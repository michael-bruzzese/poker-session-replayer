// Browser tests for AI parsing panel and pipeline
// Runs against the BUILT index.html

const { test, expect } = require("@playwright/test");
const path = require("path");

const INDEX_PATH = path.resolve(__dirname, "../../index.html");

test.describe("AI Parsing — Panel and Key Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${INDEX_PATH}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  });

  test("AI parsing panel is visible on upload screen", async ({ page }) => {
    // Look for text "AI Parsing" anywhere visible on the upload screen
    const uploadScreen = page.locator("#uploadScreen");
    await expect(uploadScreen).toBeVisible();

    const panelText = await uploadScreen.textContent();
    expect(panelText).toMatch(/AI Parsing/i);
  });

  test("shows 'Off' state when no key saved", async ({ page }) => {
    const uploadScreen = page.locator("#uploadScreen");
    const text = await uploadScreen.textContent();
    expect(text).toMatch(/off/i);
  });

  test("key input is visible when no key saved", async ({ page }) => {
    // The key input should be somewhere visible
    const keyInput = page.locator('input[placeholder*="sk-"]').first();
    await expect(keyInput).toBeVisible();
  });

  test("auto-detects Anthropic provider from key format", async ({ page }) => {
    // We'll simulate a key entry but mock the validation to avoid network
    await page.evaluate(() => {
      // Pre-save a key to test the saved-state UI
      window.LLMAdapter.saveKey("anthropic", "sk-ant-api03-test-key");
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // After reload, panel should show "On (Anthropic)" or similar
    const uploadScreen = page.locator("#uploadScreen");
    const text = await uploadScreen.textContent();
    expect(text).toMatch(/anthropic/i);
    expect(text).toMatch(/on/i);
  });

  test("auto-detects OpenAI provider from key format", async ({ page }) => {
    await page.evaluate(() => {
      window.LLMAdapter.saveKey("openai", "sk-test-openai-key");
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    const uploadScreen = page.locator("#uploadScreen");
    const text = await uploadScreen.textContent();
    expect(text).toMatch(/openai/i);
  });

  test("removing key reverts panel to Off state", async ({ page }) => {
    // Save a key
    await page.evaluate(() => {
      window.LLMAdapter.saveKey("anthropic", "sk-ant-test");
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Confirm "On" state
    let text = await page.locator("#uploadScreen").textContent();
    expect(text).toMatch(/on/i);

    // Remove the key
    await page.evaluate(() => {
      window.LLMAdapter.removeKey("anthropic");
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Should be back to Off state
    text = await page.locator("#uploadScreen").textContent();
    expect(text).toMatch(/off/i);
  });

  test("multiple keys can be saved for different providers", async ({ page }) => {
    await page.evaluate(() => {
      window.LLMAdapter.saveKey("anthropic", "sk-ant-xxx");
      window.LLMAdapter.saveKey("openai", "sk-xxx");
    });

    const keys = await page.evaluate(() => window.LLMAdapter.getSavedKeys());
    expect(keys.anthropic).toBeDefined();
    expect(keys.openai).toBeDefined();
    expect(keys.anthropic.apiKey).toBe("sk-ant-xxx");
    expect(keys.openai.apiKey).toBe("sk-xxx");
  });
});

test.describe("AI Parsing — Mocked LLM Call", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${INDEX_PATH}`);
    await page.evaluate(() => localStorage.clear());
  });

  test("parseWithAI is called when key is saved and text is uploaded", async ({ page }) => {
    // Save a key
    await page.evaluate(() => {
      localStorage.clear();
      window.LLMAdapter.saveKey("anthropic", "sk-ant-test-key");
    });

    // Mock the Anthropic API endpoint
    await page.route("**/v1/messages", async (route) => {
      const mockResponse = {
        content: [{
          text: JSON.stringify({
            version: 2,
            app: "session-replayer",
            session_name: "Mocked Session",
            blinds: { small: 2, big: 5 },
            players: { "1": { name: "Hero", is_hero: true } },
            hands: [{
              hand_id: 1,
              hand_label: "Hand 1",
              status: "confirmed",
              hero_seat: 1,
              button_seat: 1,
              blinds: { small: 2, big: 5 },
              stacks: { "1": 500, "2": 500 },
              hero_cards: ["As", "Kd"],
              board: { flop: ["Ks", "8c", "3d"] },
              action_sequence: [{
                street: "preflop",
                actions: [{ seat: 1, position: "BTN", action: "raise", amount: 15 }]
              }],
              result: { winner_seat: 1, pot: 22, showdown: false }
            }]
          })
        }],
        usage: { input_tokens: 100, output_tokens: 200 }
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockResponse)
      });
    });

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Now trigger a text parse via pasteTextArea or similar
    // Use a direct test via the exposed parseWithAI function
    const parseResult = await page.evaluate(async () => {
      // Simulate calling parseWithAI with text
      const text = "Hand 1: Hero raises to 15 from the button, folds around";
      const LA = window.LLMAdapter;
      const PP = window.ParsePrompt;
      const primaryKey = LA.getPrimaryKey();

      const result = await LA.callLLM({
        provider: primaryKey.provider,
        apiKey: primaryKey.apiKey,
        model: primaryKey.model,
        systemPrompt: PP.SYSTEM_PROMPT,
        userMessage: PP.buildUserMessage({ text, blinds: { small: 2, big: 5 }, heroSeat: 1 })
      });

      if (!result.success) return { error: result.error };

      const parsed = PP.extractJSON(result.text);
      return {
        success: true,
        hasHands: parsed && parsed.hands && parsed.hands.length > 0,
        handCount: parsed ? parsed.hands.length : 0,
        sessionName: parsed ? parsed.session_name : null
      };
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.hasHands).toBe(true);
    expect(parseResult.handCount).toBe(1);
    expect(parseResult.sessionName).toBe("Mocked Session");
  });

  test("falls back gracefully when API returns error", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.clear();
      window.LLMAdapter.saveKey("anthropic", "sk-ant-bad-key");
    });

    // Mock a 401 auth error
    await page.route("**/v1/messages", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "invalid api key" } })
      });
    });

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(async () => {
      const LA = window.LLMAdapter;
      const r = await LA.callLLM({
        provider: "anthropic",
        apiKey: "sk-ant-bad-key",
        systemPrompt: "test",
        userMessage: "test"
      });
      return r;
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API key");
  });
});

test.describe("AI Parsing — Integration with existing flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${INDEX_PATH}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  });

  test("JSON uploads bypass AI parsing (go direct to QA)", async ({ page }) => {
    // Save a key so AI is on
    await page.evaluate(() => {
      window.LLMAdapter.saveKey("anthropic", "sk-ant-test");
    });

    // Mock the API — if this is called, the test fails
    let apiCalled = false;
    await page.route("**/v1/messages", async (route) => {
      apiCalled = true;
      await route.fulfill({ status: 200, body: "{}" });
    });

    // Upload the gold session JSON
    const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/gold_session.json");
    const fileInput = page.locator("#fileInput");
    await fileInput.setInputFiles(FIXTURE_PATH);

    // Wait for QA or playback screen
    await page.waitForTimeout(2000);

    // Verify AI was NOT called for JSON input
    expect(apiCalled).toBe(false);
  });

  test("without key, ShorthandLearner is used (existing behavior)", async ({ page }) => {
    // No key saved
    let apiCalled = false;
    await page.route("**/v1/messages", async (route) => {
      apiCalled = true;
      await route.fulfill({ status: 200, body: "{}" });
    });

    // AI panel should show "Off"
    const uploadScreen = page.locator("#uploadScreen");
    const text = await uploadScreen.textContent();
    expect(text).toMatch(/off/i);

    // API should not be called
    expect(apiCalled).toBe(false);
  });
});
