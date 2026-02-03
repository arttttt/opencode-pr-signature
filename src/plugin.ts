/**
 * OpenCode PR Auto-Signature Plugin
 *
 * Automatically appends AI model signature to PR, Issue bodies, and git commits.
 *
 * @author arttttt
 * @license Apache-2.0
 */

import type { Plugin } from "@opencode-ai/plugin";

/**
 * Format model name to human-readable form
 */
function formatModelName(model: { providerID: string; modelID: string } | string | undefined): string {
  if (!model) return "Unknown Model";

  // If model is a string
  if (typeof model === "string") {
    return formatModelString(model);
  }

  // If model is an object with providerID and modelID
  if (typeof model === "object") {
    if (model.modelID) {
      return formatModelString(model.modelID);
    }
  }

  return "Unknown Model";
}

/**
 * Format model ID string
 */
function formatModelString(modelId: string): string {
  if (!modelId) return "Unknown Model";

  // Remove dates and hashes from name
  const cleanName = modelId
    .replace(/-\d{4}-\d{2}-\d{2}/g, "") // Remove dates
    .replace(/-[a-f0-9]{7,}/g, "") // Remove short hashes
    .replace(/@/g, "/"); // Replace @ with /

  // Known models - use nice names
  const knownModels: Record<string, string> = {
    kimi: "Kimi",
    "kimi-for-coding": "Kimi",
    k2p5: "K2.5",
    claude: "Claude",
    "claude-3": "Claude 3",
    "claude-3-5-sonnet": "Claude 3.5 Sonnet",
    "claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
    "gpt-4": "GPT-4",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    gemini: "Gemini",
    "gemini-pro": "Gemini Pro",
    "gemini-ultra": "Gemini Ultra",
  };

  // Check exact match
  if (knownModels[cleanName]) {
    return knownModels[cleanName];
  }

  // Check partial match
  for (const [key, value] of Object.entries(knownModels)) {
    if (cleanName.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  // Return as-is with capitalized first letter
  return cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
}

/**
 * Generate signature
 */
function generateSignature(modelName: string): string {
  return `🤖 Generated with [OpenCode](https://opencode.ai) (${modelName})`;
}

/**
 * Check if text already contains OpenCode signature
 */
function hasSignature(text: string): boolean {
  return text.includes("Generated with [OpenCode]");
}

/**
 * Find the end position of a command in a bash command string.
 * Respects quotes to avoid splitting on && or || inside quoted strings.
 *
 * @param command - The full bash command string
 * @param startIndex - Where to start searching from
 * @returns The index where command ends (before && || ; | or end of string)
 */
function findCommandEndIndex(command: string, startIndex: number): number {
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
      // Check for command separators outside of quotes
      const remaining = command.slice(i);
      if (
        remaining.startsWith("&&") ||
        remaining.startsWith("||") ||
        remaining.startsWith(";") ||
        remaining.startsWith("|")
      ) {
        return i;
      }
    }
    i++;
  }

  return command.length;
}

/**
 * Escape special characters for use in shell arguments
 */
