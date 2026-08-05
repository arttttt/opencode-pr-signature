/**
 * Signing GitHub CLI command lines: gh pr/issue create, comment and review.
 */

import { hasSignature } from "./signature";
import { signedValueSubstitution } from "./signed-message";
import {
  attachedValue,
  findCommandEndIndex,
  findCommandMatch,
  maskHeredocBodies,
  quoteShellArgument,
  readShellWord,
} from "./shell";

/** gh commands that carry a body we can sign. */
const GH_COMMAND_PATTERN = /gh\s+(pr|issue)\s+(create|comment|review)\b/i;

/**
 * What the gh command says about its body, as far as we can tell.
 *
 * "unsupported" is deliberately distinct from "absent": adding a second
 * --body would make gh use ours and drop the user's text, so a body we cannot
 * rewrite in place has to stop us rather than fall back to adding a flag.
 */
type GhBodyOption =
  | { kind: "absent" }
  | { kind: "unsupported" }
  /** A body written out in the command; its text is known here. */
  | { kind: "static"; value: string; start: number; end: number }
  /** A body that only exists once the shell expands it. */
  | { kind: "dynamic"; expression: string; start: number; end: number };

/**
 * Locate the --body/-b value of a gh command, in any of the spellings gh
 * accepts: `--body x`, `--body=x`, `-b x`, `-bx`.
 */
function findGhBodyOption(command: string): GhBodyOption {
  let index = 0;

  while (index < command.length) {
    const word = readShellWord(command, index);
    if (!word || word.value === "--") break;
    index = word.end;

    // --body-file and --body-text are different options that happen to share
    // the prefix; only an exact match or an `=` is the body itself.
    if (word.value === "--body" || word.value === "-b") {
      const value = readShellWord(command, index);
      if (!value) return { kind: "unsupported" };
      return /[$`]/.test(value.raw)
        ? { kind: "dynamic", expression: value.raw, start: word.start, end: value.end }
        : { kind: "static", value: value.value, start: word.start, end: value.end };
    }

    const prefix = word.value.startsWith("--body=") ? "--body=" : word.value.startsWith("-b") ? "-b" : undefined;
    if (prefix) {
      const raw = attachedValue(word, prefix);
      // The option was quoted as a whole ("--body=x"), so its prefix and its
      // raw text no longer line up and slicing would break the command.
      if (raw === undefined) return { kind: "unsupported" };
      return /[$`]/.test(raw)
        ? { kind: "dynamic", expression: raw, start: word.start, end: word.end }
        : { kind: "static", value: word.value.slice(prefix.length), start: word.start, end: word.end };
    }

    // A body read from a file or from standard input is not ours to rewrite.
    // Reading it in a substitution would discard the reader's exit status, so
    // an unreadable file would become an empty body and a successful gh run.
    if (
      word.value === "--body-file" ||
      word.value === "-F" ||
      word.value.startsWith("--body-file=") ||
      word.value.startsWith("-F")
    ) {
      return { kind: "unsupported" };
    }
  }

  return { kind: "absent" };
}

/**
 * Add signature to a gh CLI command: gh pr/issue create, comment or review.
 * If --body/-b exists, append the signature to its value; otherwise add the
 * flag. Returns the command unchanged when the body cannot be rewritten.
 */
export function addSignatureToGhCommand(command: string, signature: string): string {
  const scan = maskHeredocBodies(command);
  const ghMatch = findCommandMatch(scan, GH_COMMAND_PATTERN);
  if (!ghMatch || ghMatch.index === undefined) return command;

  const startIndex = ghMatch.index;
  const endIndex = findCommandEndIndex(scan, startIndex);

  const commandPart = command.slice(startIndex, endIndex);
  const beforeCommand = command.slice(0, startIndex);
  const afterCommand = command.slice(endIndex);

  // Scoped to this command, not the whole line: a signature already added to
  // a git commit earlier in the same line says nothing about the PR body.
  if (hasSignature(commandPart)) return command;

  // A heredoc inside the gh command itself (--body-file -, an inline body)
  // carries text we would have to read to append to it. Leave it alone.
  if (scan.slice(startIndex, endIndex) !== commandPart) return command;

  const body = findGhBodyOption(commandPart);

  if (body.kind === "unsupported") return command;

  if (body.kind === "absent") {
    const trimmedPart = commandPart.trimEnd();
    return beforeCommand + trimmedPart + ` --body ${quoteShellArgument(signature)}` + afterCommand;
  }

  // Real newlines: gh receives the body as one shell argument, where a
  // literal "\n" would stay two characters.
  const signed =
    body.kind === "static"
      ? quoteShellArgument(body.value.trimEnd() + "\n\n" + signature)
      : signedValueSubstitution(body.expression, signature);

  const rewritten = commandPart.slice(0, body.start) + `--body ${signed}` + commandPart.slice(body.end);
  return beforeCommand + rewritten + afterCommand;
}
