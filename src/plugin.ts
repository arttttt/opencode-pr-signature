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
    "moonshot-v1-8k-vision-preview": "Moonshot Vision",
    "moonshot-v1-32k-vision-preview": "Moonshot Vision",
    "moonshot-v1-128k-vision-preview": "Moonshot Vision",
    "kimi-k2.6": "Kimi K2.6",
    "kimi-k2-6": "Kimi K2.6",
    "kimi-k2.7-code": "Kimi K2.7 Code",

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
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-fable-5": "Claude Fable 5",
    "claude-mythos-5": "Claude Mythos 5",

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
    "gpt-5-3": "GPT-5.3",
    "gpt-5.3": "GPT-5.3",
    "gpt-5-4": "GPT-5.4",
    "gpt-5.4": "GPT-5.4",
    "gpt-5-4-pro": "GPT-5.4 Pro",
    "gpt-5.4-pro": "GPT-5.4 Pro",
    "gpt-5-4-mini": "GPT-5.4 Mini",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "gpt-5-4-nano": "GPT-5.4 Nano",
    "gpt-5.4-nano": "GPT-5.4 Nano",
    "gpt-5-5": "GPT-5.5",
    "gpt-5.5": "GPT-5.5",
    "gpt-5-5-pro": "GPT-5.5 Pro",
    "gpt-5.5-pro": "GPT-5.5 Pro",

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
    "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
    "gpt-5-3-codex-spark": "GPT-5.3 Codex Spark",

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
    "gemini-3-1-flash-lite": "Gemini 3.1 Flash Lite",
    "gemini-3-5-flash": "Gemini 3.5 Flash",
    "gemini-3-5-flash-preview": "Gemini 3.5 Flash",

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
    "deepseek-v4": "DeepSeek V4",
    "deepseek-v4-pro": "DeepSeek V4 Pro",
    "deepseek-v4-flash": "DeepSeek V4 Flash",

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
    "mistral-large-3": "Mistral Large 3",
    "mistral-medium-3-5": "Mistral Medium 3.5",
    "mistral-small-4": "Mistral Small 4",
    "ministral-3": "Ministral 3",
    "ministral-3-8b": "Ministral 3 8B",
    "mistral-ocr-3": "Mistral OCR 3",
    voxtral: "Voxtral",
    "voxtral-small": "Voxtral Small",

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
    "qwen3.6-plus": "Qwen 3.6 Plus",
    "qwen3-6-plus": "Qwen 3.6 Plus",
    "qwen3.7-max": "Qwen 3.7 Max",
    "qwen3-7-max": "Qwen 3.7 Max",
    "qwen3.7-plus": "Qwen 3.7 Plus",
    "qwen3-7-plus": "Qwen 3.7 Plus",
    "qwen3-vl-plus": "Qwen 3 VL Plus",
    "qwen3-vl-flash": "Qwen 3 VL Flash",
    "qwen3-vl-max": "Qwen 3 VL Max",
    "qwen-vl-ocr": "Qwen VL OCR",
    "qwen3.6-flash": "Qwen 3.6 Flash",
    "qwen3-6-flash": "Qwen 3.6 Flash",
    "qwen3.6-max": "Qwen 3.6 Max",
    "qwen3-6-max": "Qwen 3.6 Max",
    "qwen3.5-omni-plus": "Qwen 3.5 Omni Plus",
    "qwen3-5-omni-plus": "Qwen 3.5 Omni Plus",
    "qwen3-omni-flash": "Qwen 3 Omni Flash",
    "qwen-omni-turbo": "Qwen Omni Turbo",

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
    "grok-4": "Grok 4",
    "grok-4-heavy": "Grok 4 Heavy",
    "grok-4-fast": "Grok 4 Fast",
    "grok-4-fast-reasoning": "Grok 4 Fast",
    "grok-4-fast-non-reasoning": "Grok 4 Fast",
    "grok-code-fast-1": "Grok Code Fast 1",
    "grok-4.1": "Grok 4.1",
    "grok-4-1": "Grok 4.1",
    "grok-4.1-fast": "Grok 4.1 Fast",
    "grok-4-1-fast": "Grok 4.1 Fast",
    "grok-4.1-fast-reasoning": "Grok 4.1 Fast",
    "grok-4-1-fast-reasoning": "Grok 4.1 Fast",
    "grok-4.1-fast-non-reasoning": "Grok 4.1 Fast",
    "grok-4-1-fast-non-reasoning": "Grok 4.1 Fast",
    "grok-4.20": "Grok 4.20",
    "grok-4-20": "Grok 4.20",
    "grok-4.20-reasoning": "Grok 4.20",
    "grok-4-20-reasoning": "Grok 4.20",
    "grok-4.20-non-reasoning": "Grok 4.20",
    "grok-4-20-non-reasoning": "Grok 4.20",
    "grok-4.3": "Grok 4.3",
    "grok-4-3": "Grok 4.3",

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
    "yi-lightning-lite": "Yi Lightning Lite",
    "yi-large": "Yi Large",
    "yi-large-turbo": "Yi Large Turbo",
    "yi-large-fc": "Yi Large FC",
    "yi-large-rag": "Yi Large RAG",
    "yi-vision": "Yi Vision",
    "yi-medium": "Yi Medium",
    "yi-spark": "Yi Spark",

    // GLM models (Zhipu AI / Z.ai)
    glm: "GLM",
    "glm-5.2": "GLM-5.2",
    "glm-5-2": "GLM-5.2",
    "glm-5.1": "GLM-5.1",
    "glm-5-1": "GLM-5.1",
    "glm-5": "GLM-5",
    "glm-5-turbo": "GLM-5 Turbo",
    "glm-5v-turbo": "GLM-5V Turbo",
    "glm-4.7": "GLM-4.7",
    "glm-4-7": "GLM-4.7",
    "glm-4.7-flash": "GLM-4.7 Flash",
    "glm-4-7-flash": "GLM-4.7 Flash",
    "glm-4.6": "GLM-4.6",
    "glm-4-6": "GLM-4.6",
    "glm-4.6v": "GLM-4.6V",
    "glm-4-6v": "GLM-4.6V",
    "glm-4.5": "GLM-4.5",
    "glm-4-5": "GLM-4.5",
    "glm-4.5-air": "GLM-4.5 Air",
    "glm-4-5-air": "GLM-4.5 Air",
    "glm-4.5-x": "GLM-4.5-X",
    "glm-4-5-x": "GLM-4.5-X",
    "glm-4.5-airx": "GLM-4.5-AirX",
    "glm-4-5-airx": "GLM-4.5-AirX",
    "glm-4.5-flash": "GLM-4.5 Flash",
    "glm-4-5-flash": "GLM-4.5 Flash",
    "glm-4.5v": "GLM-4.5V",
    "glm-4-5v": "GLM-4.5V",
    "glm-4-32b": "GLM-4-32B",
    "glm-4-plus": "GLM-4-Plus",
    "glm-4-air": "GLM-4 Air",
    "glm-4-flashx": "GLM-4-FlashX",
    "glm-z1-air": "GLM-Z1-Air",
    "glm-z1-airx": "GLM-Z1-AirX",
    "glm-z1-flash": "GLM-Z1-Flash",
    "glm-z1-32b": "GLM-Z1-32B",
    "glm-z1-rumination-32b": "GLM-Z1-Rumination-32B",

    // MiniMax models
    minimax: "MiniMax",
    "minimax-m3": "MiniMax M3",
    "minimax-m2.7": "MiniMax M2.7",
    "minimax-m2-7": "MiniMax M2.7",
    "minimax-m2.5": "MiniMax M2.5",
    "minimax-m2-5": "MiniMax M2.5",
    "minimax-m2.1": "MiniMax M2.1",
    "minimax-m2-1": "MiniMax M2.1",
    "minimax-m2": "MiniMax M2",
    "minimax-m1": "MiniMax M1",
    "minimax-text-01": "MiniMax Text-01",
    "minimax-01": "MiniMax-01",
    "abab6.5-chat": "abab6.5",
    "abab6.5s-chat": "abab6.5s",

    // Amazon Nova models
    "nova-2-pro": "Amazon Nova 2 Pro",
    "amazon-nova-2-pro": "Amazon Nova 2 Pro",
    "nova-2-lite": "Amazon Nova 2 Lite",
    "amazon-nova-2-lite": "Amazon Nova 2 Lite",
    "nova-premier": "Amazon Nova Premier",
    "amazon-nova-premier": "Amazon Nova Premier",
    "nova-pro": "Amazon Nova Pro",
    "amazon-nova-pro": "Amazon Nova Pro",
    "nova-lite": "Amazon Nova Lite",
    "amazon-nova-lite": "Amazon Nova Lite",
    "nova-micro": "Amazon Nova Micro",
    "amazon-nova-micro": "Amazon Nova Micro",

    // Baidu ERNIE models
    "ernie-5.1": "ERNIE 5.1",
    "ernie-5-1": "ERNIE 5.1",
    "ernie-5.0": "ERNIE 5.0",
    "ernie-5-0": "ERNIE 5.0",
    "ernie-x1.1": "ERNIE X1.1",
    "ernie-x1-1": "ERNIE X1.1",
    "ernie-x1": "ERNIE X1",
    "ernie-4.5-turbo": "ERNIE 4.5 Turbo",
    "ernie-4-5-turbo": "ERNIE 4.5 Turbo",
    "ernie-4.5": "ERNIE 4.5",
    "ernie-4-5": "ERNIE 4.5",
    "ernie-speed": "ERNIE Speed",
    "ernie-lite": "ERNIE Lite",

    // Tencent Hunyuan models
    "hunyuan-turbos": "Hunyuan TurboS",
    "hunyuan-turbo-s": "Hunyuan TurboS",
    "hunyuan-t1": "Hunyuan T1",
    "hunyuan-a13b": "Hunyuan A13B",
    "hunyuan-standard": "Hunyuan Standard",
    "hunyuan-lite": "Hunyuan Lite",
    "hunyuan-large": "Hunyuan Large",

    // ByteDance Doubao / Seed models
    "doubao-seed-2.0-pro": "Doubao Seed 2.0 Pro",
    "doubao-seed-2-0-pro": "Doubao Seed 2.0 Pro",
    "doubao-seed-2.0-lite": "Doubao Seed 2.0 Lite",
    "doubao-seed-2-0-lite": "Doubao Seed 2.0 Lite",
    "doubao-seed-1.6": "Doubao Seed 1.6",
    "doubao-seed-1-6": "Doubao Seed 1.6",
    "doubao-1.5-pro": "Doubao 1.5 Pro",
    "doubao-1-5-pro": "Doubao 1.5 Pro",
    "doubao-1.5-lite": "Doubao 1.5 Lite",

    // Microsoft Phi models
    "phi-4-reasoning-vision": "Phi-4 Reasoning Vision",
    "phi-4-reasoning-plus": "Phi-4 Reasoning Plus",
    "phi-4-reasoning": "Phi-4 Reasoning",
    "phi-4-mini-reasoning": "Phi-4 Mini Reasoning",
    "phi-4-multimodal": "Phi-4 Multimodal",
    "phi-4-mini": "Phi-4 Mini",
    "phi-4": "Phi-4",
    "phi-3.5-mini": "Phi-3.5 Mini",
    "phi-3-5-mini": "Phi-3.5 Mini",

    // AI21 Jamba models
    "jamba-large-1.7": "Jamba Large 1.7",
    "jamba-large-1-7": "Jamba Large 1.7",
    "jamba-large": "Jamba Large",
    "jamba-mini-2": "Jamba Mini 2",
    "jamba-mini": "Jamba Mini",
    "jamba-3b-2": "Jamba 3B 2",

    // Reka models
    "reka-core": "Reka Core",
    "reka-flash-3.1": "Reka Flash 3.1",
    "reka-flash-3-1": "Reka Flash 3.1",
    "reka-flash-3": "Reka Flash 3",
    "reka-flash": "Reka Flash",
    "reka-edge": "Reka Edge",
  };

  // Check exact match
  if (knownModels[cleanName]) {
    return knownModels[cleanName];
  }

  // Check partial match. Try the most specific (longest) keys first so generic
  // keys like "claude" or "gpt-4" don't shadow specific ones like
  // "claude-3-5-sonnet" or "gpt-4o" for unknown model-id variants.
  const lowerName = cleanName.toLowerCase();
  const keysBySpecificity = Object.keys(knownModels).sort((a, b) => b.length - a.length);
  for (const key of keysBySpecificity) {
    if (lowerName.includes(key.toLowerCase())) {
      return knownModels[key];
    }
  }

  // Return as-is with capitalized first letter
  return cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
}

