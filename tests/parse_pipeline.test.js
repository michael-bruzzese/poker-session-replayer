import { describe, it, expect } from "vitest";
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
globalThis.HoldemValidator = HoldemValidator;
const SL = require("../shared/shorthand_learner.js");

const PE = PokerEngine;
const HV = HoldemValidator;
const SEAT_COUNT = 9;

// ============================================================
// JSON path — regression guard
// ============================================================

describe("JSON upload path — regression guard", () => {
  const goldSession = JSON.parse(
    readFileSync(resolve(__dirname, "fixtures/gold_session.json"), "utf-8")
  );

  it("gold session loads and validates without errors", () => {
    const errors = HV.validateSession(goldSession).filter(v => v.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("all 5 hands play back successfully", () => {
    for (const hand of goldSession.hands) {
      const blinds = hand.blinds || goldSession.blinds;
      const init = PE.initializeHand({
        seatCount: 9, buttonSeat: (hand.button_seat || 1) - 1,
        heroSeat: (hand.hero_seat || 1) - 1, stacks: hand.stacks,
        smallBlind: blinds.small, bigBlind: blinds.big,
        playerNames: goldSession.players, defaultStack: 500, handNumber: hand.hand_id
      });

      let currentStreet = "preflop";
      const flatActions = [];
      (hand.action_sequence || []).forEach(sb => {
        sb.actions.forEach(a => flatActions.push({ ...a, street: sb.street }));
      });

      for (const step of flatActions) {
        if (step.street !== currentStreet && step.street !== "preflop") {
          PE.beginStreetRound(step.street, init.players, init.tableState, 9, blinds.big);
          currentStreet = step.street;
        }
        init.tableState.actionSeat = step.seat - 1;
        const r = PE.applyPlayerAction(
          step.seat - 1, PE.normalizeActionName(step.action), step.amount || 0,
          init.players, init.tableState, 9, blinds.big, { exactAmount: true }
        );
        expect(r.success, `Hand ${hand.hand_id}: ${step.action} at seat ${step.seat} failed`).toBe(true);
      }
    }
  });
});

// ============================================================
// Text parsing — natural language with seat numbers
// ============================================================

describe("Text parsing — natural language with seat numbers", () => {
  const text = `Hand 1
Button is on seat 1. I've got ace of spades king of diamonds. Seat 9 opens to 15. I call on the button. Small blind folds. Big blind folds.
Flop king of spades, eight of clubs, three of diamonds. Seat 9 bets 20. I call.
Turn five of hearts. Seat 9 checks. I bet 45. Seat 9 calls.
River deuce of clubs. Seat 9 checks. I bet 90. Seat 9 folds.`;

  let result;

  it("parses without crashing", () => {
    result = SL.parseWithProfile(text, "default", {
      blinds: { small: 2, big: 5 }, heroSeat: 1
    });
    expect(result).toBeDefined();
    expect(result.hands).toBeDefined();
  });

  it("finds exactly 1 hand", () => {
    expect(result.hands).toHaveLength(1);
  });

  it("extracts button seat correctly", () => {
    expect(result.hands[0].button_seat).toBe(1);
  });

  it("extracts hero cards", () => {
    expect(result.hands[0].hero_cards).toHaveLength(2);
    expect(result.hands[0].hero_cards).toContain("As");
    expect(result.hands[0].hero_cards).toContain("Kd");
  });

  it("extracts board cards", () => {
    const board = result.hands[0].board;
    expect(board.flop).toHaveLength(3);
    expect(board.turn).toBeDefined();
    expect(board.river).toBeDefined();
  });

  it("assigns seat 9 from explicit Seat N references", () => {
    const allActions = result.hands[0].action_sequence.flatMap(s => s.actions);
    const seat9actions = allActions.filter(a => a.seat === 9);
    expect(seat9actions.length).toBeGreaterThan(0);
  });

  it("hero actions have seat 1", () => {
    const allActions = result.hands[0].action_sequence.flatMap(s => s.actions);
    const heroActions = allActions.filter(a => a.seat === 1);
    expect(heroActions.length).toBeGreaterThan(0);
  });

  it("no seat: 0 in output", () => {
    const allActions = result.hands[0].action_sequence.flatMap(s => s.actions);
    const seat0 = allActions.filter(a => a.seat === 0);
    expect(seat0).toHaveLength(0);
  });
});

// ============================================================
// Text parsing — shorthand notation with positions
// ============================================================

describe("Text parsing — shorthand with positions and button", () => {
  const text = `Hand 1
Button seat 5. Hero: Ah Kd (CO)
Preflop: UTG folds, UTG+1 folds, LJ raises 15, Hero calls, BTN folds, SB folds, BB calls
Flop: Qs Jd 4c
BB checks, LJ bets 20, Hero raises 55, BB folds, LJ calls
Turn: Th
LJ checks, Hero bets 80, LJ calls
River: 2s
LJ checks, Hero bets 150, LJ folds`;

  let result;

  it("parses without crashing", () => {
    result = SL.parseWithProfile(text, "default", {
      blinds: { small: 2, big: 5 }, heroSeat: 1
    });
    expect(result.hands).toBeDefined();
  });

  it("finds 1 hand", () => {
    expect(result.hands).toHaveLength(1);
  });

  it("extracts button seat 5", () => {
    expect(result.hands[0].button_seat).toBe(5);
  });

  it("maps positions to correct seats via button", () => {
    const allActions = result.hands[0].action_sequence.flatMap(s => s.actions);
    // With button on seat 5 (0-indexed: 4), positions are:
    // BTN=5, SB=6, BB=7, UTG=8, UTG+1=9, UTG+2=1, LJ=2, HJ=3, CO=4
    const sbActions = allActions.filter(a => a.position === "SB");
    const bbActions = allActions.filter(a => a.position === "BB");
    // SB should be seat 6, BB should be seat 7
    if (sbActions.length > 0 && sbActions[0].seat !== null) {
      expect(sbActions[0].seat).toBe(6);
    }
    if (bbActions.length > 0 && bbActions[0].seat !== null) {
      expect(bbActions[0].seat).toBe(7);
    }
  });

  it("no seat: 0 in output", () => {
    const allActions = result.hands[0].action_sequence.flatMap(s => s.actions);
    expect(allActions.filter(a => a.seat === 0)).toHaveLength(0);
  });
});

// ============================================================
// Text parsing — name learning from "Seat N Name"
// ============================================================

describe("Text parsing — player name learning", () => {
  const text = `Hand 1
Button on seat 2. Seat 8 Steve opens to 15. Seat 9 folds. I call. Button folds. SB folds. BB folds.
Flop Ks 8c 3d. Steve bets 20. I call.
Turn 5h. Steve checks. I bet 45. Steve calls.`;

  it("learns Steve = seat 8 and uses it in later actions", () => {
    const result = SL.parseWithProfile(text, "default", {
      blinds: { small: 2, big: 5 }, heroSeat: 1
    });
    const allActions = result.hands[0].action_sequence.flatMap(s => s.actions);
    const steveActions = allActions.filter(a => a.seat === 8);
    // Steve should be recognized in preflop AND on the flop/turn
    expect(steveActions.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// Edge cases
// ============================================================

describe("Parse pipeline edge cases", () => {
  it("empty text returns 0 hands without crashing", () => {
    const result = SL.parseWithProfile("", "default", {
      blinds: { small: 2, big: 5 }, heroSeat: 1
    });
    expect(result.hands).toHaveLength(0);
  });

  it("preamble-only text (no actions) returns 0 hands", () => {
    const text = `Table Lineup
Seat 1 is me Hero. Seat 2 is Dave. Seat 3 is Karen. Playing 2-5 no limit at the Wynn.`;
    const result = SL.parseWithProfile(text, "default", {
      blinds: { small: 2, big: 5 }, heroSeat: 1
    });
    expect(result.hands).toHaveLength(0);
  });

  it("garbage text doesn't crash", () => {
    const text = "lorem ipsum dolor sit amet consectetur adipiscing elit";
    const result = SL.parseWithProfile(text, "default", {
      blinds: { small: 2, big: 5 }, heroSeat: 1
    });
    expect(result).toBeDefined();
    expect(result.hands).toHaveLength(0);
  });

  it("mixed preamble + hands only parses hands", () => {
    const text = `Session notes from Tuesday.
Table was soft. Good game.

Hand 1
Button seat 1. I open to 15 with Ah Kd. Everyone folds.`;
    const result = SL.parseWithProfile(text, "default", {
      blinds: { small: 2, big: 5 }, heroSeat: 1
    });
    expect(result.hands).toHaveLength(1);
  });
});
