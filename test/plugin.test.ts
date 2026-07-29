import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSignatureToGitCommitCommand } from "../src/plugin";

const signature = "🤖 Generated with [OpenCode](https://opencode.ai) (Test Model)";
const directories: string[] = [];

function run(directory: string, command: string): string {
  return execFileSync("/bin/zsh", ["-c", command], { cwd: directory, encoding: "utf8" });
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

  test("signs a -F message without changing its source file", () => {
    const directory = createRepository();
    const messageFile = join(directory, "commit message.txt");
    writeFileSync(messageFile, "subject\n\nbody\n");
    const command = addSignatureToGitCommitCommand("git commit -F 'commit message.txt'", signature);

    run(directory, command);

    expect(commitMessage(directory)).toContain(signature);
    expect(readFileSync(messageFile, "utf8")).toBe("subject\n\nbody\n");
  });

  test("supports --file=PATH and does not duplicate an existing signature", () => {
    const directory = createRepository();
    writeFileSync(join(directory, "message"), `subject\n\n${signature}\n`);
    const command = addSignatureToGitCommitCommand("git commit --file=message", signature);

    run(directory, command);

    expect(commitMessage(directory).match(/Generated with \[OpenCode\]/g)).toHaveLength(1);
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

  test("captures piped stdin for -F-", () => {
    const directory = createRepository();
    const command = addSignatureToGitCommitCommand("printf 'subject\\n' | git commit -F-", signature);

    run(directory, command);

    expect(commitMessage(directory)).toContain(signature);
  });
});
