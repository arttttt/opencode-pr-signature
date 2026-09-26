import { describe, expect, test } from "bun:test";

import type { Signer, SignerOptions } from "../src/app/signer";
import { createV1Plugin } from "../src/hosts/opencode-v1";

/**
 * A Signer that records what the adapter hands it, so these tests pin the
 * translation from OpenCode 1 hooks, not the signing itself.
 */
function fakeSigner() {
  const models: unknown[] = [];
  const signer: Signer = {
    observeModel: (model) => void models.push(model),
    signCommand: (command) => (command.startsWith("git commit") ? `${command} SIGNED` : command),
    signBody: (tool, body) => (tool === "github_create_issue" ? `${String(body)} SIGNED` : undefined),
  };
  return { signer, models };
}

async function hooksWith(signer: Signer, options?: Record<string, unknown>) {
  const received: SignerOptions[] = [];
  const plugin = createV1Plugin((opts) => {
    received.push(opts);
    return signer;
  });
  const hooks = await plugin({} as never, options);
  return { hooks, received };
}

async function beforeTool(signer: Signer, tool: string, args: Record<string, unknown>) {
  const { hooks } = await hooksWith(signer);
  const output = { args };
  await hooks["tool.execute.before"]!({ tool, sessionID: "", callID: "" } as never, output as never);
  return output.args;
}

describe("OpenCode 1 adapter", () => {
  test("hands the plugin options to the signer factory, or an empty record", async () => {
    const { signer } = fakeSigner();

    expect((await hooksWith(signer, { cachePath: "/x" })).received).toEqual([{ cachePath: "/x" }]);
    expect((await hooksWith(signer, undefined)).received).toEqual([{}]);
  });

  test("reports the chat.message model pair", async () => {
    const fake = fakeSigner();
    const { hooks } = await hooksWith(fake.signer);
    const model = { providerID: "anthropic", modelID: "claude-opus-4" };

    await hooks["chat.message"]!({ model } as never, {} as never);

    expect(fake.models).toEqual([model]);
  });

  test("signs the command of the bash tool", async () => {
    const args = await beforeTool(fakeSigner().signer, "bash", { command: "git commit -m x" });

    expect(args.command).toBe("git commit -m x SIGNED");
  });

  test("leaves the command of any other tool alone, including OpenCode 2's shell", async () => {
    const args = await beforeTool(fakeSigner().signer, "shell", { command: "git commit -m x" });

    expect(args.command).toBe("git commit -m x");
  });

  test("tolerates a bash call without a command", async () => {
    const args = await beforeTool(fakeSigner().signer, "bash", {});

    expect(args).toEqual({});
  });

  test("replaces the body of a PR/Issue tool with the signed one", async () => {
    const args = await beforeTool(fakeSigner().signer, "github_create_issue", { body: "hello" });

    expect(args.body).toBe("hello SIGNED");
  });
});
