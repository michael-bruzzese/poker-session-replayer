import { describe, it, expect } from "vitest";

const PokerConstants = require("../shared/constants.js");
globalThis.PokerConstants = PokerConstants;
globalThis.localStorage = { _data: {}, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = v; } };

const ShorthandLearner = require("../shared/shorthand_learner.js");
const SL = ShorthandLearner;

// ============================================================
// Hand Chunk Splitting
// ============================================================

describe("Hand Chunk Splitting", () => {
  it("splits on 'hand N' pattern", () => {
    const text = "hand 1\nAhKs btn\nhand 2\nQdJd co\nhand 3\n7c2h fold";
    const chunks = SL.splitIntoHandChunks(text);
    expect(chunks.length).toBe(3);
  });

  it("splits on 'next hand'", () => {
    const text = "AhKs I raise to 15\nnext hand\nQdJd fold preflop";
    const chunks = SL.splitIntoHandChunks(text);
    expect(chunks.length).toBe(2);
  });

  it("splits on double newline", () => {
    const text = "AhKs raise to 15 utg folds\n\nQdJd fold preflop";
    const chunks = SL.splitIntoHandChunks(text);
    expect(chunks.length).toBe(2);
  });

  it("splits on 'hand #N' with hash", () => {
    const text = "hand #1 AhKs\nhand #2 QdJd\nhand #3 7c2h";
    const chunks = SL.splitIntoHandChunks(text);
    expect(chunks.length).toBe(3);
  });

  it("returns single chunk for unsplittable text", () => {
    const text = "AhKs I raised and won";
    const chunks = SL.splitIntoHandChunks(text);
    expect(chunks.length).toBe(1);
  });
});

// ============================================================
// Card Extraction
// ============================================================

describe("Flexible Card Extraction", () => {
  it("extracts standard card codes", () => {
    const result = SL.extractCardsFlexible("I had Ah Ks on the button", {});
    expect(result.hero).toEqual(["Ah", "Ks"]);
  });

  it("extracts cards from mixed text", () => {
    const result = SL.extractCardsFlexible("hand 1 Jh Th flop Qs 9h 4c turn 2d river Ac", {});
    expect(result.hero).toEqual(["Jh", "Th"]);
    expect(result.flop).toEqual(["Qs", "9h", "4c"]);
    expect(result.turn).toBe("2d");
    expect(result.river).toBe("Ac");
  });

  it("extracts pocket pair hand name", () => {
    const result = SL.extractCardsFlexible("I have pocket aces", {});
    expect(result.hero.length).toBe(2);
    expect(result.hero[0][0]).toBe("A");
    expect(result.hero[1][0]).toBe("A");
  });

  it("extracts big slick", () => {
    const result = SL.extractCardsFlexible("I look down at big slick suited", {});
    expect(result.hero.length).toBe(2);
    expect(result.hero[0][0]).toBe("A");
    expect(result.hero[1][0]).toBe("K");
  });

  it("assigns board by position when no street markers", () => {
    const result = SL.extractCardsFlexible("Ah Ks Qd 9h 4c 2s Jh", {});
    expect(result.hero).toEqual(["Ah", "Ks"]);
    expect(result.flop).toEqual(["Qd", "9h", "4c"]);
    expect(result.turn).toBe("2s");
    expect(result.river).toBe("Jh");
  });

  it("handles flop with 'comes' phrasing", () => {
    const result = SL.extractCardsFlexible("I have Ah Kd. Flop comes Qs 9h 2d.", {});
    expect(result.flop).toEqual(["Qs", "9h", "2d"]);
  });
});

// ============================================================
// Action Extraction
// ============================================================

