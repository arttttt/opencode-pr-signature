/**
 * Turning a model id into the human-readable name that goes in the signature.
 *
 * The map below is deliberately historical: old ids keep rendering the name
 * they had, so a signature written last year still reads the way it did.
 */

/**
 * Format model name to human-readable form
 */
export function formatModelName(model: { providerID: string; modelID: string } | string | undefined): string {
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
