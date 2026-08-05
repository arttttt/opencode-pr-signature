/**
 * Signing `git commit` command lines.
 */

import { hasSignature } from "./signature";
import { fileReader, signedMessageGroup } from "./signed-message";
import {
  findCommandEndIndex,
  findCommandMatch,
  attachedValue,
  findCommandStarts,
  findHeredocBody,
  findStdinRedirect,
  hasPrecedingPipe,
  hasUnquotedGlob,
  maskHeredocBodies,
  quoteShellArgument,
  readHeredocHeader,
  readShellWord,
  type ShellWord,
} from "./shell";

/**
 * Where a git commit takes its message from.
 *
 * "stdin" and "path" are kept apart because only one of them is signable: an
 * inline heredoc is right there in the command string, while a path names
 * content that exists only on disk, at a working directory this plugin does
 * not know, at a time that has not arrived yet.
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
  const newline = command.indexOf("\n", afterOption);
  const limit = newline === -1 ? command.length : newline;

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
  gitCommitStart: number,
  endIndex: number,
  afterGitCommit: number,
  source: CommitMessageSource,
): SigningStage | undefined {
  const insertionPoint = findCommandStarts(scan).get(gitCommitStart) ?? gitCommitStart;
  const piped = hasPrecedingPipe(scan, insertionPoint);
  const redirect = findStdinRedirect(scan.slice(gitCommitStart, endIndex));

  // A message of its own: nothing else may already be feeding this command.
  if (source.kind === "path" || source.kind === "head") {
    if (piped || redirect.kind !== "none") return undefined;
    return source.kind === "path"
      ? {
          reader: fileReader(source.token),
          edits: [{ start: source.start, end: source.end, text: "-F -" }],
          insertionPoint,
        }
      : {
          reader: "git log -1 --format=%B HEAD",
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
  const before = command.slice(0, stage.insertionPoint ?? gitCommitStart);
  // A `$(` immediately before the stage would read as arithmetic expansion in
  // a POSIX shell, so never let the group's `(` touch what precedes it.
  const spacer = before && !/\s$/.test(before) ? " " : "";

  return (
    before +
    spacer +
    group +
    " | " +
    command.slice(stage.insertionPoint ?? gitCommitStart, gitCommitStart) +
    rewritten.trimEnd() +
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
  const gitCommitMatch = findCommandMatch(scan, /git\s+commit\b/i);
  if (!gitCommitMatch || gitCommitMatch.index === undefined) return command;

  const gitCommitStart = gitCommitMatch.index;
  const endIndex = findCommandEndIndex(scan, gitCommitStart);
  const commandPart = command.slice(gitCommitStart, endIndex);
  const source = findCommitMessageSource(scan.slice(gitCommitStart, endIndex), gitCommitMatch[0].length);
  if (!source) return command;

  if (source.kind === "message") {
    if (hasSignature(commandPart)) return command;
    const beforeEnd = command.slice(0, endIndex).trimEnd();
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

  const stage = planSigningStage(scan, command, gitCommitStart, endIndex, gitCommitMatch[0].length, source);
  if (!stage) return command;

  return applySigningStage(command, gitCommitStart, endIndex, stage, signature);
}
