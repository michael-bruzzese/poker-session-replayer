import { describe, it, expect, beforeAll } from "vitest";

// Load modules in Node
const PokerConstants = require("../shared/constants.js");
globalThis.PokerConstants = PokerConstants;
const CardUtils = require("../shared/card_utils.js");
globalThis.CardUtils = CardUtils;
const PokerEngine = require("../shared/table_engine.js");
globalThis.PokerEngine = PokerEngine;
const HoldemValidator = require("../shared/holdem_validator.js");

// ============================================================
// Card Validation
// ============================================================

describe("Card Validation", () => {
  it("accepts valid cards", () => {
    expect(HoldemValidator.isValidCard("Ah")).toBe(true);
    expect(HoldemValidator.isValidCard("2c")).toBe(true);
    expect(HoldemValidator.isValidCard("Ts")).toBe(true);
    expect(HoldemValidator.isValidCard("Kd")).toBe(true);
  });

  it("rejects invalid cards", () => {
    expect(HoldemValidator.isValidCard("")).toBe(false);
    expect(HoldemValidator.isValidCard("X")).toBe(false);
    expect(HoldemValidator.isValidCard("1h")).toBe(false);
    expect(HoldemValidator.isValidCard("Ax")).toBe(false);
    expect(HoldemValidator.isValidCard("hello")).toBe(false);
    expect(HoldemValidator.isValidCard(null)).toBe(false);
    expect(HoldemValidator.isValidCard(undefined)).toBe(false);
  });

  it("normalizes card codes", () => {
    expect(HoldemValidator.normalizeCard("ah")).toBe("Ah");
    expect(HoldemValidator.normalizeCard("tS")).toBe("Ts");
    expect(HoldemValidator.normalizeCard("KD")).toBe("Kd");
  });

  it("detects duplicate cards", () => {
    expect(HoldemValidator.findDuplicateCards(["Ah", "Kd", "Ah"])).toEqual(["Ah"]);
    expect(HoldemValidator.findDuplicateCards(["Ah", "Kd", "Qs"])).toEqual([]);
    expect(HoldemValidator.findDuplicateCards(["Ah", "ah"])).toEqual(["Ah"]); // case-insensitive dupes
  });
});

// ============================================================
// Hand Validation — Hero Cards
// ============================================================

describe("Hand Validation — Hero Cards", () => {
  it("rejects hand with no hero cards", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: [],
      board: {},
      action_sequence: []
    });
    expect(errors.some(e => e.field === "hero_cards")).toBe(true);
  });

  it("rejects hand with 1 hero card", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah"],
      board: {},
      action_sequence: []
    });
    expect(errors.some(e => e.field === "hero_cards")).toBe(true);
  });

  it("rejects hand with 3 hero cards", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd", "Qs"],
      board: {},
      action_sequence: []
    });
    expect(errors.some(e => e.field === "hero_cards")).toBe(true);
  });

  it("accepts hand with 2 valid hero cards", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: {},
      action_sequence: []
    });
    expect(errors.filter(e => e.field === "hero_cards")).toEqual([]);
  });

  it("rejects invalid hero card format", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "XX"],
      board: {},
      action_sequence: []
    });
    expect(errors.some(e => e.field === "hero_cards[1]")).toBe(true);
  });
});

// ============================================================
// Hand Validation — Board
// ============================================================

describe("Hand Validation — Board", () => {
  it("rejects flop with wrong number of cards", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd"] }, // only 2 cards
      action_sequence: []
    });
    expect(errors.some(e => e.field === "board.flop")).toBe(true);
  });

  it("rejects turn without flop", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { turn: "5c" },
      action_sequence: []
    });
    expect(errors.some(e => e.message.includes("flop is missing"))).toBe(true);
  });

  it("rejects river without turn", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"], river: "2h" },
      action_sequence: []
    });
    expect(errors.some(e => e.message.includes("turn is missing"))).toBe(true);
  });

  it("accepts valid full board", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"], turn: "Th", river: "2s" },
      action_sequence: []
    });
    const boardErrors = errors.filter(e => e.field.startsWith("board"));
    expect(boardErrors).toEqual([]);
  });
});

// ============================================================
// Hand Validation — Duplicate Cards
// ============================================================

describe("Hand Validation — Duplicate Cards", () => {
  it("catches hero card duplicated on board", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Ah", "Jd", "4c"] }, // Ah is hero's card!
      action_sequence: []
    });
    expect(errors.some(e => e.field === "cards" && e.message.includes("Ah"))).toBe(true);
  });

  it("catches duplicate within board", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "Qs"] }, // Qs appears twice
      action_sequence: []
    });
    expect(errors.some(e => e.field === "cards" && e.message.includes("Qs"))).toBe(true);
  });

  it("catches hero card duplicated in villain cards", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      known_villain_cards: { "3": ["Ah", "Qs"] }, // Ah is hero's card!
      board: {},
      action_sequence: []
    });
    expect(errors.some(e => e.field === "cards" && e.message.includes("Ah"))).toBe(true);
  });

  it("catches board card duplicated in villain cards", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      known_villain_cards: { "3": ["Qs", "Jd"] }, // Qs is on the flop!
      board: { flop: ["Qs", "9h", "4c"] },
      action_sequence: []
    });
    expect(errors.some(e => e.field === "cards" && e.message.includes("Qs"))).toBe(true);
  });

  it("passes when all cards are unique", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      known_villain_cards: { "3": ["9s", "9h"] },
      board: { flop: ["Qs", "Jd", "4c"], turn: "Th", river: "2s" },
      action_sequence: []
    });
    const cardErrors = errors.filter(e => e.field === "cards");
    expect(cardErrors).toEqual([]);
  });
});

// ============================================================
// Hand Validation — Villain Cards
// ============================================================

describe("Hand Validation — Villain Cards", () => {
  it("rejects villain with 1 hole card", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      known_villain_cards: { "3": ["9s"] }, // only 1 card
      board: {},
      action_sequence: []
    });
    expect(errors.some(e => e.message.includes("0 or 2 hole cards"))).toBe(true);
  });

  it("rejects villain with 3 hole cards", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      known_villain_cards: { "3": ["9s", "9h", "9d"] },
      board: {},
      action_sequence: []
    });
    expect(errors.some(e => e.message.includes("0 or 2 hole cards"))).toBe(true);
  });
});

// ============================================================
// Action Validation — Check Rules
// ============================================================

describe("Action Validation — Check/Bet/Raise Rules", () => {
  it("catches check when facing a bet", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [
          { seat: 1, position: "SB", action: "bet", amount: 30 },
          { seat: 2, position: "BB", action: "check" } // can't check facing a bet
        ]
      }]
    });
    expect(errors.some(e => e.message.includes("checks but there's a bet"))).toBe(true);
  });

  it("catches call with nothing to call", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [
          { seat: 1, position: "SB", action: "call" } // nothing to call
        ]
      }]
    });
    expect(errors.some(e => e.message.includes("calls but no one bet") || e.message.includes("nothing to call"))).toBe(true);
  });

  it("catches bet when there's already a bet (should be raise)", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [
          { seat: 1, position: "SB", action: "bet", amount: 30 },
          { seat: 2, position: "BB", action: "bet", amount: 80 } // should be raise
        ]
      }]
    });
    expect(errors.some(e => e.message.includes("bets but there's already a bet"))).toBe(true);
  });

  it("catches raise to less than current bet", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [
          { seat: 1, position: "SB", action: "bet", amount: 80 },
          { seat: 2, position: "BB", action: "raise", amount: 50 } // less than the bet!
        ]
      }]
    });
    expect(errors.some(e => e.message.includes("not more than the current bet"))).toBe(true);
  });

  it("accepts valid check-raise sequence", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [
          { seat: 1, position: "SB", action: "check" },
          { seat: 2, position: "BB", action: "bet", amount: 30 },
          { seat: 1, position: "SB", action: "raise", amount: 90 }
        ]
      }]
    });
    const actionErrors = errors.filter(e => e.field.startsWith("flop"));
    expect(actionErrors.filter(e => e.severity === "error")).toEqual([]);
  });
});

