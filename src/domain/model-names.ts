/**
 * Turning model ids into the human-readable names that go in the signature.
 *
 * Pure domain: no imports, no clock, no IO. The catalogue arrives as already
 * parsed JSON (or already read cache text); the caller supplies timestamps.
 */

/** One usable model: full org-qualified id + the name we would sign. */
export interface RawModelEntry {
  id: string;
  name: string;
}

/** The parsed, deduplicated, key-sorted list of usable text models. */
export interface ModelCatalogue {
  models: RawModelEntry[];
}

/** The cache text's first line: a version gate and the age clock. */
const CACHE_VERSION = 1;
const MAX_CACHE_LINE_BYTES = 4096;
const MAX_NAME_LENGTH = 80;

/**
 * Fold digit.digit to digit-digit: "glm-5.3" -> "glm-5-3".
 * The one normalizer shared by key derivation and lookup — both sides of
 * every comparison go through this, so dotted and dashed ids can never
 * disagree.
 */
export function foldKey(id: string): string {
  return id.replace(/(\d)\.(\d)/g, "$1-$2");
}

/**
 * Normalize a model id for LOOKUP: lowercase, strip dates (-YYYY-MM-DD) and
 * 7+ hex hashes, @ -> /, then fold dots-to-dashes LAST. The org prefix is
 * kept — the substring pass is position-indifferent. Bedrock -v1:0 style
 * decorations are NOT stripped here: the substring pass absorbs trailing
 * noise by construction ("…claude-opus-5-v1:0" contains "claude-opus-5").
 */
export function normalizeModelId(modelId: string): string {
  return foldKey(
    modelId
      .toLowerCase()
      .replace(/-\d{4}-\d{2}-\d{2}/g, "")
      .replace(/-[a-f0-9]{7,}/g, "")
      .replace(/@/g, "/"),
  );
}

/**
 * Derive a display name from a model id for models no catalogue knows.
 * NOT folded — version digits render as dots. Bedrock chain separators
 * ("us.anthropic.claude-opus-4-8-v1:0") split on "." and "/", but a dot
 * between digits is a version ("granite3.3") and never a separator.
 * Leading region tokens (us|eu|apac|apne1|global) drop; "-v1:0" suffixes
 * and "[1m]" markers clean; word tokens join with spaces:
 * "claude-opus-4-8" -> "Claude Opus 4.8".
 */
