/**
 * OpenCode PR Auto-Signature Plugin
 *
 * Automatically appends AI model signature to PR and Issue bodies.
 *
 * @author arttttt
 * @license Apache-2.0
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";

type OpencodeClient = PluginInput["client"];

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
 * Check if body already contains OpenCode signature
 */
function hasSignature(body: string): boolean {
  return body.includes("Generated with [OpenCode]");
}

/**
 * PR Auto-Signature Plugin
 *
 * Automatically appends AI model signature to PR and Issue bodies.
 */
export const PRSignaturePlugin: Plugin = async ({ client }) => {
  // Store current model name
  let currentModel = "Unknown Model";

  // Tools to intercept
  const toolsToIntercept = [
    "github_create_pull_request",
    "github_create_issue",
    "github_update_pull_request",
    "github_update_issue",
    "MCP_DOCKER_create_pull_request",
    "MCP_DOCKER_create_issue",
    "MCP_DOCKER_update_pull_request",
    "MCP_DOCKER_update_issue",
  ];

  // Git commands that create commits
  const gitCommitPatterns = [
    /git\s+commit/i,
    /git\s+commit\s+-m/i,
  ];

  return {
    /**
     * Hook: chat.message
     * Track the current model from chat messages
     */
    "chat.message": async (_input, output) => {
      // Extract model from message
      if (output.message?.model) {
        currentModel = formatModelName(output.message.model);
      }
    },

    /**
     * Hook: tool.execute.before
     * Intercept PR, Issue creation/update, and git commits to add signature
     */
    "tool.execute.before": async (input, output) => {
      // Handle GitHub/MCP tools
      if (toolsToIntercept.includes(input.tool)) {
        // Generate signature
        const signature = generateSignature(currentModel);

        // Append signature to body
        if (output.args?.body) {
          // Check if signature already exists
          if (!hasSignature(output.args.body)) {
            output.args.body = output.args.body.trim() + "\n\n" + signature;
          }
        } else {
          output.args.body = signature;
        }

        // Log for debugging
        console.log(`[PRSignature] Added signature for model: ${currentModel}`);
        return;
      }

      // Handle git commit commands via bash
      if (input.tool === "bash" && output.args?.command) {
        const command = output.args.command;
        
        // Check if this is a git commit command
        const isGitCommit = gitCommitPatterns.some(pattern => pattern.test(command));
        
        if (isGitCommit) {
          // Check if command already has -m flag
          if (command.includes(' -m ') || command.includes(' --message=')) {
            // Extract the message and append signature
            const signature = generateSignature(currentModel);
            
            // If command uses -m "message" format
            if (command.includes(' -m ')) {
              // Replace the message part
              output.args.command = command.replace(
                /-m\s+["']([^"']+)["']/,
                (match, msg) => {
                  if (!hasSignature(msg)) {
                    return `-m "${msg.trim()}\n\n${signature}"`;
                  }
                  return match;
                }
              );
            }
            
            console.log(`[PRSignature] Added signature to git commit for model: ${currentModel}`);
          }
        }
      }
    },
  };
};

export default PRSignaturePlugin;
