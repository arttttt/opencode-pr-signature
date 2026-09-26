/**
 * OpenCode 1 host adapter: the `(input, options) => hooks` plugin function.
 *
 * Every OpenCode 1 release calls this function — the oldest ones find it as
 * the package's default export, 1.3.4 and later as `server` on the object
 * module — and reads the returned hook map.
 */

import type { Plugin } from "@opencode-ai/plugin";

import type { SignerFactory } from "../app/signer";

/** OpenCode 1 names its shell tool `bash`. */
const SHELL_TOOL = "bash";

export function createV1Plugin(createSigner: SignerFactory): Plugin {
  return async (_input, options) => {
    const signer = createSigner(options ?? {});

    return {
      /**
       * The model is on the input, not on output.message.
       */
      "chat.message": async (input, _output) => {
        signer.observeModel(input.model);
      },

      /**
       * Sign a PR/Issue body, or the git commit / gh invocations on a shell line.
       */
      "tool.execute.before": async (input, output) => {
        const body = signer.signBody(input.tool, output.args?.body);
        if (body !== undefined) {
          output.args.body = body;
          return;
        }

        if (input.tool === SHELL_TOOL && typeof output.args?.command === "string") {
          const command: string = output.args.command;
          const rewritten = signer.signCommand(command);
          if (rewritten !== command) output.args.command = rewritten;
        }
      },
    };
  };
}
