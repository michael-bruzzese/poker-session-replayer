import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PokerStarsExporter = require("../shared/pokerstars_exporter.js");
const PSE = PokerStarsExporter;

const goldSession = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/gold_session.json"), "utf-8")
);

describe("PokerStars Exporter — Formatting Helpers", () => {
  it("formats cards unchanged (our format matches PokerStars)", () => {
    expect(PSE.formatCard("Ah")).toBe("Ah");
    expect(PSE.formatCard("Ts")).toBe("Ts");
    expect(PSE.formatCard("2c")).toBe("2c");
  });

  it("formats money with dollar sign", () => {
    expect(PSE.formatMoney(15)).toBe("$15");
    expect(PSE.formatMoney(1000)).toBe("$1000");
    expect(PSE.formatMoney(0)).toBe("$0");
  });

  it("formats date in PokerStars format (YYYY/MM/DD HH:MM:SS ET)", () => {
    const date = PSE.formatDate(0);
    expect(date).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} ET$/);
  });
});

describe("PokerStars Exporter — Session Export", () => {
  it("exports a session with all hands", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toBeTruthy();
    expect(output.length).toBeGreaterThan(500);
  });

  it("output contains PokerStars header per hand", () => {
    const output = PSE.exportSession(goldSession);
    const handHeaders = output.match(/PokerStars Hand #\d+/g);
    expect(handHeaders).not.toBeNull();
    expect(handHeaders.length).toBe(goldSession.hands.length);
  });

  it("output contains stakes and game type", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toContain("Hold'em No Limit");
    expect(output).toContain("$2/$5 USD");
  });

  it("output shows button seat", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/Seat #\d is the button/);
  });

  it("output lists all seated players", () => {
    const output = PSE.exportSession(goldSession);
    // Gold session has 9 seats
    expect(output).toMatch(/Seat 1: .+\(\$500 in chips\)/);
  });

  it("posts blinds", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/posts small blind \$2/);
    expect(output).toMatch(/posts big blind \$5/);
  });

  it("shows HOLE CARDS section with hero's cards", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toContain("*** HOLE CARDS ***");
    expect(output).toMatch(/Dealt to \w+ \[\w\w \w\w\]/);
  });

  it("shows FLOP, TURN, RIVER sections", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toContain("*** FLOP ***");
    expect(output).toContain("*** TURN ***");
    expect(output).toContain("*** RIVER ***");
  });

  it("shows SUMMARY section per hand", () => {
    const output = PSE.exportSession(goldSession);
    const summaries = output.match(/\*\*\* SUMMARY \*\*\*/g);
    expect(summaries).not.toBeNull();
    expect(summaries.length).toBe(goldSession.hands.length);
  });

  it("shows total pot in summary", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/Total pot \$\d+/);
  });

  it("shows board in summary when board exists", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/Board \[.+\]/);
  });

  it("shows winner collecting pot", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/collected \(\$\d+\)/);
  });

  it("formats fold actions", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/\w+: folds/);
  });

  it("formats bet actions", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/\w+: bets \$\d+/);
  });

  it("formats raise actions with 'to' amount", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/\w+: raises \$\d+ to \$\d+/);
  });

  it("formats call actions", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/\w+: calls \$\d+/);
  });

  it("formats check actions", () => {
    const output = PSE.exportSession(goldSession);
    expect(output).toMatch(/\w+: checks/);
  });

  it("separates hands with blank lines", () => {
    const output = PSE.exportSession(goldSession);
    // PokerStars separates hands with double newlines
    expect(output).toMatch(/\n\n\n/);
  });

  it("returns empty string for empty session", () => {
    expect(PSE.exportSession(null)).toBe("");
    expect(PSE.exportSession({})).toBe("");
    expect(PSE.exportSession({ hands: [] })).toBe("");
  });
});

describe("PokerStars Exporter — Format Validation", () => {
  it("each hand line ends with valid characters (no stray content)", () => {
    const output = PSE.exportSession(goldSession);
    const lines = output.split("\n").filter(l => l.trim());
    // Every non-empty line should not have trailing control chars
    for (const line of lines) {
      expect(line).not.toMatch(/[\x00-\x08\x0E-\x1F]/);
    }
  });

  it("player names don't contain spaces (would break HM/PT parsing)", () => {
    const output = PSE.exportSession(goldSession);
    // "Seat 1: Name ($500 in chips)" — name must be a single token
    const seatLines = output.match(/Seat \d+: (\S+) \(\$\d+ in chips\)/g);
    expect(seatLines).not.toBeNull();
    for (const line of seatLines) {
      const name = line.match(/Seat \d+: (\S+) \(/)[1];
      expect(name).not.toContain(" ");
    }
  });
});