export function displayModelId(modelId: string): string {
  const cleaned = modelId
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-v\d+(:\d+)?$/, "")
    .replace(/:\d+$/, "");
  const segments = cleaned
    .split(/(?<!\d)\.|\.(?!\d)|\//)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const regions = new Set(["us", "eu", "apac", "apne1", "global"]);
  const kept = segments.filter((segment, i) => !(i === 0 && regions.has(segment.toLowerCase())));
  return kept
    .map((segment) =>
      segment
        .replace(/(\d)-(\d)/g, "$1.$2")
        .split("-")
        .filter(Boolean)
        .map((part) => {
          if (/^\d+(\.\d+)?$/.test(part)) return part;
          if (/^\d+[a-z]$/i.test(part)) return part.toUpperCase();
          if (/^[a-z]+$/.test(part) && !/[aeiou]/.test(part)) return part.toUpperCase();
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(" "),
    )
    .filter(Boolean)
    .join(" ");
}

/**
 * Make a catalogue-provided name safe to embed in a commit message or PR
 * body: control characters (the injection vector) die here, whitespace
 * collapses, absurd length is capped. Returns "" when nothing usable
 * remains — the caller then derives from the id.
 */
export function sanitizeName(name: string): string {
  let s = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > MAX_NAME_LENGTH) s = s.slice(0, MAX_NAME_LENGTH).trimEnd();
  return s;
}

/** Everything after the last "/" of an org-qualified id. */
function modelPart(id: string): string {
  const idx = id.lastIndexOf("/");
  return idx === -1 ? id : id.slice(idx + 1);
}

/**
 * Derive the display name when the catalogue gave none: same rules as the
 * fallback renderer, applied to the bare model part.
 */
function deriveDisplayName(id: string): string {
  return displayModelId(modelPart(id));
}

/**
 * Build the lookup index: keys are normalized org-stripped ids (folded),
 * pre-sorted longest-first so the substring pass tries the most specific
 * key first — generic keys cannot shadow specific ones.
 */
export function prepareModels(catalogue: ModelCatalogue): { keys: string[]; names: Map<string, string> } {
  const names = new Map<string, string>();
  for (const entry of catalogue.models) {
    const key = modelPart(normalizeModelId(entry.id));
    if (key && !names.has(key)) names.set(key, entry.name);
  }
  const keys = [...names.keys()].sort((a, b) => b.length - a.length);
  return { keys, names };
}

/**
 * Resolve a raw model id to its catalogue name: exact key hit, then the
 * longest normalized key contained in the normalized query, then null —
 * the caller renders the fallback via displayModelId.
 */
export function lookupModelName(
  index: { keys: string[]; names: Map<string, string> },
  query: string,
): string | null {
  const normalized = normalizeModelId(query);
  if (!normalized) return null;
  const exact = index.names.get(modelPart(normalized));
  if (exact !== undefined) return exact;
  for (const key of index.keys) {
    if (normalized.includes(key)) {
      const name = index.names.get(key);
      if (name !== undefined) return name;
    }
  }
  return null;
}

/** The cache/index key of an entry: normalized, org-stripped, folded. */
function cacheKey(id: string): string {
  return modelPart(normalizeModelId(id));
}

const SUFFIX_RE = /:(free|batch|thinking)$/;

interface RawItem {
  id?: unknown;
  name?: unknown;
  created?: unknown;
  pricing?: unknown;
  architecture?: unknown;
}

interface RawCandidate {
  /** Suffix-stripped, org-qualified id. */
  id: string;
  item: RawItem;
  /** True when the entry only exists because its ":free"-style base is absent. */
  fromSuffix: boolean;
}

/**
 * Parse OpenRouter's /api/v1/models response into the usable catalogue.
 *
 * The funnel (stage counts are today's live catalogue, 420 in):
 *   S1  keep entries with a non-empty string id                 (420)
 *   S2  drop "~" auto-aliases                                    (408)
 *   S3  strip :free/:batch/:thinking and dedupe — an exact base
 *       beats its suffixed variants; a suffixed entry survives
 *       only as an orphan when no base exists                    (337)
 *   S4  drop routers: the openrouter/* org, or pricing.prompt
 *       === "-1" — never a name list, those rot                  (331)
 *   S5  drop non-text output: architecture.output_modalities must
 *       be exactly ["text"]; a missing architecture field keeps
 *       the entry (false-keep costs one dead line, false-drop
 *       loses a real model)                                      (318)
 *   S6  build entries: name from the display name (vendor prefix
 *       stripped, orphan "(free)" tag stripped, sanitized), else
 *       derived from the id
 *   S7  resolve folded-key collisions: non-orphan over orphan,
 *       then the newer model, tie by id — survivor selection only
 *   S8  sort by key
 *
 * Returns null when the shape is unusable: data not a non-empty
 * array, links.next set (pagination turned on), or total_count
 * larger than the payload — never silently accept a partial
 * catalogue.
 */
export function parseCatalogueResponse(body: unknown): ModelCatalogue | null {
  if (typeof body !== "object" || body === null) return null;
  const root = body as { data?: unknown; total_count?: unknown; links?: unknown };
  if (!Array.isArray(root.data) || root.data.length === 0) return null;
  if (typeof root.total_count === "number" && root.total_count > root.data.length) return null;
  if (
    typeof root.links === "object" &&
    root.links !== null &&
    (root.links as { next?: unknown }).next != null
  ) {
    return null;
  }

  // S3 needs the suffix-stripped id, so S1/S2 filter in place first.
  const byBase = new Map<string, RawCandidate>();
  for (const item of root.data as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const model = item as RawItem;
    if (typeof model.id !== "string" || model.id.length === 0) continue;
    if (model.id.startsWith("~")) continue;

    const match = SUFFIX_RE.exec(model.id);
    if (match === null) {
      byBase.set(model.id, { id: model.id, item, fromSuffix: false });
    } else {
      const base = model.id.slice(0, model.id.length - match[0].length);
      const existing = byBase.get(base);
      if (existing === undefined || existing.fromSuffix) {
        byBase.set(base, { id: base, item, fromSuffix: true });
      }
    }
  }

  const entries: (RawModelEntry & { fromSuffix: boolean; created: number })[] = [];
  for (const { id, item, fromSuffix } of byBase.values()) {
    // S4: routers.
    if (id.startsWith("openrouter/")) continue;
    const pricing = item.pricing as { prompt?: unknown } | undefined;
    if (pricing !== null && typeof pricing === "object" && pricing.prompt === "-1") continue;

    // S5: text-only output; missing architecture keeps the entry.
    const architecture = item.architecture as { output_modalities?: unknown } | undefined;
    if (
      architecture !== null &&
      typeof architecture === "object" &&
      Array.isArray(architecture.output_modalities)
    ) {
      const out = architecture.output_modalities;
      if (out.length !== 1 || out[0] !== "text") continue;
    }

    // S6: the name we would sign.
    let name = typeof item.name === "string" ? item.name.replace(/^[^:]{1,40}:\s*/, "") : "";
    if (fromSuffix) name = name.replace(/\s\((free|batch)\)$/, "");
    name = sanitizeName(name);
    if (name === "") name = deriveDisplayName(id);

    const created = typeof item.created === "number" ? item.created : 0;
    entries.push({ id, name, fromSuffix, created });
  }

  // S7: folded-key collisions resolve by survivor selection.
  const survivors = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    const key = cacheKey(entry.id);
    const winner = survivors.get(key);
    if (winner === undefined) {
      survivors.set(key, entry);
      continue;
    }
    if (winner.fromSuffix === entry.fromSuffix) {
      // Same class: newer wins, id breaks exact ties.
      if (entry.created > winner.created || (entry.created === winner.created && entry.id < winner.id)) {
        survivors.set(key, entry);
      }
    } else if (!entry.fromSuffix) {
      survivors.set(key, entry);
    }
  }

  // S8: sort by key — the only ordering, kept identical in serializeCache.
  const models = [...survivors.values()]
    .sort((a, b) => (cacheKey(a.id) < cacheKey(b.id) ? -1 : cacheKey(a.id) > cacheKey(b.id) ? 1 : 0))
    .map(({ id, name }) => ({ id, name }));
  return { models };
}

