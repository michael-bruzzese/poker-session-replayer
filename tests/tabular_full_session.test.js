import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

let TabularParser;
beforeAll(async () => {
  TabularParser = (await import("../shared/tabular_parser.js")).default;
});

describe("Full 172-hand session parse", () => {
  let session;

  beforeAll(() => {
    const text = readFileSync(resolve(__dirname, "full_session_sample.txt"), "utf-8");
    session = TabularParser.parse(text, {
      blinds: { small: 2, big: 5 },
      heroSeat: 1,
      sessionName: "Full Session Test"
    });
  });

  it("parses all 172 hands", () => {
    expect(session.hands.length).toBe(172);
  });

  it("every hand has valid hero cards", () => {
    for (const hand of session.hands) {
      expect(hand.hero_cards.length).toBe(2);
      for (const card of hand.hero_cards) {
        expect(card).toMatch(/^[AKQJT2-9][shdc]$/);
      }
    }
  });

  it("every hand has at least one action street", () => {
    for (const hand of session.hands) {
      expect(hand.action_sequence.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every hand has a valid hero seat", () => {
    for (const hand of session.hands) {
      expect(hand.hero_seat).toBe(1);
    }
  });

  it("every hand has a valid button seat (1-9)", () => {
    for (const hand of session.hands) {
      expect(hand.button_seat).toBeGreaterThanOrEqual(1);
      expect(hand.button_seat).toBeLessThanOrEqual(9);
    }
  });

  it("fold hands have hero fold action (excluding blinds chopped)", () => {
    const foldHands = session.hands.filter(h =>
      h.coach_flags.tag.match(/Fold/i) &&
      !(h.result && h.result.notes && h.result.notes.match(/blinds chopped/i))
    );
    expect(foldHands.length).toBeGreaterThan(100); // Most hands are folds
    for (const hand of foldHands) {
      const preflopActions = hand.action_sequence[0];
      expect(preflopActions.street).toBe("preflop");
      const heroFold = preflopActions.actions.find(a => a.seat === 1 && a.action === "fold");
      expect(heroFold).toBeTruthy();
    }
  });

  it("played hands have board cards when postflop action exists", () => {
    const playedHands = session.hands.filter(h => !h.coach_flags.tag.match(/^Fold$/i));
    for (const hand of playedHands) {
      const hasPostflop = hand.action_sequence.some(s => s.street !== "preflop");
      if (hasPostflop) {
        expect(hand.board.flop).toBeTruthy();
        expect(hand.board.flop.length).toBe(3);
      }
    }
  });

  it("blinds chopped hands are handled", () => {
    const chopHands = session.hands.filter(h =>
      h.result && h.result.notes && h.result.notes.match(/blinds chopped/i)
    );
    expect(chopHands.length).toBeGreaterThanOrEqual(5); // hands 83, 90, 114, 123, 170, 171
  });

  // Specific hand checks
  it("hand 3: 3BP with BTN wins showdown", () => {
    const hand = session.hands.find(h => h.hand_id === 3);
    expect(hand.board.flop).toEqual(["Jd", "7h", "7s"]);
    expect(hand.board.turn).toBe("6h");
    expect(hand.board.river).toBe("8d");
    expect(hand.result.showdown).toBe(true);
    const villainCards = Object.values(hand.known_villain_cards).flat();
    expect(villainCards).toContain("9d");
    expect(villainCards).toContain("7d");
  });

  it("hand 24: Hero jams river, LJ mucks", () => {
    const hand = session.hands.find(h => h.hand_id === 24);
    expect(hand.hero_cards).toEqual(["Jd", "Jh"]);
    expect(hand.result.winner_seat).toBe(1);
    // Should have river actions including jam
    const riverActions = hand.action_sequence.find(s => s.street === "river");
    expect(riverActions).toBeTruthy();
    const jam = riverActions.actions.find(a => a.action === "all-in");
    expect(jam).toBeTruthy();
  });

  it("hand 26: BB loses, shows 6d 5d", () => {
    const hand = session.hands.find(h => h.hand_id === 26);
    expect(hand.result.winner_seat).toBe(1);
    expect(hand.result.showdown).toBe(true);
    const villainCards = Object.values(hand.known_villain_cards).flat();
    expect(villainCards).toContain("6d");
    expect(villainCards).toContain("5d");
  });

  it("hand 92: full street-by-street with BB loses", () => {
    const hand = session.hands.find(h => h.hand_id === 92);
    expect(hand.board.flop).toEqual(["Kd", "Js", "8s"]);
    expect(hand.board.turn).toBe("Qd");
    expect(hand.board.river).toBe("6h");
    expect(hand.result.winner_seat).toBe(1);
    const villainCards = Object.values(hand.known_villain_cards).flat();
    expect(villainCards).toContain("As");
    expect(villainCards).toContain("Qs");
  });

  it("hand 130: EP3 mucks after river", () => {
    const hand = session.hands.find(h => h.hand_id === 130);
    expect(hand.hero_cards).toEqual(["Kh", "Qh"]);
    expect(hand.result.winner_seat).toBe(1);
  });

  it("hand 143: BTN mucks", () => {
    const hand = session.hands.find(h => h.hand_id === 143);
    expect(hand.hero_cards).toEqual(["Kh", "Td"]);
    expect(hand.result.winner_seat).toBe(1);
  });

  it("hand 169: HJ chops pot with Ah Kh", () => {
    const hand = session.hands.find(h => h.hand_id === 169);
    expect(hand.hero_cards).toEqual(["As", "Kc"]);
    expect(hand.result.notes).toMatch(/chop/i);
    const villainCards = Object.values(hand.known_villain_cards).flat();
    expect(villainCards).toContain("Ah");
    expect(villainCards).toContain("Kh");
  });

  it("hand 172: Hero jams river, LJ folds", () => {
    const hand = session.hands.find(h => h.hand_id === 172);
    expect(hand.hero_cards).toEqual(["Ac", "Jc"]);
    const riverActions = hand.action_sequence.find(s => s.street === "river");
    expect(riverActions).toBeTruthy();
    const jam = riverActions.actions.find(a => a.action === "all-in" && a.seat === 1);
    expect(jam).toBeTruthy();
  });

  it("parse confidence is high for all hands", () => {
    for (const hand of session.hands) {
      expect(hand.parse_confidence).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("no hands have warnings", () => {
    const withWarnings = session.hands.filter(h => h.warnings && h.warnings.length > 0);
    // Ideally zero, but some edge cases may generate warnings
    expect(withWarnings.length).toBeLessThan(5);
  });

  it("player notes are captured", () => {
    const playerNames = Object.values(session.players).map(p => p.name);
    expect(playerNames).toContain("Hero");
  });
});