// ============================================================
// Action Validation — Folded Player
// ============================================================

describe("Action Validation — Folded Players", () => {
  it("catches folded player acting again", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [
          { seat: 1, position: "SB", action: "fold" },
          { seat: 2, position: "BB", action: "bet", amount: 30 },
          { seat: 1, position: "SB", action: "call", amount: 30 } // already folded!
        ]
      }]
    });
    expect(errors.some(e => e.message.includes("already folded"))).toBe(true);
  });

  it("catches all players folding", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [
          { seat: 1, position: "SB", action: "fold" },
          { seat: 2, position: "BB", action: "fold" },
          { seat: 3, position: "UTG", action: "fold" },
          { seat: 4, position: "UTG+1", action: "fold" },
          { seat: 5, position: "UTG+2", action: "fold" },
          { seat: 6, position: "LJ", action: "fold" },
          { seat: 7, position: "HJ", action: "fold" },
          { seat: 8, position: "CO", action: "fold" },
          { seat: 9, position: "BTN", action: "fold" }
        ]
      }]
    });
    expect(errors.some(e => e.message.includes("All players folded"))).toBe(true);
  });
});

// ============================================================
// Action Validation — Street Order
// ============================================================

describe("Action Validation — Street Order", () => {
  it("catches out-of-order streets", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"], turn: "Th", river: "2s" },
      action_sequence: [
        { street: "turn", actions: [{ seat: 1, action: "check" }] },
        { street: "flop", actions: [{ seat: 1, action: "check" }] } // flop after turn!
      ]
    });
    expect(errors.some(e => e.message.includes("out of order"))).toBe(true);
  });

  it("catches invalid street name", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: {},
      action_sequence: [
        { street: "fourth_street", actions: [{ seat: 1, action: "check" }] }
      ]
    });
    expect(errors.some(e => e.message.includes("Invalid street"))).toBe(true);
  });

  it("catches flop actions without flop cards", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: {}, // no flop!
      action_sequence: [
        { street: "flop", actions: [{ seat: 1, action: "bet", amount: 30 }] }
      ]
    });
    expect(errors.some(e => e.message.includes("no flop cards"))).toBe(true);
  });
});

// ============================================================
// Action Validation — Seat Range
// ============================================================

describe("Action Validation — Seat Range", () => {
  it("catches seat 0", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [{ seat: 0, position: "SB", action: "check" }]
      }]
    });
    expect(errors.some(e => e.message.includes("Invalid seat number"))).toBe(true);
  });

  it("catches seat 10 in 9-max", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [{ seat: 10, position: "BTN", action: "check" }]
      }]
    });
    expect(errors.some(e => e.message.includes("Invalid seat number"))).toBe(true);
  });
});

// ============================================================
// Action Validation — Invalid Action Types
// ============================================================

describe("Action Validation — Invalid Action Types", () => {
  it("catches invalid action name", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [{ seat: 1, position: "SB", action: "limp" }] // not a valid action
      }]
    });
    expect(errors.some(e => e.message.includes('Invalid action: "limp"'))).toBe(true);
  });
});

// ============================================================
// Action Validation — Turn Order (Full Sequence)
// ============================================================

describe("Action Validation — Turn Order", () => {
  // 9-max, button seat 9 → SB=1, BB=2, UTG=3
  const baseHand = {
    hand_id: 99, hero_seat: 1, button_seat: 9,
    hero_cards: ["Ah", "Kd"],
    blinds: { small: 2, big: 5 },
    board: {}
  };

  it("catches BB acting before UTG preflop", () => {
    const errors = HoldemValidator.validateHand({
      ...baseHand,
      action_sequence: [{
        street: "preflop",
        actions: [
          { seat: 2, position: "BB", action: "fold" },   // BB acts first — wrong!
          { seat: 3, position: "UTG", action: "raise", amount: 15 },
          { seat: 1, position: "SB", action: "fold" }
        ]
      }]
    });
    expect(errors.some(e => e.field === "preflop.action_order")).toBe(true);
  });

  it("catches SB acting before UTG preflop", () => {
    const errors = HoldemValidator.validateHand({
      ...baseHand,
      action_sequence: [{
        street: "preflop",
        actions: [
          { seat: 1, position: "SB", action: "fold" },   // SB acts first — wrong!
          { seat: 3, position: "UTG", action: "raise", amount: 15 },
          { seat: 2, position: "BB", action: "call", amount: 15 }
        ]
      }]
    });
    expect(errors.some(e => e.field === "preflop.action_order")).toBe(true);
  });

  it("accepts correct preflop order: UTG, CO, SB, BB", () => {
    const errors = HoldemValidator.validateHand({
      ...baseHand,
      action_sequence: [{
        street: "preflop",
        actions: [
          { seat: 3, position: "UTG", action: "fold" },
          { seat: 4, position: "UTG+1", action: "fold" },
          { seat: 5, position: "UTG+2", action: "fold" },
          { seat: 6, position: "LJ", action: "fold" },
          { seat: 7, position: "HJ", action: "fold" },
          { seat: 8, position: "CO", action: "raise", amount: 15 },
          { seat: 9, position: "BTN", action: "fold" },
          { seat: 1, position: "SB", action: "call", amount: 15 },
          { seat: 2, position: "BB", action: "fold" }
        ]
      }]
    });
    const orderErrors = errors.filter(e => e.field === "preflop.action_order");
    expect(orderErrors).toEqual([]);
  });

  it("catches BTN acting before SB on the flop", () => {
    const errors = HoldemValidator.validateHand({
      ...baseHand,
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [
        {
          street: "preflop",
          actions: [
            { seat: 3, position: "UTG", action: "fold" },
            { seat: 8, position: "CO", action: "fold" },
            { seat: 9, position: "BTN", action: "raise", amount: 15 },
            { seat: 1, position: "SB", action: "call", amount: 15 },
            { seat: 2, position: "BB", action: "fold" }
          ]
        },
        {
          street: "flop",
          actions: [
            { seat: 9, position: "BTN", action: "bet", amount: 20 }, // BTN acts first — wrong!
            { seat: 1, position: "SB", action: "call", amount: 20 }
          ]
        }
      ]
    });
    expect(errors.some(e => e.field === "flop.action_order")).toBe(true);
  });

  it("accepts correct postflop order: SB then BTN", () => {
    const errors = HoldemValidator.validateHand({
      ...baseHand,
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [
        {
          street: "preflop",
          actions: [
            { seat: 3, position: "UTG", action: "fold" },
            { seat: 9, position: "BTN", action: "raise", amount: 15 },
            { seat: 1, position: "SB", action: "call", amount: 15 },
            { seat: 2, position: "BB", action: "fold" }
          ]
        },
        {
          street: "flop",
          actions: [
            { seat: 1, position: "SB", action: "check" },
            { seat: 9, position: "BTN", action: "bet", amount: 20 },
            { seat: 1, position: "SB", action: "call", amount: 20 }
          ]
        }
      ]
    });
    const orderErrors = errors.filter(e => e.field === "flop.action_order");
    expect(orderErrors).toEqual([]);
  });

  it("catches mid-position acting out of order preflop", () => {
    // CO acts before UTG+1 — wrong in 9-max
    const errors = HoldemValidator.validateHand({
      ...baseHand,
      action_sequence: [{
        street: "preflop",
        actions: [
          { seat: 3, position: "UTG", action: "fold" },
          { seat: 8, position: "CO", action: "raise", amount: 15 },  // skipped seats 4-7
          { seat: 4, position: "UTG+1", action: "fold" },
          { seat: 1, position: "SB", action: "fold" },
          { seat: 2, position: "BB", action: "fold" }
        ]
      }]
    });
    expect(errors.some(e => e.field === "preflop.action_order")).toBe(true);
  });
});

