/**
 * The one owner of model-name state and its refresh sequence.
 *
 * Policy lives here, mechanics live at the edges: the catalogue arrives
 * through an injectable fetch, persistence through a store port, and the
 * clock through an injectable now. Everything the plugin needs is the
 * synchronous get() plus a fire-and-forget ensureFresh() that never
 * rejects — a signature must never fail because a catalogue didn't load.
 */

import {
  displayModelId,
  lookupModelName,
  parseCatalogueResponse,
  prepareModels,
  type RawModelEntry,
} from "../domain/model-names";

/** Persistence boundary: the cache file, behind an interface. */
export interface ModelCacheStorePort {
  read(): { fetchedAt: number; models: RawModelEntry[] } | null;
  write(cache: { fetchedAt: number; models: RawModelEntry[] }): void;
}

/** Network boundary: one bounded catalogue request. */
export type FetchCatalogue = (signal: AbortSignal) => Promise<unknown>;

export interface RegistryOptions {
  store: ModelCacheStorePort;
  fetchCatalogue: FetchCatalogue;
  now?: () => number;
  freshForMs?: number;
  failureBackoffMs?: number;
  minEntries?: number;
}

export interface ModelRegistry {
  /** Load the cache synchronously; an absent or unusable cache seeds nothing. */
  seedFromCache(): void;
  /** The formatted model name for a signature; never throws. */
  get(model: { providerID: string; modelID: string } | string | undefined): string;
  /** Refresh when stale; coalesces concurrent callers; never rejects. */
  ensureFresh(): Promise<void>;
}

const HOUR_MS = 60 * 60 * 1000;

export function createModelRegistry(opts: RegistryOptions): ModelRegistry {
  const now = opts.now ?? Date.now;
  const freshForMs = opts.freshForMs ?? 24 * HOUR_MS;
  const failureBackoffMs = opts.failureBackoffMs ?? HOUR_MS;
  const minEntries = opts.minEntries ?? 100;

  let index: ReturnType<typeof prepareModels> | null = null;
  let fetchedAt = 0;
  let lastAttempt = 0;
  let inFlight: Promise<void> | null = null;

  function seedFromCache(): void {
    const cache = opts.store.read();
    if (cache === null) return;
    index = prepareModels({ models: cache.models });
    fetchedAt = cache.fetchedAt;
  }

  function get(model: { providerID: string; modelID: string } | string | undefined): string {
    if (!model) return "Unknown Model";
    const id = typeof model === "string" ? model : model.modelID;
    if (!id) return "Unknown Model";
    if (index !== null) {
      const hit = lookupModelName(index, id);
      if (hit !== null) return hit;
    }
    return displayModelId(id);
  }

  async function attempt(t: number): Promise<void> {
    try {
      const body = await opts.fetchCatalogue(new AbortController().signal);
      const catalogue = parseCatalogueResponse(body);
      // null or suspiciously small: not a catalogue we would sign from.
      // Keep the old data and let lastAttempt hold the retry off.
      if (catalogue === null || catalogue.models.length < minEntries) return;
      index = prepareModels(catalogue);
      fetchedAt = now();
      try {
        opts.store.write({ fetchedAt, models: catalogue.models });
      } catch {
        // The swap stands and freshness advanced — a read-only cache home
        // must not turn into a refetch storm on every message.
      }
    } catch {
      // Network or parse failure: keep serving what we have.
    }
  }

  function ensureFresh(): Promise<void> {
    if (inFlight !== null) return inFlight;
    const t = now();
    if (fetchedAt > 0 && t - fetchedAt < freshForMs) return Promise.resolve();
    if (t - lastAttempt < failureBackoffMs) return Promise.resolve();
    lastAttempt = t;
    inFlight = attempt(t).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { seedFromCache, get, ensureFresh };
}
