import { describe, expect, test } from "bun:test";

import type { ModelRegistry } from "../src/app/model-registry";
import { createSigner } from "../src/app/signer";

const opus = "🤖 Generated with [OpenCode](https://opencode.ai) (Claude Opus 4)";
const unknown = "🤖 Generated with [OpenCode](https://opencode.ai) (Unknown Model)";

/** A registry that names one model and counts refresh requests. */
function fakeRegistry() {
  const seen: unknown[] = [];
  let refreshes = 0;
  const registry: ModelRegistry = {
    seedFromCache() {},
    get(model) {
      seen.push(model);
      return model === undefined ? "Unknown Model" : "Claude Opus 4";
    },
    async ensureFresh() {
      refreshes++;
    },
  };
  return { registry, seen, refreshes: () => refreshes };
}

describe("Signer", () => {
  test("signs with Unknown Model until a model is observed", () => {
    const signer = createSigner(fakeRegistry().registry);

    expect(signer.signBody("github_create_issue", "hello")).toBe(`hello\n\n${unknown}`);
  });

  test("names the observed model and asks the registry to refresh", () => {
    const fake = fakeRegistry();
    const signer = createSigner(fake.registry);

    signer.observeModel("claude-opus-4");

    expect(fake.seen).toEqual(["claude-opus-4"]);
    expect(fake.refreshes()).toBe(1);
    expect(signer.signBody("github_create_issue", "hello")).toBe(`hello\n\n${opus}`);
  });

  test("passes an OpenCode 1 model pair to the registry untouched", () => {
    const fake = fakeRegistry();
    const pair = { providerID: "anthropic", modelID: "claude-opus-4" };

    createSigner(fake.registry).observeModel(pair);

    expect(fake.seen).toEqual([pair]);
  });

  describe("signBody", () => {
    const signer = () => {
      const s = createSigner(fakeRegistry().registry);
      s.observeModel("claude-opus-4");
      return s;
    };

    test("leaves a tool that carries no PR/Issue body alone", () => {
      expect(signer().signBody("github_get_issue", "hello")).toBeUndefined();
      expect(signer().signBody("shell", "hello")).toBeUndefined();
    });

    test("appends to an existing body, trimming trailing whitespace", () => {
      expect(signer().signBody("MCP_DOCKER_update_pull_request", "hello\n\n")).toBe(`hello\n\n${opus}`);
    });

    test("does not sign a body twice", () => {
      expect(signer().signBody("github_update_issue", `hello\n\n${opus}`)).toBe(`hello\n\n${opus}`);
    });

    test("supplies the signature when the body is missing, empty, or not text", () => {
      expect(signer().signBody("github_create_pull_request", undefined)).toBe(opus);
      expect(signer().signBody("github_create_pull_request", "")).toBe(opus);
      expect(signer().signBody("github_create_pull_request", 42)).toBe(opus);
    });
  });

  describe("signCommand", () => {
    test("returns a command with nothing to sign unchanged", () => {
      const command = "ls -la && git status";

      expect(createSigner(fakeRegistry().registry).signCommand(command)).toBe(command);
    });

    test("signs a commit and a PR on the same line", () => {
      const signer = createSigner(fakeRegistry().registry);
      signer.observeModel("claude-opus-4");

      const rewritten = signer.signCommand('git commit -m "subject" && gh pr create --title t --body "b"');

      expect(rewritten).toContain(`git commit -m "subject" -m '${opus}'`);
      expect(rewritten.split(opus).length - 1).toBe(2);
    });
  });
});