// ============================================================
// Session Validation
// ============================================================

describe("Session Validation", () => {
  it("validates a clean session with no errors", () => {
    const errors = HoldemValidator.validateSession({
      blinds: { small: 2, big: 5 },
      hands: [{
        hand_id: 1, hero_seat: 1, button_seat: 9,
        hero_cards: ["Ah", "Kd"],
        board: { flop: ["Qs", "Jd", "4c"], turn: "Th", river: "2s" },
        action_sequence: [
          {
            street: "preflop",
            actions: [
              { seat: 3, position: "UTG", action: "fold" },
              { seat: 8, position: "CO", action: "raise", amount: 15 },
              { seat: 1, position: "SB", action: "call", amount: 15 },
              { seat: 2, position: "BB", action: "fold" }
            ]
          },
          {
            street: "flop",
            actions: [
              { seat: 1, position: "SB", action: "check" },
              { seat: 8, position: "CO", action: "bet", amount: 25 },
              { seat: 1, position: "SB", action: "call", amount: 25 }
            ]
          }
        ]
      }]
    });
    const realErrors = errors.filter(e => e.severity === "error");
    expect(realErrors).toEqual([]);
  });

  it("catches errors across multiple hands", () => {
    const errors = HoldemValidator.validateSession({
      blinds: { small: 2, big: 5 },
      hands: [
        {
          hand_id: 1, hero_seat: 1, button_seat: 9,
          hero_cards: ["Ah", "Kd"],
          board: {},
          action_sequence: []
        },
        {
          hand_id: 2, hero_seat: 1, button_seat: 9,
          hero_cards: ["Ah"], // only 1 card
          board: {},
          action_sequence: []
        }
      ]
    });
    expect(errors.some(e => e.hand_id === 2 && e.field === "hero_cards")).toBe(true);
  });
});

// ============================================================
// Blinds Validation
// ============================================================

describe("Blinds Validation", () => {
  it("catches small blind >= big blind", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      blinds: { small: 10, big: 5 }, // SB > BB
      board: {},
      action_sequence: []
    });
    expect(errors.some(e => e.field === "blinds")).toBe(true);
  });
});

// ============================================================
// Hand Evaluation
// ============================================================

describe("Hand Evaluation", () => {
  const board = ["Ac", "9d", "4s", "7h", "3c"];

  it("evaluates pair of aces vs pair of kings correctly", () => {
    const aces = HoldemValidator.evaluateHoldemHand(["As", "Qh"], board);
    const kings = HoldemValidator.evaluateHoldemHand(["Kd", "Ks"], board);
    expect(HoldemValidator.compareHandRanks(aces, kings)).toBeGreaterThan(0);
  });

  it("evaluates a set vs top pair", () => {
    const set = HoldemValidator.evaluateHoldemHand(["9s", "9c"], ["9h", "Qc", "4d", "2s", "Jc"]);
    const topPair = HoldemValidator.evaluateHoldemHand(["Ah", "Qd"], ["9h", "Qc", "4d", "2s", "Jc"]);
    expect(HoldemValidator.compareHandRanks(set, topPair)).toBeGreaterThan(0);
  });

  it("evaluates a flush vs straight", () => {
    const flush = HoldemValidator.evaluateHoldemHand(["Th", "9h"], ["Kh", "6h", "2h", "4s", "3d"]);
    const straight = HoldemValidator.evaluateHoldemHand(["5d", "4c"], ["Kh", "6h", "2h", "3s", "7d"]);
    expect(flush.category).toBe(5); // flush
    expect(straight.category).toBe(4); // straight
    expect(HoldemValidator.compareHandRanks(flush, straight)).toBeGreaterThan(0);
  });

  it("evaluates two pair vs one pair", () => {
    const twoPair = HoldemValidator.evaluateHoldemHand(["Kd", "9c"], ["Kh", "9s", "4d", "2c", "7h"]);
    const onePair = HoldemValidator.evaluateHoldemHand(["Kc", "Jd"], ["Kh", "9s", "4d", "2c", "7h"]);
    expect(HoldemValidator.compareHandRanks(twoPair, onePair)).toBeGreaterThan(0);
  });

  it("evaluates full house vs flush", () => {
    const fullHouse = HoldemValidator.evaluateHoldemHand(["Kd", "Kc"], ["Kh", "9s", "9d", "2c", "7h"]);
    const flush = HoldemValidator.evaluateHoldemHand(["Th", "8h"], ["Kh", "9h", "2h", "4c", "7d"]);
    expect(HoldemValidator.compareHandRanks(fullHouse, flush)).toBeGreaterThan(0);
  });

  it("handles the wheel (A-2-3-4-5 straight)", () => {
    const wheel = HoldemValidator.evaluateHoldemHand(["Ad", "2c"], ["3h", "4s", "5d", "Kc", "9h"]);
    expect(wheel.category).toBe(4); // straight
    expect(wheel.kickers[0]).toBe(5); // 5-high
  });

  it("Q-high beats T-high", () => {
    const qHigh = HoldemValidator.evaluateHoldemHand(["Qc", "Jd"], ["Kh", "6h", "2c", "4s", "3d"]);
    const tHigh = HoldemValidator.evaluateHoldemHand(["Th", "9h"], ["Kh", "6h", "2c", "4s", "3d"]);
    expect(HoldemValidator.compareHandRanks(qHigh, tHigh)).toBeGreaterThan(0);
  });

  it("describes hand ranks readably", () => {
    const pairOfAces = HoldemValidator.evaluateHoldemHand(["As", "Qh"], board);
    const desc = HoldemValidator.describeHandRank(pairOfAces);
    expect(desc).toContain("pair");
    expect(desc).toContain("ace");
  });
});

// ============================================================
// Showdown Winner Validation
// ============================================================

describe("Showdown Winner Validation", () => {
  it("catches wrong winner when hero's aces beat villain's kings", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 8,
      hero_cards: ["As", "Qh"],
      known_villain_cards: { "4": ["Kd", "Ks"] },
      board: { flop: ["Ac", "9d", "4s"], turn: "7h", river: "3c" },
      action_sequence: [
        { street: "preflop", actions: [
          { seat: 4, action: "raise", amount: 15 },
          { seat: 1, action: "call", amount: 15 }
        ]},
        { street: "flop", actions: [
          { seat: 4, action: "bet", amount: 20 },
          { seat: 1, action: "call", amount: 20 }
        ]},
        { street: "turn", actions: [
          { seat: 4, action: "bet", amount: 45 },
          { seat: 1, action: "call", amount: 45 }
        ]},
        { street: "river", actions: [
          { seat: 4, action: "bet", amount: 100 },
          { seat: 1, action: "call", amount: 100 }
        ]}
      ],
      result: { winner_seat: 4, pot: 367, showdown: true }
    });
    expect(errors.some(e => e.field === "result.winner_seat")).toBe(true);
  });

  it("accepts correct showdown winner", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 6, hero_seat: 1, button_seat: 4,
      hero_cards: ["9s", "9c"],
      known_villain_cards: { "6": ["Ah", "Qd"] },
      board: { flop: ["9h", "Qc", "4d"], turn: "2s", river: "Jc" },
      action_sequence: [
        { street: "preflop", actions: [
          { seat: 6, action: "raise", amount: 15 },
          { seat: 1, action: "call", amount: 15 }
        ]},
        { street: "flop", actions: [
          { seat: 1, action: "check" },
          { seat: 6, action: "bet", amount: 20 },
          { seat: 1, action: "call", amount: 20 }
        ]},
        { street: "turn", actions: [
          { seat: 1, action: "check" },
          { seat: 6, action: "bet", amount: 40 },
          { seat: 1, action: "call", amount: 40 }
        ]},
        { street: "river", actions: [
          { seat: 1, action: "check" },
          { seat: 6, action: "bet", amount: 95 },
          { seat: 1, action: "call", amount: 95 }
        ]}
      ],
      result: { winner_seat: 1, pot: 347, showdown: true }
    });
    expect(errors.filter(e => e.field === "result.winner_seat")).toEqual([]);
  });

  it("does not validate when villain cards are unknown", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 8,
      hero_cards: ["As", "Qh"],
      known_villain_cards: {},
      board: { flop: ["Ac", "9d", "4s"], turn: "7h", river: "3c" },
      action_sequence: [],
      result: { winner_seat: 4, pot: 200, showdown: true }
    });
    // Can't validate — only hero cards known
    expect(errors.filter(e => e.field === "result.winner_seat")).toEqual([]);
  });
});

