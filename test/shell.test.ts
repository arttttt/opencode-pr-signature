/**
 * Unit tests for the shell reading that locates an invocation: the options a
 * program takes before its subcommand, and which occurrence of a program name
 * is the one actually being run.
 *
 * These sit below the hook-level suite in plugin.test.ts, which can only say
 * that a command came back unsigned — never which of the two steps decided it.
 */

import { describe, expect, test } from "bun:test";
import { findCommandEndIndex, findCommandStarts, findInvocation, readShellWord, skipLeadingOptions } from "../src/domain/shell";

/** git's own set: the options before a subcommand that eat the next word. */
const gitValueOptions = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--attr-source", "--config-env"]);
const gitTakesValue = (option: string) => gitValueOptions.has(option);

/** The word skipping stopped on, which is what a caller reads next. */
function wordAfterOptions(command: string, from = 3): string | undefined {
  return readShellWord(command, skipLeadingOptions(command, from, gitTakesValue))?.value;
}

/** Accepts only the subcommand `commit`, the way git-commit.ts does. */
function commitSubcommand(command: string, index: number): number | undefined {
  const word = readShellWord(command, index);
  return word && word.value.toLowerCase() === "commit" ? word.end : undefined;
}

const findGitCommit = (command: string) => findInvocation(command, "git", gitTakesValue, commitSubcommand);

describe("skipLeadingOptions", () => {
  test("stops on the first word that is not an option", () => {
    expect(wordAfterOptions("git commit -m x")).toBe("commit");
  });

  test("steps over an option and the value attached to it", () => {
    expect(wordAfterOptions("git --git-dir=/x/.git commit")).toBe("commit");
    expect(wordAfterOptions("git -c user.name=bob commit")).toBe("commit");
  });

  test("steps over an option and the separate word holding its value", () => {
    expect(wordAfterOptions("git -C /path/to/repo commit")).toBe("commit");
    expect(wordAfterOptions("git --work-tree /x --git-dir /x/.git commit")).toBe("commit");
  });

  test("keeps a valueless flag from swallowing the subcommand", () => {
    // The regex this replaced read `log` as the value of `--no-pager` and then
    // `commit` — a ref here — as the subcommand.
    expect(wordAfterOptions("git --no-pager log commit")).toBe("log");
    expect(wordAfterOptions("git -P show commit")).toBe("show");
  });

  test("a quoted option value is one word, however it is spelled", () => {
    expect(wordAfterOptions(`git -C "/path with spaces" commit`)).toBe("commit");
    expect(wordAfterOptions(`git -C '/path with spaces' commit`)).toBe("commit");
  });

  test("an unrecognized option is assumed to stand alone", () => {
    expect(wordAfterOptions("git --frobnicate commit")).toBe("commit");
  });

  test("`--` ends the options without being read as one", () => {
    expect(wordAfterOptions("git -- commit")).toBe("--");
  });

  test("a lone dash is a word, not an option", () => {
    expect(wordAfterOptions("git - commit")).toBe("-");
  });

  test("an option whose value never arrives stops the walk rather than running off", () => {
    expect(skipLeadingOptions("git -C", 3, gitTakesValue)).toBe(6);
  });
});

