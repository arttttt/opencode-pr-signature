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
 * Find the end position of git commit command in a bash command string.
 * Respects quotes to avoid splitting on && or || inside quoted strings.
 *
 * @param command - The full bash command string
 * @param startIndex - Where to start searching from
 * @returns The index where git commit command ends (before && || ; | or end of string)
 */
function findGitCommitEndIndex(command: string, startIndex: number): number {
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
 * Escape special characters for use in shell -m argument
 */
function escapeForShell(text: string): string {
  // Escape double quotes and backslashes
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

        console.log(`[PRSignature] Added signature to ${input.tool} for model: ${currentModel}`);
        return;
      }

      // Handle git commit commands via bash tool
      if (input.tool === "bash" && output.args?.command) {
        const command: string = output.args.command;

        // Check if this is a git commit command with a message flag
        const isGitCommit = /git\s+commit\b/i.test(command);
        const hasMessageFlag = /\s-m\s|\s-m["']|\s--message[=\s]/i.test(command);

        if (isGitCommit && hasMessageFlag && !hasSignature(command)) {
          const signature = generateSignature(currentModel);
          const escapedSignature = escapeForShell(signature);

          // Find where "git commit" starts
          const gitCommitMatch = command.match(/git\s+commit\b/i);
          if (gitCommitMatch && gitCommitMatch.index !== undefined) {
            // Find where this git commit command ends
            const endIndex = findGitCommitEndIndex(command, gitCommitMatch.index);

            // Insert additional -m flag with signature before the separator
            // Git concatenates multiple -m messages with blank lines between them
            const beforeEnd = command.slice(0, endIndex).trimEnd();
            const afterEnd = command.slice(endIndex);

            output.args.command = `${beforeEnd} -m "${escapedSignature}"${afterEnd}`;

            console.log(`[PRSignature] Added signature to git commit for model: ${currentModel}`);
          }
        }
      }
    },
  };
};

export default PRSignaturePlugin;