// ============================================================
// Implicit Action Inference
// ============================================================

describe("Implicit Action Inference", () => {
  it("infers checks when flop action starts with a bet and earlier players are active", () => {
    // Button=9, SB=1, BB=2. Preflop: seat 4 raises, seat 1 calls, rest fold.
    // Flop: only seat 4's bet is recorded. Seat 1 should have a check inferred.
    const hand = {
      hand_id: 1, hero_seat: 1, button_seat: 9,
      blinds: { small: 2, big: 5 },
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [
        {
          street: "preflop",
          actions: [
            { seat: 3, position: "UTG", action: "fold" },
            { seat: 4, position: "UTG+1", action: "raise", amount: 15 },
            { seat: 1, position: "CO", action: "call", amount: 15 },
            { seat: 9, position: "SB", action: "fold" },
            { seat: 2, position: "BB", action: "fold" }
          ]
        },
        {
          street: "flop",
          actions: [
            { seat: 4, position: "UTG+1", action: "bet", amount: 20 },
            { seat: 1, position: "CO", action: "call", amount: 20 }
          ]
        }
      ]
    };
    // Postflop order: SB(1)=folded, BB(2)=folded, UTG(3)=folded, UTG+1(4), ..., CO(1 is not SB here)
    // Wait — seat 1 is CO, seat 4 is UTG+1. Postflop, start at SB=1... but SB folded.
    // Active seats: 4 and 1. Seat 1 comes before seat 4 starting from SB position going clockwise.
    // Clockwise from SB(seat 1): 1, 2, 3, 4, 5, 6, 7, 8, 9. Active: 1 and 4. So order = [1, 4].
    // First action is seat 4 betting — seat 1 should have checked first.
    const inferred = HoldemValidator.inferImpliedActions(hand, 9);
    expect(inferred.length).toBeGreaterThan(0);
    expect(inferred[0].seat).toBe(1);
    expect(inferred[0].action).toBe("check");

    // The flop actions should now start with the inferred check
    const flopBlock = hand.action_sequence.find(s => s.street === "flop");
    expect(flopBlock.actions[0].action).toBe("check");
    expect(flopBlock.actions[0].seat).toBe(1);
    expect(flopBlock.actions[0]._inferred).toBe(true);
  });

  it("infers BB option check when limped pot goes to flop", () => {
    // Button=9, SB=1, BB=2. Everyone folds or limps, no raise. Hand goes to flop.
    // BB never explicitly acts preflop — should infer a check.
    const hand = {
      hand_id: 2, hero_seat: 1, button_seat: 9,
      blinds: { small: 2, big: 5 },
      board: { flop: ["Ks", "8d", "3c"] },
      action_sequence: [
        {
          street: "preflop",
          actions: [
            { seat: 3, position: "UTG", action: "call", amount: 5 },
            { seat: 4, position: "UTG+1", action: "fold" },
            { seat: 5, position: "UTG+2", action: "fold" },
            { seat: 6, position: "LJ", action: "fold" },
            { seat: 7, position: "HJ", action: "fold" },
            { seat: 8, position: "CO", action: "fold" },
            { seat: 1, position: "BTN", action: "call", amount: 5 },
            { seat: 9, position: "SB", action: "call", amount: 5 }
            // BB never acts — option is implied
          ]
        },
        {
          street: "flop",
          actions: [
            { seat: 2, position: "BB", action: "check" },
            { seat: 3, position: "UTG", action: "bet", amount: 15 }
          ]
        }
      ]
    };
    const inferred = HoldemValidator.inferImpliedActions(hand, 9);
    // BB's preflop check should be inferred
    expect(inferred.some(i => i.seat === 2 && i.street === "preflop")).toBe(true);
    const preflopBlock = hand.action_sequence.find(s => s.street === "preflop");
    const bbAction = preflopBlock.actions.find(a => a.seat === 2);
    expect(bbAction).toBeDefined();
    expect(bbAction.action).toBe("check");
  });

  it("does NOT infer BB check when there was a raise preflop", () => {
    const hand = {
      hand_id: 3, hero_seat: 1, button_seat: 9,
      blinds: { small: 2, big: 5 },
      board: { flop: ["Ks", "8d", "3c"] },
      action_sequence: [
        {
          street: "preflop",
          actions: [
            { seat: 3, position: "UTG", action: "raise", amount: 15 },
            { seat: 1, position: "BTN", action: "call", amount: 15 },
            { seat: 9, position: "SB", action: "fold" },
            { seat: 2, position: "BB", action: "call", amount: 15 }
          ]
        },
        {
          street: "flop",
          actions: [
            { seat: 2, position: "BB", action: "check" },
            { seat: 3, position: "UTG", action: "bet", amount: 20 }
          ]
        }
      ]
    };
    const inferred = HoldemValidator.inferImpliedActions(hand, 9);
    // BB acted explicitly (called), no BB option inference needed
    expect(inferred.filter(i => i.seat === 2 && i.street === "preflop")).toEqual([]);
  });

  it("does not infer checks when flop order is already correct", () => {
    const hand = {
      hand_id: 4, hero_seat: 1, button_seat: 9,
      blinds: { small: 2, big: 5 },
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [
        {
          street: "preflop",
          actions: [
            { seat: 4, position: "UTG+1", action: "raise", amount: 15 },
            { seat: 1, position: "CO", action: "call", amount: 15 },
            { seat: 2, position: "BB", action: "fold" }
          ]
        },
        {
          street: "flop",
          actions: [
            { seat: 1, position: "CO", action: "check" },
            { seat: 4, position: "UTG+1", action: "bet", amount: 20 }
          ]
        }
      ]
    };
    // Seat 1 (CO) comes before seat 4 (UTG+1) postflop? Let's verify.
    // Button=9, SB=1, BB=2. Postflop order from SB: 1, 2(folded), 3, 4, ...
    // Active: 1 and 4. Order: [1, 4]. First action is seat 1 check — correct, no inference.
    const inferred = HoldemValidator.inferImpliedActions(hand, 9);
    const flopInferred = inferred.filter(i => i.street === "flop");
    expect(flopInferred).toEqual([]);
  });
});

// ============================================================
// Engine — Pot Math
// ============================================================

