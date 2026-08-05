import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRSignaturePlugin } from "../src/plugin";

const signature = "🤖 Generated with [OpenCode](https://opencode.ai) (Claude Opus 4)";
const directories: string[] = [];

/**
 * Drive the plugin the way OpenCode does: report a model, then hand the hook a
 * tool call and read back what it rewrote. Testing through the hook is what
 * makes the git/gh dispatch, and the model formatting, testable at all.
 */
async function hooks() {
  const plugin = await PRSignaturePlugin({} as never);
  await plugin["chat.message"]!({ model: { providerID: "anthropic", modelID: "claude-opus-4" } } as never, {} as never);
  return plugin;
}

async function sign(command: string): Promise<string> {
  const plugin = await hooks();
  const output = { args: { command } };
  await plugin["tool.execute.before"]!({ tool: "bash", sessionID: "", callID: "" } as never, output as never);
  return output.args.command;
}

async function signToolBody(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const plugin = await hooks();
  const output = { args };
  await plugin["tool.execute.before"]!({ tool, sessionID: "", callID: "" } as never, output as never);
  return output.args;
}

// POSIX sh, not the developer's login shell: the rewritten commands must work
// under whatever /bin/sh the machine running OpenCode provides.
function run(directory: string, command: string): string {
  return execFileSync("/bin/sh", ["-c", command], { cwd: directory, encoding: "utf8" });
}

function createRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), "opencode-pr-signature-"));
  directories.push(directory);
  run(directory, "git init -q && git config user.name Test && git config user.email test@example.com");
  writeFileSync(join(directory, "tracked.txt"), "content\n");
  run(directory, "git add tracked.txt");
  return directory;
}

function commitMessage(directory: string): string {
  return run(directory, "git log -1 --format=%B");
}

