import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSignatureToGitCommitCommand } from "../src/git-commit";

const signature = "🤖 Generated with [OpenCode](https://opencode.ai) (Test Model)";
const directories: string[] = [];

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

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe("git commit signatures", () => {
  test("keeps the additional -m paragraph behavior", () => {
    const command = addSignatureToGitCommitCommand('git commit -m "subject" && git status --short', signature);

    expect(command).toBe(`git commit -m "subject" -m '${signature}' && git status --short`);
  });

  test("supports multiple existing -m paragraphs", () => {
    const command = addSignatureToGitCommitCommand('git commit -m "subject" -m "body"', signature);

    expect(command).toBe(`git commit -m "subject" -m "body" -m '${signature}'`);
  });

  test("leaves a message file untouched, and its commit unchanged", () => {
    const directory = createRepository();
    const messageFile = join(directory, "commit message.txt");
    writeFileSync(messageFile, "subject\n\nbody\n");
    const original = "git commit -F 'commit message.txt'";

    const command = addSignatureToGitCommitCommand(original, signature);
    run(directory, command);

    expect(command).toBe(original);
    expect(commitMessage(directory)).toBe("subject\n\nbody\n\n");
    expect(readFileSync(messageFile, "utf8")).toBe("subject\n\nbody\n");
  });

  test("leaves --file=PATH alone rather than guessing at its contents", () => {
    const original = "git commit --file=message";

    expect(addSignatureToGitCommitCommand(original, signature)).toBe(original);
  });

  test("signs a -F- heredoc before Git reads stdin", () => {
    const directory = createRepository();
    const command = addSignatureToGitCommitCommand("git commit -F- <<'EOF'\nsubject\n\nbody\nEOF", signature);

    run(directory, command);

    expect(commitMessage(directory)).toContain("subject\n\nbody\n\n" + signature);
  });

  test("leaves an already signed heredoc unchanged", () => {
    const command = `git commit -F- <<'EOF'\nsubject\n\n${signature}\nEOF`;

    expect(addSignatureToGitCommitCommand(command, signature)).toBe(command);
  });

  test("leaves piped stdin alone: taking the stream would lose the message", () => {
    const directory = createRepository();
    const original = "printf 'subject\\n' | git commit -F-";

    const command = addSignatureToGitCommitCommand(original, signature);
    run(directory, command);

    expect(command).toBe(original);
    expect(commitMessage(directory)).toBe("subject\n\n");
  });
});
