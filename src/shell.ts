/**
 * Reading a bash command well enough to append to it safely.
 *
 * Everything here answers one question: which characters of this string are
 * shell syntax, and which are somebody's text? Get that wrong and a commit
 * message becomes a command separator, or a closing paren lands inside a
 * commit message.
 */

export type HeredocHeader = { delimiter: string; allowIndent: boolean };

/**
 * Read a heredoc header (`<<EOF`, `<<-'EOF'`, `<< "EOF"`) starting at index.
 * Returns undefined for anything else, including the `<<<` herestring.
 */
export function readHeredocHeader(
  command: string,
  index: number,
): { header: HeredocHeader; end: number } | undefined {
  if (command[index] !== "<" || command[index + 1] !== "<" || command[index + 2] === "<") return undefined;

  let i = index + 2;
  const allowIndent = command[i] === "-";
  if (allowIndent) i++;
  while (command[i] === " " || command[i] === "\t") i++;

  let delimiter = "";
  let quote: string | undefined;
  while (i < command.length) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = undefined;
      else delimiter += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "\\" && i + 1 < command.length) {
      delimiter += command[++i];
    } else if (/[\s;|&<>()]/.test(char)) {
      break;
    } else {
      delimiter += char;
    }
    i++;
  }

  if (quote || delimiter === "") return undefined;
  return { header: { delimiter, allowIndent }, end: i };
}

/** Filler that carries no shell meaning; masking never changes string length. */
const MASK_CHARACTER = "x";

/**
 * Locate the body of the heredoc whose header ends at headerEnd: the text
 * between the newline that opens it and its terminator line. Returns
 * undefined when the heredoc is never terminated.
 */
export function findHeredocBody(
  command: string,
  headerEnd: number,
  header: HeredocHeader,
): { start: number; end: number; delimiterLineEnd: number } | undefined {
  const opening = command.indexOf("\n", headerEnd);
  if (opening === -1) return undefined;

  let lineStart = opening + 1;
  while (lineStart <= command.length) {
    const newline = command.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? command.length : newline;
    const line = command.slice(lineStart, lineEnd);
    const content = header.allowIndent ? line.replace(/^\t+/, "") : line;

    if (content.replace(/\r$/, "") === header.delimiter) {
      return { start: opening + 1, end: lineStart, delimiterLineEnd: lineEnd };
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }

  return undefined;
}

/**
 * Overwrite one heredoc body — its text and its terminator line — and return
 * the index just past that terminator line.
 *
 * The newline that opens the body is left alone: it still ends the command
 * line that carried the header, and whatever follows on that line, such as
 * `&& gh pr create`, is a real command that must stay visible.
 */
function maskHeredocBody(command: string, masked: string[], start: number, header: HeredocHeader): number {
  const body = findHeredocBody(command, start, header);
  // An unterminated heredoc swallows the rest of the string as message text.
  const end = body ? body.delimiterLineEnd : command.length;
  for (let i = start + 1; i < end; i++) masked[i] = MASK_CHARACTER;
  return end;
}

/**
 * Return a copy of the command with every heredoc body replaced by filler of
 * the same length, so positions still map 1:1 onto the original string.
 *
 * Heredoc bodies are plain text, not shell syntax: without this, a commit
 * message containing `;` or `&&` looks like a command separator, and a message
 * mentioning `-m` looks like an option. Scanning runs on the masked copy;
 * every slice that is returned to the caller is cut from the original.
 */
export function maskHeredocBodies(command: string): string {
  const masked = command.split("");
  const pending: HeredocHeader[] = [];
  let quote: string | undefined;
  let i = 0;

  while (i < command.length) {
    const char = command[i];

    if (quote) {
      if (char === "\\" && quote === '"' && i + 1 < command.length) i++;
      else if (char === quote) quote = undefined;
      i++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      i++;
      continue;
    }
    if (char === "\\" && i + 1 < command.length) {
      i += 2;
      continue;
    }
    if (char === "<") {
      const heredoc = readHeredocHeader(command, i);
      if (heredoc) {
        pending.push(heredoc.header);
        i = heredoc.end;
        continue;
      }
    }
    // Bodies begin after the line carrying their headers, in header order.
    if (char === "\n" && pending.length > 0) {
      let cursor = i;
      for (const header of pending) cursor = maskHeredocBody(command, masked, cursor, header);
      pending.length = 0;
      i = cursor;
      continue;
    }
    i++;
  }

  return masked.join("");
}

/**
 * Whether the character at index ends the command that precedes it.
 *
 * A newline separates as surely as a semicolon, `(` and `)` bound a subshell
 * or substitution, and a free-standing `&` backgrounds what came before — but
 * an `&` in 2>&1, >&2 or &>log is part of a redirection and belongs to the
 * command.
 */
function isSeparatorAt(command: string, index: number): boolean {
  const char = command[index];
  if (char === "&") {
    const prevChar = index > 0 ? command[index - 1] : "";
    return !(prevChar === ">" || prevChar === "<" || command[index + 1] === ">");
  }
  return /[;|\n()]/.test(char ?? "");
}

/**
 * Collect the positions at which a command begins: the start of the string,
 * and the first non-blank character after every separator.
 *
 * A `git commit` found anywhere else is text inside another command's
 * argument — `echo "run git commit -m x"` — and rewriting it would append
 * options to whatever command really is running.
 */
export function findCommandStarts(command: string): Set<number> {
  const starts = new Set<number>();
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let atStart = true;
  let inAssignment = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const prevChar = i > 0 ? command[i - 1] : "";

    if (char === "'" && !inDoubleQuote && prevChar !== "\\") {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && prevChar !== "\\") {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote && isSeparatorAt(command, i)) {
      atStart = true;
      inAssignment = false;
      continue;
    }

    // `GIT_COMMITTER_DATE=… git commit …`: an assignment prefix leaves the
    // word after it still in command position.
    if (inAssignment && !inSingleQuote && !inDoubleQuote && /\s/.test(char)) {
      atStart = true;
      inAssignment = false;
    }

    if (!atStart || /\s/.test(char)) continue;

    starts.add(i);
    atStart = false;

    const word = readShellWord(command, i);
    if (word && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word.value)) inAssignment = true;
  }

  return starts;
}