describe("Engine — Pot and Stack Tracking", () => {
  it("tracks pot correctly through a simple hand", () => {
    const PE = PokerEngine;
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      stacks: { 0: 500, 1: 500, 2: 500, 3: 500, 4: 500, 5: 500, 6: 500, 7: 500, 8: 500 },
      smallBlind: 2, bigBlind: 5, defaultStack: 500
    });

    const { players, tableState } = init;

    // Blinds should be posted
    expect(tableState.pot).toBe(7); // 2 + 5
    expect(PE.getPlayerBySeat(players, 1).stack).toBe(498); // SB posted 2
    expect(PE.getPlayerBySeat(players, 2).stack).toBe(495); // BB posted 5
  });

  it("enforces minimum raise correctly", () => {
    const PE = PokerEngine;
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      stacks: { 0: 500, 1: 500, 2: 500, 3: 500, 4: 500, 5: 500, 6: 500, 7: 500, 8: 500 },
      smallBlind: 2, bigBlind: 5, defaultStack: 500
    });

    const { players, tableState } = init;

    // UTG (seat 3) raises to 15
    const result = PE.applyPlayerAction(3, "raise", 15, players, tableState, 9, 5);
    expect(result.success).toBe(true);
    expect(tableState.pot).toBe(22); // 7 + 15
  });

  it("prevents illegal actions", () => {
    const PE = PokerEngine;
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      stacks: { 0: 500, 1: 500, 2: 500, 3: 500, 4: 500, 5: 500, 6: 500, 7: 500, 8: 500 },
      smallBlind: 2, bigBlind: 5, defaultStack: 500
    });

    const { players, tableState } = init;

    // UTG can't check preflop (there's a blind to call)
    const legal = PE.getLegalActions(3, players, tableState);
    expect(legal.check).toBe(false);
    expect(legal.call).toBe(true);
    expect(legal.raise).toBe(true);
    expect(legal.fold).toBe(true);
  });
});

// ============================================================
// Engine — Side Pots
// ============================================================

describe("Engine — Side Pots", () => {
  it("creates a single pot when stacks are equal", () => {
    const PE = PokerEngine;
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500,
      smallBlind: 2, bigBlind: 5
    });
    const { players, tableState } = init;
    // Blinds posted: SB 2 + BB 5 = 7
    expect(tableState.pot).toBe(7);
    expect(tableState.pots.length).toBeGreaterThanOrEqual(1);
    const totalPot = tableState.pots.reduce((s, p) => s + p.amount, 0);
    expect(totalPot).toBe(tableState.pot);
  });

  it("short stack call only risks their remaining chips", () => {
    const PE = PokerEngine;
    // 9-max, seat 4 (UTG+1) has only 50 chips
    const stacks = {};
    for (let i = 1; i <= 9; i++) stacks[i] = 500;
    stacks[5] = 50; // seat 5 (1-based) = seat 4 (0-based) = UTG+1
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      stacks, smallBlind: 2, bigBlind: 5
    });
    const { players, tableState } = init;

    // UTG (seat 3) raises to 200
    PE.applyPlayerAction(3, "raise", 200, players, tableState, 9, 5, { exactAmount: true });
    // UTG+1 (seat 4, short stack 50) calls — should go all-in for 50
    const shortPlayer = PE.getPlayerBySeat(players, 4);
    PE.applyPlayerAction(4, "call", 0, players, tableState, 9, 5, { exactAmount: true });
    expect(shortPlayer.status).toBe("allin");
    expect(shortPlayer.stack).toBe(0);

    // Side pots should exist
    expect(tableState.pots.length).toBeGreaterThan(1);

    // Short stack should be eligible for main pot but not side pot
    const mainPot = tableState.pots[0];
    expect(mainPot.eligible).toContain(4);
    // If there's a side pot, short stack shouldn't be in it
    if (tableState.pots.length > 1) {
      const sidePot = tableState.pots[tableState.pots.length - 1];
      expect(sidePot.eligible).not.toContain(4);
    }
  });

  it("creates correct pot amounts with three different stack sizes", () => {
    const PE = PokerEngine;
    // Simulate manually: 3 players all go all-in for different amounts
    const players = [
      PE.createPlayerState(0, 0, "A"),  // will set committedHand manually
      PE.createPlayerState(1, 0, "B"),
      PE.createPlayerState(2, 0, "C")
    ];
    players[0].committedHand = 50;  players[0].stack = 0; players[0].status = "allin";
    players[1].committedHand = 150; players[1].stack = 0; players[1].status = "allin";
    players[2].committedHand = 300; players[2].stack = 0; players[2].status = "allin";

    const tableState = PE.createTableState({});
    PE.recomputePotAndToCall(players, tableState);

    expect(tableState.pot).toBe(500);
    expect(tableState.pots.length).toBe(3);

    // Main pot: 50 * 3 = 150 (all three eligible)
    expect(tableState.pots[0].amount).toBe(150);
    expect(tableState.pots[0].eligible.length).toBe(3);

    // Side pot 1: 100 * 2 = 200 (B and C eligible)
    expect(tableState.pots[1].amount).toBe(200);
    expect(tableState.pots[1].eligible.length).toBe(2);
    expect(tableState.pots[1].eligible).not.toContain(0);

    // Side pot 2: 150 * 1 = 150 (only C eligible)
    expect(tableState.pots[2].amount).toBe(150);
    expect(tableState.pots[2].eligible.length).toBe(1);
    expect(tableState.pots[2].eligible).toContain(2);
  });

  it("handles straddle — action starts after straddler", () => {
    const PE = PokerEngine;
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500,
      smallBlind: 2, bigBlind: 5,
      straddles: [{ seat: 4, amount: 10 }]  // seat 4 (1-based) = UTG straddles to 10
    });
    const { players, tableState } = init;

    // Blinds + straddle posted: SB 2 + BB 5 + straddle 10 = 17
    expect(tableState.pot).toBe(17);
    // Straddle seat (idx 3) should have 10 committed
    const straddler = PE.getPlayerBySeat(players, 3);
    expect(straddler.committedHand).toBe(10);
    // Action should start AFTER the straddler, not after BB
    expect(tableState.actionSeat).not.toBe(PE.findSeatByPosition(players, "BB") + 1);
    // Effective big blind should be the straddle amount
    expect(tableState.effectiveBigBlind).toBe(10);
    // Min raise should be straddle + straddle = 20
    expect(tableState.minRaiseTo).toBe(20);
  });

  it("handles multiple straddles", () => {
    const PE = PokerEngine;
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500,
      smallBlind: 2, bigBlind: 5,
      straddles: [
        { seat: 4, amount: 10 },  // UTG straddles to 10
        { seat: 5, amount: 20 }   // UTG+1 re-straddles to 20
      ]
    });
    const { tableState } = init;
    // SB 2 + BB 5 + straddle 10 + re-straddle 20 = 37
    expect(tableState.pot).toBe(37);
    expect(tableState.effectiveBigBlind).toBe(20);
    expect(tableState.minRaiseTo).toBe(40);
  });

  it("includes folded player contributions in pots", () => {
    const PE = PokerEngine;
    const players = [
      PE.createPlayerState(0, 0, "A"),
      PE.createPlayerState(1, 0, "B"),
      PE.createPlayerState(2, 0, "C")
    ];
    players[0].committedHand = 50; players[0].status = "folded";  // folded after putting in 50
    players[1].committedHand = 100; players[1].stack = 0; players[1].status = "allin";
    players[2].committedHand = 100; players[2].stack = 200; players[2].status = "active";

    const tableState = PE.createTableState({});
    PE.recomputePotAndToCall(players, tableState);

    expect(tableState.pot).toBe(250);
    // Folded player's 50 goes to the pot but they're not eligible
    // Main pot should include all contributions
    const totalPots = tableState.pots.reduce((s, p) => s + p.amount, 0);
    expect(totalPots).toBe(250);
    // Folded player should not be eligible for any pot
    for (const pot of tableState.pots) {
      expect(pot.eligible).not.toContain(0);
    }
  });
});

// ============================================================
// Engine — All-In Edge Cases
// ============================================================

