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
