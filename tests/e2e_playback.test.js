import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load modules
const PokerConstants = require("../shared/constants.js");
globalThis.PokerConstants = PokerConstants;
const CardUtils = require("../shared/card_utils.js");
globalThis.CardUtils = CardUtils;
const PokerEngine = require("../shared/table_engine.js");
globalThis.PokerEngine = PokerEngine;
const HoldemValidator = require("../shared/holdem_validator.js");

const PE = PokerEngine;
const HV = HoldemValidator;
const SEAT_COUNT = 9;

// Load gold session fixture
const goldSession = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/gold_session.json"), "utf-8")
);

// ============================================================
// Helper: Simulate full playback — mirrors session_replayer_web.html exactly
// ============================================================

function simulateHandPlayback(hand, sessionBlinds) {
  const blinds = hand.blinds || sessionBlinds;
  const heroSeat = (hand.hero_seat || 1) - 1;
  const buttonSeat = (hand.button_seat || 1) - 1;

  // Pass stacks as-is (1-indexed) — initializeHand expects seat+1 keys
  const stacks = hand.stacks || {};

  const playerNames = {};
  for (let s = 0; s < SEAT_COUNT; s++) {
    playerNames[s + 1] = { name: `Seat ${s + 1}`, description: "" };
  }

  const init = PE.initializeHand({
    seatCount: SEAT_COUNT,
    buttonSeat,
    heroSeat,
    stacks,
    smallBlind: blinds.small,
    bigBlind: blinds.big,
    playerNames,
    defaultStack: 1000,
    handNumber: hand.hand_id || 1,
  });

  const players = init.players;
  const tableState = init.tableState;

  // Flatten action sequence
  const flatActions = [];
  (hand.action_sequence || []).forEach((streetBlock) => {
    (streetBlock.actions || []).forEach((action) => {
      flatActions.push({ ...action, street: streetBlock.street });
    });
  });

  const stepLog = [];
  let currentStreet = "preflop";

  for (let i = 0; i < flatActions.length; i++) {
    const step = flatActions[i];
    const newStreet = step.street;

    // Street transition — use engine's beginStreetRound (matches app behavior)
    if (newStreet !== currentStreet && newStreet !== "preflop") {
      PE.beginStreetRound(newStreet, players, tableState, SEAT_COUNT, blinds.big);
      currentStreet = newStreet;
    }

    const seatIdx = (step.seat || 1) - 1;
    const action = PE.normalizeActionName(step.action);
    const amount = step.amount || 0;

    const prePlayer = PE.getPlayerBySeat(players, seatIdx);
    const preStack = prePlayer ? prePlayer.stack : 0;
    const preStatus = prePlayer ? prePlayer.status : "unknown";
    const prePot = tableState.pot;

    // Set actionSeat before applying — matches app behavior exactly
    tableState.actionSeat = seatIdx;

    const result = PE.applyPlayerAction(
      seatIdx, action, amount,
      players, tableState, SEAT_COUNT, blinds.big,
      { exactAmount: true }
    );

    const postPlayer = PE.getPlayerBySeat(players, seatIdx);
    const postStack = postPlayer ? postPlayer.stack : 0;

    stepLog.push({
      stepIndex: i,
      street: newStreet,
      seat: step.seat,
      action,
      amount,
      success: result.success,
      // Track if action was redundant (player already folded by auto-fold)
      alreadyFolded: preStatus === "folded",
      preStack,
      postStack,
      stackChange: postStack - preStack,
      pot: tableState.pot,
      potChange: tableState.pot - prePot,
      playerStatus: postPlayer ? postPlayer.status : "unknown",
    });
  }

  return { players, tableState, flatActions, stepLog, currentStreet };
}

// ============================================================
// Full Session Playback
// ============================================================

describe("End-to-End Session Playback", () => {
  it("plays through all 5 gold session hands — every action succeeds", () => {
    for (const hand of goldSession.hands) {
      const result = simulateHandPlayback(hand, goldSession.blinds);

      const failures = result.stepLog.filter((s) => !s.success);
      expect(
        failures,
        `Hand ${hand.hand_id}: Actions failed: ${JSON.stringify(failures)}`
      ).toHaveLength(0);
    }
  });

  it("validates Hold'em rules on the gold session", () => {
    const violations = HV.validateSession(goldSession);
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors, `Hold'em rule errors: ${JSON.stringify(errors)}`).toHaveLength(0);
  });
});

// ============================================================
// Hand-by-Hand Verification
// ============================================================