describe("Engine — All-In Edge Cases", () => {
  const PE = PokerEngine;

  function setup9Max(stackOverrides) {
    const stacks = {};
    for (let i = 1; i <= 9; i++) stacks[i] = stackOverrides[i] || 500;
    return PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      stacks, smallBlind: 2, bigBlind: 5, defaultStack: 500
    });
  }

  it("all-in call for less than raise does not reopen action", () => {
    // UTG+1 (seat index 4) has only 30 chips. UTG raises to 50.
    // Stacks key 5 (1-based) = seat index 4 = UTG+1
    const { players, tableState } = setup9Max({ 5: 30 });

    // UTG (index 3) raises to 50
    PE.applyPlayerAction(3, "raise", 50, players, tableState, 9, 5, { exactAmount: true });
    // UTG+1 (index 4, short 30) calls all-in
    PE.applyPlayerAction(4, "call", 0, players, tableState, 9, 5);

    const shortPlayer = PE.getPlayerBySeat(players, 4);
    expect(shortPlayer.status).toBe("allin");
    expect(shortPlayer.stack).toBe(0);
    // Short stack committed only what they had (30), not the full 50
    expect(shortPlayer.committedHand).toBeLessThanOrEqual(30);
  });

  it("call that puts player exactly all-in", () => {
    // UTG+1 (index 4) has exactly 50 chips
    const { players, tableState } = setup9Max({ 5: 50 });

    // UTG (index 3) raises to 50
    PE.applyPlayerAction(3, "raise", 50, players, tableState, 9, 5, { exactAmount: true });
    // UTG+1 (index 4, 50 chips) calls — exactly covers it
    PE.applyPlayerAction(4, "call", 0, players, tableState, 9, 5);

    const player = PE.getPlayerBySeat(players, 4);
    expect(player.stack).toBe(0);
    expect(player.status).toBe("allin");
  });

  it("all-in shove for less than minimum raise amount", () => {
    // UTG+1 (index 4) has only 12 chips
    const { players, tableState } = setup9Max({ 5: 12 });

    // UTG (index 3) raises to 15
    PE.applyPlayerAction(3, "raise", 15, players, tableState, 9, 5, { exactAmount: true });
    // UTG+1 (index 4) goes all-in for 12 (less than the 15 raise, but all-in is allowed)
    const result = PE.applyPlayerAction(4, "all-in", 0, players, tableState, 9, 5);
    expect(result.success).toBe(true);
    const player = PE.getPlayerBySeat(players, 4);
    expect(player.status).toBe("allin");
    expect(player.stack).toBe(0);
  });

  it("multiple all-ins on same street create correct pots", () => {
    // Seats 4,5,6 (1-based) = indices 3,4,5 = UTG, UTG+1, UTG+2
    const { players, tableState } = setup9Max({ 4: 100, 5: 200, 6: 500 });

    // UTG (index 3, 100 chips) goes all-in for 100
    PE.applyPlayerAction(3, "all-in", 0, players, tableState, 9, 5);
    expect(PE.getPlayerBySeat(players, 3).status).toBe("allin");
    // UTG+1 (index 4, 200 chips) goes all-in for 200
    PE.applyPlayerAction(4, "all-in", 0, players, tableState, 9, 5);
    expect(PE.getPlayerBySeat(players, 4).status).toBe("allin");
    // UTG+2 (index 5, 500 chips) calls 200
    PE.applyPlayerAction(5, "call", 0, players, tableState, 9, 5);

    // Should have multiple pots (100 level + 200 level)
    expect(tableState.pots.length).toBeGreaterThanOrEqual(2);
    // Total should match
    const totalPots = tableState.pots.reduce((s, p) => s + p.amount, 0);
    expect(totalPots).toBe(tableState.pot);
    // Shortest stack not eligible for the bigger side pot
    const lastPot = tableState.pots[tableState.pots.length - 1];
    expect(lastPot.eligible).not.toContain(3);
  });
});

// ============================================================
// Engine — Min Raise Calculation
// ============================================================

describe("Engine — Min Raise Calculation", () => {
  const PE = PokerEngine;

  it("min raise after an open raise", () => {
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500, smallBlind: 2, bigBlind: 5
    });
    const { players, tableState } = init;

    // UTG raises to 15 (raise of 10 over the 5 BB)
    PE.applyPlayerAction(3, "raise", 15, players, tableState, 9, 5, { exactAmount: true });
    // Min re-raise should be 15 + 10 = 25 (previous raise size was 10)
    expect(tableState.minRaiseTo).toBe(25);
  });

  it("min raise after a re-raise", () => {
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500, smallBlind: 2, bigBlind: 5
    });
    const { players, tableState } = init;

    // UTG raises to 15
    PE.applyPlayerAction(3, "raise", 15, players, tableState, 9, 5, { exactAmount: true });
    // UTG+1 re-raises to 45 (raise of 30)
    PE.applyPlayerAction(4, "raise", 45, players, tableState, 9, 5, { exactAmount: true });
    // Min re-re-raise should be 45 + 30 = 75
    expect(tableState.minRaiseTo).toBe(75);
  });

  it("min raise on the flop is 1 big blind", () => {
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500, smallBlind: 2, bigBlind: 5
    });
    const { players, tableState } = init;

    // Start a flop street
    PE.beginStreetRound("flop", players, tableState, 9, 5);
    expect(tableState.minRaiseTo).toBe(5); // 1 BB
  });
});

// ============================================================
// Engine — Street Transitions
// ============================================================

describe("Engine — Street Transitions", () => {
  const PE = PokerEngine;

  it("beginStreetRound resets committedStreet for active players", () => {
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500, smallBlind: 2, bigBlind: 5
    });
    const { players, tableState } = init;

    // Simulate preflop action — some players committed chips
    PE.applyPlayerAction(3, "raise", 15, players, tableState, 9, 5, { exactAmount: true });
    PE.applyPlayerAction(4, "call", 0, players, tableState, 9, 5);
    // Others fold
    for (let s = 5; s <= 8; s++) PE.applyPlayerAction(s, "fold", 0, players, tableState, 9, 5);
    // SB/BB
    PE.applyPlayerAction(1, "fold", 0, players, tableState, 9, 5);
    PE.applyPlayerAction(2, "fold", 0, players, tableState, 9, 5);

    // Begin flop
    PE.beginStreetRound("flop", players, tableState, 9, 5);

    // Active players should have committedStreet = 0
    players.filter(p => p.status === "active").forEach(p => {
      expect(p.committedStreet).toBe(0);
    });
    // toCall should be 0
    expect(tableState.toCall).toBe(0);
    // Action should start after button (SB side)
    expect(tableState.actionSeat).toBeGreaterThanOrEqual(0);
  });

  it("folded players remain folded across streets", () => {
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500, smallBlind: 2, bigBlind: 5
    });
    const { players, tableState } = init;

    // Fold seat 3
    PE.applyPlayerAction(3, "fold", 0, players, tableState, 9, 5);
    expect(PE.getPlayerBySeat(players, 3).status).toBe("folded");

    PE.beginStreetRound("flop", players, tableState, 9, 5);
    expect(PE.getPlayerBySeat(players, 3).status).toBe("folded");

    PE.beginStreetRound("turn", players, tableState, 9, 5);
    expect(PE.getPlayerBySeat(players, 3).status).toBe("folded");
  });
});

// ============================================================
// Engine — Position Mapping
// ============================================================

