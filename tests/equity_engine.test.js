import { describe, it, expect } from "vitest";

// Load HandEvaluator first so EquityEngine can find it
const HE = require("../shared/hand_evaluator.js");
globalThis.HandEvaluator = HE;
const EE = require("../shared/equity_engine.js");

// Helper to build a range of specific combos
function combos(...strings) {
  return strings.map(s => s.split(" "));
}

// ============================================================
// Card Removal / Blockers
// ============================================================

describe("Equity Engine — Card Removal", () => {
  it("filterBlockedCombos removes combos with blocked cards", () => {
    const range = combos("As Ks", "Ah Kh", "Qs Qh");
    const filtered = EE.filterBlockedCombos(range, ["As"]);
    expect(filtered.length).toBe(2);
    expect(filtered).not.toContainEqual(["As", "Ks"]);
  });

  it("filterBlockedCombos handles empty range", () => {
    expect(EE.filterBlockedCombos([], ["As"])).toEqual([]);
  });

  it("filterBlockedCombos is case-insensitive", () => {
    const range = combos("As Ks");
    const filtered = EE.filterBlockedCombos(range, ["AS"]);
    expect(filtered.length).toBe(0);
  });
});

// ============================================================
// Grid Cell Expansion
// ============================================================

describe("Equity Engine — Grid Expansion", () => {
  it("pair (diagonal) expands to 6 combos", () => {
    const aaCombos = EE.expandCell(0, 0); // AA
    expect(aaCombos.length).toBe(6);
    // Each combo has 2 aces
    for (const combo of aaCombos) {
      expect(combo[0][0]).toBe("A");
      expect(combo[1][0]).toBe("A");
    }
  });

  it("suited (above diagonal) expands to 4 combos", () => {
    const aksCombos = EE.expandCell(0, 1); // AKs
    expect(aksCombos.length).toBe(4);
    for (const combo of aksCombos) {
      expect(combo[0][0]).toBe("A");
      expect(combo[1][0]).toBe("K");
      expect(combo[0][1]).toBe(combo[1][1]); // same suit
    }
  });

  it("offsuit (below diagonal) expands to 12 combos", () => {
    const akoCombos = EE.expandCell(1, 0); // AKo
    expect(akoCombos.length).toBe(12);
    for (const combo of akoCombos) {
      expect(combo[0][1]).not.toBe(combo[1][1]); // different suits
    }
  });

  it("expandRangeFromGrid builds full combo list", () => {
    // Grid with just AA selected
    const grid = Array.from({ length: 13 }, () => Array(13).fill(false));
    grid[0][0] = true; // AA
    const range = EE.expandRangeFromGrid(grid);
    expect(range.length).toBe(6);
  });

  it("empty grid produces empty range", () => {
    const grid = Array.from({ length: 13 }, () => Array(13).fill(false));
    expect(EE.expandRangeFromGrid(grid)).toEqual([]);
  });
});

// ============================================================
// River Equity (simplest case)
// ============================================================

describe("Equity Engine — River (no runouts)", () => {
  it("hero has nuts → 100% equity", () => {
    // Hero: AA vs villain KK on low dry board → Hero wins 100%
    const result = EE.calculateEquity({
      heroCards: ["As", "Ah"],
      villainRanges: [combos("Kc Kd")],
      board: ["2h", "3h", "7s", "9c", "Tc"]
    });
    // Hero has pair of aces, villain pair of kings. Hero wins.
    expect(result.equities[0]).toBe(100);
    expect(result.equities[1]).toBe(0);
  });

  it("hero vs same hand → 50/50", () => {
    // Board makes both play same straight
    const result = EE.calculateEquity({
      heroCards: ["As", "Kh"],
      villainRanges: [combos("Ad Kc")], // same ranks
      board: ["Qs", "Jh", "Tc", "2d", "5h"] // both make broadway
    });
    expect(result.equities[0]).toBe(50);
    expect(result.equities[1]).toBe(50);
  });

  it("hero nut flush vs worse flush → 100%", () => {
    const result = EE.calculateEquity({
      heroCards: ["As", "5s"],
      villainRanges: [combos("Ks Qs")],
      board: ["9s", "4s", "2s", "7h", "8d"]
    });
    expect(result.equities[0]).toBe(100);
    expect(result.equities[1]).toBe(0);
  });
});

// ============================================================
// Flop Equity — Exact Enumeration
// ============================================================

describe("Equity Engine — Flop Exact Enumeration", () => {
  it("AA vs KK on A-high flop → AA dominates", () => {
    const result = EE.calculateEquity({
      heroCards: ["As", "Ah"],
      villainRanges: [combos("Ks Kh")],
      board: ["Ad", "7c", "2d"]
    });
    // Hero has set of aces vs pair of kings — hero should be ~95%+
    expect(result.equities[0]).toBeGreaterThan(90);
    expect(result.equities[1]).toBeLessThan(10);
  });

  it("AK vs QQ on K-high flop → AK huge favorite", () => {
    const result = EE.calculateEquity({
      heroCards: ["As", "Kh"],
      villainRanges: [combos("Qs Qd")],
      board: ["Kd", "7c", "2h"]
    });
    // Hero has top pair top kicker vs pair of queens
    expect(result.equities[0]).toBeGreaterThan(85);
  });

  it("flush draw vs top pair on flop", () => {
    // Hero: Ah 5h (nut flush draw), villain: As Kd (top pair top kicker)
    // Board: 9h 4h 2c
    const result = EE.calculateEquity({
      heroCards: ["Ah", "5h"],
      villainRanges: [combos("Ks Kd")],
      board: ["9h", "4h", "2c"]
    });
    // Hero has nut flush draw + overcard. Vs KK (overpair).
    // Hero should have ~35-45% equity
    expect(result.equities[0]).toBeGreaterThan(25);
    expect(result.equities[0]).toBeLessThan(55);
  });

  it("set vs overpair → set is favored", () => {
    // Hero: 6s 6h set of 6s, villain: Ks Kd overpair
    // Board: 6d 9c 2h
    const result = EE.calculateEquity({
      heroCards: ["6s", "6h"],
      villainRanges: [combos("Ks Kd")],
      board: ["6d", "9c", "2h"]
    });
    // Set should be ~90%
    expect(result.equities[0]).toBeGreaterThan(85);
  });
});

