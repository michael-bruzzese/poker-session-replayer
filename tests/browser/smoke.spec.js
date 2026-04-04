// Smoke test: upload gold session JSON → playback works → no crashes
// This test runs against the BUILT index.html to catch build divergence.

const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const INDEX_PATH = path.resolve(__dirname, "../../index.html");
const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/gold_session.json");

test.describe("Smoke Test — Gold Session Playback", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto(`file://${INDEX_PATH}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  });

  test("app loads without errors", async ({ page }) => {
    // Check no JS errors on load
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`file://${INDEX_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    // Upload zone should be visible
    const uploadZone = page.locator("#uploadZone");
    await expect(uploadZone).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test("upload gold session JSON and play through hands", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`file://${INDEX_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    // Upload the gold session fixture via file input
    const fileInput = page.locator("#fileInput");
    await fileInput.setInputFiles(FIXTURE_PATH);

    // Gold session goes through QA (may have warnings). Click Skip All if QA appears.
    await page.waitForTimeout(1000);
    const qaScreen = page.locator("#qaScreen");
    const qaVisible = await qaScreen.evaluate(el => el.classList.contains("active"));
    if (qaVisible) {
      // Click "Skip All & Load" to bypass QA
      const skipAllBtn = page.locator("#qaSkipAllBtn");
      if (await skipAllBtn.isVisible()) {
        await skipAllBtn.click();
        await page.waitForTimeout(500);
      }
      // Then click "Finish & Load Session" if it appears
      const finishBtn = page.locator("#qaFinishBtn");
      if (await finishBtn.isVisible()) {
        await finishBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Now check for review screen — click "Launch Coaching Playback" if visible
    const reviewScreen = page.locator("#reviewScreen");
    const reviewVisible = await reviewScreen.evaluate(el => el.classList.contains("active")).catch(() => false);
    if (reviewVisible) {
      const launchBtn = page.locator("#reviewLaunchBtn");
      if (await launchBtn.isVisible()) {
        await launchBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Wait for playback screen
    await page.waitForFunction(() => {
      const playback = document.getElementById("playbackScreen");
      return playback && playback.classList.contains("active");
    }, { timeout: 10000 });

    // Playback screen should be visible
    const playbackScreen = page.locator("#playbackScreen");
    await expect(playbackScreen).toBeVisible();

    // Table felt should be visible
    const tableFelt = page.locator("#tableFelt");
    await expect(tableFelt).toBeVisible();

    // Should show hand count
    const handProgress = page.locator("#handProgress");
    const text = await handProgress.textContent();
    expect(text).toContain("1");

    // Click Next to advance through a few steps
    const nextBtn = page.locator("#btnNextStep");
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    for (let i = 0; i < 5; i++) {
      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForTimeout(400);
      }
    }

    // Pot should have a value
    const potAmount = page.locator("#potAmount");
    const potText = await potAmount.textContent();
    expect(parseInt(potText)).toBeGreaterThan(0);

    // No JS errors during playback
    expect(errors).toHaveLength(0);
  });

  test("session auto-saves to library after loading", async ({ page }) => {
    await page.goto(`file://${INDEX_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    // Upload fixture
    const fileInput = page.locator("#fileInput");
    await fileInput.setInputFiles(FIXTURE_PATH);

    // Navigate through QA/review to playback
    await page.waitForTimeout(1000);
    const qaScreen = page.locator("#qaScreen");
    const qaVisible = await qaScreen.evaluate(el => el.classList.contains("active"));
    if (qaVisible) {
      const skipAllBtn = page.locator("#qaSkipAllBtn");
      if (await skipAllBtn.isVisible()) await skipAllBtn.click();
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

    // Check localStorage has a saved session
    const sessionCount = await page.evaluate(() => {
      const manifest = localStorage.getItem("sr_session_manifest");
      if (!manifest) return 0;
      return JSON.parse(manifest).length;
    });
    expect(sessionCount).toBeGreaterThanOrEqual(1);
  });
});