/**
 * The part of the signature that never varies. Every "is this already signed?"
 * check must use this one string, so changing the signature text can never
 * leave a stale copy behind that silently stops recognizing our own output.
 */
const SIGNATURE_MARKER = "Generated with [OpenCode]";

const SIGNATURE_URL = "https://opencode.ai";

/**
 * Generate signature
 */
function generateSignature(modelName: string): string {
  return `🤖 ${SIGNATURE_MARKER}(${SIGNATURE_URL}) (${modelName})`;
}

/**
 * Check if text already contains OpenCode signature
 */
function hasSignature(text: string): boolean {
  return text.includes(SIGNATURE_MARKER);
}

type HeredocHeader = { delimiter: string; allowIndent: boolean };

/**
 * Read a heredoc header (`<<EOF`, `<<-'EOF'`, `<< "EOF"`) starting at index.
 * Returns undefined for anything else, including the `<<<` herestring.
 */
function readHeredocHeader(command: string, index: number): { header: HeredocHeader; end: number } | undefined {
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
 * Overwrite one heredoc body — from the newline that opens it through its
 * terminator line — and return the index just past the terminator line.
 */
function maskHeredocBody(command: string, masked: string[], start: number, header: HeredocHeader): number {
  let lineStart = start + 1;

  while (lineStart <= command.length) {
    const newline = command.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? command.length : newline;
    const line = command.slice(lineStart, lineEnd);
    const content = header.allowIndent ? line.replace(/^\t+/, "") : line;

    if (content.replace(/\r$/, "") === header.delimiter) {
      for (let i = start; i < lineEnd; i++) masked[i] = MASK_CHARACTER;
      return lineEnd;
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }

  // Unterminated heredoc: the rest of the string is message text.
  for (let i = start; i < command.length; i++) masked[i] = MASK_CHARACTER;
  return command.length;
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
function maskHeredocBodies(command: string): string {
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
      // Everything that ends a command, not just the && || ; | separators:
      // a newline separates as surely as a semicolon, `(` and `)` bound a
      // subshell or substitution we must not reach across, a lone `&`
      // backgrounds what came before, and `#` opens a comment that would
      // swallow anything appended after it.
      if (/[;|&\n()]/.test(char)) return i;
      if (char === "#" && (i === startIndex || /\s/.test(prevChar))) return i;
    }
    i++;
  }

  return command.length;
}

/**
 * Wrap a value so the shell passes it through verbatim. Single quotes are the
 * only quoting in POSIX sh that suppresses every expansion, so an embedded
 * quote has to be closed, escaped and reopened.
 */
function quoteShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

type ShellWord = {
  raw: string;
  value: string;
  start: number;
  end: number;
};

type CommitMessageSource =
  | { kind: "message" }
  | { kind: "file"; value: string; start: number; end: number };

/** Read the limited shell word syntax used for git commit message options. */
function readShellWord(command: string, startIndex: number): ShellWord | undefined {
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

function findCommitMessageSource(command: string, startIndex: number): CommitMessageSource | undefined {
  let index = startIndex;
  let source: CommitMessageSource | undefined;

  while (index < command.length) {
    const word = readShellWord(command, index);
    if (!word || word.value === "--") break;
    index = word.end;

    if (word.value === "-m" || word.value === "--message") {
      const message = readShellWord(command, index);
      if (!message || source?.kind === "file") return undefined;
      source = { kind: "message" };
      index = message.end;
      continue;
    }
    // Attached forms: -m"subject", -msubject, --message=subject. git accepts
    // all of them, so the plugin has to recognize all of them.
    if (word.value.startsWith("--message=") || (word.value.startsWith("-m") && word.value.length > 2)) {
      if (source?.kind === "file") return undefined;
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
      // Dynamic paths would be evaluated a second time by the wrapper.
      if (source || /[$`]/.test(file.raw)) return undefined;
      source = { kind: "file", value: file.value, start: word.start, end: file.end };
    }
  }
  return source;
}

function addSignatureToHeredoc(command: string, signature: string, afterOption: number): string | undefined {
  const header = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(command.slice(afterOption));
  if (!header || header.index === undefined) return undefined;

  const headerEnd = afterOption + header.index + header[0].length;
  const bodyStart = command.indexOf("\n", headerEnd);
  if (bodyStart === -1) return undefined;

  const delimiter = header[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const indent = header[0].startsWith("<<-") ? "\\t*" : "";
  const delimiterMatch = new RegExp(`^${indent}${delimiter}\\r?$`, "m").exec(command.slice(bodyStart + 1));
  if (!delimiterMatch || delimiterMatch.index === undefined) return undefined;

  const delimiterStart = bodyStart + 1 + delimiterMatch.index;
  const body = command.slice(bodyStart + 1, delimiterStart);
  if (hasSignature(body)) return command;
  return command.slice(0, delimiterStart) + `\n${signature}\n` + command.slice(delimiterStart);
}

/**
 * Add a signature to a single git commit command. File-backed messages are
 * copied to a temporary file so the caller's message file is never modified.
 */
export function addSignatureToGitCommitCommand(command: string, signature: string): string {
  // Scan the masked copy so message text is never read as shell syntax, and
  // slice the original so the message is never altered by scanning.
  const scan = maskHeredocBodies(command);
  const gitCommitMatch = scan.match(/git\s+commit\b/i);
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

  if (source.value === "-") {
    const heredocCommand = addSignatureToHeredoc(commandPart, signature, source.end);
    if (heredocCommand) return command.slice(0, gitCommitStart) + heredocCommand + command.slice(endIndex);
  }

  const tempFile = "__opencode_signature_file";
  const rewrittenCommit = commandPart.slice(0, source.start) + `-F "$${tempFile}"` + commandPart.slice(source.end);
  const readMessage = source.value === "-"
    ? `cat >"$${tempFile}"`
    : `cat -- ${quoteShellArgument(source.value)} >"$${tempFile}"`;
  const marker = quoteShellArgument(SIGNATURE_MARKER);
  const quotedSignature = quoteShellArgument(signature);
  const wrapper = `( ${tempFile}=$(mktemp "\${TMPDIR:-/tmp}/opencode-pr-signature.XXXXXX") || exit; trap 'rm -f -- "$${tempFile}"' 0 HUP INT TERM; ${readMessage} || exit; if ! grep -Fq -- ${marker} "$${tempFile}"; then printf '\\n\\n%s\\n' ${quotedSignature} >>"$${tempFile}" || exit; fi; ${rewrittenCommit} )`;
  const afterCommand = command.slice(endIndex);
  const separator = afterCommand && !/^\s/.test(afterCommand) ? " " : "";
  return command.slice(0, gitCommitStart) + wrapper + separator + afterCommand;
}

/**
 * Check if a command is a gh CLI command that needs signature injection.
 * Supported commands: gh pr create, gh issue create, gh pr comment, gh issue comment, gh pr review
 */
function isGhCommandWithBody(command: string): boolean {
  return /gh\s+(pr|issue)\s+(create|comment|review)\b/i.test(command);
}

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
  | { kind: "present"; value: string; start: number; end: number };

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
      if (/[$`]/.test(value.raw)) return { kind: "unsupported" };
      return { kind: "present", value: value.value, start: word.start, end: value.end };
    }

    let inline: { value: string; offset: number } | undefined;
    if (word.value.startsWith("--body=")) inline = { value: word.value.slice(7), offset: 7 };
    else if (word.value.startsWith("-b") && word.value.length > 2) {
      inline = { value: word.value.slice(2), offset: 2 };
    }

    if (inline) {
      if (/[$`]/.test(word.raw.slice(inline.offset))) return { kind: "unsupported" };
      return { kind: "present", value: inline.value, start: word.start, end: word.end };
    }

    // A body read from a file or from stdin is not ours to rewrite.
    if (word.value === "--body-file" || word.value.startsWith("--body-file=") || word.value === "-F") {
      return { kind: "unsupported" };
    }
  }

  return { kind: "absent" };
}

/**
 * Add signature to gh CLI command.
 * If --body/-b exists, append the signature to its value; otherwise add the
 * flag. Returns the command unchanged when the body cannot be rewritten.
 */
function addSignatureToGhCommand(command: string, signature: string, startIndex: number): string {
  const scan = maskHeredocBodies(command);
  const endIndex = findCommandEndIndex(scan, startIndex);

  const commandPart = command.slice(startIndex, endIndex);
  const beforeCommand = command.slice(0, startIndex);
  const afterCommand = command.slice(endIndex);

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
  const signed = quoteShellArgument(body.value.trimEnd() + "\n\n" + signature);
  const rewritten = commandPart.slice(0, body.start) + `--body ${signed}` + commandPart.slice(body.end);
  return beforeCommand + rewritten + afterCommand;
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

        const signature = generateSignature(currentModel);

        // Handle git commit commands
        const signedGitCommitCommand = addSignatureToGitCommitCommand(command, signature);
        if (signedGitCommitCommand !== command) {
          output.args.command = signedGitCommitCommand;
          return;
        }

        // Handle gh CLI commands (pr create, issue create, pr comment, issue comment, pr review)
        if (isGhCommandWithBody(command) && !hasSignature(command)) {
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
