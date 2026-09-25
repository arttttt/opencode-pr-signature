/**
 * OpenCode PR Auto-Signature Plugin
 *
 * Automatically appends AI model signature to PR, Issue bodies, and git commits.
 *
 * @author arttttt
 * @license Apache-2.0
 */

import { homedir } from "node:os";
import { join } from "node:path";

import type { Plugin, PluginOptions } from "@opencode-ai/plugin";

import { createModelRegistry, type FetchCatalogue } from "./app/model-registry";
import { createSigner } from "./app/signer";
import { createFetchCatalogue } from "./infra/model-catalogue";
import { createModelCacheStore } from "./infra/model-cache";

/** Where the catalogue cache lives; overridable for tests and unusual setups. */
function resolveCachePath(options: PluginOptions): string {
  const override = options.cachePath;
  if (typeof override === "string" && override !== "") return override;
  const configRoot = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configRoot, "opencode", "cache", "opencode-pr-signature", "models.jsonl");
}

/** The catalogue fetch, injectable so tests never touch the network. */
function resolveFetchCatalogue(options: PluginOptions): FetchCatalogue {
  const override = options.fetchCatalogue;
  if (typeof override === "function") return override as FetchCatalogue;
  return createFetchCatalogue();
}

/**
 * PR Auto-Signature Plugin
 *
 * Automatically appends AI model signature to PR and Issue bodies,
 * as well as git commit messages.
 */
export const PRSignaturePlugin: Plugin = async (_input, options) => {
  const registry = createModelRegistry({
    store: createModelCacheStore(resolveCachePath(options ?? {})),
    fetchCatalogue: resolveFetchCatalogue(options ?? {}),
  });
  // A local, size-capped read — bounded by construction, and the only way
  // the first message of a fresh session resolves against real data.
  registry.seedFromCache();

  const signer = createSigner(registry);

  return {
    /**
     * Hook: chat.message
     * Track the current model from chat messages.
     * Note: model is passed in input, not output.message
     */
    "chat.message": async (input, _output) => {
      signer.observeModel(input.model);
    },

    /**
     * Hook: tool.execute.before
     * Intercept PR, Issue creation/update, and git commits to add signature
     */
    "tool.execute.before": async (input, output) => {
      const body = signer.signBody(input.tool, output.args?.body);
      if (body !== undefined) {
        output.args.body = body;
        return;
      }

      if (input.tool === "bash" && output.args?.command) {
        const command: string = output.args.command;
        const rewritten = signer.signCommand(command);
        if (rewritten !== command) output.args.command = rewritten;
      }
    },
  };
};

export default PRSignaturePlugin;
