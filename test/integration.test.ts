import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModelRegistry } from "../src/app/model-registry";
import { serializeCache } from "../src/domain/model-names";
import { createModelCacheStore } from "../src/infra/model-cache";
import { PRSignaturePlugin } from "../src/plugin";

const directories: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-pr-signature-integration-"));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function bodyOf(models: unknown[]): unknown {
  return { data: models, total_count: models.length, links: { next: null } };
}

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

describe("integration", () => {
  test("registry end-to-end over real files: stale cache refreshes on disk", async () => {
    const path = join(tempDir(), "models.jsonl");
    const store = createModelCacheStore(path);
    // A cache from yesterday, holding yesterday's names.
    writeFileSync(path, serializeCache(1, [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }]));

    const registry = createModelRegistry({
      store,
      fetchCatalogue: async () => bodyOf(bigCatalogue()),
      now: () => 25 * 60 * 60 * 1000, // a day later
    });
    registry.seedFromCache();
    expect(registry.get("glm-5.3")).toBe("GLM 5.3");

    await registry.ensureFresh();

    expect(registry.get("glm-5.3")).toBe("GLM 5.3");
    expect(registry.get("glm-9.9")).toBe("GLM 9.9");
    const onDisk = readFileSync(path, "utf8");
    expect(onDisk.startsWith('{"v":1,"fetchedAt":')).toBe(true);
    expect(onDisk).toContain('"z-ai/glm-9.9"');
  });

  test("plugin wiring: the hook resolves while the fetch is pending; resolving it lands the cache", async () => {
    const path = join(tempDir(), "models.jsonl");
    writeFileSync(path, serializeCache(1, [{ id: "z-ai/glm-5.3", name: "GLM 5.3" }]));

    let resolveFetch!: (body: unknown) => void;
    const fetchCatalogue = () =>
      new Promise<unknown>((resolve) => {
        resolveFetch = resolve;
      });

    const plugin = await PRSignaturePlugin({} as never, { cachePath: path, fetchCatalogue });

    // The hook completes even though the background fetch has not.
    await plugin["chat.message"]!({ model: { providerID: "zai", modelID: "glm-5.3" } } as never, {} as never);
    const before = { args: { body: "pr body" } };
    await plugin["tool.execute.before"]!({ tool: "github_create_pull_request", sessionID: "", callID: "" } as never, before as never);
    expect(before.args.body).toContain("(GLM 5.3)");

    resolveFetch(bodyOf(bigCatalogue()));

    // The background chain finishes asynchronously; wait for the disk to show it.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (readFileSync(path, "utf8").includes("glm-9.9")) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    await plugin["chat.message"]!({ model: { providerID: "zai", modelID: "glm-9.9" } } as never, {} as never);
    const after = { args: { body: "pr body" } };
    await plugin["tool.execute.before"]!({ tool: "github_create_pull_request", sessionID: "", callID: "" } as never, after as never);
    expect(after.args.body).toContain("(GLM 9.9)");
  });
});
