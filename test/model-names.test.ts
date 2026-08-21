import { describe, expect, test } from "bun:test";
import {
  displayModelId,
  lookupModelName,
  normalizeModelId,
  parseCache,
  parseCatalogueResponse,
  prepareModels,
  sanitizeName,
  serializeCache,
  type RawModelEntry,
} from "../src/domain/model-names";

/**
 * A 19-model slice of OpenRouter's real /api/v1/models response (fields
 * trimmed to the ones the pipeline reads, values verbatim). One model per
 * pipeline branch; live counts are deliberately not asserted.
 */
const REAL_SLICE = [
  { id: "~z-ai/glm-latest", name: "Z.ai: GLM Latest", created: 1787151053, pricing: { prompt: "0.0000014" }, architecture: { output_modalities: ["text"] } },
  { id: "z-ai/glm-5.2", name: "Z.ai: GLM 5.2", created: 1781631930, pricing: { prompt: "0.000000966" }, architecture: { output_modalities: ["text"] } },
  { id: "z-ai/glm-5.2:free", name: "Z.ai: GLM 5.2 (free)", created: 1781631930, pricing: { prompt: "0" }, architecture: { output_modalities: ["text"] } },
  { id: "dots-studio/dots-3-note-preview:free", name: "Dots Studio: Dots3-Note Preview (free)", created: 1786680361, pricing: { prompt: "0" }, architecture: { output_modalities: ["text"] } },
  { id: "anthropic/claude-opus-4.5:batch", name: "Anthropic: Claude Opus 4.5 (batch)", created: 1764010580, pricing: { prompt: "0.0000025" }, architecture: { output_modalities: ["text"] } },
  { id: "qwen/qwen-plus-2025-07-28", name: "Qwen: Qwen Plus 0728", created: 1757347599, pricing: { prompt: "0.00000026" }, architecture: { output_modalities: ["text"] } },
  { id: "qwen/qwen-plus", name: "Qwen: Qwen-Plus", created: 1738409840, pricing: { prompt: "0.00000026" }, architecture: { output_modalities: ["text"] } },
  { id: "openrouter/auto", name: "Auto Router", created: 1699401600, pricing: { prompt: "-1" }, architecture: { output_modalities: ["text"] } },
  { id: "openrouter/free", name: "Free Models Router", created: 1769917427, pricing: { prompt: "0" }, architecture: { output_modalities: ["text"] } },
  { id: "google/gemini-2.5-flash-image", name: "Google: Nano Banana (Gemini 2.5 Flash Image)", created: 1759870431, pricing: { prompt: "0.0000003" }, architecture: { output_modalities: ["image"] } },
  { id: "google/lyria-3-pro-preview", name: "Google: Lyria 3 Pro Preview", created: 1774907286, pricing: { prompt: "0" }, architecture: { output_modalities: ["audio"] } },
  { id: "deepseek/deepseek-v4-flash-vision-exp", name: "DeepSeek: DeepSeek V4 Flash Vision Exp", created: 1787311563, pricing: { prompt: "0.00000022" }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
  { id: "z-ai/glm-5.3", name: "Z.ai: GLM 5.3", created: 1787086655, pricing: { prompt: "0.0000014" }, architecture: { output_modalities: ["text"] } },
  { id: "tencent/hy3", name: "Tencent: Hy3", created: 1783344048, pricing: { prompt: "0.000000132" }, architecture: { output_modalities: ["text"] } },
  { id: "stealth/ox-alpha", name: "Ox Alpha", created: 1787256295, pricing: { prompt: "0" }, architecture: { output_modalities: ["text"] } },
  { id: "moonshotai/kimi-k2.5", name: "MoonshotAI: Kimi K2.5", created: 1769487076, pricing: { prompt: "0.00000045" }, architecture: { output_modalities: ["text"] } },
  { id: "x-ai/grok-4.6", name: "SpaceXAI: Grok 4.6", created: 1786548957, pricing: { prompt: "0.000002" }, architecture: { output_modalities: ["text"] } },
  { id: "openai/gpt-4o", name: "OpenAI: GPT-4o", created: 1715558400, pricing: { prompt: "0.0000025" }, architecture: { output_modalities: ["text"] } },
  { id: "openai/gpt-4o-2024-05-13", name: "OpenAI: GPT-4o (2024-05-13)", created: 1715558400, pricing: { prompt: "0.000005" }, architecture: { output_modalities: ["text"] } },
];

const parseOf = (models: unknown[]) => parseCatalogueResponse({ data: models, total_count: models.length, links: { next: null } });
const namesOf = (models: unknown[]) => (parseOf(models)?.models ?? []).map((m) => m.name);

describe("parseCatalogueResponse", () => {
  test("golden: the real slice funnels to exactly these entries, sorted by key", () => {
    const catalogue = parseOf(REAL_SLICE);
    expect(catalogue).not.toBeNull();
    expect(catalogue!.models).toEqual([
      { id: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5 (batch)" }, // orphan :batch keeps its variant tag
      { id: "deepseek/deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp" },
      { id: "dots-studio/dots-3-note-preview", name: "Dots3-Note Preview" }, // orphan :free, "(free)" stripped
      { id: "z-ai/glm-5.2", name: "GLM 5.2" }, // base beats its :free variant
      { id: "z-ai/glm-5.3", name: "GLM 5.3" },
      { id: "openai/gpt-4o", name: "GPT-4o" }, // date-suffix collision, tie on created, id breaks it
      { id: "x-ai/grok-4.6", name: "Grok 4.6" },
      { id: "tencent/hy3", name: "Hy3" },
      { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
      { id: "stealth/ox-alpha", name: "Ox Alpha" }, // no vendor prefix to strip
      { id: "qwen/qwen-plus-2025-07-28", name: "Qwen Plus 0728" }, // date-stripped key collision, newer survives
    ]);
  });

  test("alias: ids starting with ~ are dropped", () => {
    expect(namesOf([{ id: "~openai/gpt-latest", name: "OpenAI: GPT Latest", pricing: {}, architecture: { output_modalities: ["text"] } }])).toEqual([]);
    expect(namesOf([{ id: "openai/gpt-5", name: "OpenAI: GPT-5", pricing: {}, architecture: { output_modalities: ["text"] } }])).toEqual(["GPT-5"]);
  });

  test("suffix dedupe: an exact base replaces a previously seen suffixed entry", () => {
    const models = [
      { id: "z-ai/glm-5.2:free", name: "Z.ai: GLM 5.2 (free)", pricing: {}, architecture: { output_modalities: ["text"] } },
      { id: "z-ai/glm-5.2", name: "Z.ai: GLM 5.2", pricing: {}, architecture: { output_modalities: ["text"] } },
    ];
    expect(parseOf(models)!.models).toEqual([{ id: "z-ai/glm-5.2", name: "GLM 5.2" }]);
  });

  test("thinking suffix strips like free and batch", () => {
    const models = [{ id: "qwen/qwen-plus:thinking", name: "Qwen: Qwen Plus", pricing: {}, architecture: { output_modalities: ["text"] } }];
    expect(parseOf(models)!.models).toEqual([{ id: "qwen/qwen-plus", name: "Qwen Plus" }]);
  });

  test("routers: the openrouter org drops even when prompt is 0", () => {
    const models = [{ id: "openrouter/free", name: "Free Models Router", pricing: { prompt: "0" }, architecture: { output_modalities: ["text"] } }];
    // Shape is fine, so this is a valid (if empty) catalogue — the caller's
    // entry floor decides what to do with it, not the parser.
    expect(parseOf(models)!.models).toEqual([]);
  });

  test("routers: prompt -1 drops outside the openrouter org", () => {
    const models = [
      { id: "acme/cheap-router", name: "Acme Router", pricing: { prompt: "-1" }, architecture: { output_modalities: ["text"] } },
      { id: "acme/real", name: "Acme Real", pricing: { prompt: "0.001" }, architecture: { output_modalities: ["text"] } },
    ];
    expect(parseOf(models)!.models).toEqual([{ id: "acme/real", name: "Acme Real" }]);
  });

  test("non-text output drops; image INPUT with text output keeps", () => {
    const models = [
      { id: "google/lyria", name: "Google: Lyria", pricing: {}, architecture: { output_modalities: ["audio"] } },
      { id: "google/vision-text", name: "Google: Vision Text", pricing: {}, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
    ];
    expect(parseOf(models)!.models).toEqual([{ id: "google/vision-text", name: "Vision Text" }]);
  });

  test("missing architecture keeps the entry (lenient)", () => {
    const models = [{ id: "acme/no-arch", name: "Acme: No Arch", pricing: {} }];
    expect(parseOf(models)!.models).toEqual([{ id: "acme/no-arch", name: "No Arch" }]);
  });

  test("missing name derives from the id", () => {
    const models = [{ id: "acme/granite-xl", pricing: {}, architecture: { output_modalities: ["text"] } }];
    expect(parseOf(models)!.models).toEqual([{ id: "acme/granite-xl", name: "Granite XL" }]);
  });

  test("non-string ids and non-object entries are skipped silently", () => {
    const models = [
      { id: 42, name: "Broken", pricing: {}, architecture: { output_modalities: ["text"] } },
      "just a string",
      null,
      { id: "", name: "Empty", pricing: {}, architecture: { output_modalities: ["text"] } },
      { id: "acme/kept", name: "Acme: Kept", pricing: {}, architecture: { output_modalities: ["text"] } },
    ];
    expect(parseOf(models)!.models).toEqual([{ id: "acme/kept", name: "Kept" }]);
  });

  test("collision policy: non-orphan beats orphan regardless of created", () => {
    // No base exists, so the :free entry survives S3 as an orphan; the dated
    // snapshot strips to the same key without ever being a suffixed variant.
    const models = [
      { id: "acme/pro.2:free", name: "Acme: Pro 2 (free)", created: 9_000, pricing: {}, architecture: { output_modalities: ["text"] } },
      { id: "acme/pro.2-2024-01-01", name: "Acme: Pro 2 Old", created: 1_000, pricing: {}, architecture: { output_modalities: ["text"] } },
    ];
    expect(parseOf(models)!.models).toEqual([{ id: "acme/pro.2-2024-01-01", name: "Pro 2 Old" }]);
  });

  test("pagination guard: links.next set -> null", () => {
    const body = { data: REAL_SLICE, total_count: REAL_SLICE.length, links: { next: "https://openrouter.ai/api/v1/models?page=2" } };
    expect(parseCatalogueResponse(body)).toBeNull();
  });

  test("pagination guard: total_count beyond the payload -> null", () => {
    const body = { data: REAL_SLICE, total_count: REAL_SLICE.length + 1, links: { next: null } };
    expect(parseCatalogueResponse(body)).toBeNull();
  });

  test("shape guard: unusable bodies yield null", () => {
    expect(parseCatalogueResponse(null)).toBeNull();
    expect(parseCatalogueResponse("string")).toBeNull();
    expect(parseCatalogueResponse({})).toBeNull();
    expect(parseCatalogueResponse({ data: "no" })).toBeNull();
    expect(parseCatalogueResponse({ data: [] })).toBeNull();
  });

  test("shape guard: absent links/total_count tolerated (additive drift)", () => {
    const body = { data: [{ id: "acme/bare", name: "Acme: Bare", pricing: {}, architecture: { output_modalities: ["text"] } }] };
    expect(parseCatalogueResponse(body)!.models).toEqual([{ id: "acme/bare", name: "Bare" }]);
  });
});

describe("normalizeModelId", () => {
  test("dots fold to dashes; the org prefix is kept for the position-indifferent substring pass", () => {
    expect(normalizeModelId("qwen/qwen3.8-max")).toBe("qwen/qwen3-8-max");
    expect(normalizeModelId("qwen3-8-max")).toBe("qwen3-8-max");
    expect(normalizeModelId("Qwen/Qwen3.8-Max")).toBe("qwen/qwen3-8-max");
  });

  test("strips dates and hashes, @ becomes /", () => {
    expect(normalizeModelId("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(normalizeModelId("claude-3-5-sonnet-abc123def")).toBe("claude-3-5-sonnet");
    expect(normalizeModelId("anthropic@claude-opus-4.6")).toBe("anthropic/claude-opus-4-6");
  });

  test("keeps trailing -v1:0 decorations (the substring pass absorbs them)", () => {
    expect(normalizeModelId("us.anthropic.claude-opus-4-8-v1:0")).toBe("us.anthropic.claude-opus-4-8-v1:0");
  });
});

describe("displayModelId", () => {
  test("the accepted samples", () => {
    expect(displayModelId("us.anthropic.claude-opus-4-8-v1:0")).toBe("Anthropic Claude Opus 4.8");
    expect(displayModelId("claude-opus-5[1m]")).toBe("Claude Opus 5");
    expect(displayModelId("ollama/granite3.3")).toBe("Ollama Granite3.3");
    expect(displayModelId("glm-5.2")).toBe("GLM 5.2");
    expect(displayModelId("claude-3-5-sonnet")).toBe("Claude 3.5 Sonnet");
    expect(displayModelId("us.amazon.nova-2-pro-v1:0")).toBe("Amazon Nova 2 Pro");
    expect(displayModelId("kimi-k2.5-turbo")).toBe("Kimi K2.5 Turbo");
    expect(displayModelId("ernie-4.5-turbo")).toBe("Ernie 4.5 Turbo");
    expect(displayModelId("llama-3-1-8b-instruct")).toBe("Llama 3.1 8B Instruct");
  });

  test("region token drops only in leading position", () => {
    expect(displayModelId("eu.mistral-large")).toBe("Mistral Large");
    expect(displayModelId("mistral-large-eu")).toBe("Mistral Large Eu");
  });
});

describe("sanitizeName", () => {
  test("control characters die (signature-injection vector), whitespace collapses", () => {
    expect(sanitizeName("Bad\nName\r\u0003here  with   spaces")).toBe("Bad Name here with spaces");
    expect(sanitizeName("ls\u2028a\u2029b")).toBe("ls a b");
  });

  test("capped at 80 characters", () => {
    expect(sanitizeName("x".repeat(100)).length).toBe(80);
  });

  test("empty (or control-only) names come back empty for the caller to derive", () => {
    expect(sanitizeName("   ")).toBe("");
    expect(sanitizeName("\n\t")).toBe("");
  });
});

describe("lookupModelName", () => {
  const index = prepareModels({
    models: [
      { id: "z-ai/glm-5.3", name: "GLM 5.3" },
      { id: "z-ai/glm-5", name: "GLM-5" },
      { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
    ],
  });

  test("exact hit, through dotted, dashed, org-prefixed and decorated spellings", () => {
    expect(lookupModelName(index, "glm-5.3")).toBe("GLM 5.3");
    expect(lookupModelName(index, "glm-5-3")).toBe("GLM 5.3");
    expect(lookupModelName(index, "zai-coding-plan/glm-5.3")).toBe("GLM 5.3");
    expect(lookupModelName(index, "us.anthropic.claude-opus-4-8-v1:0")).toBe("Claude Opus 4.8");
  });

  test("substring pass resolves the longest key first", () => {
    expect(lookupModelName(index, "glm-5.3-preview")).toBe("GLM 5.3");
    expect(lookupModelName(index, "glm-5-turbo")).toBe("GLM-5");
  });

  test("unknown ids yield null — the fallback is the caller's job", () => {
    expect(lookupModelName(index, "ernie-4.5-turbo")).toBeNull();
    expect(lookupModelName(index, "")).toBeNull();
  });
});

describe("cache", () => {
  const entries: RawModelEntry[] = [
    { id: "z-ai/glm-5.3", name: "GLM 5.3" },
    { id: "acme/beta", name: "Beta" },
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
  ];

  test("round-trip is byte-stable and order-preserving", () => {
    const text = serializeCache(1755820800000, entries);
    const parsed = parseCache(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.fetchedAt).toBe(1755820800000);
    expect(serializeCache(parsed!.fetchedAt, parsed!.models)).toBe(text);
    expect(text.split("\n")[0]).toBe('{"v":1,"fetchedAt":1755820800000}');
  });

  test("sorted by key (org-stripped, folded) regardless of input order", () => {
    const lines = serializeCache(1, entries).trim().split("\n").slice(1);
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([
      "acme/beta",
      "anthropic/claude-opus-4.8",
      "z-ai/glm-5.3",
    ]);
  });

  test("corrupt and oversized lines are skipped, the rest survive", () => {
    const oversizeId = "a".repeat(4096); // valid JSON, only the length guard can drop it
    const text = [
      '{"v":1,"fetchedAt":5}',
      '{"id":"z-ai/glm-5.3","name":"GLM 5.3"}',
      "{not json",
      '{"id":42,"name":"Broken"}',
      '{"id":"acme/no-name"}',
      '{"id":"acme/fine","name":"Fine"}',
      `{"id":"${oversizeId}","name":"Oversize"}`,
    ].join("\n");
    const parsed = parseCache(text);
    expect(parsed!.models).toEqual([
      { id: "z-ai/glm-5.3", name: "GLM 5.3" },
      { id: "acme/fine", name: "Fine" },
    ]);
  });

  test("a cache without a usable meta line is not a cache", () => {
    expect(parseCache('{"id":"z-ai/glm-5.3","name":"GLM 5.3"}')).toBeNull();
    expect(parseCache('{"v":2,"fetchedAt":5}\n{"id":"a","name":"A"}')).toBeNull();
    expect(parseCache('{"v":1,"fetchedAt":"soon"}\n{"id":"a","name":"A"}')).toBeNull();
    expect(parseCache("not json\n{\"id\":\"a\",\"name\":\"A\"}")).toBeNull();
  });

  test("zero valid entries yields null", () => {
    expect(parseCache('{"v":1,"fetchedAt":5}\n')).toBeNull();
    expect(parseCache('{"v":1,"fetchedAt":5}\ngarbage')).toBeNull();
  });
});
