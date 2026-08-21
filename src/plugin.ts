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
import { addSignatureToGhCommand } from "./domain/gh";
import { addSignatureToGitCommitCommand } from "./domain/git-commit";
import { generateSignature, hasSignature } from "./domain/signature";
import { createFetchCatalogue } from "./infra/model-catalogue";
import { createModelCacheStore } from "./infra/model-cache";

/**
 * Adds the signature to one kind of command, or returns it untouched.
 * Locating its own command is part of the job, so the caller stays a list.
 */
type CommandRewriter = (command: string, signature: string) => string;

const BASH_REWRITERS: readonly CommandRewriter[] = [addSignatureToGitCommitCommand, addSignatureToGhCommand];

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

  // Store current model name
  let currentModel = "Unknown Model";

  // GitHub/MCP tools to intercept for PR/Issue operations
  const prIssueTools = [
    "github_create_pull_request",
    "github_create_issue",
    "github_update_pull_request",
    "github_update_issue",
    "MCP_DOCKER_create_pull_request",
    "MCP_DOCKER_create_issue",
    "MCP_DOCKER_update_pull_request",
    "MCP_DOCKER_update_issue",
  ];

  return {
    /**
     * Hook: chat.message
     * Track the current model from chat messages, and refresh the catalogue
     * in the background when the cache has gone stale. The refresh is
     * fire-and-forget: the registry never rejects, and the hook never waits.
     * Note: model is passed in input, not output.message
     */
    "chat.message": async (input, _output) => {
      currentModel = registry.get(input.model);
      void registry.ensureFresh();
    },

    /**
     * Hook: tool.execute.before
     * Intercept PR, Issue creation/update, and git commits to add signature
     */
    "tool.execute.before": async (input, output) => {
      // Handle GitHub/MCP PR and Issue tools
      if (prIssueTools.includes(input.tool)) {
        const signature = generateSignature(currentModel);

        if (output.args?.body) {
          if (!hasSignature(output.args.body)) {
            output.args.body = output.args.body.trim() + "\n\n" + signature;
          }
        } else {
          output.args.body = signature;
        }

        return;
      }

      // Handle bash commands (git commit, gh CLI)
      if (input.tool === "bash" && output.args?.command) {
        const command: string = output.args.command;
        const signature = generateSignature(currentModel);

        // One line can carry both a commit and a PR — `git commit … && gh pr
        // create …` is the everyday shape — so every rewriter gets a turn on
        // what the previous one produced. Each returns the command unchanged
        // when it has nothing to sign.
        let rewritten = command;
        for (const addSignature of BASH_REWRITERS) rewritten = addSignature(rewritten, signature);

        if (rewritten !== command) output.args.command = rewritten;
      }
    },
  };
};

export default PRSignaturePlugin;