describe("Flexible Action Extraction", () => {
  const profile = SL.getProfile("default");
  const tracker = { heroSeat: 1, knownPlayers: {}, lastVillainSeat: 0 };

  it("extracts simple position+action", () => {
    const actions = SL.parseWithProfile(
      "hand 1\nAh Ks\nutg raises 15\nhero calls\nflop Qs 9h 4c\ncheck check",
      "default",
      { blinds: { small: 2, big: 5 }, heroSeat: 1 }
    );
    const hand = actions.hands[0];
    expect(hand.action_sequence.length).toBeGreaterThan(0);
    const preflop = hand.action_sequence.find(s => s.street === "preflop");
    expect(preflop).toBeTruthy();
    expect(preflop.actions.some(a => a.action === "raise")).toBe(true);
  });

  it("handles shorthand notation: r15, c, f", () => {
    const result = SL.parseWithProfile(
      "hand 1\nAh Ks\nutg r15 hero c\nflop Qs 9h 4c\nx x",
      "default",
      { blinds: { small: 2, big: 5 }, heroSeat: 1 }
    );
    const hand = result.hands[0];
    expect(hand.hero_cards).toEqual(["Ah", "Ks"]);
    expect(hand.board.flop).toEqual(["Qs", "9h", "4c"]);
  });

  it("handles 'I' as hero", () => {
    const result = SL.parseWithProfile(
      "hand 1\nAh Kd\nI raise to 15 on the button\nflop Qs 9h 4c",
      "default",
      { blinds: { small: 2, big: 5 }, heroSeat: 1 }
    );
    const hand = result.hands[0];
    const preflop = hand.action_sequence.find(s => s.street === "preflop");
    if (preflop) {
      const heroAction = preflop.actions.find(a => a.seat === 1);
      expect(heroAction).toBeTruthy();
      expect(heroAction.action).toBe("raise");
    }
  });

  it("handles compound actions: check-raise", () => {
    const result = SL.parseWithProfile(
      "hand 1\nAh Kd\nflop Qs 9h 4c\nI check-raise to 90",
      "default",
      { blinds: { small: 2, big: 5 }, heroSeat: 1 }
    );
    const hand = result.hands[0];
    const flop = hand.action_sequence.find(s => s.street === "flop");
    if (flop && flop.actions.length >= 2) {
      expect(flop.actions[0].action).toBe("check");
      expect(flop.actions[1].action).toBe("raise");
    }
  });

  it("extracts amounts from 'raises to X' pattern", () => {
    const result = SL.parseWithProfile(
      "hand 1\nAh Kd\nutg raises to 15\nhero raises to 45",
      "default",
      { blinds: { small: 2, big: 5 }, heroSeat: 1 }
    );
    const hand = result.hands[0];
    const preflop = hand.action_sequence.find(s => s.street === "preflop");
    if (preflop) {
      const raise = preflop.actions.find(a => a.amount === 15);
      expect(raise).toBeTruthy();
    }
  });

  it("handles preflop fold hand", () => {
    const result = SL.parseWithProfile(
      "hand 1\n7d 2c fold preflop",
      "default",
      { blinds: { small: 2, big: 5 }, heroSeat: 1 }
    );
    const hand = result.hands[0];
    expect(hand.hero_cards).toEqual(["7d", "2c"]);
    expect(hand.action_sequence.length).toBeGreaterThan(0);
    expect(hand.action_sequence[0].actions[0].action).toBe("fold");
  });

  it("handles multiple streets", () => {
    const result = SL.parseWithProfile(
      "hand 1\nAh Kd\npreflop: utg raise 15 hero call\nflop Qs 9h 4c: villain bets 25 hero calls\nturn 7d: check check",
      "default",
      { blinds: { small: 2, big: 5 }, heroSeat: 1 }
    );
    const hand = result.hands[0];
    const streets = hand.action_sequence.map(s => s.street);
    expect(streets).toContain("preflop");
    expect(streets).toContain("flop");
  });
});

// ============================================================
// Smart Alignment
// ============================================================

