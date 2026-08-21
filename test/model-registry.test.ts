import { describe, expect, test } from "bun:test";
import {
  createModelRegistry,
  type FetchCatalogue,
  type ModelCacheStorePort,
} from "../src/app/model-registry";
import { serializeCache, type RawModelEntry } from "../src/domain/model-names";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A deferred the test resolves by hand, so concurrency is observable. */
function deferred(): { promise: Promise<unknown>; resolve: (body: unknown) => void } {
  let resolve!: (body: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function bodyOf(models: unknown[]): unknown {
  return { data: models, total_count: models.length, links: { next: null } };
}

/** 150 generic entries plus the one the assertions look for. */
function bigCatalogue(): unknown[] {
  const models: unknown[] = Array.from({ length: 149 }, (_, i) => ({
    id: `acme/gen-${i}`,
    name: `Acme: Gen ${i}`,
    pricing: {},
    architecture: { output_modalities: ["text"] },
  }));
  models.push({
    id: "z-ai/glm-9.9",
    name: "Z.ai: GLM 9.9",
    pricing: {},
    architecture: { output_modalities: ["text"] },
  });
  return models;
}

function fakeStore(cache: { fetchedAt: number; models: RawModelEntry[] } | null): ModelCacheStorePort & {
  writes: { fetchedAt: number; models: RawModelEntry[] }[];
} {
  const writes: { fetchedAt: number; models: RawModelEntry[] }[] = [];
  return {
    writes,
    read: () => cache,
    write: (c) => {
      writes.push(c);
    },
  };
}

function registry(args: {
  store: ModelCacheStorePort;
  fetchCatalogue: FetchCatalogue;
  t?: number;
  freshForMs?: number;
  failureBackoffMs?: number;
}) {
  let t = args.t ?? 1_000_000_000_000;
  const reg = createModelRegistry({
    store: args.store,
    fetchCatalogue: args.fetchCatalogue,
    now: () => t,
    freshForMs: args.freshForMs ?? DAY,
    failureBackoffMs: args.failureBackoffMs ?? HOUR,
  });
  return {
    reg,
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
  };
}

describe("model registry", () => {
  test("seedFromCache serves cached names; an absent cache serves the fallback", () => {
    const withCache = registry({
      store: fakeStore({ fetchedAt: 1, models: [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }] }),
      fetchCatalogue: () => new Promise(() => {}),
    });
    withCache.reg.seedFromCache();
    expect(withCache.reg.get({ providerID: "zai", modelID: "glm-5.3" })).toBe("GLM 5.3");
    expect(withCache.reg.get("glm-5-3-preview")).toBe("GLM 5.3");

    const empty = registry({ store: fakeStore(null), fetchCatalogue: () => new Promise(() => {}) });
    empty.reg.seedFromCache();
    expect(empty.reg.get("claude-opus-4")).toBe("Claude Opus 4");
  });

  test("get() degenerate inputs", () => {
    const reg = createModelRegistry({ store: fakeStore(null), fetchCatalogue: () => new Promise(() => {}) });
    expect(reg.get(undefined)).toBe("Unknown Model");
    expect(reg.get({ providerID: "x" } as never)).toBe("Unknown Model");
    expect(reg.get("")).toBe("Unknown Model");
  });

  test("stale cache: fetch, swap the index, write the store", async () => {
    const store = fakeStore({ fetchedAt: 1, models: [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }] });
    let calls = 0;
    const { reg, now } = registry({
      store,
      fetchCatalogue: async () => {
        calls++;
        return bodyOf(bigCatalogue());
      },
      t: 25 * HOUR, // cache is a day old
    });
    reg.seedFromCache();
    expect(reg.get("glm-9.9")).toBe("GLM 9.9"); // fallback rendering before the fetch
    await reg.ensureFresh();
    expect(calls).toBe(1);
    expect(reg.get("glm-9.9")).toBe("GLM 9.9");
    expect(store.writes.length).toBe(1);
    expect(store.writes[0].fetchedAt).toBe(now());
  });

  test("fresh cache: no fetch at all", async () => {
    let calls = 0;
    const { reg } = registry({
      store: fakeStore({ fetchedAt: 1, models: [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }] }),
      fetchCatalogue: async () => {
        calls++;
        return bodyOf(bigCatalogue());
      },
      t: 23 * HOUR,
    });
    reg.seedFromCache();
    await reg.ensureFresh();
    expect(calls).toBe(0);
  });

  test("concurrent ensureFresh shares ONE fetch", async () => {
    const gate = deferred();
    let calls = 0;
    const { reg, advance } = registry({
      store: fakeStore(null),
      fetchCatalogue: () => {
        calls++;
        return gate.promise;
      },
    });
    const first = reg.ensureFresh();
    // Past the backoff window with the first attempt still pending: only the
    // single-flight guard can keep this from starting a second fetch.
    advance(2 * HOUR);
    const second = reg.ensureFresh();
    gate.resolve(bodyOf(bigCatalogue()));
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  test("fetch failure: no swap, no rejection, backoff holds the retry", async () => {
    const store = fakeStore({ fetchedAt: 1, models: [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }] });
    let calls = 0;
    const { reg, advance } = registry({
      store,
      fetchCatalogue: async () => {
        calls++;
        throw new Error("network down");
      },
      t: 25 * HOUR,
    });
    reg.seedFromCache();
    await reg.ensureFresh();
    expect(calls).toBe(1);
    expect(reg.get("glm-5.3")).toBe("GLM 5.3"); // old data still served

    advance(30 * 60 * 1000); // within the 1h backoff
    await reg.ensureFresh();
    expect(calls).toBe(1); // held off

    advance(HOUR + 1000); // backoff elapsed
    await reg.ensureFresh();
    expect(calls).toBe(2);
  });

  test("an unparsable body is a failure: no write, backoff engaged", async () => {
    const store = fakeStore({ fetchedAt: 1, models: [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }] });
    let calls = 0;
    const { reg, advance } = registry({
      store,
      fetchCatalogue: async () => {
        calls++;
        return { data: "junk" };
      },
      t: 25 * HOUR,
    });
    reg.seedFromCache();
    await reg.ensureFresh();
    expect(calls).toBe(1);
    expect(store.writes.length).toBe(0); // the old cache was NOT overwritten
    advance(30 * 60 * 1000);
    await reg.ensureFresh();
    expect(calls).toBe(1);
  });

  test("a tiny catalogue is a failure: the old cache file survives", async () => {
    const store = fakeStore({ fetchedAt: 1, models: [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }] });
    const { reg } = registry({
      store,
      fetchCatalogue: async () =>
        bodyOf([
          { id: "acme/only-one", name: "Acme: Only One", pricing: {}, architecture: { output_modalities: ["text"] } },
        ]),
      t: 25 * HOUR,
    });
    reg.seedFromCache();
    await reg.ensureFresh();
    expect(store.writes.length).toBe(0);
    expect(reg.get("glm-5.3")).toBe("GLM 5.3"); // no swap to the tiny catalogue
  });

  test("persist failure: the swap stands and no further fetch happens (no refetch storm)", async () => {
    const store = fakeStore({ fetchedAt: 1, models: [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }] });
    const failing: ModelCacheStorePort = {
      read: store.read,
      write: () => {
        throw new Error("read-only home");
      },
    };
    let calls = 0;
    const { reg, advance } = registry({
      store: failing,
      fetchCatalogue: async () => {
        calls++;
        return bodyOf(bigCatalogue());
      },
      t: 25 * HOUR,
    });
    reg.seedFromCache();
    await reg.ensureFresh();
    expect(reg.get("glm-9.9")).toBe("GLM 9.9"); // swapped in

    // Past the failure backoff (1h) but inside the freshness TTL: with the
    // backoff hold released, a second fetch here would prove freshness did
    // NOT advance — exactly one call proves it did. Counting the calls makes
    // the test self-sufficient: it no longer leans on the name still serving.
    advance(2 * HOUR);
    await reg.ensureFresh();
    expect(calls).toBe(1); // freshness advanced in memory — nothing retried
    expect(reg.get("glm-9.9")).toBe("GLM 9.9");
  });

  test("the written cache round-trips through the domain parser", async () => {
    const store = fakeStore(null);
    const { reg } = registry({
      store,
      fetchCatalogue: async () => bodyOf(bigCatalogue()),
    });
    await reg.ensureFresh();
    const written = store.writes[0];
    const text = serializeCache(written.fetchedAt, written.models);
    expect(text.startsWith('{"v":1,"fetchedAt":')).toBe(true);
    expect(text.split("\n").length).toBe(written.models.length + 2); // meta + entries + trailing newline
  });
});
