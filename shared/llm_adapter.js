// LLM Adapter — provider-agnostic interface for LLM API calls
// Supports: Anthropic, OpenAI, OpenAI-compatible endpoints

const LLMAdapter = (() => {
  "use strict";

  // Default models per provider (picked for parsing quality + cost balance)
  const DEFAULT_MODELS = {
    anthropic: "claude-sonnet-4-5-20250514",
    openai: "gpt-4o"
  };

  // Approximate per-token costs (USD, input tokens). Update as providers change pricing.
  // These are used ONLY for honest cost estimates — do not hide costs.
  const COST_PER_1K_INPUT_TOKENS = {
    anthropic: { "claude-sonnet-4-5-20250514": 0.003, default: 0.003 },
    openai: { "gpt-4o": 0.0025, default: 0.0025 }
  };
  const COST_PER_1K_OUTPUT_TOKENS = {
    anthropic: { "claude-sonnet-4-5-20250514": 0.015, default: 0.015 },
    openai: { "gpt-4o": 0.01, default: 0.01 }
  };

  // ---- Provider Detection ----

  function detectProvider(apiKey) {
    if (!apiKey || typeof apiKey !== "string") return "unknown";
    const key = apiKey.trim();
    if (key.startsWith("sk-ant-")) return "anthropic";
    if (key.startsWith("sk-")) return "openai";
    return "unknown";
  }

  // ---- Cost Estimation ----

  function estimateTokens(chars) {
    // Rough estimate: 1 token ≈ 4 characters for English
    return Math.ceil(chars / 4);
  }

  function estimateCost({ provider, inputChars, maxOutputTokens, model }) {
    const usedModel = model || DEFAULT_MODELS[provider] || "default";
    const inputRates = COST_PER_1K_INPUT_TOKENS[provider] || { default: 0.003 };
    const outputRates = COST_PER_1K_OUTPUT_TOKENS[provider] || { default: 0.015 };

    const inputRate = inputRates[usedModel] || inputRates.default;
    const outputRate = outputRates[usedModel] || outputRates.default;

    const inputTokens = estimateTokens(inputChars);
    const outputTokens = maxOutputTokens || 4096;

    const cost = (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;

    return {
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCost: Math.round(cost * 10000) / 10000, // 4 decimal places
      inputRatePerK: inputRate,
      outputRatePerK: outputRate
    };
  }

  // ---- Error Mapping ----

  function mapError(status, bodyText, isCors) {
    if (isCors) {
      return "This provider is blocking browser requests. Try a different provider or paste your notes manually.";
    }
    if (status === 401) return "Invalid API key. Check that you copied the full key.";
    if (status === 403) return "API key doesn't have permission for this model.";
    if (status === 429) return "Rate limited. Wait a moment and try again.";
    if (status === 413) return "Request too large. Try shortening your notes.";
    if (status === 400) {
      if (bodyText && bodyText.toLowerCase().includes("model")) {
        return "Model not available. Try a different model.";
      }
      return "Request rejected. Check the format of your notes.";
    }
    if (status >= 500) return "Provider service error. Try again in a moment.";
    return `API error (status ${status})`;
  }

  // ---- Request Builders ----

  function buildAnthropicRequest({ apiKey, model, systemPrompt, userMessage, maxTokens }) {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODELS.anthropic,
        max_tokens: maxTokens || 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      })
    };
  }

  function buildOpenAIRequest({ apiKey, model, systemPrompt, userMessage, maxTokens, endpoint }) {
    return {
      url: endpoint || "https://api.openai.com/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODELS.openai,
        max_tokens: maxTokens || 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ]
      })
    };
  }

  // ---- Response Parsing ----

  function parseAnthropicResponse(data) {
    if (data.content && Array.isArray(data.content) && data.content[0]) {
      return {
        text: data.content[0].text,
        tokensUsed: (data.usage && (data.usage.input_tokens + data.usage.output_tokens)) || 0
      };
    }
    return { text: "", tokensUsed: 0 };
  }

  function parseOpenAIResponse(data) {
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return {
        text: data.choices[0].message.content,
        tokensUsed: (data.usage && data.usage.total_tokens) || 0
      };
    }
    return { text: "", tokensUsed: 0 };
  }

  // ---- Main Call ----

  async function callLLM({ provider, apiKey, model, endpoint, systemPrompt, userMessage, maxTokens }) {
    if (!apiKey) return { success: false, error: "API key is required" };
    if (!systemPrompt || !userMessage) return { success: false, error: "System prompt and user message required" };

    const effectiveProvider = provider || detectProvider(apiKey);
    if (effectiveProvider === "unknown") {
      return { success: false, error: "Could not detect provider from API key. Please specify." };
    }

    let request;
    try {
      if (effectiveProvider === "anthropic") {
        request = buildAnthropicRequest({ apiKey, model, systemPrompt, userMessage, maxTokens });
      } else if (effectiveProvider === "openai" || effectiveProvider === "openai-compatible") {
        request = buildOpenAIRequest({ apiKey, model, systemPrompt, userMessage, maxTokens, endpoint });
      } else {
        return { success: false, error: `Unsupported provider: ${effectiveProvider}` };
      }
    } catch (e) {
      return { success: false, error: "Failed to build request: " + e.message };
    }

    let response;
    try {
      response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body
      });
    } catch (e) {
      const msg = e.message || "";
      const isCors = msg.includes("CORS") || msg.includes("cors") || msg.includes("Failed to fetch");
      return { success: false, error: mapError(0, msg, isCors) };
    }

    if (!response.ok) {
      let bodyText = "";
      try { bodyText = await response.text(); } catch (_) {}
      return { success: false, error: mapError(response.status, bodyText, false), status: response.status };
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      return { success: false, error: "Failed to parse API response" };
    }

    const parsed = (effectiveProvider === "anthropic")
      ? parseAnthropicResponse(data)
      : parseOpenAIResponse(data);

    return {
      success: true,
      text: parsed.text,
      tokensUsed: parsed.tokensUsed,
      provider: effectiveProvider
    };
  }

  // ---- Vision / Image Call ----

  async function callLLMWithImage({ provider, apiKey, model, endpoint, systemPrompt, userMessage, imageBase64, imageMimeType, maxTokens }) {
    if (!apiKey) return { success: false, error: "API key is required" };
    if (!imageBase64) return { success: false, error: "No image data provided" };

    const effectiveProvider = provider || detectProvider(apiKey);
    if (effectiveProvider === "unknown") {
      return { success: false, error: "Could not detect provider from API key." };
    }

    let url, headers, body;

    if (effectiveProvider === "anthropic") {
      url = "https://api.anthropic.com/v1/messages";
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      };
      body = JSON.stringify({
        model: model || "claude-sonnet-4-5-20250514",
        max_tokens: maxTokens || 8192,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: imageMimeType || "image/jpeg", data: imageBase64 } },
            { type: "text", text: userMessage || "Read and parse these poker session notes." }
          ]
        }]
      });
    } else {
      // OpenAI / compatible
      url = endpoint || "https://api.openai.com/v1/chat/completions";
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      };
      body = JSON.stringify({
        model: model || "gpt-4o",
        max_tokens: maxTokens || 8192,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "image_url", image_url: { url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}` } },
            { type: "text", text: userMessage || "Read and parse these poker session notes." }
          ]}
        ]
      });
    }

    let response;
    try {
      response = await fetch(url, { method: "POST", headers, body });
    } catch (e) {
      const msg = e.message || "";
      const isCors = msg.includes("CORS") || msg.includes("Failed to fetch");
      return { success: false, error: mapError(0, msg, isCors) };
    }

    if (!response.ok) {
      let bodyText = "";
      try { bodyText = await response.text(); } catch (_) {}
      return { success: false, error: mapError(response.status, bodyText, false), status: response.status };
    }

    let data;
    try { data = await response.json(); } catch (e) {
      return { success: false, error: "Failed to parse API response" };
    }

    const parsed = (effectiveProvider === "anthropic")
      ? parseAnthropicResponse(data)
      : parseOpenAIResponse(data);

    return { success: true, text: parsed.text, tokensUsed: parsed.tokensUsed, provider: effectiveProvider };
  }

  function isImageFile(file) {
    if (!file) return false;
    const type = (file.type || "").toLowerCase();
    if (type.startsWith("image/")) return true;
    const name = (file.name || "").toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/.test(name);
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // Strip the data:...;base64, prefix
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---- Key Validation ----

  async function validateKey({ provider, apiKey, endpoint }) {
    // Make a minimal API call to verify the key works
    const result = await callLLM({
      provider,
      apiKey,
      endpoint,
      systemPrompt: "Respond with just the word: OK",
      userMessage: "test",
      maxTokens: 10
    });

    if (result.success) {
      return { valid: true, provider: result.provider };
    }
    return { valid: false, error: result.error };
  }

  // ---- Audio Transcription (Whisper API) ----

  // Poker jargon prompt — helps Whisper transcribe poker terms correctly
  const POKER_JARGON_PROMPT = "Poker session recording. Terms: UTG, UTG+1, UTG+2, lojack, hijack, cutoff, button, small blind, big blind, three-bet, check-raise, all-in, straddle, pocket aces, ace king suited, flop, turn, river, pot, fold, raise, call, bet, check, limp, squeeze, isolate, c-bet, overpair, top pair, flush draw, straight draw, set, trips, two pair.";

  const WHISPER_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
  const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper API limit

  async function transcribeAudio({ apiKey, audioBlob, language, prompt, model }) {
    if (!apiKey) {
      return { success: false, error: "Audio transcription requires an OpenAI API key" };
    }
    if (!audioBlob) {
      return { success: false, error: "No audio data provided" };
    }
    if (audioBlob.size > MAX_AUDIO_BYTES) {
      return {
        success: false,
        error: `Audio file too large (${(audioBlob.size / 1024 / 1024).toFixed(1)}MB). Whisper API limit is 25MB.`
      };
    }

    const formData = new FormData();
    formData.append("file", audioBlob, audioBlob.name || "audio.m4a");
    formData.append("model", model || "whisper-1");
    formData.append("language", language || "en");
    formData.append("prompt", prompt || POKER_JARGON_PROMPT);

    let response;
    try {
      response = await fetch(WHISPER_ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`
        },
        body: formData
      });
    } catch (e) {
      const msg = e.message || "";
      const isCors = msg.includes("CORS") || msg.includes("Failed to fetch");
      return { success: false, error: mapError(0, msg, isCors) };
    }

    if (!response.ok) {
      let bodyText = "";
      try { bodyText = await response.text(); } catch (_) {}
      if (response.status === 413) {
        return { success: false, error: "Audio file too large for transcription." };
      }
      if (response.status === 400 && bodyText.toLowerCase().includes("format")) {
        return { success: false, error: "Unsupported audio format. Try m4a, mp3, or wav." };
      }
      return { success: false, error: mapError(response.status, bodyText, false) };
    }

    try {
      const data = await response.json();
      return {
        success: true,
        text: data.text || "",
        language: data.language || language
      };
    } catch (e) {
      return { success: false, error: "Failed to parse transcription response" };
    }
  }

  function estimateTranscriptionTime(fileSizeBytes) {
    // Rough heuristic: ~1 second per 100KB of audio
    return Math.max(5, Math.ceil(fileSizeBytes / 100000));
  }

  function isAudioFile(file) {
    if (!file) return false;
    const type = (file.type || "").toLowerCase();
    if (type.startsWith("audio/")) return true;
    const name = (file.name || "").toLowerCase();
    return /\.(m4a|mp3|wav|webm|mp4|mpeg|mpga|ogg|flac)$/.test(name);
  }

  // ---- Key Storage ----
  // Multiple keys supported — one per provider

  const STORAGE_KEY = "llm_keys";

  function getSavedKeys() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (_) {
      return {};
    }
  }

  function saveKey(provider, apiKey, options) {
    const keys = getSavedKeys();
    keys[provider] = {
      apiKey,
      model: (options && options.model) || DEFAULT_MODELS[provider],
      endpoint: (options && options.endpoint) || null,
      savedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    return { success: true };
  }

  function removeKey(provider) {
    const keys = getSavedKeys();
    delete keys[provider];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    return { success: true };
  }

  function getKeyForProvider(provider) {
    const keys = getSavedKeys();
    return keys[provider] || null;
  }

  function hasAnyKey() {
    const keys = getSavedKeys();
    return Object.keys(keys).length > 0;
  }

  function getPrimaryKey() {
    // Return first available key, preferring Anthropic then OpenAI
    const keys = getSavedKeys();
    if (keys.anthropic) return { provider: "anthropic", ...keys.anthropic };
    if (keys.openai) return { provider: "openai", ...keys.openai };
    const providers = Object.keys(keys);
    if (providers.length > 0) return { provider: providers[0], ...keys[providers[0]] };
    return null;
  }

  // ---- Public API ----

  return {
    // Detection
    detectProvider,
    DEFAULT_MODELS,

    // Cost estimation
    estimateTokens,
    estimateCost,

    // Core call
    callLLM,
    callLLMWithImage,
    validateKey,

    // Image handling
    isImageFile,
    fileToBase64,

    // Audio transcription
    transcribeAudio,
    estimateTranscriptionTime,
    isAudioFile,
    POKER_JARGON_PROMPT,
    MAX_AUDIO_BYTES,

    // Key storage
    getSavedKeys,
    saveKey,
    removeKey,
    getKeyForProvider,
    hasAnyKey,
    getPrimaryKey,

    // Error mapping (for testing)
    mapError
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = LLMAdapter;
} else if (typeof window !== "undefined") {
  window.LLMAdapter = LLMAdapter;
}
