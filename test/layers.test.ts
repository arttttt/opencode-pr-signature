/**
 * Pins the layer boundaries of src/:
 *   src/domain/  — pure logic; imports nothing outside domain, no packages.
 *   src/app/     — state/sequence; imports domain (and app).
 *   src/infra/   — adapters; imports domain+app and node:* builtins only.
 *   src/plugin.ts — composition root; may import everything.
 *
 * Every import shape counts as a dependency, including `import type` and
 * `export … from` re-exports (a re-export smuggles the target's layer with
 * it, so it is scanned as an import of that target).
 *
 * No cross-layer re-export rule: enforced by the same scan — an export-from
 * is resolved to its target and judged by the source file's layer row.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";

const SRC_DIR = join(import.meta.dir, "..", "src");

type Layer = "domain" | "app" | "infra" | "root-plugin";

const ROOT_FILES: Record<string, Layer> = {
  "plugin.ts": "root-plugin",
};

const LAYER_DIRS = new Set(["domain", "app", "infra"]);

function classify(relPath: string): Layer | null {
  if (ROOT_FILES[relPath]) return ROOT_FILES[relPath];
  const top = relPath.split(sep)[0];
  return LAYER_DIRS.has(top) ? (top as Layer) : null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(relative(SRC_DIR, full));
  }
  return out;
}

const IMPORT_SHAPES: RegExp[] = [
  /import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g,
  /^\s*import\s+["']([^"']+)["']/gm,
  /export\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g,
  /import\(\s*["']([^"']+)["']\s*\)/g,
  /require\(\s*["']([^"']+)["']\s*\)/g,
];

function specifiersOf(source: string): string[] {
  const found = new Set<string>();
  for (const shape of IMPORT_SHAPES) {
    shape.lastIndex = 0;
    for (const match of source.matchAll(shape)) found.add(match[1]);
  }
  return [...found];
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = normalize(join(dirname(join(SRC_DIR, fromFile)), spec));
  const rel = relative(SRC_DIR, base);
  if (rel.startsWith("..")) return null;
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative(SRC_DIR, candidate);
  }
  return null;
}

const ALLOWED_TARGETS: Record<Layer, Set<string>> = {
  domain: new Set(["domain"]),
  app: new Set(["domain", "app"]),
  infra: new Set(["domain", "app", "infra"]),
  "root-plugin": new Set(["domain", "app", "infra", "root-plugin"]),
};

const BARE_ALLOWED: Record<Layer, (spec: string) => boolean> = {
  domain: () => false,
  app: () => false,
  infra: (spec) => spec.startsWith("node:"),
  "root-plugin": () => true,
};

describe("layer boundaries", () => {
  test("every src module obeys its layer's import rule, and every file is classified", () => {
    const violations: string[] = [];
    const files = walk(SRC_DIR);

    for (const file of files) {
      const layer = classify(file);
      if (!layer) {
        violations.push(`${file}: not in the layer table — add to the layer table or move under domain/app/infra`);
        continue;
      }

      for (const spec of specifiersOf(readFileSync(join(SRC_DIR, file), "utf8"))) {
        if (spec.startsWith(".")) {
          const target = resolveRelative(file, spec);
          if (target === null) {
            violations.push(`${file}: dangling relative import "${spec}"`);
            continue;
          }
          const targetLayer = classify(target);
          if (!targetLayer || !ALLOWED_TARGETS[layer].has(targetLayer)) {
            violations.push(`${file} (${layer}): relative import "${spec}" reaches ${targetLayer ?? "unclassified"} ${target}`);
          }
          // Composition-root pin: only plugin.ts may reach into infra/.
          if (targetLayer === "infra" && layer !== "root-plugin") {
            violations.push(`${file} (${layer}): only the composition root may import infra (got "${spec}")`);
          }
        } else {
          if (!BARE_ALLOWED[layer](spec)) {
            violations.push(`${file} (${layer}): bare import "${spec}" is not allowed in this layer`);
          }
          // SDK pin: only the composition root may touch the opencode SDK/plugin packages.
          if (spec.startsWith("@opencode-ai/") && layer !== "root-plugin") {
            violations.push(`${file} (${layer}): only the composition root may import "${spec}"`);
          }
        }
      }
    }

    expect(violations.join("\n")).toBe("");
  });
});
