/**
 * The package is installed and loaded by name, and each OpenCode generation
 * finds a different entry in it. These tests install the checkout into a
 * throwaway node_modules, resolve it the way each loader does, and apply
 * each loader's own acceptance rule to what comes back:
 *
 *   OpenCode 1.0 – 1.3.3  import the package root, call EVERY export
 *                         (packages/opencode/src/plugin/index.ts@v1.0.0 … @v1.3.3)
 *   OpenCode 1.3.4 – 1.x  exports["./server"], else main; default {id, server}
 *                         (plugin/shared.ts resolvePackageEntrypoint, readV1Plugin @v1.18.32)
 *   OpenCode 2            `<name>/server`, else `<name>`; default must be an
 *                         OBJECT {id, setup} (@opencode/plugin host.js, @opencode/core Module)
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const install = mkdtempSync(join(tmpdir(), "opencode-pr-signature-install-"));
mkdirSync(join(install, "node_modules"));
symlinkSync(ROOT, join(install, "node_modules", pkg.name), "dir");
afterAll(() => rmSync(install, { force: true, recursive: true }));

const cacheDir = mkdtempSync(join(tmpdir(), "opencode-pr-signature-entry-"));
afterAll(() => rmSync(cacheDir, { force: true, recursive: true }));
const offline = { cachePath: join(cacheDir, "models.jsonl"), fetchCatalogue: () => new Promise(() => {}) };

/** Resolve a specifier from inside the install, as a host resolving the installed package does. */
function resolveFromInstall(specifier: string): string {
  return Bun.resolveSync(specifier, install);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("package manifest", () => {
  test("main and the root export name the same file", () => {
    // A resolver that ignores `exports` falls back to `main`; both must land on the legacy entry.
    expect(`./${pkg.main}`).toBe(pkg.exports["."]);
  });

  test("the published files include every entry", () => {
    expect(pkg.files).toContain("src");
    for (const target of Object.values<string>(pkg.exports)) expect(target.startsWith("./src/")).toBe(true);
  });
});

describe("OpenCode 1.0 – 1.3.3: the package root, every export called", () => {
  test("the root resolves to the legacy entry", () => {
    expect(resolveFromInstall(pkg.name)).toBe(join(ROOT, "src", "entry", "legacy.ts"));
  });

  test("every export is a plugin function and there is exactly one", async () => {
    const mod: Record<string, unknown> = await import(resolveFromInstall(pkg.name));
    // 1.0.x calls each export without deduplicating, so a second export
    // pointing at the same function would register the hooks twice.
    const hooks = [];
    for (const entry of Object.values(mod)) {
      expect(typeof entry).toBe("function");
      hooks.push(await (entry as (input: unknown, options: unknown) => Promise<Record<string, unknown>>)({}, offline));
    }

    expect(hooks).toHaveLength(1);
    expect(Object.keys(hooks[0]).sort()).toEqual(["chat.message", "tool.execute.before"]);
  });
});

describe("OpenCode 1.3.4+: exports['./server'], an {id, server} object", () => {
  test("the server export resolves to the server entry", () => {
    expect(resolveFromInstall(`${pkg.name}/server`)).toBe(join(ROOT, "src", "entry", "server.ts"));
  });

  test("readV1Plugin accepts it and the server function yields the hooks", async () => {
    const value = (await import(resolveFromInstall(`${pkg.name}/server`))).default;

    // readV1Plugin: a record with a function `server`, and not also `tui`.
    expect(isRecord(value)).toBe(true);
    expect(value.id).toBe(pkg.name);
    expect(typeof value.server).toBe("function");
    expect("tui" in value).toBe(false);
    const hooks = await value.server({}, offline);
    expect(Object.keys(hooks).sort()).toEqual(["chat.message", "tool.execute.before"]);
  });
});

describe("OpenCode 2: <name>/server first, an {id, setup} object", () => {
  test("the Module schema's shape holds: an object, a string id, a setup function", async () => {
    const mod = await import(resolveFromInstall(`${pkg.name}/server`));

    // A function default is rejected by OpenCode 2 even with id/setup attached.
    expect(typeof mod.default).toBe("object");
    expect(typeof mod.default.id).toBe("string");
    expect(typeof mod.default.setup).toBe("function");
  });

  test("setup registers its hooks on an OpenCode 2 context", async () => {
    const { default: plugin } = await import(resolveFromInstall(`${pkg.name}/server`));
    const registered: string[] = [];
    const domain = (prefix: string) => ({
      hook: async (name: string) => {
        registered.push(`${prefix}:${name}`);
        return { dispose: async () => {} };
      },
    });

    await plugin.setup({ options: offline, session: domain("session"), tool: domain("tool") });

    expect(registered.sort()).toEqual(["session:context", "tool:execute.before"]);
  });
});
