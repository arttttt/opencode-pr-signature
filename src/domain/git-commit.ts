/**
 * Signing `git commit` command lines.
 */

import { hasSignature } from "./signature";
import { fileReader, signedMessageGroup } from "./signed-message";
import {
  findCommandEndIndex,
  findInvocation,
  attachedValue,
  findCommandStarts,
  findHeredocBody,
  findLineEnd,
  findStdinRedirect,
  hasPrecedingPipe,
  hasUnquotedGlob,
  maskHeredocBodies,
  quoteShellArgument,
  readHeredocHeader,
  readLeadingOptions,
  readShellWord,
  trimEndContinuation,
  type Invocation,
  type ShellWord,
} from "./shell";

/**
 * The options git takes before a subcommand that read the next word as their
 * value. `--exec-path` is deliberately absent: spelled without `=` it prints
 * the path and exits rather than taking the word after it.
 */
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--attr-source",
  "--config-env",
]);

const gitTakesSeparatedValue = (option: string) => GIT_VALUE_OPTIONS.has(option);

/** Accept `git commit`, and nothing that merely starts with it. */
function readCommitSubcommand(command: string, index: number): number | undefined {
  const word = readShellWord(command, index);
  return word && word.value.toLowerCase() === "commit" ? word.end : undefined;
}

/**
 * Where a git commit takes its message from.
 *
 * The variants are kept apart by what it takes to read the text: "message" is
 * written out in the command, while "stdin", "path" and "head" each name text
 * that only exists once the command runs, and each needs a different reader in
 * front of it.
 */
type CommitMessageSource =
  | { kind: "message" }
  | { kind: "stdin"; optionEnd: number }
  | { kind: "path"; token: string; start: number; end: number }
  | { kind: "head" };

/**
 * Work out which message option the commit carries, in any of the spellings
 * git accepts. Returns undefined when the options do not add up — an
 * unreadable word, or -m mixed with -F — so the caller leaves the command be.
 */
