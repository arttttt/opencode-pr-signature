/**
 * Building the shell fragment that emits a signed message.
 */

import { quoteShellArgument } from "./shell";
import { SIGNATURE_MARKER } from "./signature";

/** Shell variable holding the message; named so it cannot collide with the user's. */
const MESSAGE_VARIABLE = "__opencode_message";

/**
 * Build a subshell that reads a message, appends the signature unless it is
 * already there, and writes the result to stdout — ready to be piped into a
 * command that takes its message from standard input.
 *
 * One shape serves every source, because the decision needs the message text
 * and the text only exists while the command runs: the plugin cannot read a
 * file without knowing the working directory git will use, and cannot read a
 * stream without taking it away from the command that needs it. Deferring to
 * run time answers both, and reads the same bytes git would have read.
 *
 * An empty or blank message emits nothing, so git still refuses the commit
 * exactly as it would without the plugin.
 *
 * @param reader - command that writes the original message to stdout
 */
export function signedMessageGroup(reader: string, signature: string): string {
  const value = `"$${MESSAGE_VARIABLE}"`;
  // Quoted inside the pattern so the marker's brackets stay literal text
  // rather than becoming a character class.
  const alreadySigned = `*"${SIGNATURE_MARKER}"*`;
  // Anything holding one non-blank character is a message worth signing;
  // everything else falls through to the branch that prints nothing.
  const worthSigning = "*[![:space:]]*";

  return (
    `( ${MESSAGE_VARIABLE}=$(${reader}); case ${value} in ` +
    `${alreadySigned}) printf '%s\\n' ${value} ;; ` +
    `${worthSigning}) printf '%s\\n\\n%s\\n' ${value} ${quoteShellArgument(signature)} ;; ` +
    `*) ;; esac )`
  );
}

/** Read a message file, passing the path through exactly as the user wrote it. */
export function fileReader(pathToken: string): string {
  return `cat -- ${pathToken}`;
}

/** Read the message from whatever is already feeding standard input. */
export function stdinReader(): string {
  return "cat";
}

/** Read the message of an existing commit, for --amend and -C/-c. */
export function commitReader(refToken: string): string {
  return `git log -1 --format=%B ${refToken}`;
}