/**
 * Parse the cache text. Line 1 is mandatory meta {"v":1,"fetchedAt":<unix
 * ms>} — anything else (or a version we do not know) is not a cache and
 * yields null. Entry lines are {"id":…,"name":…}; a corrupt or oversized
 * line is skipped, the rest survive; zero valid entries yield null.
 */
export function parseCache(text: string): { fetchedAt: number; models: RawModelEntry[] } | null {
  const lines = text.split("\n");
  if (lines.length === 0) return null;

  let meta: { v?: unknown; fetchedAt?: unknown };
  try {
    const parsed = JSON.parse(lines[0]) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    meta = parsed as { v?: unknown; fetchedAt?: unknown };
  } catch {
    return null;
  }
  if (meta.v !== CACHE_VERSION) return null;
  if (typeof meta.fetchedAt !== "number") return null;

  const models: RawModelEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || line.length > MAX_CACHE_LINE_BYTES) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const entry = parsed as { id?: unknown; name?: unknown };
    if (typeof entry.id !== "string" || entry.id.length === 0) continue;
    if (typeof entry.name !== "string") continue;
    models.push({ id: entry.id, name: entry.name });
  }

  if (models.length === 0) return null;
  return { fetchedAt: meta.fetchedAt, models };
}

/**
 * Render the cache text: the meta line, then one line per entry, sorted
 * by key — byte-stable round-trips with the pipeline's own ordering.
 */
export function serializeCache(fetchedAt: number, entries: RawModelEntry[]): string {
  const meta = `{"v":${CACHE_VERSION},"fetchedAt":${fetchedAt}}`;
  const lines = entries
    .slice()
    .sort((a, b) => (cacheKey(a.id) < cacheKey(b.id) ? -1 : cacheKey(a.id) > cacheKey(b.id) ? 1 : 0))
    .map((entry) => JSON.stringify({ id: entry.id, name: entry.name }));
  return [meta, ...lines].join("\n") + "\n";
}