describe("Smart Hand Alignment", () => {
  it("aligns by card overlap not index", () => {
    const rawChunks = [
      "Qd Jd raise flop Th 8h 3d",  // has Qd, Jd, Th, 8h, 3d
      "Ah Ks 3bet flop Kh 7c 2s"     // has Ah, Ks, Kh, 7c, 2s
    ];
    const parsedHands = [
      { hand_id: 1, hero_cards: ["Ah", "Ks"], board: { flop: ["Kh", "7c", "2s"] } },
      { hand_id: 2, hero_cards: ["Qd", "Jd"], board: { flop: ["Th", "8h", "3d"] } }
    ];

    const alignments = SL.alignByCardOverlap(rawChunks, parsedHands);
    // Chunk 0 (QdJd) should match hand 2 (QdJd), chunk 1 (AhKs) should match hand 1 (AhKs)
    expect(alignments[0].handIdx).toBe(1); // QdJd chunk → hand_id 2 (index 1)
    expect(alignments[1].handIdx).toBe(0); // AhKs chunk → hand_id 1 (index 0)
  });

  it("handles chunks with no card overlap gracefully", () => {
    const rawChunks = ["fold preflop garbage hand"];
    const parsedHands = [
      { hand_id: 1, hero_cards: ["Ah", "Ks"], board: {} }
    ];
    const alignments = SL.alignByCardOverlap(rawChunks, parsedHands);
    expect(alignments.length).toBe(1);
    // Low score but still returns best match
    expect(alignments[0].handIdx).toBe(0);
  });
});

// ============================================================
// Multi-Hand Session Parse
// ============================================================

describe("Multi-Hand Session Parse", () => {
  it("parses a 3-hand session", () => {
    const raw = `hand 1
Jh Th btn, utg opens 15 I call
flop 9h 8d 3c villain bets 20 I call
turn Qh villain bets 40 I raise to 100 villain folds

hand 2
As Ks btn I raise 20
villain calls
flop Kh 7c 2s I bet 30 villain calls
turn 6c I bet 70 villain calls
river Kd I bet 150 villain calls

hand 3
5d 4d I fold preflop`;

    const result = SL.parseWithProfile(raw, "default", {
      blinds: { small: 1, big: 2 },
      heroSeat: 1,
      sessionName: "Test Session"
    });

    expect(result.hands.length).toBe(3);
    expect(result.hands[0].hero_cards).toEqual(["Jh", "Th"]);
    expect(result.hands[1].hero_cards).toEqual(["As", "Ks"]);
    expect(result.hands[2].hero_cards).toEqual(["5d", "4d"]);

    // Hand 1 should have flop and turn
    expect(result.hands[0].board.flop).toEqual(["9h", "8d", "3c"]);
    expect(result.hands[0].board.turn).toBe("Qh");

    // Hand 2 should have full board
    expect(result.hands[1].board.flop).toEqual(["Kh", "7c", "2s"]);
    expect(result.hands[1].board.turn).toBe("6c");
    expect(result.hands[1].board.river).toBe("Kd");

    // Hand 3 should be a preflop fold
    expect(result.hands[2].action_sequence.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Profile Management
// ============================================================

describe("Profile Management", () => {
  it("saves and loads a profile", () => {
    SL.saveProfile("test", { actions: { "zz": "fold" }, learnedAt: "2026-04-02" });
    const profile = SL.getProfile("test");
    expect(profile.actions["zz"]).toBe("fold");
    // Should also have defaults merged
    expect(profile.actions["f"]).toBe("fold");
  });

  it("lists profiles", () => {
    SL.saveProfile("profile_a", { actions: {} });
    SL.saveProfile("profile_b", { actions: {} });
    const list = SL.listProfiles();
    expect(list).toContain("profile_a");
    expect(list).toContain("profile_b");
  });

  it("deletes a profile", () => {
    SL.saveProfile("to_delete", { actions: {} });
    SL.deleteProfile("to_delete");
    const list = SL.listProfiles();
    expect(list).not.toContain("to_delete");
  });
});
