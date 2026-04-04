import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage
const _store = Object.create(null);
globalThis.localStorage = {
  getItem: (k) => (k in _store) ? _store[k] : null,
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
  clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
  get length() { return Object.keys(_store).length; },
  key: (i) => Object.keys(_store)[i] || null
};

const LLMAdapter = require("../shared/llm_adapter.js");
const LA = LLMAdapter;

// ============================================================
// Provider Detection
// ============================================================

describe("LLM Adapter — Provider Detection", () => {
  it("detects Anthropic from sk-ant- prefix", () => {
    expect(LA.detectProvider("sk-ant-api03-abc123")).toBe("anthropic");
    expect(LA.detectProvider("sk-ant-xxx")).toBe("anthropic");
  });

  it("detects OpenAI from sk- prefix", () => {
    expect(LA.detectProvider("sk-abc123")).toBe("openai");
    expect(LA.detectProvider("sk-proj-xyz")).toBe("openai");
  });

  it("returns unknown for unrecognized formats", () => {
    expect(LA.detectProvider("random-key")).toBe("unknown");
    expect(LA.detectProvider("xyz-123")).toBe("unknown");
    expect(LA.detectProvider("")).toBe("unknown");
    expect(LA.detectProvider(null)).toBe("unknown");
    expect(LA.detectProvider(undefined)).toBe("unknown");
  });

  it("trims whitespace from keys before detecting", () => {
    expect(LA.detectProvider("  sk-ant-xxx  ")).toBe("anthropic");
    expect(LA.detectProvider("\nsk-xxx\n")).toBe("openai");
  });
});

// ============================================================
// Cost Estimation
// ============================================================

describe("LLM Adapter — Cost Estimation", () => {
  it("estimates tokens from chars (~1/4 ratio)", () => {
    expect(LA.estimateTokens(4)).toBe(1);
    expect(LA.estimateTokens(400)).toBe(100);
    expect(LA.estimateTokens(10000)).toBe(2500);
  });

  it("estimates cost for Anthropic", () => {
    const est = LA.estimateCost({ provider: "anthropic", inputChars: 10000, maxOutputTokens: 2000 });
    expect(est.estimatedInputTokens).toBe(2500);
    expect(est.estimatedOutputTokens).toBe(2000);
    expect(est.estimatedCost).toBeGreaterThan(0);
    expect(est.inputRatePerK).toBe(0.003);
    expect(est.outputRatePerK).toBe(0.015);
  });

  it("estimates cost for OpenAI", () => {
    const est = LA.estimateCost({ provider: "openai", inputChars: 10000, maxOutputTokens: 2000 });
    expect(est.estimatedInputTokens).toBe(2500);
    expect(est.estimatedCost).toBeGreaterThan(0);
  });

  it("honest cost comparison between providers", () => {
    const anthropic = LA.estimateCost({ provider: "anthropic", inputChars: 10000, maxOutputTokens: 2000 });
    const openai = LA.estimateCost({ provider: "openai", inputChars: 10000, maxOutputTokens: 2000 });
    // Just verify both are computed, not that one is cheaper
    expect(anthropic.estimatedCost).toBeGreaterThan(0);
    expect(openai.estimatedCost).toBeGreaterThan(0);
  });
});

// ============================================================
// Error Mapping
// ============================================================

describe("LLM Adapter — Error Mapping", () => {
  it("401 → Invalid API key", () => {
    expect(LA.mapError(401, "", false)).toContain("Invalid API key");
  });

  it("403 → Permission error", () => {
    expect(LA.mapError(403, "", false)).toContain("doesn't have permission");
  });

  it("429 → Rate limit", () => {
    expect(LA.mapError(429, "", false)).toContain("Rate limited");
  });

  it("413 → Request too large", () => {
    expect(LA.mapError(413, "", false)).toContain("too large");
  });

  it("500+ → Service error", () => {
    expect(LA.mapError(500, "", false)).toContain("service error");
    expect(LA.mapError(503, "", false)).toContain("service error");
  });

  it("CORS flag → Browser blocked message", () => {
    expect(LA.mapError(0, "Failed to fetch", true)).toContain("blocking browser requests");
  });

  it("400 with model text → Model not available", () => {
    expect(LA.mapError(400, "model not found", false)).toContain("Model not available");
  });
});

// ============================================================
// Call LLM — Request Building (mocked fetch)
// ============================================================