function escapeForShell(text: string): string {
  // Escape double quotes and backslashes
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Check if a command is a gh CLI command that needs signature injection.
 * Supported commands: gh pr create, gh issue create, gh pr comment, gh issue comment, gh pr review
 */
function isGhCommandWithBody(command: string): boolean {
  return /gh\s+(pr|issue)\s+(create|comment|review)\b/i.test(command);
}

/**
 * Check if command has --body or -b flag
 */
function hasBodyFlag(command: string): boolean {
  return /\s(--body|-b)\s/.test(command) || /\s(--body|-b)["']/.test(command);
}

/**
 * Add signature to gh CLI command.
 * If --body/-b exists, append signature to its value.
 * If not, add --body flag with signature.
 */
function addSignatureToGhCommand(command: string, signature: string, startIndex: number): string {
  const escapedSignature = escapeForShell(signature);
  const endIndex = findCommandEndIndex(command, startIndex);

  const commandPart = command.slice(startIndex, endIndex);
  const beforeCommand = command.slice(0, startIndex);
  const afterCommand = command.slice(endIndex);

  if (hasBodyFlag(commandPart)) {
    // Find and modify existing --body or -b value
    // Match patterns: --body "text", --body 'text', -b "text", -b 'text'
    const bodyRegex = /(--body|-b)\s*(["'])([\s\S]*?)\2/;
    const match = commandPart.match(bodyRegex);

    if (match) {
      const [fullMatch, flag, quote, content] = match;
      const newContent = content.trimEnd() + "\\n\\n" + escapedSignature;
      const newBody = `${flag} ${quote}${newContent}${quote}`;
      const modifiedPart = commandPart.replace(fullMatch, newBody);
      return beforeCommand + modifiedPart + afterCommand;
    }

    // If regex didn't match (e.g., HEREDOC), add as separate flag anyway
    // gh CLI will use the last --body value
    const trimmedPart = commandPart.trimEnd();
    return beforeCommand + trimmedPart + ` --body "${escapedSignature}"` + afterCommand;
  } else {
    // No body flag, add one
    const trimmedPart = commandPart.trimEnd();
    return beforeCommand + trimmedPart + ` --body "${escapedSignature}"` + afterCommand;
  }
}

/**
 * PR Auto-Signature Plugin
 *
 * Automatically appends AI model signature to PR and Issue bodies,
 * as well as git commit messages.
 */
export const PRSignaturePlugin: Plugin = async () => {
  // Store current model name
  let currentModel = "Unknown Model";

  // GitHub/MCP tools to intercept for PR/Issue operations
  const prIssueTools = [
    "github_create_pull_request",
    "github_create_issue",
    "github_update_pull_request",
    "github_update_issue",
    "MCP_DOCKER_create_pull_request",
    "MCP_DOCKER_create_issue",
    "MCP_DOCKER_update_pull_request",
    "MCP_DOCKER_update_issue",
  ];

  return {
    /**
     * Hook: chat.message
     * Track the current model from chat messages.
     * Note: model is passed in input, not output.message
     */
    "chat.message": async (input, _output) => {
      if (input.model) {
        currentModel = formatModelName(input.model);
      }
    },

    /**
     * Hook: tool.execute.before
     * Intercept PR, Issue creation/update, and git commits to add signature
     */
    "tool.execute.before": async (input, output) => {
      // Handle GitHub/MCP PR and Issue tools
      if (prIssueTools.includes(input.tool)) {
        const signature = generateSignature(currentModel);

        if (output.args?.body) {
          if (!hasSignature(output.args.body)) {
            output.args.body = output.args.body.trim() + "\n\n" + signature;
          }
        } else {
          output.args.body = signature;
        }

        return;
      }

      // Handle bash commands (git commit, gh CLI)
      if (input.tool === "bash" && output.args?.command) {
        const command: string = output.args.command;

        // Skip if signature already exists
        if (hasSignature(command)) {
          return;
        }

        const signature = generateSignature(currentModel);

        // Handle git commit commands
        const isGitCommit = /git\s+commit\b/i.test(command);
        const hasMessageFlag = /\s-m\s|\s-m["']|\s--message[=\s]/i.test(command);

        if (isGitCommit && hasMessageFlag) {
          const escapedSignature = escapeForShell(signature);
          const gitCommitMatch = command.match(/git\s+commit\b/i);

          if (gitCommitMatch && gitCommitMatch.index !== undefined) {
            const endIndex = findCommandEndIndex(command, gitCommitMatch.index);
            const beforeEnd = command.slice(0, endIndex).trimEnd();
            const afterEnd = command.slice(endIndex);

            output.args.command = `${beforeEnd} -m "${escapedSignature}"${afterEnd}`;
          }
          return;
        }

        // Handle gh CLI commands (pr create, issue create, pr comment, issue comment, pr review)
        if (isGhCommandWithBody(command)) {
          const ghMatch = command.match(/gh\s+(pr|issue)\s+(create|comment|review)\b/i);

          if (ghMatch && ghMatch.index !== undefined) {
            output.args.command = addSignatureToGhCommand(command, signature, ghMatch.index);
          }
        }
      }
    },
  };
};

export default PRSignaturePlugin;
