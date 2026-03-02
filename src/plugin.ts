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
    // Kimi / Moonshot models
    kimi: "Kimi",
    "kimi-latest": "Kimi",
    "kimi-for-coding": "Kimi",
    "kimi-thinking-preview": "Kimi",
    "kimi-k2": "Kimi K2",
    "kimi-k2-turbo-preview": "Kimi K2",
    "kimi-k2-thinking": "Kimi K2 Thinking",
    "kimi-k2-thinking-turbo": "Kimi K2 Thinking",
    "kimi-k2.5": "Kimi K2.5",
    k2p5: "Kimi K2.5",
    "moonshot-v1": "Moonshot",
    "moonshot-v1-8k": "Moonshot",
    "moonshot-v1-32k": "Moonshot",
    "moonshot-v1-128k": "Moonshot",
    "moonshot-v1-vision-preview": "Moonshot Vision",

    // Claude models (Anthropic)
    claude: "Claude",
    "claude-3": "Claude 3",
    "claude-3-opus": "Claude 3 Opus",
    "claude-3-sonnet": "Claude 3 Sonnet",
    "claude-3-haiku": "Claude 3 Haiku",
    "claude-3-5-sonnet": "Claude 3.5 Sonnet",
    "claude-3-5-haiku": "Claude 3.5 Haiku",
    "claude-3-7-sonnet": "Claude 3.7 Sonnet",
    "claude-sonnet-4": "Claude Sonnet 4",
    "claude-opus-4": "Claude Opus 4",
    "claude-opus-4-1": "Claude Opus 4.1",
    "claude-sonnet-4-5": "Claude Sonnet 4.5",
    "claude-haiku-4-5": "Claude Haiku 4.5",
    "claude-opus-4-5": "Claude Opus 4.5",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",

    // GPT models (OpenAI)
    "gpt-4": "GPT-4",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-1": "GPT-4.1",
    "gpt-4-1-mini": "GPT-4.1 Mini",
    "gpt-4-1-nano": "GPT-4.1 Nano",
    "gpt-4-5": "GPT-4.5",
    "gpt-4-5-preview": "GPT-4.5 Preview",
    "gpt-5": "GPT-5",
    "gpt-5-chat": "GPT-5",
    "gpt-5-mini": "GPT-5 Mini",
    "gpt-5-nano": "GPT-5 Nano",
    "gpt-5-pro": "GPT-5 Pro",
    "gpt-5-1": "GPT-5.1",
    "gpt-5-2": "GPT-5.2",
    "gpt-5-2-pro": "GPT-5.2 Pro",

    // Codex models (OpenAI)
    "codex-1": "Codex",
    "codex-mini": "Codex Mini",
    "gpt-5-codex": "GPT-5 Codex",
    "gpt-5.1-codex": "GPT-5.1 Codex",
    "gpt-5-1-codex": "GPT-5.1 Codex",
    "gpt-5.1-codex-mini": "GPT-5.1 Codex Mini",
    "gpt-5-1-codex-mini": "GPT-5.1 Codex Mini",
    "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
    "gpt-5-1-codex-max": "GPT-5.1 Codex Max",
    "gpt-5.2-codex": "GPT-5.2 Codex",
    "gpt-5-2-codex": "GPT-5.2 Codex",
    "gpt-5.3-codex": "GPT-5.3 Codex",
    "gpt-5-3-codex": "GPT-5.3 Codex",

    // o-series reasoning models (OpenAI)
    "o1": "o1",
    "o1-mini": "o1 Mini",
    "o1-preview": "o1 Preview",
    "o1-pro": "o1 Pro",
    "o3": "o3",
    "o3-mini": "o3 Mini",
    "o3-pro": "o3 Pro",
    "o3-deep-research": "o3 Deep Research",
    "o4-mini": "o4 Mini",
    "o4-mini-deep-research": "o4 Mini Deep Research",

    // Gemini models (Google)
    gemini: "Gemini",
    "gemini-pro": "Gemini Pro",
    "gemini-ultra": "Gemini Ultra",
    "gemini-1-5-pro": "Gemini 1.5 Pro",
    "gemini-1-5-flash": "Gemini 1.5 Flash",
    "gemini-1-5-flash-8b": "Gemini 1.5 Flash 8B",
    "gemini-2-0-pro": "Gemini 2.0 Pro",
    "gemini-2-0-flash": "Gemini 2.0 Flash",
    "gemini-2-0-flash-lite": "Gemini 2.0 Flash Lite",
    "gemini-2-5-pro": "Gemini 2.5 Pro",
    "gemini-2-5-pro-preview": "Gemini 2.5 Pro",
    "gemini-2-5-flash": "Gemini 2.5 Flash",
    "gemini-2-5-flash-lite": "Gemini 2.5 Flash Lite",
    "gemini-3-pro": "Gemini 3 Pro",
    "gemini-3-pro-preview": "Gemini 3 Pro",
    "gemini-3-flash": "Gemini 3 Flash",
    "gemini-3-flash-preview": "Gemini 3 Flash",
    "gemini-3-1-pro": "Gemini 3.1 Pro",
    "gemini-3-1-pro-preview": "Gemini 3.1 Pro",

    // DeepSeek models
    deepseek: "DeepSeek",
    "deepseek-chat": "DeepSeek Chat",
    "deepseek-coder": "DeepSeek Coder",
    "deepseek-reasoner": "DeepSeek R1",
    "deepseek-v3": "DeepSeek V3",
    "deepseek-v3.1": "DeepSeek V3.1",
    "deepseek-v3.2": "DeepSeek V3.2",
    "deepseek-v3.2-exp": "DeepSeek V3.2",
    "deepseek-r1": "DeepSeek R1",
    "deepseek-r1-lite": "DeepSeek R1 Lite",
    "deepseek-prover-v2": "DeepSeek Prover V2",

    // Llama models (Meta)
    llama: "Llama",
    "meta-llama-3": "Llama 3",
    "llama-3": "Llama 3",
    "llama-3-1": "Llama 3.1",
    "llama-3-2": "Llama 3.2",
    "llama-3-3": "Llama 3.3",
    "meta-llama-4": "Llama 4",
    "llama-4": "Llama 4",
    "llama-4-maverick": "Llama 4 Maverick",
    "llama-4-scout": "Llama 4 Scout",
    "llama-4-behemoth": "Llama 4 Behemoth",

    // Mistral models
    mistral: "Mistral",
    "mistral-large": "Mistral Large",
    "mistral-large-2": "Mistral Large 2",
    "mistral-large-latest": "Mistral Large",
    "mistral-medium": "Mistral Medium",
    "mistral-medium-3": "Mistral Medium 3",
    "mistral-small": "Mistral Small",
    "mistral-small-3": "Mistral Small 3",
    "mistral-small-3-1": "Mistral Small 3.1",
    "mistral-small-latest": "Mistral Small",
    "mistral-nemo": "Mistral Nemo",
    "mistral-saba": "Mistral Saba",
    "mistral-ocr": "Mistral OCR",
    codestral: "Codestral",
    "codestral-mamba": "Codestral Mamba",
    "pixtral-large": "Pixtral Large",
    "pixtral-12b": "Pixtral 12B",
    magistral: "Magistral",
    "magistral-medium": "Magistral Medium",
    "magistral-small": "Magistral Small",
    devstral: "Devstral",
    "devstral-small": "Devstral Small",
    "devstral-medium": "Devstral Medium",
    ministral: "Ministral",
    "ministral-3b": "Ministral 3B",
    mathstral: "Mathstral",

    // Qwen models (Alibaba)
    qwen: "Qwen",
    "qwen-2": "Qwen 2",
    "qwen-2-5": "Qwen 2.5",
    "qwen2-5-coder": "Qwen 2.5 Coder",
    "qwen2-5-math": "Qwen 2.5 Math",
    qwen3: "Qwen 3",
    "qwen3-max": "Qwen 3 Max",
    "qwen3-max-preview": "Qwen 3 Max",
    "qwen3-coder-plus": "Qwen 3 Coder",
    "qwen3-coder-flash": "Qwen 3 Coder",
    "qwen3.5-plus": "Qwen 3.5 Plus",
    "qwen3.5-flash": "Qwen 3.5 Flash",
    "qwen-turbo": "Qwen Turbo",
    "qwen-plus": "Qwen Plus",
    "qwen-max": "Qwen Max",
    "qwen-flash": "Qwen Flash",
    "qwen-long": "Qwen Long",
    "qwen-coder-plus": "Qwen Coder",
    "qwen-coder-turbo": "Qwen Coder",
    "qwen-vl": "Qwen VL",
    "qwen-vl-max": "Qwen VL Max",
    "qwen-vl-plus": "Qwen VL Plus",
    qwq: "QwQ",
    "qwq-plus": "QwQ Plus",

    // Grok models (xAI)
    grok: "Grok",
    "grok-2": "Grok 2",
    "grok-2-vision": "Grok 2 Vision",
    "grok-3": "Grok 3",
    "grok-3-beta": "Grok 3",
    "grok-3-fast": "Grok 3",
    "grok-3-fast-beta": "Grok 3",
    "grok-3-mini": "Grok 3 Mini",
    "grok-3-mini-beta": "Grok 3 Mini",
    "grok-3-mini-fast": "Grok 3 Mini",
    "grok-3-mini-fast-beta": "Grok 3 Mini",
    "grok-beta": "Grok 2 Beta",

    // Cohere models
    command: "Command",
    "command-r": "Command R",
    "command-r-plus": "Command R+",
    "command-r7b": "Command R7B",
    "command-a": "Command A",

    // Perplexity / Sonar models
    perplexity: "Perplexity",
    sonar: "Sonar",
    "sonar-pro": "Sonar Pro",
    "sonar-reasoning": "Sonar Reasoning",
    "sonar-reasoning-pro": "Sonar Reasoning Pro",
    "sonar-deep-research": "Sonar Deep Research",
    "r1-1776": "R1-1776",

    // Yi models (01.AI)
    "yi-lightning": "Yi Lightning",
    "yi-large": "Yi Large",
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