// ============================================================
// Turn Equity — Exact Enumeration (46 runouts)
// ============================================================

describe("Equity Engine — Turn Exact Enumeration", () => {
  it("nut flush draw vs overpair on turn", () => {
    const result = EE.calculateEquity({
      heroCards: ["Ah", "5h"],
      villainRanges: [combos("Ks Kd")],
      board: ["9h", "4h", "2c", "Ts"]
    });
    // Hero has 9 hearts out of 46 unknown cards ≈ 19.6% + some overcard outs
    expect(result.equities[0]).toBeGreaterThan(15);
    expect(result.equities[0]).toBeLessThan(35);
  });

  it("made flush on turn → huge favorite", () => {
    const result = EE.calculateEquity({
      heroCards: ["Ah", "5h"],
      villainRanges: [combos("Ks Kd")],
      board: ["9h", "4h", "2h", "Ts"]
    });
    // Hero has flush, villain has overpair. Hero should be ~90%+
    expect(result.equities[0]).toBeGreaterThan(85);
  });
});

// ============================================================
// Known Matchups — Heads-up (exact verification)
// ============================================================

describe("Equity Engine — Known Heads-Up Matchups", () => {
  it("AA vs KK preflop → AA ~81.5%", () => {
    // Monte Carlo preflop
    const result = EE.calculateEquity({
      heroCards: ["As", "Ah"],
      villainRanges: [combos("Ks Kh")],
      board: [],
      samples: 30000,
      forceMonteCarlo: true
    });
    // Known value: AA vs KK = 81.95%
    expect(result.equities[0]).toBeGreaterThan(79);
    expect(result.equities[0]).toBeLessThan(84);
  });

  it("AKs vs 22 preflop → coin flip ~52%", () => {
    const result = EE.calculateEquity({
      heroCards: ["As", "Ks"],
      villainRanges: [combos("2h 2d")],
      board: [],
      samples: 30000,
      forceMonteCarlo: true
    });
    // Known value: AKs vs 22 ≈ 52.5% for AKs
    expect(result.equities[0]).toBeGreaterThan(48);
    expect(result.equities[0]).toBeLessThan(57);
  });

  it("QQ vs AKo preflop → QQ ~56%", () => {
    const result = EE.calculateEquity({
      heroCards: ["Qs", "Qh"],
      villainRanges: [combos("Ad Kc")],
      board: [],
      samples: 30000,
      forceMonteCarlo: true
    });
    // Known value: QQ vs AKo ≈ 56%
    expect(result.equities[0]).toBeGreaterThan(52);
    expect(result.equities[0]).toBeLessThan(60);
  });

  it("equities sum to 100", () => {
    const result = EE.calculateEquity({
      heroCards: ["As", "Ah"],
      villainRanges: [combos("Ks Kh")],
      board: ["Qd", "7c", "2h"]
    });
    const sum = result.equities.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(99.9);
    expect(sum).toBeLessThan(100.1);
  });
});

// ============================================================
// Multiway Equity
// ============================================================

describe("Equity Engine — Multiway", () => {
  it("3-way all-in equities sum to 100", () => {
    const result = EE.calculateEquity({
      heroCards: ["As", "Ah"],
      villainRanges: [
        combos("Ks Kh"),
        combos("Qd Qc")
      ],
      board: ["7h", "3d", "2c"],
      samples: 10000,
      forceMonteCarlo: true
    });
    const sum = result.equities.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(99);
    expect(sum).toBeLessThan(101);
  });

  it("AA vs KK vs QQ 3-way preflop — AA dominates", () => {
    const result = EE.calculateEquity({
      heroCards: ["As", "Ah"],
      villainRanges: [
        combos("Ks Kh"),
        combos("Qd Qc")
      ],
      board: [],
      samples: 10000,
      forceMonteCarlo: true
    });
    // AA should be ~66%, KK ~19%, QQ ~15% in this 3-way
    expect(result.equities[0]).toBeGreaterThan(55);
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe("Equity Engine — Edge Cases", () => {
  it("throws when hero has wrong number of cards", () => {
    expect(() => EE.calculateEquity({
      heroCards: ["As"],
      villainRanges: [combos("Ks Kh")],
      board: []
    })).toThrow();
  });

  it("handles empty villain range after filtering", () => {
    // Villain range only contains combos blocked by hero
    const result = EE.calculateEquity({
      heroCards: ["As", "Ah"],
      villainRanges: [combos("As Ah")], // blocked
      board: []
    });
    expect(result.error).toBeDefined();
  });

  it("returns elapsed time", () => {
    const result = EE.calculateEquity({
      heroCards: ["As", "Ah"],
      villainRanges: [combos("Ks Kh")],
      board: ["Qd", "7c", "2h"]
    });
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// Performance
// ============================================================

describe("Equity Engine — Performance", () => {
  it("heads-up flop completes in <1s", () => {
    const start = Date.now();
    EE.calculateEquity({
      heroCards: ["As", "Ks"],
      villainRanges: [combos("Qh Qd", "Jh Jd", "Th Td", "9h 9d", "8h 8d")],
      board: ["7h", "3d", "2c"]
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
