// Browser tests for the equity calculator UI
const { test, expect } = require("@playwright/test");
const path = require("path");

const INDEX_PATH = path.resolve(__dirname, "../../index.html");
const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/gold_session.json");

test.describe("Equity Calculator UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${INDEX_PATH}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Load a session to get to playback screen
    const fileInput = page.locator("#fileInput");
    await fileInput.setInputFiles(FIXTURE_PATH);

    // Skip through QA to playback
    await page.waitForTimeout(1000);
    const qaScreen = page.locator("#qaScreen");
    const qaVisible = await qaScreen.evaluate(el => el.classList.contains("active"));
    if (qaVisible) {
      const skipBtn = page.locator("#qaSkipAllBtn");
      if (await skipBtn.isVisible()) await skipBtn.click();
      await page.waitForTimeout(500);
      const finishBtn = page.locator("#qaFinishBtn");
      if (await finishBtn.isVisible()) await finishBtn.click();
      await page.waitForTimeout(500);
    }
    const reviewScreen = page.locator("#reviewScreen");
    const reviewVisible = await reviewScreen.evaluate(el => el.classList.contains("active")).catch(() => false);
    if (reviewVisible) {
      const launchBtn = page.locator("#reviewLaunchBtn");
      if (await launchBtn.isVisible()) await launchBtn.click();
      await page.waitForTimeout(500);
    }
    await page.waitForFunction(() => {
      const playback = document.getElementById("playbackScreen");
      return playback && playback.classList.contains("active");
    }, { timeout: 10000 });
  });

  test("equity button is visible during playback", async ({ page }) => {
    // Look for button with "Equity" text
    const buttons = await page.locator("button").allTextContents();
    const hasEquity = buttons.some(t => /equity/i.test(t));
    expect(hasEquity).toBe(true);
  });

  test("equity panel opens when button clicked", async ({ page }) => {
    // Find and click the equity button
    const equityBtn = page.locator("button", { hasText: /equity/i }).first();
    await equityBtn.click();
    await page.waitForTimeout(300);

    // Panel should be visible
    const panel = page.locator("#equityPanel");
    await expect(panel).toBeVisible();
  });

  test("equity panel renders with board/hero info", async ({ page }) => {
    const equityBtn = page.locator("button", { hasText: /equity/i }).first();
    await equityBtn.click();
    await page.waitForTimeout(500);

    // Panel should be visible
    const panel = page.locator("#equityPanel");
    await expect(panel).toBeVisible();

    // Panel should have some text content
    const text = await panel.textContent();
    expect(text.length).toBeGreaterThan(20);
  });

  test("equity engine modules loaded on window", async ({ page }) => {
    const loaded = await page.evaluate(() => {
      return {
        hasHE: typeof window.HandEvaluator !== "undefined",
        hasEE: typeof window.EquityEngine !== "undefined",
        hasEC: typeof window.EquityCalculator !== "undefined"
      };
    });
    expect(loaded.hasHE).toBe(true);
    expect(loaded.hasEE).toBe(true);
    expect(loaded.hasEC).toBe(true);
  });

  test("can calculate equity via JS API", async ({ page }) => {
    const result = await page.evaluate(async () => {
      return await window.EquityCalculator.calculate({
        heroCards: ["As", "Ah"],
        villainRanges: [[["Ks", "Kh"]]],
        board: ["Qd", "7c", "2h"]
      });
    });
    expect(result.equities).toBeDefined();
    expect(result.equities[0]).toBeGreaterThan(85);
    expect(result.equities[0]).toBeLessThan(100);
  });

  test("panel closes when X clicked", async ({ page }) => {
    const equityBtn = page.locator("button", { hasText: /equity/i }).first();
    await equityBtn.click();
    await page.waitForTimeout(300);

    // Find close button
    const closeBtn = page.locator("#equityPanel button", { hasText: /×|close/i }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(300);
      // Panel should be hidden or display:none
      const panelVisible = await page.locator("#equityPanel").isVisible();
      expect(panelVisible).toBe(false);
    }
  });
});
