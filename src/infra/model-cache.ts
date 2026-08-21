/**
 * The JSONL cache file behind the registry's store port.
 *
 * Reading is size-capped before it starts; writing lands on disk the only
 * way a concurrent reader can never see a torn file — a unique temporary
 * in the same directory, renamed over the target.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ModelCacheStorePort } from "../app/model-registry";
import { parseCache, serializeCache } from "../domain/model-names";

export function createModelCacheStore(
  path: string,
  opts: { maxFileBytes?: number } = {},
): ModelCacheStorePort {
  const maxFileBytes = opts.maxFileBytes ?? 2 * 1024 * 1024;

  return {
    read() {
      let size: number;
      try {
        const stats = statSync(path);
        if (!stats.isFile()) return null;
        size = stats.size;
      } catch {
        return null; // absent — the common case on a fresh install
      }
      if (size > maxFileBytes) return null; // not ours; refuse to even read it
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        return null;
      }
      return parseCache(text);
    },

    write(cache) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(tmp, serializeCache(cache.fetchedAt, cache.models));
      renameSync(tmp, path);
    },
  };
}
