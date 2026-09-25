/**
 * Composition root: wires the registry, its cache and the catalogue fetch
 * into a Signer, and hands that to each OpenCode host adapter.
 *
 * The entrypoints under entry/ only pick which of these a loader sees.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { createModelRegistry, type FetchCatalogue } from "./app/model-registry";
import { createSigner, type Signer, type SignerOptions } from "./app/signer";
import { createV1Plugin } from "./hosts/opencode-v1";
import { createFetchCatalogue } from "./infra/model-catalogue";
import { createModelCacheStore } from "./infra/model-cache";

export const PLUGIN_ID = "opencode-pr-signature";

/** Where the catalogue cache lives; overridable for tests and unusual setups. */
function resolveCachePath(options: SignerOptions): string {
  const override = options.cachePath;
  if (typeof override === "string" && override !== "") return override;
  const configRoot = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configRoot, "opencode", "cache", "opencode-pr-signature", "models.jsonl");
}

/** The catalogue fetch, injectable so tests never touch the network. */
function resolveFetchCatalogue(options: SignerOptions): FetchCatalogue {
  const override = options.fetchCatalogue;
  if (typeof override === "function") return override as FetchCatalogue;
  return createFetchCatalogue();
}

export function createSignerFromOptions(options: SignerOptions): Signer {
  const registry = createModelRegistry({
    store: createModelCacheStore(resolveCachePath(options)),
    fetchCatalogue: resolveFetchCatalogue(options),
  });
  // A local, size-capped read — bounded by construction, and the only way
  // the first message of a fresh session resolves against real data.
  registry.seedFromCache();
  return createSigner(registry);
}

export const openCodeV1Plugin = createV1Plugin(createSignerFromOptions);
