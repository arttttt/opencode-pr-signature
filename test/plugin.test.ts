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

describe("git commit with a message file", () => {
  /** Write msg.txt in a fresh repository, run the signed command, report both. */
  async function commitFromFile(command: string, content: string, name = "msg.txt") {
    const directory = createRepository();
    writeFileSync(join(directory, name), content);
    let status = 0;
    try {
      run(directory, await sign(command));
    } catch (error) {
      status = (error as { status?: number }).status ?? -1;
    }
    let message: string | undefined;
    try {
      message = commitMessage(directory);
    } catch {
      message = undefined;
    }
    return { message, status, file: readFileSync(join(directory, name), "utf8") };
  }

  test.each([
    ["git commit -F msg.txt", "-F <path>"],
    ["git commit --file=msg.txt", "--file=<path>"],
    ["git commit -Fmsg.txt", "attached -F<path>"],
  ])("signs %p", async (command) => {
    const { message, file } = await commitFromFile(command, "subject\n\nbody\n");

    expect(message).toBe(`subject\n\nbody\n\n${signature}\n\n`);
    // The message the user wrote is read, never rewritten.
    expect(file).toBe("subject\n\nbody\n");
  });

  test("keeps a message whose text looks like shell syntax", async () => {
    const { message } = await commitFromFile("git commit -F msg.txt", "fix: a; b && c | d\n");

    expect(message).toBe(`fix: a; b && c | d\n\n${signature}\n\n`);
  });

  test("does not sign a file that is already signed", async () => {
    const { message } = await commitFromFile("git commit -F msg.txt", `subject\n\n${signature}\n`);

    expect(message).toBe(`subject\n\n${signature}\n\n`);
  });

  // git refuses an empty message; appending a signature would have turned that
  // refusal into a commit whose whole message is the signature.
  test.each([
    ["an empty file", ""],
    ["a blank file", "   \n\n"],
  ])("makes no commit from %s", async (_name, content) => {
    const { message, status } = await commitFromFile("git commit -F msg.txt", content);

    expect(message).toBeUndefined();
    expect(status).not.toBe(0);
  });

  test("resolves the path in the shell, so expansions still work", async () => {
    const directory = createRepository();
    writeFileSync(join(directory, "msg.txt"), "subject\n");

    run(directory, `MSGFILE=msg.txt; ${await sign('git commit -F "$MSGFILE"')}`);

    expect(commitMessage(directory)).toBe(`subject\n\n${signature}\n\n`);
  });

  test("leaves a command whose input is already piped alone", async () => {
    const command = "printf x | git commit -F msg.txt";

    expect(await sign(command)).toBe(command);
  });
});

describe("git commit -F- fed by a redirect", () => {
  test.each([
    ["git commit -F- < msg.txt", "spaced"],
    ["git commit -F- <msg.txt", "unspaced"],
    ["git commit -F- 0< msg.txt", "with an explicit descriptor"],
  ])("signs %p", async (command) => {
    const directory = createRepository();
    writeFileSync(join(directory, "msg.txt"), "subject\n\nbody\n");

    run(directory, await sign(command));

    expect(commitMessage(directory)).toBe(`subject\n\nbody\n\n${signature}\n\n`);
    expect(readFileSync(join(directory, "msg.txt"), "utf8")).toBe("subject\n\nbody\n");
  });

  test("keeps an output redirection on the command it belongs to", async () => {
    const directory = createRepository();
    writeFileSync(join(directory, "msg.txt"), "subject\n");

    run(directory, await sign("git commit -F- < msg.txt > out.log"));

    expect(commitMessage(directory)).toBe(`subject\n\n${signature}\n\n`);
    expect(readFileSync(join(directory, "out.log"), "utf8")).toContain("subject");
  });

  test("makes no commit when the redirected file is empty", async () => {
    const directory = createRepository();
    writeFileSync(join(directory, "msg.txt"), "");
    const rewritten = await sign("git commit -F- < msg.txt");

    expect(() => run(directory, rewritten)).toThrow();
    expect(() => commitMessage(directory)).toThrow();
  });

  // Executed under bash rather than /bin/sh: a here-string is the user's own
  // syntax, so their shell already supports it, but dash does not.
  test("moves a here-string onto the group, expansion intact", async () => {
    const rewritten = await sign('git commit -F- <<< "subject $NAME"');

    expect(rewritten).toContain('<<< "subject $NAME" | git commit -F-');
    expect(rewritten.indexOf("__opencode_message")).toBeLessThan(rewritten.indexOf("<<<"));
  });
});