/** Rewrite, execute for real, and report the message git actually stored. */
async function signAndCommit(command: string): Promise<{ rewritten: string; message: string; directory: string }> {
  const directory = createRepository();
  const rewritten = await sign(command);
  run(directory, rewritten);
  return { rewritten, message: commitMessage(directory), directory };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe("git commit -m", () => {
  test("appends the signature as another paragraph", async () => {
    const { message } = await signAndCommit('git commit -m "subject"');

    expect(message).toBe(`subject\n\n${signature}\n\n`);
  });

  test("keeps every -m paragraph the user wrote", async () => {
    const { message } = await signAndCommit('git commit -m "subject" -m "body"');

    expect(message).toBe(`subject\n\nbody\n\n${signature}\n\n`);
  });

  // git accepts the message attached to the flag; all three spellings were
  // signed before the tokenizer landed and have to stay signed.
  test.each(['git commit -m"subject"', "git commit -m'subject'", "git commit -msubject", 'git commit --message="subject"'])(
    "recognizes the attached form %p",
    async (command) => {
      const { message } = await signAndCommit(command);

      expect(message).toBe(`subject\n\n${signature}\n\n`);
    },
  );

  test("does not sign twice", async () => {
    const command = `git commit -m "subject" -m "${signature}"`;

    expect(await sign(command)).toBe(command);
  });

  test("quotes the signature so the shell cannot expand it", async () => {
    const rewritten = await sign('git commit -m "subject"');

    expect(rewritten).toBe(`git commit -m "subject" -m '${signature}'`);
  });
});

describe("git commit with a heredoc message", () => {
  // The message is data, not syntax. Each of these characters used to end the
  // command early and leave the rewrite's own punctuation inside the message,
  // which the shell then refused to parse at all.
  test.each([
    ["a semicolon", "refactor: split module; extract helper"],
    ["a pipe", "fix: handle a|b"],
    ["an and-and", "fix: make build && make test"],
    ["an option-looking word", "feat: add -m flag support"],
    ["a long option", "docs: describe --file=x usage"],
  ])("signs a body containing %s", async (_name, subject) => {
    const { message } = await signAndCommit(`git commit -F- <<'EOF'\n${subject}\nEOF`);

    expect(message).toBe(`${subject}\n\n${signature}\n\n`);
  });

  test("signs a tab-indented <<- heredoc", async () => {
    const { message } = await signAndCommit("git commit -F- <<-'EOF'\n\tsubject\n\tEOF");

    expect(message).toBe(`subject\n\n${signature}\n\n`);
  });

  test("signs a delimiter that is not a bare word", async () => {
    const { message } = await signAndCommit("git commit -F- <<'MSG-END'\nsubject\nMSG-END");

    expect(message).toBe(`subject\n\n${signature}\n\n`);
  });

  test("leaves an already signed body unchanged", async () => {
    const command = `git commit -F- <<'EOF'\nsubject\n\n${signature}\nEOF`;

    expect(await sign(command)).toBe(command);
  });

  // A body that talks about commands is still a commit message. Nothing in it
  // may be treated as a command to rewrite — which is what masking the body
  // before any scanning buys.
  test.each([
    ["gh pr create --title t --body \"see the docs\"", "gh"],
    ['git commit -m "like this"', "git commit"],
  ])("does not rewrite %p written inside the message", async (bodyLine) => {
    const command = `git commit -F- <<'EOF'\ndocs: explain how to run\n\n    ${bodyLine}\nEOF`;

    const rewritten = await sign(command);

    expect(rewritten).toBe(
      `git commit -F- <<'EOF'\ndocs: explain how to run\n\n    ${bodyLine}\n\n${signature}\nEOF`,
    );
  });

  test("keeps a command that follows the heredoc", async () => {
    const { message, directory } = await signAndCommit("git commit -F- <<'EOF'\nsubject\nEOF\ngit status --short");

    expect(message).toBe(`subject\n\n${signature}\n\n`);
    expect(run(directory, "git status --short")).toBe("");
  });
});

describe("messages the plugin refuses to touch", () => {
  // Every one of these names content the plugin cannot see. Rewriting them
  // meant reading the wrong bytes, or taking stdin away from git and
  // committing the signature alone — with exit status 0.
  test.each([
    ["a message file", "git commit -F 'commit message.txt'"],
    ["a message file by long option", "git commit --file=message.txt"],
    ["a piped message", "printf 'subject\\n' | git commit -F-"],
    ["a redirected message", "git commit -F- < message.txt"],
    ["a here-string message", 'git commit -F- <<< "subject"'],
    ["a message file mixed with -m", 'git commit -m "subject" -F message.txt'],
  ])("returns the command unchanged for %s", async (_name, command) => {
    expect(await sign(command)).toBe(command);
  });

  test("a message file is neither read nor modified, and its commit still works", async () => {
    const directory = createRepository();
    const messageFile = join(directory, "commit message.txt");
    writeFileSync(messageFile, "subject\n\nbody\n");

    run(directory, await sign("git commit -F 'commit message.txt'"));

    expect(commitMessage(directory)).toBe("subject\n\nbody\n\n");
    expect(readFileSync(messageFile, "utf8")).toBe("subject\n\nbody\n");
  });

  test("a piped message reaches git intact", async () => {
    const directory = createRepository();

    run(directory, await sign("printf 'subject\\n' | git commit -F-"));

    expect(commitMessage(directory)).toBe("subject\n\n");
  });
});

describe("the rest of the command line", () => {
  test("keeps a file-descriptor redirection intact", async () => {
    const { message, directory } = await signAndCommit('git commit -m "subject" 2>&1 | tee log.txt');

    expect(message).toBe(`subject\n\n${signature}\n\n`);
    expect(readFileSync(join(directory, "log.txt"), "utf8")).toContain("subject");
  });

  test("does not append into a trailing comment", async () => {
    const { message } = await signAndCommit('git commit -m "subject" # ship it');

    expect(message).toBe(`subject\n\n${signature}\n\n`);
  });

  test("signs the command, not the line that follows it", async () => {
    const { message, directory } = await signAndCommit('git commit -m "subject"\ngit tag done');

    expect(message).toBe(`subject\n\n${signature}\n\n`);
    expect(run(directory, "git tag")).toBe("done\n");
  });

  test("signs a commit carrying an environment assignment", async () => {
    const { message } = await signAndCommit('GIT_AUTHOR_NAME=Someone git commit -m "subject"');

    expect(message).toBe(`subject\n\n${signature}\n\n`);
  });

  test("ignores a commit that is only mentioned inside an argument", async () => {
    const command = 'echo "run git commit -m x to commit"';

    expect(await sign(command)).toBe(command);
  });

  test("skips a mention and signs the real command after it", async () => {
    const rewritten = await sign('grep -r "git commit -F" . ; git commit -m "subject"');

    expect(rewritten).toBe(`grep -r "git commit -F" . ; git commit -m "subject" -m '${signature}'`);
  });
});

describe("gh commands", () => {
  test.each([
    ['gh pr create --title t --body "hello"', "--body value"],
    ["gh pr create --title t --body=hello", "--body=value"],
    ["gh issue comment 1 -b hello", "-b value"],
    ["gh pr review 1 -bhello", "-bvalue"],
  ])("appends to the body of %p", async (command) => {
    const rewritten = await sign(command);

    expect(rewritten).toContain(`--body 'hello\n\n${signature}'`);
  });

  test("adds a body when the command has none", async () => {
    const rewritten = await sign("gh pr create --title t");

    expect(rewritten).toBe(`gh pr create --title t --body '${signature}'`);
  });

  test("quotes a body containing an apostrophe so the shell keeps it", async () => {
    const rewritten = await sign(`gh issue create --title t --body "it's here"`);

    expect(run(process.cwd(), rewritten.replace(/^gh issue create --title t --body/, "printf '%s'"))).toBe(
      `it's here\n\n${signature}`,
    );
  });

  // Adding a second --body would make gh use ours and drop the user's text.
  test.each([
    ['gh pr create --body "$PR_BODY"', "a body from a variable"],
    ['gh pr create --body "$(cat msg.md)"', "a body from a substitution"],
    ["gh pr create --body-file msg.md", "a body from a file"],
  ])("refuses %p rather than replacing it", async (command) => {
    expect(await sign(command)).toBe(command);
  });

  test("does not sign twice", async () => {
    const command = `gh pr create --body "hello ${signature}"`;

    expect(await sign(command)).toBe(command);
  });
});

describe("one line carrying both a commit and a pull request", () => {
  test("signs the commit and the pull request body", async () => {
    const rewritten = await sign('git commit -m "subject" && gh pr create --title t --body "hello"');

    expect(rewritten).toBe(
      `git commit -m "subject" -m '${signature}' && gh pr create --title t --body 'hello\n\n${signature}'`,
    );
  });

  test("still signs the pull request when the commit cannot be signed", async () => {
    const rewritten = await sign('git commit -F msg.txt && gh pr create --title t --body "hello"');

    expect(rewritten).toBe(`git commit -F msg.txt && gh pr create --title t --body 'hello\n\n${signature}'`);
  });
});

describe("GitHub and MCP pull request tools", () => {
  test("appends to an existing body", async () => {
    const args = await signToolBody("github_create_pull_request", { body: "hello" });

    expect(args.body).toBe(`hello\n\n${signature}`);
  });

  test("supplies a body when the call has none", async () => {
    const args = await signToolBody("MCP_DOCKER_create_issue", { title: "t" });

    expect(args.body).toBe(signature);
  });

  test("does not sign twice", async () => {
    const args = await signToolBody("github_update_issue", { body: `hello\n\n${signature}` });

    expect(args.body).toBe(`hello\n\n${signature}`);
  });
});
