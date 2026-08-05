/**
 * Signing `git commit` command lines.
 */

import { hasSignature } from "./signature";
import { fileReader, signedMessageGroup, stdinReader } from "./signed-message";
import {
  findCommandEndIndex,
  findCommandMatch,
  findHeredocBody,
  findStdinRedirect,
  hasPrecedingPipe,
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
  | { kind: "path"; token: string; start: number; end: number };

/**
 * Work out which message option the commit carries, in any of the spellings
 * git accepts. Returns undefined when the options do not add up — an
 * unreadable word, or -m mixed with -F — so the caller leaves the command be.
 */
function findCommitMessageSource(command: string, startIndex: number): CommitMessageSource | undefined {
  let index = startIndex;
  let source: CommitMessageSource | undefined;

  while (index < command.length) {
    const word = readShellWord(command, index);
    if (!word || word.value === "--") break;
    index = word.end;

    if (word.value === "-m" || word.value === "--message") {
      const message = readShellWord(command, index);
      if (!message || (source && source.kind !== "message")) return undefined;
      source = { kind: "message" };
      index = message.end;
      continue;
    }
    // Attached forms: -m"subject", -msubject, --message=subject. git accepts
    // all of them, so the plugin has to recognize all of them.
    if (word.value.startsWith("--message=") || (word.value.startsWith("-m") && word.value.length > 2)) {
      if (source && source.kind !== "message") return undefined;
      source = { kind: "message" };
      continue;
    }

    let file: ShellWord | undefined;
    if (word.value === "-F" || word.value === "--file") {
      file = readShellWord(command, index);
      if (!file) return undefined;
      index = file.end;
    } else if (word.value.startsWith("-F") && word.value.length > 2) {
      file = { raw: word.raw.slice(2), value: word.value.slice(2), start: word.start + 2, end: word.end };
    } else if (word.value.startsWith("--file=") && word.value.length > 7) {
      file = { raw: word.raw.slice(7), value: word.value.slice(7), start: word.start + 7, end: word.end };
    }

    if (file) {
      // -m together with -F is a git error; two -F options are ambiguous.
      if (source) return undefined;
      source =
        file.value === "-"
          ? { kind: "stdin", optionEnd: file.end }
          : { kind: "path", token: file.raw, start: word.start, end: file.end };
    }
  }
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

/**
 * Add a signature to a single git commit command.
 *
 * Signs the two message forms whose text is visible in the command itself:
 * -m in any spelling, and -F - fed by an inline heredoc. Every other form —
 * a message file, a pipe, a redirect — is left exactly as the user wrote it,
 * because signing it would mean guessing at content this plugin cannot see.
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

  // A message file: read it when the command runs, in the working directory
  // git will use, and hand the signed text to git on standard input.
  if (source.kind === "path") {
    // A producer upstream expects git to read its output; a stage that ignores
    // it would leave that producer writing into a pipe nobody drains.
    if (hasPrecedingPipe(scan, gitCommitStart)) return command;
    // -F <path> together with a redirect on stdin is a shape we do not model.
    if (findStdinRedirect(scan.slice(gitCommitStart, endIndex)).kind !== "none") return command;

    const group = signedMessageGroup(fileReader(source.token), signature);
    const rewritten = commandPart.slice(0, source.start) + "-F -" + commandPart.slice(source.end);
    return command.slice(0, gitCommitStart) + group + " | " + rewritten + command.slice(endIndex);
  }

  // -F - with an attached heredoc: the text is right there, edit it in place.
  const heredocCommand = addSignatureToHeredoc(command, signature, gitCommitStart + source.optionEnd);
  if (heredocCommand) return heredocCommand;

  // Otherwise the message arrives on standard input. Move whatever feeds it
  // onto the group, so the group reads exactly what git would have read and
  // git reads the signed result.
  const redirect = findStdinRedirect(scan.slice(gitCommitStart, endIndex));
  const group = signedMessageGroup(stdinReader(), signature);

  if (redirect.kind === "file" || redirect.kind === "string") {
    const operator = redirect.kind === "file" ? "<" : "<<<";
    const withoutRedirect = (commandPart.slice(0, redirect.start) + commandPart.slice(redirect.end)).trimEnd();

    return (
      command.slice(0, gitCommitStart) +
      `${group} ${operator} ${redirect.token} | ${withoutRedirect}` +
      command.slice(endIndex)
    );
  }

  // Fed by a pipeline: slot the group in between, where it reads the producer
  // and git reads it.
  if (redirect.kind === "none" && hasPrecedingPipe(scan, gitCommitStart)) {
    return command.slice(0, gitCommitStart) + `${group} | ${commandPart}` + command.slice(endIndex);
  }

  // Nothing visible feeds standard input, so there is no message to sign.
  return command;
}