describe("git commit -F- fed by a pipe", () => {
  test("signs the piped message", async () => {
    const directory = createRepository();

    run(directory, await sign("printf 'subject\\n\\nbody\\n' | git commit -F-"));

    expect(commitMessage(directory)).toBe(`subject\n\nbody\n\n${signature}\n\n`);
  });

  test("does not sign a piped message that already carries the signature", async () => {
    const directory = createRepository();

    run(directory, await sign(`printf 'subject\\n\\n${signature}\\n' | git commit -F-`));

    expect(commitMessage(directory).match(/Generated with \[OpenCode\]/g)).toHaveLength(1);
  });

  test("makes no commit when the producer writes nothing", async () => {
    const directory = createRepository();
    const rewritten = await sign("printf '' | git commit -F-");

    expect(() => run(directory, rewritten)).toThrow();
    expect(() => commitMessage(directory)).toThrow();
  });

  test("keeps a command chained after the pipeline", async () => {
    const directory = createRepository();

    run(directory, await sign("printf 'subject\\n' | git commit -F- && git tag done"));

    expect(commitMessage(directory)).toBe(`subject\n\n${signature}\n\n`);
    expect(run(directory, "git tag")).toBe("done\n");
  });
});

describe("git commit --amend --no-edit", () => {
  /** A repository whose HEAD carries `subject`, with something else staged. */
  function repositoryWithCommit(subject: string): string {
    const directory = createRepository();
    run(directory, `git commit -q -m ${JSON.stringify(subject)}`);
    writeFileSync(join(directory, "tracked.txt"), "changed\n");
    run(directory, "git add tracked.txt");
    return directory;
  }

  test("signs the message it is reusing", async () => {
    const directory = repositoryWithCommit("subject");

    run(directory, await sign("git commit --amend --no-edit"));

    expect(commitMessage(directory)).toBe(`subject\n\n${signature}\n\n`);
  });

  test("keeps the original author and author date", async () => {
    const directory = repositoryWithCommit("subject");
    const before = run(directory, "git log -1 --format='%an|%ae|%ad'");

    run(directory, await sign("git commit --amend --no-edit"));

    expect(run(directory, "git log -1 --format='%an|%ae|%ad'")).toBe(before);
  });

  test("does not sign twice when amended again", async () => {
    const directory = repositoryWithCommit("subject");
    run(directory, await sign("git commit --amend --no-edit"));
    writeFileSync(join(directory, "tracked.txt"), "changed again\n");
    run(directory, "git add tracked.txt");

    run(directory, await sign("git commit --amend --no-edit"));

    expect(commitMessage(directory).match(/Generated with \[OpenCode\]/g)).toHaveLength(1);
  });
});

describe("messages the plugin refuses to touch", () => {
  test.each([
    ["a message file mixed with -m", 'git commit -m "subject" -F message.txt'],
    ["a message file whose input is already piped", "printf x | git commit -F msg.txt"],
    ["stdin with nothing visible feeding it", "git commit -F-"],
    // The message does not exist yet: the user is about to write it.
    ["an amend that opens the editor", "git commit --amend"],
    ["a commit that opens the editor", "git commit"],
    // -C and -c copy the author and author date too; -F would reset both.
    ["a message reused from another commit", "git commit -C HEAD~1"],
    ["a message reedited from another commit", "git commit -c HEAD~1"],
    ["--reuse-message", "git commit --reuse-message=HEAD~1"],
  ])("returns the command unchanged for %s", async (_name, command) => {
    expect(await sign(command)).toBe(command);
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

  test("signs a message-file commit and the pull request body", async () => {
    const rewritten = await sign('git commit -F msg.txt && gh pr create --title t --body "hello"');

    expect(rewritten).toContain("cat -- msg.txt");
    expect(rewritten).toContain(`--body 'hello\n\n${signature}'`);
  });

  test("still signs the pull request when the commit cannot be signed", async () => {
    const rewritten = await sign('printf x | git commit -F msg.txt && gh pr create --title t --body "hello"');

    expect(rewritten).toBe(
      `printf x | git commit -F msg.txt && gh pr create --title t --body 'hello\n\n${signature}'`,
    );
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