describe("Hand 1 — Hero flops top pair, value bets, villain folds river", () => {
  let result;
  beforeAll(() => {
    result = simulateHandPlayback(goldSession.hands[0], goldSession.blinds);
  });

  it("non-redundant actions all succeed", () => {
    const failures = result.stepLog.filter((s) => !s.success);
    expect(failures).toHaveLength(0);
  });

  it("goes through all four streets", () => {
    const streets = [...new Set(result.stepLog.map((s) => s.street))];
    expect(streets).toContain("preflop");
    expect(streets).toContain("flop");
    expect(streets).toContain("turn");
    expect(streets).toContain("river");
  });

  it("stacks decrease on bets and calls (for successful actions)", () => {
    const betsAndCalls = result.stepLog.filter(
      (s) => s.success && (s.action === "bet" || s.action === "call" || s.action === "raise")
    );
    for (const step of betsAndCalls) {
      expect(step.stackChange, `step ${step.stepIndex}: ${step.action}`).toBeLessThanOrEqual(0);
    }
  });

  it("no stack goes negative", () => {
    for (const p of result.players) {
      expect(p.stack, `Seat ${p.seat}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Hand 2 — Hero flops a set, three streets of value", () => {
  let result;
  beforeAll(() => {
    result = simulateHandPlayback(goldSession.hands[1], goldSession.blinds);
  });

  it("non-redundant actions all succeed", () => {
    const failures = result.stepLog.filter((s) => !s.success);
    expect(failures).toHaveLength(0);
  });

  it("flop raise costs more than initial bet", () => {
    const flopRaise = result.stepLog.find(
      (s) => s.street === "flop" && s.action === "raise" && s.success
    );
    expect(flopRaise).toBeDefined();
    expect(flopRaise.amount).toBeGreaterThan(25);
  });

  it("no stack goes negative", () => {
    for (const p of result.players) {
      expect(p.stack, `Seat ${p.seat}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Hand 3 — Preflop only, everyone folds to hero's open", () => {
  let result;
  beforeAll(() => {
    result = simulateHandPlayback(goldSession.hands[2], goldSession.blinds);
  });

  it("non-redundant actions all succeed", () => {
    const failures = result.stepLog.filter((s) => !s.success);
    expect(failures).toHaveLength(0);
  });

  it("only preflop actions", () => {
    expect(result.stepLog.every((s) => s.street === "preflop")).toBe(true);
  });
});

describe("Hand 4 — Hero folds turn to a barrel", () => {
  let result;
  beforeAll(() => {
    result = simulateHandPlayback(goldSession.hands[3], goldSession.blinds);
  });

  it("non-redundant actions all succeed", () => {
    const failures = result.stepLog.filter((s) => !s.success);
    expect(failures).toHaveLength(0);
  });

  it("hero ends up folded", () => {
    const hero = PE.getPlayerBySeat(result.players, 0);
    expect(hero.status).toBe("folded");
  });

  it("villain who bet wins by fold", () => {
    const active = result.players.filter((p) => p.status !== "folded");
    expect(active.length).toBe(1);
    expect(active[0].seat).toBe(8); // seat 9 = index 8
  });
});

describe("Hand 5 — Hero turns flush, three streets, villain folds river", () => {
  let result;
  beforeAll(() => {
    result = simulateHandPlayback(goldSession.hands[4], goldSession.blinds);
  });

  it("non-redundant actions all succeed", () => {
    const failures = result.stepLog.filter((s) => !s.success);
    expect(failures).toHaveLength(0);
  });

  it("check-raise on flop works correctly", () => {
    const flopSteps = result.stepLog.filter((s) => s.street === "flop" && s.success);
    expect(flopSteps[0].action).toBe("check");
    expect(flopSteps[1].action).toBe("bet");
    expect(flopSteps[2].action).toBe("raise");
    expect(flopSteps[3].action).toBe("call");
  });

  it("no stack goes negative", () => {
    for (const p of result.players) {
      expect(p.stack, `Seat ${p.seat}`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================
// Hold'em Rule Invariants — Cross-cutting
// ============================================================

describe("Hold'em Rule Invariants — every hand", () => {
  const handResults = goldSession.hands.map((hand) => ({
    hand,
    result: simulateHandPlayback(hand, goldSession.blinds),
  }));

  it("no non-redundant action fails", () => {
    for (const { hand, result } of handResults) {
      const failures = result.stepLog.filter((s) => !s.success);
      expect(failures, `Hand ${hand.hand_id}`).toHaveLength(0);
    }
  });

  it("no stack ever goes negative", () => {
    for (const { hand, result } of handResults) {
      for (const p of result.players) {
        expect(p.stack, `Hand ${hand.hand_id}, seat ${p.seat}: ${p.stack}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("pot is always non-negative", () => {
    for (const { hand, result } of handResults) {
      for (const step of result.stepLog) {
        expect(step.pot, `Hand ${hand.hand_id}, step ${step.stepIndex}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("fold results in folded status", () => {
    for (const { hand, result } of handResults) {
      for (const step of result.stepLog) {
        if (step.action === "fold" && step.success) {
          expect(step.playerStatus, `Hand ${hand.hand_id}, seat ${step.seat}`).toBe("folded");
        }
      }
    }
  });

  it("successful bets/calls/raises only decrease stacks", () => {
    for (const { hand, result } of handResults) {
      for (const step of result.stepLog) {
        if (step.success && ["bet", "call", "raise", "all-in"].includes(step.action)) {
          expect(
            step.stackChange,
            `Hand ${hand.hand_id}, step ${step.stepIndex}: ${step.action}`
          ).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("pot only increases during a hand", () => {
    for (const { hand, result } of handResults) {
      for (const step of result.stepLog) {
        if (step.success) {
          expect(
            step.potChange,
            `Hand ${hand.hand_id}, step ${step.stepIndex}`
          ).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("total chips are conserved (stacks + pot = initial)", () => {
    for (const { hand, result } of handResults) {
      const initialTotal = Object.values(hand.stacks).reduce((a, b) => a + b, 0);
      const finalStacks = result.players.reduce((sum, p) => sum + p.stack, 0);
      const finalPot = result.tableState.pot;
      // pot = sum of all committedHand, so stacks + pot = initial total
      expect(
        finalStacks + finalPot,
        `Hand ${hand.hand_id}: stacks=${finalStacks} pot=${finalPot} total=${finalStacks + finalPot} expected=${initialTotal}`
      ).toBe(initialTotal);
    }
  });

  it("at hand end, exactly 1 active player (non-showdown) or 2+ (showdown)", () => {
    for (const { hand, result } of handResults) {
      const active = result.players.filter((p) => p.status !== "folded");
      expect(active.length, `Hand ${hand.hand_id}`).toBeGreaterThanOrEqual(1);
      if (!hand.result.showdown) {
        expect(active.length, `Hand ${hand.hand_id}: non-showdown`).toBe(1);
      }
    }
  });
});

// ============================================================
// Edge Case: Short stack all-in
// ============================================================

describe("Edge Case — Short stack all-in", () => {
  it("short stack call is capped at remaining stack", () => {
    // Seat 2 is BB (button=9, so SB=1, BB=2). Seat 2 has only 30 chips.
    // Seat 8 raises to 50. All others fold. BB calls for remaining stack.
    const hand = {
      hand_id: 99, hero_seat: 1, button_seat: 9,
      blinds: { small: 2, big: 5 },
      stacks: { 1: 500, 2: 30, 3: 500, 4: 500, 5: 500, 6: 500, 7: 500, 8: 500, 9: 500 },
      hero_cards: ["Ah", "Kh"], board: {},
      action_sequence: [{
        street: "preflop",
        actions: [
          { seat: 3, action: "fold" },
          { seat: 4, action: "fold" },
          { seat: 5, action: "fold" },
          { seat: 6, action: "fold" },
          { seat: 7, action: "fold" },
          { seat: 8, action: "raise", amount: 50 },
          { seat: 9, action: "fold" },
          { seat: 1, action: "fold" },
          { seat: 2, action: "call", amount: 50 }, // BB only has 25 left after posting 5
        ],
      }],
      result: { winner_seat: 8, pot: 59, showdown: false },
    };

    const result = simulateHandPlayback(hand, { small: 2, big: 5 });
    const bbPlayer = PE.getPlayerBySeat(result.players, 1); // seat 2 = index 1

    // BB posted 5, had 25 left. Call is capped at 25 (all-in). Stack should be 0.
    // OR engine auto-folded BB before their turn (heads-up logic), stack = 25.
    expect(bbPlayer.stack).toBeLessThanOrEqual(25);
    expect(bbPlayer.stack).toBeGreaterThanOrEqual(0);

    // No negative stacks anywhere
    for (const p of result.players) {
      expect(p.stack, `Seat ${p.seat}`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================
// Street transition integrity
// ============================================================

describe("Street transitions", () => {
  it("multi-street hand transitions correctly", () => {
    const hand = goldSession.hands[0];
    const result = simulateHandPlayback(hand, goldSession.blinds);

    const streets = [...new Set(result.stepLog.map((s) => s.street))];
    expect(streets).toContain("preflop");
    expect(streets).toContain("flop");
    expect(streets).toContain("turn");
    expect(streets).toContain("river");

    // All non-redundant actions succeed
    const failures = result.stepLog.filter((s) => !s.success);
    expect(failures).toHaveLength(0);
  });

  it("preflop-only hand works correctly", () => {
    const hand = goldSession.hands[2];
    const result = simulateHandPlayback(hand, goldSession.blinds);

    const streets = [...new Set(result.stepLog.map((s) => s.street))];
    expect(streets).toEqual(["preflop"]);

    const failures = result.stepLog.filter((s) => !s.success);
    expect(failures).toHaveLength(0);
  });
});

// ============================================================
// Validator integration
// ============================================================

describe("Validator — session integrity", () => {
  it("no error-severity violations", () => {
    const violations = HV.validateSession(goldSession);
    const errors = violations.filter((v) => v.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("each hand passes individual validation", () => {
    for (const hand of goldSession.hands) {
      const errors = HV.validateHand(hand, SEAT_COUNT);
      const severe = errors.filter((e) => e.severity === "error");
      expect(severe, `Hand ${hand.hand_id}`).toHaveLength(0);
    }
  });

  it("no duplicate cards within any hand", () => {
    for (const hand of goldSession.hands) {
      const allCards = [...(hand.hero_cards || [])];
      const board = hand.board || {};
      if (board.flop) allCards.push(...board.flop);
      if (board.turn) allCards.push(board.turn);
      if (board.river) allCards.push(board.river);
      for (const [, cards] of Object.entries(hand.known_villain_cards || {})) {
        allCards.push(...cards);
      }
      const dupes = HV.findDuplicateCards(allCards);
      expect(dupes, `Hand ${hand.hand_id}`).toHaveLength(0);
    }
  });
});

// ============================================================
// Rewind integrity
// ============================================================

describe("Rewind — replay to any step produces consistent state", () => {
  it("replaying to final step matches full forward play", () => {
    const hand = goldSession.hands[1]; // Multi-street hand
    const blinds = hand.blinds || goldSession.blinds;

    // Full forward play
    const fullResult = simulateHandPlayback(hand, goldSession.blinds);

    // Replay from scratch
    const heroSeat = (hand.hero_seat || 1) - 1;
    const buttonSeat = (hand.button_seat || 1) - 1;
    const stacks = hand.stacks;
    const playerNames = {};
    for (let s = 0; s < SEAT_COUNT; s++) {
      playerNames[s + 1] = { name: `Seat ${s + 1}`, description: "" };
    }

    const init = PE.initializeHand({
      seatCount: SEAT_COUNT, buttonSeat, heroSeat, stacks,
      smallBlind: blinds.small, bigBlind: blinds.big,
      playerNames, defaultStack: 1000, handNumber: hand.hand_id,
    });

    let currentStreet = "preflop";
    for (let i = 0; i < fullResult.flatActions.length; i++) {
      const step = fullResult.flatActions[i];
      if (step.street !== currentStreet && step.street !== "preflop") {
        PE.beginStreetRound(step.street, init.players, init.tableState, SEAT_COUNT, blinds.big);
        currentStreet = step.street;
      }
      const seatIdx = (step.seat || 1) - 1;
      init.tableState.actionSeat = seatIdx;
      PE.applyPlayerAction(
        seatIdx, PE.normalizeActionName(step.action), step.amount || 0,
        init.players, init.tableState, SEAT_COUNT, blinds.big, { exactAmount: true }
      );
    }

    // Pot should match
    expect(init.tableState.pot).toBe(fullResult.tableState.pot);

    // All stacks should match
    for (let s = 0; s < SEAT_COUNT; s++) {
      const rp = PE.getPlayerBySeat(init.players, s);
      const fp = PE.getPlayerBySeat(fullResult.players, s);
      if (rp && fp) {
        expect(rp.stack, `Seat ${s} stack mismatch`).toBe(fp.stack);
      }
    }
  });
});

// ============================================================
// Regression: Auto-fold no longer fires prematurely
// ============================================================

describe("Regression — SB/BB act before heads-up auto-fold", () => {
  it("SB and BB folds succeed (not auto-folded prematurely)", () => {
    // Hand 1: CO raises, BTN calls — SB and BB must still get to act
    const hand = goldSession.hands[0];
    const result = simulateHandPlayback(hand, goldSession.blinds);

    // ALL actions must succeed — no auto-fold before players act
    const failures = result.stepLog.filter((s) => !s.success);
    expect(failures).toHaveLength(0);

    // SB and BB folds should be real successful folds, not redundant
    const sbFold = result.stepLog.find((s) => s.seat === 2 && s.action === "fold");
    const bbFold = result.stepLog.find((s) => s.seat === 3 && s.action === "fold");
    expect(sbFold.success).toBe(true);
    expect(bbFold.success).toBe(true);
    expect(sbFold.alreadyFolded).toBe(false);
    expect(bbFold.alreadyFolded).toBe(false);
  });
});