function findCommitMessageSource(command: string, startIndex: number): CommitMessageSource | undefined {
  let index = startIndex;
  let source: CommitMessageSource | undefined;
  let amend = false;
  let noEdit = false;
  // git refuses a message that is blank once comments are stripped. Appending
  // a signature would turn that refusal into a commit carrying the signature
  // and nothing else, so track whether anything was actually written.
  let messageIsBlank = true;

  const noteMessage = (value: string, raw: string) => {
    // Text the shell will expand is unknown here; assume it says something.
    if (/[$`]/.test(raw) || /[^\s]/.test(value)) messageIsBlank = false;
  };

  while (index < command.length) {
    const word = readShellWord(command, index);
    if (!word || word.value === "--") break;
    index = word.end;

    if (word.value === "--amend") {
      amend = true;
      continue;
    }
    if (word.value === "--no-edit") {
      noEdit = true;
      continue;
    }
    // -C and -c copy the author and the author date along with the message;
    // feeding the message in on -F instead would quietly reset both. A squash
    // or fixup message lives only until the rebase that consumes it.
    if (
      word.value === "-C" ||
      word.value === "-c" ||
      word.value.startsWith("--reuse-message") ||
      word.value.startsWith("--reedit-message") ||
      word.value.startsWith("--squash") ||
      word.value.startsWith("--fixup")
    ) {
      return undefined;
    }

    if (word.value === "-m" || word.value === "--message") {
      const message = readShellWord(command, index);
      if (!message || (source && source.kind !== "message")) return undefined;
      noteMessage(message.value, message.raw);
      source = { kind: "message" };
      index = message.end;
      continue;
    }
    // Attached forms: -m"subject", -msubject, --message=subject. git accepts
    // all of them, so the plugin has to recognize all of them.
    if (word.value.startsWith("--message=") || (word.value.startsWith("-m") && word.value.length > 2)) {
      if (source && source.kind !== "message") return undefined;
      const prefix = word.value.startsWith("--message=") ? "--message=" : "-m";
      noteMessage(word.value.slice(prefix.length), word.raw.slice(Math.min(prefix.length, word.raw.length)));
      source = { kind: "message" };
      continue;
    }

    let file: ShellWord | undefined;
    if (word.value === "-F" || word.value === "--file") {
      file = readShellWord(command, index);
      if (!file) return undefined;
      index = file.end;
    } else if (word.value.startsWith("-F") || word.value.startsWith("--file=")) {
      const prefix = word.value.startsWith("--file=") ? "--file=" : "-F";
      const raw = attachedValue(word, prefix);
      if (raw === undefined) return undefined;
      file = { raw, value: word.value.slice(prefix.length), start: word.start, end: word.end };
    }

    if (file) {
      // -m together with -F is a git error; two -F options are ambiguous.
      if (source) return undefined;
      if (file.value === "-") {
        source = { kind: "stdin", optionEnd: file.end };
      } else {
        // A glob names however many files match; one reader cannot stand in
        // for git's own "first match is the message, the rest are pathspecs".
        if (hasUnquotedGlob(file.raw)) return undefined;
        source = { kind: "path", token: file.raw, start: word.start, end: file.end };
      }
    }
  }

  // `--amend --no-edit` reuses HEAD's message and opens no editor. Plain
  // `--amend` does open one, and its message does not exist yet.
  if (!source && amend && noEdit) return { kind: "head" };
  if (source?.kind === "message" && messageIsBlank) return undefined;
  return source;
}

/**
 * Append the signature to the heredoc attached to a `-F -` option.
 *
 * Takes the whole command and an absolute offset, because a heredoc body
 * lives past the end of the command that owns it — after the newline, and
 * after anything else on that line. Returns the command unchanged when the
 * body is already signed, and undefined when there is no heredoc to sign: a
 * pipe, a redirect or an unterminated heredoc all land there.
 */
function addSignatureToHeredoc(command: string, signature: string, afterOption: number): string | undefined {
  // The header has to sit on the option's own line; past that newline the
  // heredoc body, or another command, has already begun.
  const limit = findLineEnd(command, afterOption);

  for (let index = afterOption; index < limit; index++) {
    const heredoc = readHeredocHeader(command, index);
    if (!heredoc) continue;

    const body = findHeredocBody(command, heredoc.end, heredoc.header);
    if (!body) return undefined;
    if (hasSignature(command.slice(body.start, body.end))) return command;
    return command.slice(0, body.end) + `\n${signature}\n` + command.slice(body.end);
  }

  return undefined;
}

/** One edit to the git commit command's own text. */
type SegmentEdit = { start: number; end: number; text: string };

/**
 * Build a reader that stands where git stands.
 *
 * git applies its own options before it does anything: `--git-dir` points it
 * at another repository, `-C` moves it into another directory. A reader that
 * drops them reads the wrong repository's HEAD and hands the message straight
 * to a commit in the right one, which is a wrong message committed silently.
 */
function headReader(options: string): string {
  return `git${options ? ` ${options}` : ""} log -1 --format=%B HEAD`;
}

/**
 * Build a reader for a message file, from the directory git will read it in.
 *
 * Only `-C` moves git: `--git-dir` and `--work-tree` send it to another
 * repository while leaving the working directory alone, so a relative path
 * still resolves against the real one. Several `-C` chain, each relative to
 * the one before, which is what repeating the `cd` reproduces. The stage is
 * already a subshell, so none of this reaches the commit itself.
 */
function pathReader(directories: string[], pathToken: string): string {
  return [...directories.map((directory) => `cd -- ${directory}`), fileReader(pathToken)].join(" && ");
}

/** The `-C` paths this invocation carries, in the order git applies them. */
function workingDirectories(command: string, invocation: Invocation): string[] {
  const directories: string[] = [];
  for (const { option, value } of readLeadingOptions(command, invocation.optionsStart, gitTakesSeparatedValue)) {
    if (option.value === "-C" && value) directories.push(value.raw);
  }
  return directories;
}

/**
 * Everything needed to put a signing stage in front of one git commit: what
 * reads the message, how the command changes to take it on standard input,
 * and what feeds the stage itself.
 */
type SigningStage = {
  reader: string;
  edits: SegmentEdit[];
  /**
   * Where the stage goes. Not the git commit itself: an assignment prefix
   * belongs to the command, and `VAR=x ( … ) | cmd` is a syntax error.
   */
  insertionPoint: number;
  /** A redirection moved off the command and onto the stage. */
  stageInput?: string;
};

/**
 * Decide how to sign a message that is not written out in the command, or
 * return undefined to leave the command alone.
 *
 * The guards live here rather than in each caller, so every source answers the
 * same questions: is this command already fed by something, and is there
 * exactly one thing feeding it?
 */
function planSigningStage(
  scan: string,
  command: string,
  invocation: Invocation,
  endIndex: number,
  source: CommitMessageSource,
): SigningStage | undefined {
  const gitCommitStart = invocation.start;
  const afterGitCommit = invocation.end - invocation.start;
  const insertionPoint = findCommandStarts(scan).get(gitCommitStart) ?? gitCommitStart;
  const piped = hasPrecedingPipe(scan, insertionPoint);
  const redirect = findStdinRedirect(scan.slice(gitCommitStart, endIndex));

  // A message of its own: nothing else may already be feeding this command.
  if (source.kind === "path" || source.kind === "head") {
    if (piped || redirect.kind !== "none") return undefined;
    return source.kind === "path"
      ? {
          reader: pathReader(workingDirectories(command, invocation), source.token),
          edits: [{ start: source.start, end: source.end, text: "-F -" }],
          insertionPoint,
        }
      : {
          reader: headReader(command.slice(invocation.optionsStart, invocation.optionsEnd).trim()),
          // Insert next to the subcommand, ahead of any `--`, past which git
          // reads every word as a pathspec rather than an option.
          edits: [{ start: afterGitCommit, end: afterGitCommit, text: " -F -" }],
          insertionPoint,
        };
  }

  // -F - : the message is on standard input, so the stage takes over whatever
  // was feeding it and git reads the stage.
  if (redirect.kind === "file" || redirect.kind === "string") {
    const operator = redirect.kind === "file" ? "<" : "<<<";
    return {
      reader: "cat",
      edits: [{ start: redirect.start, end: redirect.end, text: "" }],
      insertionPoint,
      stageInput: `${operator} ${redirect.token}`,
    };
  }
  if (redirect.kind === "none" && piped) return { reader: "cat", edits: [], insertionPoint };

  // Nothing visible feeds standard input, so there is no message to sign.
  return undefined;
}

/**
 * Splice the stage into the command: edits to the command's own text, then the
 * stage placed where a pipeline may legally begin.
 */
function applySigningStage(
  command: string,
  gitCommitStart: number,
  endIndex: number,
  stage: SigningStage,
  signature: string,
): string {
  const commandPart = command.slice(gitCommitStart, endIndex);

  let rewritten = "";
  let cursor = 0;
  for (const edit of [...stage.edits].sort((a, b) => a.start - b.start)) {
    rewritten += commandPart.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  rewritten += commandPart.slice(cursor);

  const group = signedMessageGroup(stage.reader, signature) + (stage.stageInput ? ` ${stage.stageInput}` : "");
  const before = command.slice(0, stage.insertionPoint);
  // A `$(` immediately before the stage would read as arithmetic expansion in
  // a POSIX shell, so never let the group's `(` touch what precedes it.
  const spacer = before && !/\s$/.test(before) ? " " : "";

  return (
    before +
    spacer +
    group +
    " | " +
    command.slice(stage.insertionPoint, gitCommitStart) +
    rewritten +
    command.slice(endIndex)
  );
}

/**
 * Add a signature to a single git commit command.
 *
 * Text written out in the command — `-m` in any spelling, a `-F -` heredoc —
 * is edited in place. A message that only exists once the command runs gets a
 * signing stage piped in front of it. A command whose message this plugin
 * cannot reach at all is returned exactly as the user wrote it.
 */
export function addSignatureToGitCommitCommand(command: string, signature: string): string {
  // Scan the masked copy so message text is never read as shell syntax, and
  // slice the original so the message is never altered by scanning.
  const scan = maskHeredocBodies(command);
  const invocation = findInvocation(scan, "git", gitTakesSeparatedValue, readCommitSubcommand);
  if (!invocation) return command;

  const gitCommitStart = invocation.start;
  const endIndex = findCommandEndIndex(scan, gitCommitStart);
  const commandPart = command.slice(gitCommitStart, endIndex);
  // Past the subcommand: git's own options are not the commit's, and `-C`
  // means a different thing on each side of it.
  const source = findCommitMessageSource(scan.slice(gitCommitStart, endIndex), invocation.end - gitCommitStart);
  if (!source) return command;

  if (source.kind === "message") {
    if (hasSignature(commandPart)) return command;
    const beforeEnd = trimEndContinuation(command.slice(0, endIndex));
    const afterCommand = command.slice(endIndex);
    const separator = afterCommand && !/^\s/.test(afterCommand) ? " " : "";
    return `${beforeEnd} -m ${quoteShellArgument(signature)}${separator}${afterCommand}`;
  }

  // -F - with an attached heredoc: the text is right there, edit it in place,
  // no stage needed.
  if (source.kind === "stdin") {
    const heredocCommand = addSignatureToHeredoc(command, signature, gitCommitStart + source.optionEnd);
    if (heredocCommand) return heredocCommand;
  }

  const stage = planSigningStage(scan, command, invocation, endIndex, source);
  if (!stage) return command;

  return applySigningStage(command, gitCommitStart, endIndex, stage, signature);
}
