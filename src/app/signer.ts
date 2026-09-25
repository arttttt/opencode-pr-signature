/**
 * The signing core, shared by every OpenCode host.
 *
 * It knows what to sign and how, but nothing about how a host delivers its
 * events: each host adapter translates its own hooks into these three calls.
 * The model is tracked here so both adapters report it the same way.
 */

import { addSignatureToGhCommand } from "../domain/gh";
import { addSignatureToGitCommitCommand } from "../domain/git-commit";
import { generateSignature, hasSignature } from "../domain/signature";
import type { ModelRegistry } from "./model-registry";

/**
 * Adds the signature to one kind of command, or returns it untouched.
 * Locating its own command is part of the job, so the caller stays a list.
 */
type CommandRewriter = (command: string, signature: string) => string;

const COMMAND_REWRITERS: readonly CommandRewriter[] = [addSignatureToGitCommitCommand, addSignatureToGhCommand];

/**
 * GitHub/MCP tools whose `body` is a PR or Issue description. Both OpenCode
 * versions name an MCP tool `<server>_<tool>`, so one list serves both.
 */
const BODY_TOOLS: ReadonlySet<string> = new Set([
  "github_create_pull_request",
  "github_create_issue",
  "github_update_pull_request",
  "github_update_issue",
  "MCP_DOCKER_create_pull_request",
  "MCP_DOCKER_create_issue",
  "MCP_DOCKER_update_pull_request",
  "MCP_DOCKER_update_issue",
]);

/** A model as a host reports it: OpenCode 1 sends a pair, OpenCode 2 an id. */
export type ReportedModel = Parameters<ModelRegistry["get"]>[0];

export interface Signer {
  /** The host reported the active model; later signatures name it. */
  observeModel(model: ReportedModel): void;
  /** Sign every git commit / gh invocation on a shell line; unchanged when there is none. */
  signCommand(command: string): string;
  /**
   * The signed body for a PR/Issue tool call, or undefined when `tool` is not
   * one — the caller then leaves the call alone.
   */
  signBody(tool: string, body: unknown): string | undefined;
}

/** Plugin options as either OpenCode version hands them over: a plain record. */
export type SignerOptions = Readonly<Record<string, unknown>>;

/**
 * Builds a Signer from the plugin's options. Host adapters depend on this,
 * not on the registry, cache or network behind it: wiring those up is the
 * composition root's job.
 */
export type SignerFactory = (options: SignerOptions) => Signer;

export function createSigner(registry: ModelRegistry): Signer {
  let currentModel = "Unknown Model";
  const signature = () => generateSignature(currentModel);

  return {
    observeModel(model) {
      currentModel = registry.get(model);
      // Fire-and-forget: the registry never rejects, and a hook never waits.
      void registry.ensureFresh();
    },

    signCommand(command) {
      // One line can carry both a commit and a PR — `git commit … && gh pr
      // create …` is the everyday shape — so every rewriter gets a turn on
      // what the previous one produced.
      const current = signature();
      let rewritten = command;
      for (const addSignature of COMMAND_REWRITERS) rewritten = addSignature(rewritten, current);
      return rewritten;
    },

    signBody(tool, body) {
      if (!BODY_TOOLS.has(tool)) return undefined;
      if (typeof body !== "string" || body === "") return signature();
      if (hasSignature(body)) return body;
      return body.trim() + "\n\n" + signature();
    },
  };
}