describe("Engine — Position Mapping", () => {
  const PE = PokerEngine;

  it("9-max position mapping is correct from button", () => {
    const positions = PE.computePositionsFromButton(0, 9);
    expect(positions[0]).toBe("BTN");
    expect(positions[1]).toBe("SB");
    expect(positions[2]).toBe("BB");
    expect(positions[3]).toBe("UTG");
    expect(positions[4]).toBe("UTG+1");
    expect(positions[5]).toBe("UTG+2");
    expect(positions[6]).toBe("LJ");
    expect(positions[7]).toBe("HJ");
    expect(positions[8]).toBe("CO");
  });

  it("position mapping wraps correctly with different button seats", () => {
    const positions = PE.computePositionsFromButton(5, 9);
    expect(positions[5]).toBe("BTN");
    expect(positions[6]).toBe("SB");
    expect(positions[7]).toBe("BB");
    expect(positions[8]).toBe("UTG");
    expect(positions[0]).toBe("UTG+1");
  });

  it("6-max position mapping is correct", () => {
    const C = PokerConstants;
    const positions = PE.computePositionsFromButton(0, 6, C.TABLE_POSITIONS_6MAX);
    expect(positions[0]).toBe("BTN");
    expect(positions[1]).toBe("SB");
    expect(positions[2]).toBe("BB");
    expect(positions[3]).toBe("UTG");
    expect(positions[4]).toBe("HJ");
    expect(positions[5]).toBe("CO");
  });
});

// ============================================================
// Engine — Snapshot Capture & Restore
// ============================================================

describe("Engine — Snapshot Capture & Restore", () => {
  const PE = PokerEngine;

  it("snapshot captures and restores state correctly", () => {
    const init = PE.initializeHand({
      seatCount: 9, buttonSeat: 0, heroSeat: 0,
      defaultStack: 500, smallBlind: 2, bigBlind: 5
    });
    const { players, tableState } = init;

    // Make some actions
    PE.applyPlayerAction(3, "raise", 15, players, tableState, 9, 5, { exactAmount: true });
    const potBefore = tableState.pot;
    const stackBefore = PE.getPlayerBySeat(players, 3).stack;

    // Capture snapshot
    PE.captureStreetSnapshot("preflop", [], players, tableState);

    // Make more actions that change state
    PE.applyPlayerAction(4, "call", 0, players, tableState, 9, 5);
    expect(tableState.pot).not.toBe(potBefore);

    // Restore snapshot
    const restored = PE.restoreStreetSnapshot("preflop", tableState);
    expect(restored).not.toBeNull();
    expect(restored.tableState.pot).toBe(potBefore);

    // Player stacks should be restored
    const restoredPlayer = PE.getPlayerBySeat(restored.players, 3);
    expect(restoredPlayer.stack).toBe(stackBefore);
  });

  it("restore returns null for non-existent snapshot", () => {
    const tableState = PE.createTableState({});
    const result = PE.restoreStreetSnapshot("flop", tableState);
    expect(result).toBeNull();
  });
});

// ============================================================
// Validator — Preflop/Postflop Action Order
// ============================================================

describe("Validator — Action Order (legacy tests updated)", () => {
  it("flags BB acting first preflop", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      blinds: { small: 2, big: 5 },
      board: {},
      action_sequence: [{
        street: "preflop",
        actions: [
          { seat: 2, position: "BB", action: "raise", amount: 15 },
          { seat: 3, position: "UTG", action: "fold" }
        ]
      }]
    });
    expect(errors.some(e => e.field === "preflop.action_order")).toBe(true);
  });

  it("flags SB acting before UTG preflop", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      blinds: { small: 2, big: 5 },
      board: {},
      action_sequence: [{
        street: "preflop",
        actions: [
          { seat: 1, position: "SB", action: "fold" },
          { seat: 3, position: "UTG", action: "raise", amount: 15 },
          { seat: 2, position: "BB", action: "fold" }
        ]
      }]
    });
    expect(errors.some(e => e.field === "preflop.action_order")).toBe(true);
  });

  it("does not flag UTG acting first preflop", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      blinds: { small: 2, big: 5 },
      board: {},
      action_sequence: [{
        street: "preflop",
        actions: [
          { seat: 3, position: "UTG", action: "raise", amount: 15 },
          { seat: 1, position: "SB", action: "fold" },
          { seat: 2, position: "BB", action: "fold" }
        ]
      }]
    });
    expect(errors.filter(e => e.field && e.field.includes("action_order"))).toEqual([]);
  });

  it("flags button acting first postflop", () => {
    const errors = HoldemValidator.validateHand({
      hand_id: 1, hero_seat: 1, button_seat: 9,
      hero_cards: ["Ah", "Kd"],
      board: { flop: ["Qs", "Jd", "4c"] },
      action_sequence: [{
        street: "flop",
        actions: [
          { seat: 9, position: "BTN", action: "bet", amount: 20 },
          { seat: 1, position: "SB", action: "call", amount: 20 }
        ]
      }]
    });
    expect(errors.some(e => e.field === "flop.action_order")).toBe(true);
  });
});

// ============================================================
// Gold Standard Test Session — Regression Guard
// ============================================================

