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

import type { Context as V2Context } from "@opencode/plugin/promise/plugin";
import type { Plugin } from "@opencode-ai/plugin";

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

/** OpenCode 1 and 2 both express options as a plain string-keyed record. */
type Options = Readonly<Record<string, unknown>>;

/** Where the catalogue cache lives; overridable for tests and unusual setups. */
function resolveCachePath(options: Options): string {
  const override = options.cachePath;
  if (typeof override === "string" && override !== "") return override;
  const configRoot = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configRoot, "opencode", "cache", "opencode-pr-signature", "models.jsonl");
}

/** The catalogue fetch, injectable so tests never touch the network. */
function resolveFetchCatalogue(options: Options): FetchCatalogue {
  const override = options.fetchCatalogue;
  if (typeof override === "function") return override as FetchCatalogue;
  return createFetchCatalogue();
}

/** GitHub/MCP tools to intercept for PR/Issue operations, shared by both runtimes. */
const PR_ISSUE_TOOLS = [
  "github_create_pull_request",
  "github_create_issue",
  "github_update_pull_request",
  "github_update_issue",
  "MCP_DOCKER_create_pull_request",
  "MCP_DOCKER_create_issue",
  "MCP_DOCKER_update_pull_request",
  "MCP_DOCKER_update_issue",
];

/** The shell tool is `bash` on OpenCode 1 and `shell` on OpenCode 2. */
const SHELL_TOOLS = new Set(["bash", "shell"]);

/** An OpenCode 2 host passes a context with the 2.x domains; OpenCode 1 does not. */
function isV2Context(ctx: unknown): ctx is V2Context {
  const candidate = ctx as Partial<V2Context> | undefined;
  return typeof candidate?.tool?.hook === "function" && typeof candidate?.session?.hook === "function";
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
      if (PR_ISSUE_TOOLS.includes(input.tool)) {
        signBody(output.args, generateSignature(currentModel));
        return;
      }

      // Handle bash commands (git commit, gh CLI)
      if (input.tool === "bash" && output.args?.command) {
        const command: string = output.args.command;
        const rewritten = signCommand(command, generateSignature(currentModel));
        if (rewritten !== command) output.args.command = rewritten;
      }
    },
  };
};

/** One line can carry both a commit and a PR; every rewriter gets a turn. */
function signCommand(command: string, signature: string): string {
  let rewritten = command;
  for (const addSignature of BASH_REWRITERS) rewritten = addSignature(rewritten, signature);
  return rewritten;
}

/** Append the signature to a PR/Issue body, in place. */
function signBody(target: { body?: string }, signature: string): void {
  if (target.body) {
    if (!hasSignature(target.body)) target.body = target.body.trim() + "\n\n" + signature;
  } else {
    target.body = signature;
  }
}

/**
 * OpenCode 2 entrypoint. Registered on the 2.x domains instead of the 1.x hook
 * map: the model request context carries the active model, and tool execution
 * before-hooks carry the tool name and mutable input.
 *
 * OpenCode 1.18.29+ also calls `setup`, but with a context that has no
 * `tool`/`session` domains, so the guard returns before touching it.
 */
async function setup(ctx: V2Context): Promise<void> {
  if (!isV2Context(ctx)) return;

  // OpenCode 2 declares `options` as required and always supplies it, but a
  // missing object must not sink setup: mirror the OpenCode 1 `options ?? {}`.
  const options: Options = ctx.options ?? {};

  const registry = createModelRegistry({
    store: createModelCacheStore(resolveCachePath(options)),
    fetchCatalogue: resolveFetchCatalogue(options),
  });
  registry.seedFromCache();

  let currentModel = "Unknown Model";

  await ctx.session.hook("context", (event) => {
    currentModel = registry.get(event.model.id);
    void registry.ensureFresh();
  });

  await ctx.tool.hook("execute.before", (event) => {
    if (PR_ISSUE_TOOLS.includes(event.tool)) {
      signBody(event.input as { body?: string }, generateSignature(currentModel));
      return;
    }

    if (SHELL_TOOLS.has(event.tool)) {
      const input = event.input as { command?: string } | undefined;
      if (input && typeof input.command === "string" && input.command) {
        const rewritten = signCommand(input.command, generateSignature(currentModel));
        if (rewritten !== input.command) input.command = rewritten;
      }
    }
  });
}

/**
 * Both runtimes load this default export. OpenCode 1 reads `id` + `server`;
 * OpenCode 2 reads `id` + `setup` and ignores `server`.
 */
export default {
  id: "opencode-pr-signature",
  server: PRSignaturePlugin,
  setup,
};
