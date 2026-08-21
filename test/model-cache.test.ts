import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModelCacheStore } from "../src/infra/model-cache";
import { serializeCache } from "../src/domain/model-names";

const directories: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-pr-signature-cache-"));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const CACHE = { fetchedAt: 1_755_820_800_000, models: [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }] };

describe("model cache store", () => {
  test("an absent file reads as null", () => {
    const store = createModelCacheStore(join(tempDir(), "models.jsonl"));
    expect(store.read()).toBeNull();
  });

  test("write then read round-trips", () => {
    const path = join(tempDir(), "nested", "models.jsonl");
    const store = createModelCacheStore(path);
    store.write(CACHE);
    expect(store.read()).toEqual(CACHE);
  });

  test("a write leaves no temporary residue, only the cache file", () => {
    const dir = tempDir();
    const store = createModelCacheStore(join(dir, "models.jsonl"));
    store.write(CACHE);
    store.write({ ...CACHE, fetchedAt: CACHE.fetchedAt + 1000 });
    expect(readdirSync(dir).sort()).toEqual(["models.jsonl"]);
  });

  test("two stores writing the same path both land whole — last rename wins", () => {
    const dir = tempDir();
    const path = join(dir, "models.jsonl");
    const a = createModelCacheStore(path);
    const b = createModelCacheStore(path);
    a.write(CACHE);
    b.write({ fetchedAt: 42, models: [{ id: "acme/other", name: "Other" }] });
    const read = a.read();
    expect(read).toEqual({ fetchedAt: 42, models: [{ id: "acme/other", name: "Other" }] });
    expect(readdirSync(dir).sort()).toEqual(["models.jsonl"]);
  });

  test("an oversized file reads as null without being parsed", () => {
    const dir = tempDir();
    const path = join(dir, "models.jsonl");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, serializeCache(1, CACHE.models) + "x".repeat(200));
    const store = createModelCacheStore(path, { maxFileBytes: 100 });
    expect(store.read()).toBeNull();
    expect(existsSync(path)).toBe(true); // refusal to read is not deletion
  });

  test("a corrupt file reads as null", () => {
    const dir = tempDir();
    const path = join(dir, "models.jsonl");
    writeFileSync(path, "not a cache at all\n");
    expect(createModelCacheStore(path).read()).toBeNull();
  });

  test("the written text is the domain serialization", () => {
    const dir = tempDir();
    const path = join(dir, "models.jsonl");
    createModelCacheStore(path).write(CACHE);
    expect(readFileSync(path, "utf8")).toBe(serializeCache(CACHE.fetchedAt, CACHE.models));
  });
});
