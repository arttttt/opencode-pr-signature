/**
 * OpenCode 2 host adapter: the `setup(context)` of a `{ id, setup }` plugin.
 *
 * OpenCode 2 replaces the hook map with domains on a context: the model
 * arrives on `session.hook("context")`, tool calls on
 * `tool.hook("execute.before")`, whose `input` the host executes with — so it
 * is mutated in place.
 */

import type { SignerFactory, SignerOptions } from "../app/signer";

/** OpenCode 2 renamed the shell tool from `bash`. */
const SHELL_TOOL = "shell";

/**
 * The slice of OpenCode 2's plugin context this adapter touches, declared
 * here rather than imported: @opencode/plugin would pull its whole runtime
 * in as a dependency for a type. Shapes follow @opencode/plugin 2.0.16
 * (promise API: session.d.ts, tool.d.ts, registration.d.ts).
 */
interface Registration {
  readonly dispose: () => Promise<void>;
}

interface ContextEvent {
  readonly model: { readonly id: string };
}

interface ExecuteBeforeEvent {
  readonly tool: string;
  input: unknown;
}

interface V2Context {
  readonly options?: SignerOptions;
  readonly session: {
    hook(name: "context", callback: (event: ContextEvent) => Promise<void> | void): Promise<Registration>;
  };
  readonly tool: {
    hook(name: "execute.before", callback: (event: ExecuteBeforeEvent) => Promise<void> | void): Promise<Registration>;
  };
}

export type V2Setup = (context: unknown) => Promise<void>;

/**
 * Only an OpenCode 2 host provides these domains. The OpenCode 2 host that
 * OpenCode 1.18 embeds calls setup too, with neither of them — there is
 * nothing to hook into, so setup does nothing.
 */
function isV2Context(context: unknown): context is V2Context {
  const candidate = context as Partial<Record<"session" | "tool", { hook?: unknown }>> | null | undefined;
  return typeof candidate?.session?.hook === "function" && typeof candidate?.tool?.hook === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createV2Setup(createSigner: SignerFactory): V2Setup {
  return async (context) => {
    if (!isV2Context(context)) return;

    const signer = createSigner(context.options ?? {});

    await context.session.hook("context", (event) => {
      signer.observeModel(event.model?.id);
    });

    await context.tool.hook("execute.before", (event) => {
      const input = event.input;
      if (!isRecord(input)) return;

      const body = signer.signBody(event.tool, input.body);
      if (body !== undefined) {
        input.body = body;
        return;
      }

      if (event.tool === SHELL_TOOL && typeof input.command === "string") {
        const rewritten = signer.signCommand(input.command);
        if (rewritten !== input.command) input.command = rewritten;
      }
    });
  };
}