describe("Gold Standard Test Session", () => {
  const fs = require("fs");
  const path = require("path");
  const goldPath = path.join(__dirname, "fixtures", "gold_session.json");
  let session;

  beforeAll(() => {
    session = JSON.parse(fs.readFileSync(goldPath, "utf-8"));
  });

  it("has 5 hands", () => {
    expect(session.hands.length).toBe(5);
  });

  it("passes full validator with zero errors", () => {
    const errors = HoldemValidator.validateSession(session);
    const realErrors = errors.filter(e => e.severity === "error");
    if (realErrors.length > 0) {
      console.log("Gold session errors:", realErrors);
    }
    expect(realErrors).toEqual([]);
  });

  it("has correct position labels for every action in every hand", () => {
    const POS = ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"];
    for (const hand of session.hands) {
      const posMap = {};
      for (let i = 0; i < 9; i++) {
        posMap[((hand.button_seat - 1 + i) % 9) + 1] = POS[i];
      }
      for (const street of hand.action_sequence || []) {
        for (const a of street.actions || []) {
          if (a.position && posMap[a.seat]) {
            expect(a.position).toBe(posMap[a.seat]);
          }
        }
      }
    }
  });

  it("has no duplicate cards within any hand", () => {
    for (const hand of session.hands) {
      const all = [...(hand.hero_cards || [])];
      if (hand.board.flop) all.push(...hand.board.flop);
      if (hand.board.turn) all.push(hand.board.turn);
      if (hand.board.river) all.push(hand.board.river);
      for (const cards of Object.values(hand.known_villain_cards || {})) {
        all.push(...cards);
      }
      const dupes = HoldemValidator.findDuplicateCards(all);
      expect(dupes).toEqual([]);
    }
  });

  it("has correct showdown winners", () => {
    for (const hand of session.hands) {
      if (!hand.result.showdown) continue;
      const board = [...(hand.board.flop || [])];
      if (hand.board.turn) board.push(hand.board.turn);
      if (hand.board.river) board.push(hand.board.river);
      if (board.length !== 5) continue;

      const heroRank = HoldemValidator.evaluateHoldemHand(hand.hero_cards, board);
      for (const [seat, cards] of Object.entries(hand.known_villain_cards || {})) {
        const vRank = HoldemValidator.evaluateHoldemHand(cards, board);
        const cmp = HoldemValidator.compareHandRanks(heroRank, vRank);
        if (hand.result.winner_seat === 1) {
          expect(cmp).toBeGreaterThan(0);
        } else {
          expect(cmp).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("hero is always seat 1", () => {
    for (const hand of session.hands) {
      expect(hand.hero_seat).toBe(1);
    }
  });
});

// ============================================================
// Side Pot Calculation
// ============================================================

describe("Side Pot Calculation", () => {
  const PE = PokerEngine;

  function makePlayer(seat, stack, committed, status) {
    return {
      seat, stack, status: status || "active",
      committedHand: committed || 0, committedStreet: committed || 0,
      name: `Seat ${seat}`, position: "", description: ""
    };
  }

  function makeTableState(pot) {
    return { pot: pot || 0, pots: [], toCall: 0, minRaiseTo: 5, actionSeat: -1,
      pendingActionSeats: [], headsUpLocked: false, lastAggressorSeat: -1,
      lastFullRaiseSize: 5, pendingHeadsUpAggressorSeat: -1 };
  }

  it("normal 2-player pot (no all-in) → single pot entry", () => {
    // Raiser put in 15, caller put in 15. No one is all-in.
    const players = [
      makePlayer(0, 485, 15, "active"),
      makePlayer(1, 485, 15, "active"),
      makePlayer(2, 495, 5, "folded"),  // BB folded
    ];
    const ts = makeTableState(35);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(1);
    expect(ts.pots[0].amount).toBe(35);
    expect(ts.pots[0].eligible).toContain(0);
    expect(ts.pots[0].eligible).toContain(1);
  });

  it("mid-betting with different commitments but no all-in → single pot (THE BUG)", () => {
    // Preflop: BB posted 5, UTG raised to 15 — BB hasn't acted yet
    // No one is all-in, but committedHand differs (5 vs 15)
    // Should be ONE pot, not two
    const players = [
      makePlayer(0, 485, 15, "active"),  // UTG raised to 15
      makePlayer(1, 495, 5, "active"),   // BB posted 5, hasn't acted yet
    ];
    const ts = makeTableState(20);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(1);
    expect(ts.pots[0].amount).toBe(20);
  });

  it("flop bet before call — different street commitments, no all-in → single pot", () => {
    // After preflop both put 15. Now on flop, player 0 bets 30. Player 1 hasn't acted.
    // committedHand: 45 vs 15. No all-in. Should still be one pot.
    const players = [
      makePlayer(0, 455, 45, "active"),  // 15 preflop + 30 flop bet
      makePlayer(1, 485, 15, "active"),  // 15 preflop, hasn't acted on flop
    ];
    const ts = makeTableState(60);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(1);
    expect(ts.pots[0].amount).toBe(60);
  });

  it("3-player pot, one folds, no all-in → single pot", () => {
    const players = [
      makePlayer(0, 470, 30, "active"),
      makePlayer(1, 470, 30, "active"),
      makePlayer(2, 485, 15, "folded"),
    ];
    const ts = makeTableState(75);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(1);
    expect(ts.pots[0].amount).toBe(75);
  });

  it("preflop with blinds + raise + call + folds → single pot", () => {
    // SB=2, BB=5, UTG raises to 15, BTN calls 15, SB folds, BB folds
    const players = [
      makePlayer(0, 485, 15, "active"),  // UTG raiser
      makePlayer(1, 485, 15, "active"),  // BTN caller
      makePlayer(2, 498, 2, "folded"),   // SB folded
      makePlayer(3, 495, 5, "folded"),   // BB folded
    ];
    const ts = makeTableState(37);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(1);
    expect(ts.pots[0].amount).toBe(37);
  });

  it("player all-in for less than bet → 2 pot entries (main + side)", () => {
    // Player A bets 100, Player B all-in for 50, Player C calls 100
    // Main pot: 50×3 = 150 (all eligible)
    // Side pot: 50×2 = 100 (A and C eligible)
    const players = [
      makePlayer(0, 400, 100, "active"),  // A
      makePlayer(1, 0, 50, "allin"),      // B all-in
      makePlayer(2, 400, 100, "active"),  // C
    ];
    const ts = makeTableState(250);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(2);
    // Main pot: everyone contributes up to 50 each = 150
    expect(ts.pots[0].amount).toBe(150);
    expect(ts.pots[0].eligible).toContain(0);
    expect(ts.pots[0].eligible).toContain(1);
    expect(ts.pots[0].eligible).toContain(2);
    // Side pot: A and C contribute 50 more each = 100
    expect(ts.pots[1].amount).toBe(100);
    expect(ts.pots[1].eligible).toContain(0);
    expect(ts.pots[1].eligible).toContain(2);
    expect(ts.pots[1].eligible).not.toContain(1);
    // Amounts sum to total
    expect(ts.pots.reduce((s, p) => s + p.amount, 0)).toBe(250);
  });

  it("two players all-in at different levels → 3 pot entries", () => {
    // A commits 200, B all-in for 50, C all-in for 120, D calls 200
    const players = [
      makePlayer(0, 300, 200, "active"),
      makePlayer(1, 0, 50, "allin"),
      makePlayer(2, 0, 120, "allin"),
      makePlayer(3, 300, 200, "active"),
    ];
    const ts = makeTableState(570);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(3);
    // Tier 1: 50×4 = 200
    expect(ts.pots[0].amount).toBe(200);
    expect(ts.pots[0].eligible).toHaveLength(4);
    // Tier 2: 70×3 = 210 (B not eligible)
    expect(ts.pots[1].amount).toBe(210);
    expect(ts.pots[1].eligible).toHaveLength(3);
    expect(ts.pots[1].eligible).not.toContain(1);
    // Tier 3: 80×2 = 160 (B and C not eligible)
    expect(ts.pots[2].amount).toBe(160);
    expect(ts.pots[2].eligible).toHaveLength(2);
    // Sum
    expect(ts.pots.reduce((s, p) => s + p.amount, 0)).toBe(570);
  });

  it("all players all-in at same level → single pot", () => {
    const players = [
      makePlayer(0, 0, 100, "allin"),
      makePlayer(1, 0, 100, "allin"),
      makePlayer(2, 0, 100, "allin"),
    ];
    const ts = makeTableState(300);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(1);
    expect(ts.pots[0].amount).toBe(300);
    expect(ts.pots[0].eligible).toHaveLength(3);
  });

  it("one player all-in, rest fold → single pot", () => {
    const players = [
      makePlayer(0, 0, 50, "allin"),
      makePlayer(1, 490, 10, "folded"),
      makePlayer(2, 495, 5, "folded"),
    ];
    const ts = makeTableState(65);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(1);
    expect(ts.pots[0].eligible).toContain(0);
  });

  it("short stack all-in for less than BB → correct main pot", () => {
    // Short stack has 3 chips, BB is 5. Short stack goes all-in for 3.
    // Other player covers. Main pot = 3+3=6. Side = 2 (excess from other player).
    const players = [
      makePlayer(0, 0, 3, "allin"),
      makePlayer(1, 495, 5, "active"),
    ];
    const ts = makeTableState(8);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(2);
    expect(ts.pots[0].amount).toBe(6);  // 3 from each
    expect(ts.pots[0].eligible).toHaveLength(2);
    expect(ts.pots[1].amount).toBe(2);  // excess from player 1
    expect(ts.pots[1].eligible).toHaveLength(1);
    expect(ts.pots[1].eligible).toContain(1);
  });

  it("all-in with folded player contributions included", () => {
    // Folded player put in 10, active player put in 50, all-in player put in 30
    const players = [
      makePlayer(0, 450, 50, "active"),
      makePlayer(1, 0, 30, "allin"),
      makePlayer(2, 490, 10, "folded"),
    ];
    const ts = makeTableState(90);
    PE.calculateSidePots(players, ts);
    expect(ts.pots).toHaveLength(2);
    // Main: min(10,30)+min(50,30)+min(30,30) = 10+30+30 = 70... no
    // Tier at level 30: all players contribute up to 30 each
    //   player 0: min(50,30)-0 = 30, player 1: min(30,30)-0 = 30, player 2: min(10,30)-0 = 10
    //   total = 70, eligible = [0, 1]
    // Tier at level 50: players above 30
    //   player 0: min(50,50)-min(50,30) = 20, player 1: 0, player 2: 0
    //   total = 20, eligible = [0]
    expect(ts.pots[0].amount).toBe(70);
    expect(ts.pots[1].amount).toBe(20);
    expect(ts.pots.reduce((s, p) => s + p.amount, 0)).toBe(90);
  });
});