describe("LLM Adapter — callLLM request building", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("builds Anthropic request correctly", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: "OK" }],
        usage: { input_tokens: 5, output_tokens: 1 }
      })
    });

    const result = await LA.callLLM({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      systemPrompt: "You are a bot",
      userMessage: "hi"
    });

    expect(result.success).toBe(true);
    expect(result.text).toBe("OK");
    expect(globalThis.fetch).toHaveBeenCalled();

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("api.anthropic.com");
    expect(opts.headers["x-api-key"]).toBe("sk-ant-test");
    expect(opts.headers["anthropic-version"]).toBeDefined();
    expect(opts.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");

    const body = JSON.parse(opts.body);
    expect(body.system).toBe("You are a bot");
    expect(body.messages[0].content).toBe("hi");
  });

  it("builds OpenAI request correctly", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "OK" } }],
        usage: { total_tokens: 10 }
      })
    });

    const result = await LA.callLLM({
      provider: "openai",
      apiKey: "sk-test",
      systemPrompt: "System",
      userMessage: "user"
    });

    expect(result.success).toBe(true);
    expect(result.text).toBe("OK");

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("api.openai.com");
    expect(opts.headers["Authorization"]).toBe("Bearer sk-test");

    const body = JSON.parse(opts.body);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("System");
    expect(body.messages[1].content).toBe("user");
  });

  it("handles 401 auth error", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized"
    });

    const result = await LA.callLLM({
      provider: "anthropic",
      apiKey: "sk-ant-bad",
      systemPrompt: "S",
      userMessage: "U"
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API key");
  });

  it("handles network failure", async () => {
    globalThis.fetch.mockRejectedValue(new Error("Failed to fetch"));

    const result = await LA.callLLM({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      systemPrompt: "S",
      userMessage: "U"
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("browser");
  });

  it("returns error when no API key provided", async () => {
    const result = await LA.callLLM({
      provider: "anthropic",
      apiKey: "",
      systemPrompt: "S",
      userMessage: "U"
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("API key");
  });

  it("auto-detects provider when not specified", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: "OK" }],
        usage: { input_tokens: 5, output_tokens: 1 }
      })
    });

    const result = await LA.callLLM({
      apiKey: "sk-ant-auto",
      systemPrompt: "S",
      userMessage: "U"
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("anthropic");
  });

  it("returns error for unknown provider when not auto-detectable", async () => {
    const result = await LA.callLLM({
      apiKey: "random-xxx",
      systemPrompt: "S",
      userMessage: "U"
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("detect provider");
  });
});

// ============================================================
// Key Storage
// ============================================================

describe("LLM Adapter — Key Storage", () => {
  beforeEach(() => {
    for (const k of Object.keys(_store)) delete _store[k];
  });

  it("saves and retrieves a key", () => {
    LA.saveKey("anthropic", "sk-ant-xxx");
    const k = LA.getKeyForProvider("anthropic");
    expect(k).not.toBeNull();
    expect(k.apiKey).toBe("sk-ant-xxx");
    expect(k.model).toBeDefined();
  });

  it("supports multiple keys for different providers", () => {
    LA.saveKey("anthropic", "sk-ant-xxx");
    LA.saveKey("openai", "sk-xxx");

    const all = LA.getSavedKeys();
    expect(all.anthropic.apiKey).toBe("sk-ant-xxx");
    expect(all.openai.apiKey).toBe("sk-xxx");
  });

  it("removes a key", () => {
    LA.saveKey("anthropic", "sk-ant-xxx");
    LA.saveKey("openai", "sk-xxx");
    LA.removeKey("anthropic");

    expect(LA.getKeyForProvider("anthropic")).toBeNull();
    expect(LA.getKeyForProvider("openai")).not.toBeNull();
  });

  it("hasAnyKey reflects storage state", () => {
    expect(LA.hasAnyKey()).toBe(false);
    LA.saveKey("openai", "sk-xxx");
    expect(LA.hasAnyKey()).toBe(true);
    LA.removeKey("openai");
    expect(LA.hasAnyKey()).toBe(false);
  });

  it("getPrimaryKey prefers Anthropic then OpenAI", () => {
    LA.saveKey("openai", "sk-xxx");
    let primary = LA.getPrimaryKey();
    expect(primary.provider).toBe("openai");

    LA.saveKey("anthropic", "sk-ant-xxx");
    primary = LA.getPrimaryKey();
    expect(primary.provider).toBe("anthropic");
  });

  it("getPrimaryKey returns null when no keys saved", () => {
    expect(LA.getPrimaryKey()).toBeNull();
  });
});
