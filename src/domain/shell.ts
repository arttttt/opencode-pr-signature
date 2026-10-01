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
  let i = 0;

  while (i < command.length) {
    const char = command[i];

    const afterQuote = skipQuoted(command, i);
    if (afterQuote === -1) break;
    if (afterQuote !== undefined) {
      i = afterQuote;
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
 * If a command substitution starts at index, return the index just past it.
 *
 * `$(…)` and backticks are one unit of a command's text, not a boundary: the
 * `(` inside `$(` opens a nested command, and treating it as a separator cuts
 * an argument in half. Nesting and quoting inside are tracked so the matching
 * `)` is the right one. Returns -1 when nothing starts here.
 */
export function skipCommandSubstitution(command: string, index: number): number {
  // `\$(…)` and `\`…\`` are text, not a substitution.
  if (isEscapedAt(command, index)) return -1;

  if (command[index] === "`") {
    for (let i = index + 1; i < command.length; i++) {
      if (command[i] === "\\") i++;
      else if (command[i] === "`") return i + 1;
    }
    return -1;
  }

  if (command[index] !== "$" || command[index + 1] !== "(") return -1;

  let depth = 0;
  for (let i = index + 1; i < command.length; i++) {
    const char = command[i];
    const afterQuote = skipQuoted(command, i);
    if (afterQuote === -1) return -1;
    if (afterQuote !== undefined) i = afterQuote - 1;
    else if (char === "\\") i++;
    else if (opensCommentAt(command, i)) {
      const newline = command.indexOf("\n", i);
      if (newline === -1) return -1;
      i = newline - 1;
    }
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return i + 1;
  }

  return -1;
}

/**
 * If a quote opens at index — `'…'`, `"…"` or `$'…'` — return the index just
 * past its closing quote, or -1 when it never closes. Returns undefined when
 * no quote opens here; the caller must be reading unquoted text.
 *
 * Each kind closes by its own rules: single quotes have no escapes at all, so
 * `'a\'` is closed; `$'…'` and double quotes honour a backslash, so `$'a\''`
 * and `"a\""` are not. Double quotes still expand `$(…)` and backticks, whose
 * own quotes are their business: `"$(printf '%s' "it's")"` is one span, and
 * each substitution inside is reported to onSubstitution.
 */
export function skipQuoted(
  command: string,
  index: number,
  onSubstitution?: (start: number, end: number) => void,
): number | undefined {
  const char = command[index];
  if (isEscapedAt(command, index)) return undefined;

  if (char === "'") {
    const close = command.indexOf("'", index + 1);
    return close === -1 ? -1 : close + 1;
  }

  if (char === "$" && command[index + 1] === "'") {
    for (let i = index + 2; i < command.length; i++) {
      if (command[i] === "\\") i++;
      else if (command[i] === "'") return i + 1;
    }
    return -1;
  }

  if (char !== '"') return undefined;
  for (let i = index + 1; i < command.length; i++) {
    if (command[i] === "\\") {
      i++;
      continue;
    }
    if (command[i] === '"') return i + 1;
    const afterExpansion = skipCommandSubstitution(command, i);
    if (afterExpansion !== -1) {
      onSubstitution?.(i, afterExpansion);
      i = afterExpansion - 1;
    }
  }
  return -1;
}

/** A command substitution: `$(…)` or backticks, from its opening to just past its close. */
type Substitution = { start: number; end: number };

/**
 * Every command substitution in the command, nested ones included, in the
 * order they open. Single-quoted text and comments hold none; a substitution's
 * body is read as a command of its own, with fresh quoting.
 */
function collectSubstitutions(command: string, offset = 0, found: Substitution[] = []): Substitution[] {
  const record = (start: number, end: number) => {
    found.push({ start: offset + start, end: offset + end });
    const bodyStart = command[start] === "`" ? start + 1 : start + 2;
    collectSubstitutions(command.slice(bodyStart, end - 1), offset + bodyStart, found);
  };

  for (let i = 0; i < command.length; i++) {
    const afterQuote = skipQuoted(command, i, record);
    if (afterQuote === -1) break;
    if (afterQuote !== undefined) {
      i = afterQuote - 1;
      continue;
    }
    if (command[i] === "\\") {
      i++;
      continue;
    }
    if (opensCommentAt(command, i)) {
      const newline = command.indexOf("\n", i);
      if (newline === -1) break;
      i = newline;
      continue;
    }
    const afterExpansion = skipCommandSubstitution(command, i);
    if (afterExpansion !== -1) {
      record(i, afterExpansion);
      i = afterExpansion - 1;
    }
  }
  return found;
}

/**
 * Where the text a scan from index may read ends: at the closing backtick when
 * index sits inside a backtick substitution, else at the end of the command.
 *
 * The shell finds a closing backtick before it reads any quoting, so nothing
 * past it — not even the rest of a quote it cuts — belongs to this command.
 */
function scanLimit(command: string, index: number): number {
  let innermost: Substitution | undefined;
  for (const substitution of collectSubstitutions(command)) {
    if (substitution.start < index && index < substitution.end) innermost = substitution;
  }
  return innermost && command[innermost.start] === "`" ? innermost.end - 1 : command.length;
}

/**
 * Whether the character at index is escaped by a backslash.
 *
 * A backslash escapes only the character right after it, so an odd run escapes
 * and an even run does not: in `\\;` the `\\` is a literal backslash and leaves
 * the `;` free to separate.
 */
function isEscapedAt(command: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && command[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * Whether a quote opened in the text is never closed. Such text is not a
 * command the shell would run, so it is no place to append anything.
 */
export function hasUnclosedQuote(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const afterQuote = skipQuoted(text, i);
    if (afterQuote === -1) return true;
    if (afterQuote !== undefined) {
      i = afterQuote - 1;
      continue;
    }
    if (opensCommentAt(text, i)) return false;
    const afterExpansion = skipCommandSubstitution(text, i);
    if (afterExpansion !== -1) i = afterExpansion - 1;
  }
  return false;
}

/**
 * Whether a `#` at index opens a comment: only where a word begins, which is
 * after a blank (space or tab, not any whitespace), a newline or an operator.
 * An escaped blank does not end the word before it; a continuation is deleted
 * before the shell looks, so it is seen through.
 */
function opensCommentAt(command: string, index: number): boolean {
  if (command[index] !== "#") return false;
  let before = index - 1;
  while (before >= 1 && command[before] === "\n" && command[before - 1] === "\\" && !isEscapedAt(command, before - 1)) {
    before -= 2;
  }
  return before < 0 || (/[ \t\n;&|()]/.test(command[before]) && !isEscapedAt(command, before));
}

/**
 * Whether a line continuation — a backslash that escapes a newline — starts at
 * index. The shell deletes the pair before it reads anything, so to a scanner
 * it is neither a word nor a separator, only a place the line breaks.
 */
export function isContinuationAt(command: string, index: number): boolean {
  return command[index] === "\\" && command[index + 1] === "\n" && !isEscapedAt(command, index);
}

/**
 * Whether the character at index ends the command that precedes it.
 *
 * A newline separates as surely as a semicolon, `(` and `)` bound a subshell
 * or substitution, and a free-standing `&` backgrounds what came before — but
 * an `&` in 2>&1, >&2 or &>log is part of a redirection and belongs to the
 * command. None of them separates when a backslash escapes it: a `\` before a
 * newline is a line continuation, so a command split across lines stays one
 * command instead of being cut at the first line break.
 */
function isSeparatorAt(command: string, index: number): boolean {
  const char = command[index];
  if (isEscapedAt(command, index)) return false;
  if (char === "&") {
    const prevChar = index > 0 ? command[index - 1] : "";
    return !(prevChar === ">" || prevChar === "<" || command[index + 1] === ">");
  }
  return /[;|\n()]/.test(char ?? "");
}

/**
 * Record the commands inside the substitution at index, which ends at end.
 *
 * A substitution holds commands of its own — `OUT=$(git commit …)` is a real
 * commit — so look inside, offsetting what is found back onto this string.
 */
function recordSubstitutionStarts(command: string, index: number, end: number, starts: Map<number, number>): void {
  const innerStart = command[index] === "`" ? index + 1 : index + 2;
  const inner = command.slice(innerStart, end - 1);
  for (const [start, pipeline] of findCommandStarts(inner)) {
    starts.set(innerStart + start, innerStart + pipeline);
  }
}

/**
 * Collect the positions at which a command begins: the start of the string,
 * and the first non-blank character after every separator.
 *
 * A `git commit` found anywhere else is text inside another command's
 * argument — `echo "run git commit -m x"` — and rewriting it would append
 * options to whatever command really is running.
 */
export function findCommandStarts(command: string): Map<number, number> {
  const starts = new Map<number, number>();
  let atStart = true;
  let inAssignment = false;
  // Where the whole simple command begins, assignment prefix included. A new
  // pipeline stage may only be inserted there: `VAR=x ( … ) | cmd` is a
  // syntax error, because an assignment may only be followed by a command.
  let continuesCommand = false;
  let pipelineStart = 0;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    // A quote or a substitution is one unit of a word. Commands inside a
    // substitution are real — `OUT=$(git commit …)`, `echo "$(gh …)"` — so
    // look inside, offsetting what is found back onto this string.
    const afterQuote = skipQuoted(command, i, (start, end) => recordSubstitutionStarts(command, start, end, starts));
    const afterExpansion = afterQuote === undefined ? skipCommandSubstitution(command, i) : -1;
    if (afterExpansion !== -1) recordSubstitutionStarts(command, i, afterExpansion, starts);
    const unitEnd = afterQuote ?? (afterExpansion === -1 ? undefined : afterExpansion);
    if (unitEnd !== undefined) {
      if (atStart) {
        if (!continuesCommand) pipelineStart = i;
        starts.set(i, pipelineStart);
        atStart = false;
        inAssignment = false;
        continuesCommand = false;
      }
      // An unclosed quote runs to the end: nothing after it is syntax.
      if (unitEnd === -1) break;
      i = unitEnd - 1;
      continue;
    }

    if (isSeparatorAt(command, i)) {
      atStart = true;
      inAssignment = false;
      continuesCommand = false;
      continue;
    }
    // A comment runs to the end of its line, whatever its text ends with,
    // so its newline separates even after a backslash: that backslash is
    // part of the comment, not an escape.
    if (opensCommentAt(command, i)) {
      const newline = command.indexOf("\n", i);
      i = newline === -1 ? command.length : newline;
      atStart = true;
      inAssignment = false;
      continuesCommand = false;
      continue;
    }
    // A continuation is blank space: its newline is read as whitespace on
    // the next turn, so the backslash must not be taken for a command.
    if (isContinuationAt(command, i)) continue;

    // `GIT_COMMITTER_DATE=… git commit …`: an assignment prefix leaves the
    // word after it still in command position, and part of the same command.
    if (inAssignment && /\s/.test(char) && !isEscapedAt(command, i)) {
      atStart = true;
      inAssignment = false;
      continuesCommand = true;
    }

    if (!atStart || /\s/.test(char)) continue;

    if (!continuesCommand) pipelineStart = i;
    starts.set(i, pipelineStart);
    atStart = false;
    continuesCommand = false;

    const word = readShellWord(command, i);
    if (word && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word.value)) inAssignment = true;
  }

  return starts;
}

/**
 * Whether an option takes the word after it as its value, rather than
 * standing on its own or carrying its value attached with `=`.
 */
export type TakesSeparatedValue = (option: string) => boolean;

/**
 * Walk the options a program takes before its subcommand, yielding each one
 * with the word it consumed as its value, and stopping at the first word that
 * is not an option.
 *
 * Which options swallow the word after them cannot be read off their spelling
 * — `--no-pager` takes nothing, `-C` takes a path — so the caller names the
 * ones that do. Guessing by shape instead reads the subcommand of
 * `git --no-pager log commit` as `commit`.
 *
 * An option this does not recognize is assumed to stand alone. That is the
 * safe half of the guess: an unknown option that did take a value leaves its
 * value sitting where the subcommand should be, and the caller finds no
 * subcommand and leaves the command alone.
 */
export function* readLeadingOptions(
  command: string,
  index: number,
  takesSeparatedValue: TakesSeparatedValue,
): Generator<LeadingOption> {
  let cursor = index;

  while (true) {
    const option = readShellWord(command, cursor);
    // `--` ends the options, and a subcommand never sits behind it.
    if (!option || option.value === "-" || option.value === "--" || !option.value.startsWith("-")) return;
    cursor = option.end;

    if (!takesSeparatedValue(option.value)) {
      yield { option };
      continue;
    }

    const value = readShellWord(command, cursor);
    // The value never arrives: stop here rather than read past the options.
    if (!value) {
      yield { option };
      return;
    }
    cursor = value.end;
    yield { option, value };
  }
}

/** An option read before a subcommand, with the word it took as its value. */
export type LeadingOption = { option: ShellWord; value?: ShellWord };

/** Where the options a program takes before its subcommand end. */
export function skipLeadingOptions(command: string, index: number, takesSeparatedValue: TakesSeparatedValue): number {
  let cursor = index;
  for (const { option, value } of readLeadingOptions(command, index, takesSeparatedValue)) {
    cursor = (value ?? option).end;
  }
  return cursor;
}

/** The parts of an invocation a caller has to slice between. */
export type Invocation = {
  /** Where the program name begins. */
  start: number;
  /** Where the program's own options begin, just past its name. */
  optionsStart: number;
  /** Where those options end; whitespace and the subcommand follow. */
  optionsEnd: number;
  /** Where the subcommand ends; the subcommand's own arguments follow. */
  end: number;
};

/**
 * Find the first invocation of a program that is actually being run, skipping
 * the occurrences that sit inside another command's arguments.
 *
 * The subcommand is looked for past the program's own options rather than
 * immediately after its name, so `git -C path commit` and `git commit` are
 * recognized alike. `readSubcommand` reports where the subcommand it accepts
 * ends, or undefined when this invocation is not the one being looked for.
 *
 * The program name is compared as a whole word, so `github` is not `git`; a
 * name spelled as a path is not a command start and is passed over, exactly
 * as it was before the options were allowed in.
 */
export function findInvocation(
  command: string,
  program: string,
  takesSeparatedValue: TakesSeparatedValue,
  readSubcommand: (command: string, index: number) => number | undefined,
): Invocation | undefined {
  // Command substitution nests its own starts in ahead of the outer command,
  // so insertion order is not source order; the first invocation is.
  const starts = [...findCommandStarts(command).keys()].sort((a, b) => a - b);

  for (const start of starts) {
    const word = readShellWord(command, start);
    if (!word || word.value.toLowerCase() !== program) continue;

    const optionsEnd = skipLeadingOptions(command, word.end, takesSeparatedValue);
    const end = readSubcommand(command, optionsEnd);
    if (end !== undefined) return { start, optionsStart: word.end, optionsEnd, end };
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
  // Inside a backtick substitution its closing backtick is where the command
  // ends, like `)`, whatever quoting it cuts through.
  const limit = scanLimit(command, startIndex);
  const text = command.slice(0, limit);

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    const afterQuote = skipQuoted(text, i);
    if (afterQuote === -1) return limit;
    if (afterQuote !== undefined) {
      i = afterQuote - 1;
      continue;
    }
    const afterExpansion = skipCommandSubstitution(text, i);
    if (afterExpansion !== -1) {
      i = afterExpansion - 1;
      continue;
    }
    // A backtick that opens nothing closes a substitution this scan cannot
    // see the start of.
    if (char === "`" && !isEscapedAt(text, i)) return i;
    if (isSeparatorAt(text, i)) return i;
    // A `#` opens a comment that would swallow anything appended after it.
    if (i === startIndex ? char === "#" : opensCommentAt(text, i)) return i;
  }

  return limit;
}

/**
 * What is feeding a command's standard input, as far as its own text says.
 *
 * "none" still leaves the pipeline: a command with no redirect of its own may
 * be downstream of a `|`, which hasPrecedingPipe answers separately.
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

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    const afterQuote = skipQuoted(command, i);
    if (afterQuote === -1) break;
    if (afterQuote !== undefined) {
      i = afterQuote - 1;
      continue;
    }
    const afterExpansion = skipCommandSubstitution(command, i);
    if (afterExpansion !== -1) {
      i = afterExpansion - 1;
      continue;
    }
    if (char !== "<") continue;

    // A digit run immediately before `<` is a file descriptor only when it
    // stands alone; in `out1<x` those digits end a word and the redirection
    // is still stdin's. Read the whole run — `10<` is not descriptor 0.
    let digitsStart = i;
    while (digitsStart > 0 && /[0-9]/.test(command[digitsStart - 1] ?? "")) digitsStart--;
    const bareDescriptor = digitsStart < i && (digitsStart === 0 || /[\s;|&<>()]/.test(command[digitsStart - 1] ?? ""));
    const descriptor = bareDescriptor ? command.slice(digitsStart, i) : "";
    const redirectsStdin = !bareDescriptor || descriptor === "0";
    const start = bareDescriptor ? digitsStart : i;

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
 * Drop the trailing blank space of a command, line continuations included.
 *
 * Text appended after a dangling `\<newline>` would sit behind its backslash,
 * which then escapes the space and fuses ` --body` into one stray token. An
 * escaped blank is part of the last word, so it stays.
 */
export function trimEndContinuation(command: string): string {
  let end = command.length;
  for (;;) {
    if (end >= 2 && isContinuationAt(command, end - 2)) end -= 2;
    else if (end >= 1 && /\s/.test(command[end - 1]) && !isEscapedAt(command, end - 1)) end--;
    else return command.slice(0, end);
  }
}

/**
 * The index of the first newline at or after index that ends its line, or the
 * length of the command when none does. A newline a backslash escapes does not
 * end the line, but a comment's does: its backslash escapes nothing.
 */
export function findLineEnd(command: string, index: number): number {
  for (let i = index; i < command.length; i++) {
    if (command[i] === "\\") i++;
    else if (command[i] === "\n") return i;
    else if (opensCommentAt(command, i)) {
      const newline = command.indexOf("\n", i);
      return newline === -1 ? command.length : newline;
    }
  }
  return command.length;
}

/**
 * Apply rewrite to the command, or failing that, to a command nested inside
 * escaped backticks.
 *
 * In `` echo `echo \`gh …\`` `` the inner gh is real, but its backticks are
 * escaped one level, so a scan of the outer text cannot see it. Each backtick
 * body that holds an escaped backtick is unescaped the way the shell does,
 * rewritten as a command of its own, and escaped back. Only `\`, `` ` `` and
 * `$` are escapes inside backticks; `\$` and `$` mean the same there, so the
 * round trip changes no meaning.
 */
export function rewriteInNestedBackticks(command: string, rewrite: (command: string) => string): string {
  const rewritten = rewrite(command);
  if (rewritten !== command) return rewritten;

  for (const { start, end } of collectSubstitutions(command)) {
    if (command[start] !== "`") continue;
    const body = command.slice(start + 1, end - 1);
    if (!body.includes("\\`")) continue;

    const inner = body.replace(/\\([\\`$])/g, "$1");
    const signed = rewriteInNestedBackticks(inner, rewrite);
    if (signed !== inner) {
      return command.slice(0, start + 1) + signed.replace(/[\\`]/g, "\\$&") + command.slice(end - 1);
    }
  }
  return command;
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

/**
 * The raw text of a value attached to an option — the `msg.txt` of
 * `-Fmsg.txt`, the `"my msg.txt"` of `--file="my msg.txt"`.
 *
 * Raw text is returned rather than the unquoted value so the caller can pass
 * it back to the shell and have it expand as the user wrote it. Returns
 * undefined when the option was quoted as a whole (`"-Fmsg.txt"`): then the
 * prefix and the raw text no longer line up character for character, and
 * slicing would cut a quote in half and leave the command unparseable.
 */
/**
 * Whether raw text carries a pathname-expansion character outside quotes.
 *
 * A glob names however many files match, which a single reader cannot stand
 * in for: git takes the first match as the message and the rest as pathspecs,
 * while `cat` would concatenate them all into one message.
 */
export function hasUnquotedGlob(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    const afterQuote = skipQuoted(raw, i);
    if (afterQuote === -1) return false;
    if (afterQuote !== undefined) i = afterQuote - 1;
    else if (char === "\\") i++;
    else if (char === "*" || char === "?" || char === "[") return true;
  }
  return false;
}

export function attachedValue(word: ShellWord, prefix: string): string | undefined {
  if (word.value.length <= prefix.length || !word.value.startsWith(prefix)) return undefined;
  if (!word.raw.startsWith(prefix)) return undefined;
  return word.raw.slice(prefix.length);
}

/** Characters that end a word rather than belong to it. */
const WORD_TERMINATORS = /[;|&<>]/;

/**
 * Read the limited shell word syntax used for command options.
 *
 * A redirection operator ends the word: in `-F msg.txt>out.log` the path is
 * `msg.txt`, and swallowing the `>out.log` would redirect away the very text
 * the caller is about to read. An unquoted `$(…)` is carried whole, because
 * its inner `;` and `)` belong to the nested command, not to this word.
 */
export function readShellWord(command: string, startIndex: number): ShellWord | undefined {
  let start = startIndex;
  while (/\s/.test(command[start] ?? "") || isContinuationAt(command, start)) {
    start += isContinuationAt(command, start) ? 2 : 1;
  }
  // Inside a backtick substitution its closing backtick ends every word.
  const text = command.slice(0, scanLimit(command, start));
  if (!text[start] || WORD_TERMINATORS.test(text[start])) return undefined;

  let value = "";
  let i = start;

  while (i < text.length) {
    const char = text[i];

    const afterQuote = skipQuoted(text, i);
    if (afterQuote === -1) return undefined;
    if (afterQuote !== undefined) {
      value += quotedValue(text.slice(i, afterQuote));
      i = afterQuote;
      continue;
    }

    const afterExpansion = skipCommandSubstitution(text, i);
    if (afterExpansion !== -1) {
      value += text.slice(i, afterExpansion);
      i = afterExpansion;
      continue;
    }

    if (char === "`") break;

    if (isContinuationAt(text, i)) {
      i++;
    } else if (char === "\\" && i + 1 < text.length) {
      value += text[++i];
    } else if (/\s/.test(char) || WORD_TERMINATORS.test(char)) {
      break;
    } else {
      value += char;
    }
    i++;
  }

  if (i === start) return undefined;
  return { raw: text.slice(start, i), value, start, end: i };
}

/**
 * The text a closed quote stands for. Single quotes keep everything. Inside
 * double quotes a backslash escapes only `"`, `\`, `$` and backtick, and
 * vanishes with a newline; before anything else it stays. `$'…'` keeps its
 * escapes as written: a value spelled that way carries a `$`, which callers
 * already hand to the shell to expand rather than read themselves.
 */
function quotedValue(quoted: string): string {
  if (quoted.startsWith("'")) return quoted.slice(1, -1);
  if (quoted.startsWith("$'")) return quoted.slice(2, -1);

  let value = "";
  const inner = quoted.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    const afterExpansion = skipCommandSubstitution(inner, i);
    if (afterExpansion !== -1) {
      value += inner.slice(i, afterExpansion);
      i = afterExpansion - 1;
    } else if (char === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === "\n") i++;
      else if (/["\\$`]/.test(next)) value += inner[++i];
      else value += char;
    } else {
      value += char;
    }
  }
  return value;
}