describe("findInvocation", () => {
  test("finds the plain adjacent form, with no options in between", () => {
    expect(findGitCommit("git commit -m x")).toEqual({ start: 0, optionsStart: 3, optionsEnd: 3, end: 10 });
  });

  test("finds the subcommand past the options, and spans them", () => {
    const command = "git -C /r commit -m x";
    const invocation = findGitCommit(command);
    expect(invocation).toEqual({ start: 0, optionsStart: 3, optionsEnd: 9, end: command.indexOf("commit") + 6 });
    expect(command.slice(invocation!.optionsStart, invocation!.optionsEnd).trim()).toBe("-C /r");
  });

  test("skips a program name that is only text inside another command", () => {
    expect(findGitCommit(`echo "git -C foo commit -m x"`)).toBeUndefined();
    expect(findGitCommit("echo git -C foo commit")).toBeUndefined();
  });

  test("passes over invocations that are not the subcommand being looked for", () => {
    const command = "git -C /r add . && git -C /r commit -m x";
    expect(findGitCommit(command)?.start).toBe(command.indexOf("git -C /r commit"));
  });

  test("keeps the first invocation when a line carries several", () => {
    const command = "git commit -m a; git -C /r commit -m b";
    expect(findGitCommit(command)?.start).toBe(0);
  });

  test("looks inside a command substitution, where a real commit can run", () => {
    const command = "OUT=$(git -C /r commit -m x)";
    expect(findGitCommit(command)?.start).toBe(command.indexOf("git -C"));
  });

  test("reads the program name as a whole word", () => {
    expect(findGitCommit("github commit")).toBeUndefined();
    expect(findGitCommit("gitk commit")).toBeUndefined();
  });

  test("matches the program name case-insensitively, as the shell may resolve it", () => {
    expect(findGitCommit("GIT -C /r commit -m x")).toBeDefined();
  });

  test("declines a subcommand that only shares a prefix", () => {
    expect(findGitCommit("git -C /r commit-tree x")).toBeUndefined();
  });

  test("declines when the option list never reaches a subcommand", () => {
    expect(findGitCommit("git -C /r")).toBeUndefined();
    expect(findGitCommit("git -C /r status")).toBeUndefined();
  });
});

describe("findCommandEndIndex", () => {
  test("a backslash-escaped newline continues the command rather than ending it", () => {
    const command = "gh pr create --title t \\\n  --body hello";

    expect(findCommandEndIndex(command, 0)).toBe(command.length);
  });

  test("ends a continued command at the pipe that follows it, not at its first line break", () => {
    const command = "gh pr create \\\n  --body hello | tail -5";

    expect(findCommandEndIndex(command, 0)).toBe(command.indexOf("|"));
  });

  test("an unescaped newline still ends the command", () => {
    const command = "gh pr create --title t\necho done";

    expect(findCommandEndIndex(command, 0)).toBe(command.indexOf("\n"));
  });

  test("an escaped separator does not end the command", () => {
    const command = "gh pr create --title a\\;b --body hello";

    expect(findCommandEndIndex(command, 0)).toBe(command.length);
  });

  test("an even run of backslashes leaves the separator free to end the command", () => {
    const command = "gh pr create --title a\\\\;b --body hello";

    expect(findCommandEndIndex(command, 0)).toBe(command.indexOf(";"));
  });
});

describe("readShellWord across a line continuation", () => {
  test("drops a continuation before the word instead of reading it into the value", () => {
    expect(readShellWord("\\\n--body", 0)?.value).toBe("--body");
  });

  test("drops a continuation inside an unquoted word", () => {
    expect(readShellWord("hel\\\nlo", 0)?.value).toBe("hello");
  });

  test("drops a continuation inside double quotes", () => {
    expect(readShellWord('"a\\\nb"', 0)?.value).toBe("ab");
  });

  test("keeps a continuation literal inside single quotes", () => {
    expect(readShellWord("'a\\\nb'", 0)?.value).toBe("a\\\nb");
  });

  test("keeps a backslash that double quotes do not treat as an escape", () => {
    expect(readShellWord('"C:\\new"', 0)?.value).toBe("C:\\new");
  });

  test.each([
    ['"a\\"b"', 'a"b'],
    ['"a\\\\b"', "a\\b"],
    ['"a\\$b"', "a$b"],
  ])("still unescapes what double quotes do escape: %s", (raw, value) => {
    expect(readShellWord(raw, 0)?.value).toBe(value);
  });
});

describe("findCommandStarts across a line continuation", () => {
  test("a continuation after an operator is blank space, not the start of a command", () => {
    const command = "echo a && \\\n  gh pr create";

    expect([...findCommandStarts(command).keys()]).toContain(command.indexOf("gh"));
    expect(findCommandStarts(command).has(command.indexOf("\\"))).toBe(false);
  });
});
