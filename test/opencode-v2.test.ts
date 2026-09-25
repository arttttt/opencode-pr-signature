import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Signer, SignerOptions } from "../src/app/signer";
import { openCodeV1Plugin, openCodeV2Setup } from "../src/composition";
import { createV2Setup } from "../src/hosts/opencode-v2";

type Callback = (event: never) => Promise<void> | void;

/**
 * An OpenCode 2 context that captures the registered callbacks, so a test
 * can fire them the way the host does: with an event whose `input` object
 * is the one the tool then executes with.
 */
function mockContext(options?: Record<string, unknown>) {
  const registered = new Map<string, Callback>();
  const domain = (prefix: string) => ({
    hook: async (name: string, callback: Callback) => {
      registered.set(`${prefix}:${name}`, callback);
      return { dispose: async () => {} };
    },
  });
  const context = { ...(options === undefined ? {} : { options }), session: domain("session"), tool: domain("tool") };
  const fire = async (key: string, event: unknown) => {
    const callback = registered.get(key);
    if (!callback) throw new Error(`nothing registered for ${key}`);
    await callback(event as never);
  };
  return {
    context,
    registered,
    observe: (id: string) => fire("session:context", { model: { id, providerID: "anthropic" } }),
    beforeTool: async (tool: string, input: unknown) => {
      await fire("tool:execute.before", { tool, sessionID: "s", agent: "a", messageID: "m", id: "c", input });
      return input;
    },
  };
}

function fakeSigner() {
  const models: unknown[] = [];
  const received: SignerOptions[] = [];
  const signer: Signer = {
    observeModel: (model) => void models.push(model),
    signCommand: (command) => (command.startsWith("git commit") ? `${command} SIGNED` : command),
    signBody: (tool, body) => (tool === "github_create_issue" ? `${String(body)} SIGNED` : undefined),
  };
  const setup = createV2Setup((options) => {
    received.push(options);
    return signer;
  });
  return { setup, models, received };
}

describe("OpenCode 2 adapter", () => {
  test("registers the model and tool hooks", async () => {
    const mock = mockContext({});

    await fakeSigner().setup(mock.context);

    expect([...mock.registered.keys()].sort()).toEqual(["session:context", "tool:execute.before"]);
  });

  test("does nothing on a context without the session and tool domains", async () => {
    const fake = fakeSigner();

    // The OpenCode 2 host embedded in OpenCode 1.18 passes such a context.
    await expect(fake.setup({ options: {}, agent: {}, skill: {} })).resolves.toBeUndefined();
    await expect(fake.setup(undefined)).resolves.toBeUndefined();
    await expect(fake.setup({ session: {}, tool: { hook: async () => ({}) } })).resolves.toBeUndefined();
    expect(fake.received).toEqual([]);
  });

  test("hands the context options to the signer factory, or an empty record", async () => {
    const withOptions = fakeSigner();
    await withOptions.setup(mockContext({ cachePath: "/x" }).context);
    const without = fakeSigner();
    await without.setup(mockContext().context);

    expect(withOptions.received).toEqual([{ cachePath: "/x" }]);
    expect(without.received).toEqual([{}]);
  });

  test("reports the model id from the session context", async () => {
    const fake = fakeSigner();
    const mock = mockContext({});
    await fake.setup(mock.context);

    await mock.observe("claude-opus-4");

    expect(fake.models).toEqual(["claude-opus-4"]);
  });

  test("signs the command of the shell tool in place", async () => {
    const mock = mockContext({});
    await fakeSigner().setup(mock.context);
    const input = { command: "git commit -m x", workdir: "/repo" };

    await mock.beforeTool("shell", input);

    expect(input).toEqual({ command: "git commit -m x SIGNED", workdir: "/repo" });
  });

  test("leaves the command of any other tool alone, including OpenCode 1's bash", async () => {
    const mock = mockContext({});
    await fakeSigner().setup(mock.context);

    expect(await mock.beforeTool("bash", { command: "git commit -m x" })).toEqual({ command: "git commit -m x" });
  });

  test("replaces the body of a PR/Issue tool in place", async () => {
    const mock = mockContext({});
    await fakeSigner().setup(mock.context);

    expect(await mock.beforeTool("github_create_issue", { title: "t", body: "hello" })).toEqual({
      title: "t",
      body: "hello SIGNED",
    });
  });

  test("tolerates tool input that is not an object, or a shell call without a command", async () => {
    const mock = mockContext({});
    await fakeSigner().setup(mock.context);

    await expect(mock.beforeTool("shell", undefined)).resolves.toBeUndefined();
    await expect(mock.beforeTool("github_create_issue", "text")).resolves.toBe("text");
    expect(await mock.beforeTool("shell", { command: 42 })).toEqual({ command: 42 });
  });
});

describe("OpenCode 2 and OpenCode 1 sign alike", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const dir of directories.splice(0)) rmSync(dir, { force: true, recursive: true });
  });

  /** Real composition, offline: a throwaway cache and a fetch that never settles. */
  function options() {
    const dir = mkdtempSync(join(tmpdir(), "opencode-pr-signature-v2-"));
    directories.push(dir);
    return { cachePath: join(dir, "models.jsonl"), fetchCatalogue: () => new Promise(() => {}) };
  }

  async function viaV1(tool: string, args: Record<string, unknown>) {
    const hooks = await openCodeV1Plugin({} as never, options());
    await hooks["chat.message"]!({ model: { providerID: "anthropic", modelID: "claude-opus-4" } } as never, {} as never);
    const output = { args: { ...args } };
    await hooks["tool.execute.before"]!({ tool: tool === "shell" ? "bash" : tool } as never, output as never);
    return output.args;
  }

  async function viaV2(tool: string, args: Record<string, unknown>) {
    const mock = mockContext(options());
    await openCodeV2Setup(mock.context);
    await mock.observe("claude-opus-4");
    return mock.beforeTool(tool, { ...args });
  }

  const cases: [string, Record<string, unknown>][] = [
    ["shell", { command: 'git commit -m "subject"' }],
    ["shell", { command: 'git add . && git commit -m "s" && gh pr create --title t --body "b"' }],
    ["shell", { command: "ls -la" }],
    ["github_create_pull_request", { title: "t", body: "hello" }],
    ["MCP_DOCKER_create_issue", { title: "t" }],
    ["github_get_issue", { issue_number: 1 }],
  ];

  for (const [tool, args] of cases) {
    test(`${tool} ${JSON.stringify(args)}`, async () => {
      const v2 = await viaV2(tool, args);

      expect(v2).toEqual(await viaV1(tool, args));
    });
  }

  test("the shared result names the model", async () => {
    const v2 = (await viaV2("shell", { command: 'git commit -m "subject"' })) as { command: string };

    expect(v2.command).toBe(`git commit -m "subject" -m '🤖 Generated with [OpenCode](https://opencode.ai) (Claude Opus 4)'`);
  });
});