/**
 * Find the first occurrence of a command that is actually being run, skipping
 * matches that sit inside another command's arguments.
 */
export function findCommandMatch(command: string, pattern: RegExp): RegExpExecArray | undefined {
  const starts = findCommandStarts(command);
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");

  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    if (starts.has(match.index)) return match;
  }

  return undefined;
}

/**
 * Find the end position of a command in a bash command string.
 * Respects quotes to avoid splitting on && or || inside quoted strings.
 *
 * Expects a command whose heredoc bodies are already masked; call
 * maskHeredocBodies first, or message text will be read as shell syntax.
 *
 * @param command - The full bash command string
 * @param startIndex - Where to start searching from
 * @returns The index where command ends (before a separator or end of string)
 */
export function findCommandEndIndex(command: string, startIndex: number): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = startIndex;

  while (i < command.length) {
    const char = command[i];
    const prevChar = i > 0 ? command[i - 1] : "";

    // Handle quote toggling (ignore escaped quotes)
    if (char === "'" && !inDoubleQuote && prevChar !== "\\") {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && prevChar !== "\\") {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      // A `#` opens a comment that would swallow anything appended after it.
      if (isSeparatorAt(command, i)) return i;
      if (char === "#" && (i === startIndex || /\s/.test(prevChar))) return i;
    }
    i++;
  }

  return command.length;
}

/**
 * What is feeding a command's standard input, as far as its own text says.
 *
 * "none" still leaves the pipeline: a command with no redirect of its own may
 * be downstream of a `|`, which findPrecedingPipe answers separately.
 */
export type StdinRedirect =
  | { kind: "none" }
  | { kind: "heredoc" }
  | { kind: "file"; token: string; start: number; end: number }
  | { kind: "string"; token: string; start: number; end: number }
  | { kind: "unknown" };

/**
 * Find what redirects a command's standard input, within one command's text.
 *
 * Output redirections are skipped: they say nothing about where the message
 * comes from. Anything else that touches descriptor 0 in a way not modelled
 * here answers "unknown", so callers decline rather than guess.
 */
export function findStdinRedirect(command: string): StdinRedirect {
  let found: StdinRedirect = { kind: "none" };
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const prevChar = i > 0 ? command[i - 1] : "";

    if (char === "'" && !inDoubleQuote && prevChar !== "\\") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote && prevChar !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote || char !== "<") continue;

    // A descriptor other than 0 in front of `<` is something we do not model.
    const redirectsStdin = !/[1-9]/.test(prevChar);
    const start = /[0-9]/.test(prevChar) ? i - 1 : i;

    if (command[i + 1] === "<") {
      if (command[i + 2] === "<") {
        const word = readShellWord(command, i + 3);
        if (!word || !redirectsStdin) return { kind: "unknown" };
        if (found.kind !== "none") return { kind: "unknown" };
        found = { kind: "string", token: word.raw, start, end: word.end };
        i = word.end - 1;
        continue;
      }
      // A heredoc: its body is the message, handled where heredocs are.
      if (found.kind !== "none") return { kind: "unknown" };
      found = { kind: "heredoc" };
      i += 1;
      continue;
    }

    const word = readShellWord(command, i + 1);
    if (!word || !redirectsStdin) return { kind: "unknown" };
    if (found.kind !== "none") return { kind: "unknown" };
    found = { kind: "file", token: word.raw, start, end: word.end };
    i = word.end - 1;
  }

  return found;
}

/**
 * Whether the command starting at index is downstream of a pipe.
 *
 * It matters twice over: such a command already has its standard input spoken
 * for, and inserting a stage that ignores that input would leave the producer
 * writing into a pipe nobody reads.
 */
export function hasPrecedingPipe(command: string, startIndex: number): boolean {
  let i = startIndex - 1;
  while (i >= 0 && /\s/.test(command[i] ?? "")) i--;
  return i >= 0 && command[i] === "|" && command[i - 1] !== "|";
}

/**
 * Wrap a value so the shell passes it through verbatim. Single quotes are the
 * only quoting in POSIX sh that suppresses every expansion, so an embedded
 * quote has to be closed, escaped and reopened.
 */
export function quoteShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export type ShellWord = {
  raw: string;
  value: string;
  start: number;
  end: number;
};

/** Read the limited shell word syntax used for command options. */
export function readShellWord(command: string, startIndex: number): ShellWord | undefined {
  let start = startIndex;
  while (/\s/.test(command[start] ?? "")) start++;
  if (!command[start] || /[;|&]/.test(command[start])) return undefined;

  let value = "";
  let quote: "'" | '"' | undefined;
  let i = start;

  while (i < command.length) {
    const char = command[i];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === "\\" && quote === '"' && i + 1 < command.length) {
        value += command[++i];
      } else {
        value += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "\\" && i + 1 < command.length) {
      value += command[++i];
    } else if (/\s/.test(char) || /[;|&]/.test(char)) {
      break;
    } else {
      value += char;
    }
    i++;
  }

  if (quote || i === start) return undefined;
  return { raw: command.slice(start, i), value, start, end: i };
}
