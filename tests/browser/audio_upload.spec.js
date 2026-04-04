// Browser tests for audio file upload + transcription flow
const { test, expect } = require("@playwright/test");
const path = require("path");

const INDEX_PATH = path.resolve(__dirname, "../../index.html");

test.describe("Audio Upload — File Detection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${INDEX_PATH}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  });

  test("file input accepts audio formats", async ({ page }) => {
    const accept = await page.locator("#fileInput").getAttribute("accept");
    expect(accept).toMatch(/\.m4a/);
    expect(accept).toMatch(/\.mp3/);
    expect(accept).toMatch(/\.wav/);
  });

  test("isAudioFile detects audio files", async ({ page }) => {
    const result = await page.evaluate(() => ({
      m4a: window.LLMAdapter.isAudioFile({ name: "test.m4a", type: "audio/m4a" }),
      mp3: window.LLMAdapter.isAudioFile({ name: "recording.mp3", type: "audio/mpeg" }),
      wav: window.LLMAdapter.isAudioFile({ name: "audio.wav", type: "audio/wav" }),
      txt: window.LLMAdapter.isAudioFile({ name: "notes.txt", type: "text/plain" }),
      json: window.LLMAdapter.isAudioFile({ name: "session.json", type: "application/json" })
    }));
    expect(result.m4a).toBe(true);
    expect(result.mp3).toBe(true);
    expect(result.wav).toBe(true);
    expect(result.txt).toBe(false);
    expect(result.json).toBe(false);
  });
});

test.describe("Audio Upload — Key Requirements", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${INDEX_PATH}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  });

  test("audio upload without OpenAI key shows helpful message", async ({ page }) => {
    // No keys saved
    const hasKey = await page.evaluate(() => !!window.LLMAdapter.getKeyForProvider("openai"));
    expect(hasKey).toBe(false);

    // Transcription should fail clearly
    const result = await page.evaluate(async () => {
      return await window.LLMAdapter.transcribeAudio({
        apiKey: "",
        audioBlob: new Blob(["fake"], { type: "audio/m4a" })
      });
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("OpenAI API key");
  });

  test("audio upload with OpenAI key hits Whisper API", async ({ page }) => {
    // Save an OpenAI key
    await page.evaluate(() => {
      window.LLMAdapter.saveKey("openai", "sk-test-openai");
    });

    // Mock Whisper endpoint
    await page.route("**/audio/transcriptions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text: "Hand 1: hero raises to fifteen from the button",
          language: "en"
        })
      });
    });

    const result = await page.evaluate(async () => {
      const key = window.LLMAdapter.getKeyForProvider("openai");
      return await window.LLMAdapter.transcribeAudio({
        apiKey: key.apiKey,
        audioBlob: new Blob(["fake audio"], { type: "audio/m4a" })
      });
    });

    expect(result.success).toBe(true);
    expect(result.text).toContain("hero raises");
  });

  test("transcription API auth error shows clear message", async ({ page }) => {
    await page.route("**/audio/transcriptions", async (route) => {
      await route.fulfill({
        status: 401,
        body: JSON.stringify({ error: { message: "invalid key" } })
      });
    });

    const result = await page.evaluate(async () => {
      return await window.LLMAdapter.transcribeAudio({
        apiKey: "sk-bad",
        audioBlob: new Blob(["fake"], { type: "audio/m4a" })
      });
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API key");
  });
});

test.describe("Audio Upload — Size Limits", () => {
  test("25MB file size enforced", async ({ page }) => {
    await page.goto(`file://${INDEX_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(async () => {
      // Simulate a large file
      const bigFile = { size: 30 * 1024 * 1024, name: "big.mp3", type: "audio/mpeg" };
      return await window.LLMAdapter.transcribeAudio({
        apiKey: "sk-test",
        audioBlob: bigFile
      });
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("too large");
  });
});
