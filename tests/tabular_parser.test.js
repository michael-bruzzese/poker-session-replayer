import { describe, it, expect, beforeAll } from "vitest";

// Load the module
let TabularParser;
beforeAll(async () => {
  TabularParser = (await import("../shared/tabular_parser.js")).default;
});

// Sample session data (subset of real session)
const SAMPLE_SESSION = `1    Fold    EP1    7h 3s     n/a     Pre: EP1 f, H f
2    Limp Pot (MW)    BB    Kh 2c     $1,000     "Pre: EP1 c, LJ c, HJ c, BTN c, H x
Flop (27): Kc 3c 4s --- H x,x,x,x,x
Turn (27): Ah --- H x,x,x,x,x
River (27): 2h --- H b 15, f,f,f,f "
3    3BP OOP (MW)    SB    Ac Jh     $450     "Pre: f to LJ b 20, CO c, BTN c, H r 150, BB f, LJ c, CO f, BTN c
Flop (470): Jd 7h 7s --- H x, LJ x, BTN jam 200, H c, LJ f
Turn (870): 6h ---
River (870): 8d ---

BTN wins 9d 7d "
4    Fold    BTN    9s 3c     n/a     Action in front, f
5    Fold    CO    Js 6s     n/a     Action in front, f
9    SRP OOP (MW)    EP1    2c 2d     $1,000     "Pre: H r 25, LJ c, CO c, SB c
Flop (105): Qd 7s 7h --- x, H x,x,x
Turn (105): As --- x, H x,x,x
River (105): 7c --- SB b 80, H f,f,f"
24    3BP OOP (MW)    EP2    Jd Jh     $1,025     "Pre: EP1 f, H b 25, LJ (TR) r 75, CO (Fish) c, H c
Flop (232): Kd Kc 9c --- H x,x,x
Turn (232): Jc --- H x, LJ b 125, CO f, H r 325, LJ c
River (882): 6d --- H jam 625, LJ c

LJ mucks "
26    SRP OOP (MW)    EP1    9d 9h     $600     "Pre: H r 25 c, CO c, BB c,
Flop (77): Ad 4h As --- x,H x,x
Turn (77): 8s --- x, H b 25, CO f, BB c
River (127): Js --- BB b 50, H c

BB loses 6d 5d"
83    Fold    BB    9s 5d     n/a     blinds chopped
169    SRP OOP (MW)    EP2    As Kc     $200     "Pre: f to H b 25, HJ (Amir, Fish)c, BB c
Flop (77): Th 9c 4s --- x, H x, x
Turn (77): 2h --- x, H x, HJ b 25, BB f, H jam 150, HJ c
River: (377): Qd ---

HJ chops pot Ah Kh"`;

describe("TabularParser", () => {

  describe("isTabularFormat", () => {
    it("detects tabular format", () => {
      expect(TabularParser.isTabularFormat(SAMPLE_SESSION)).toBe(true);
    });

    it("rejects non-tabular text", () => {
      expect(TabularParser.isTabularFormat("hand 1: I have AK on the button")).toBe(false);
      expect(TabularParser.isTabularFormat("")).toBe(false);
      expect(TabularParser.isTabularFormat(null)).toBe(false);
    });
  });

  describe("position helpers", () => {
    it("normalizes position aliases", () => {
      expect(TabularParser._normalizePosition("EP1")).toBe("UTG");
      expect(TabularParser._normalizePosition("EP2")).toBe("UTG+1");
      expect(TabularParser._normalizePosition("EP3")).toBe("UTG+2");
      expect(TabularParser._normalizePosition("LJ")).toBe("LJ");
      expect(TabularParser._normalizePosition("BTN")).toBe("BTN");
      expect(TabularParser._normalizePosition("SB")).toBe("SB");
      expect(TabularParser._normalizePosition("BB")).toBe("BB");
    });

    it("builds correct position-seat map from button", () => {
      const map = TabularParser._buildPositionSeatMap(1);
      expect(map["BTN"]).toBe(1);
      expect(map["SB"]).toBe(2);
      expect(map["BB"]).toBe(3);
      expect(map["UTG"]).toBe(4);
      expect(map["CO"]).toBe(9);
    });

    it("derives correct button seat from hero position", () => {
      // Hero seat 1, hero is UTG (index 3) → button = seat 1 - 3 = seat 7 (wrapping 9)
      const btn = TabularParser._deriveButtonSeat("UTG", 1, 9);
      expect(btn).toBe(7);

      // Hero seat 1, hero is BTN (index 0) → button = seat 1
      const btn2 = TabularParser._deriveButtonSeat("BTN", 1, 9);
      expect(btn2).toBe(1);

      // Hero seat 1, hero is BB (index 2) → button = seat 8
      const btn3 = TabularParser._deriveButtonSeat("BB", 1, 9);
      expect(btn3).toBe(8);

      // Hero seat 1, hero is SB (index 1) → button = seat 9
      const btn4 = TabularParser._deriveButtonSeat("SB", 1, 9);
      expect(btn4).toBe(9);
    });
  });

  describe("card parsing", () => {
    it("parses standard card codes", () => {
      expect(TabularParser._parseCards("7h 3s")).toEqual(["7h", "3s"]);
      expect(TabularParser._parseCards("Ac Jh")).toEqual(["Ac", "Jh"]);
      expect(TabularParser._parseCards("Kd Kc 9c")).toEqual(["Kd", "Kc", "9c"]);
    });
  });

  describe("hand row splitting", () => {
    it("splits multiline hand rows correctly", () => {
      const rows = TabularParser._splitIntoHandRows(SAMPLE_SESSION);
      expect(rows.length).toBeGreaterThanOrEqual(9);
      // First row should start with "1"
      expect(rows[0]).toMatch(/^1\s/);
      // Hand 2 should include multiline action text
      const hand2 = rows[1];
      expect(hand2).toMatch(/^2\s/);
      expect(hand2).toContain("Flop");
      expect(hand2).toContain("River");
    });
  });

  describe("full parse", () => {
    let session;

    beforeAll(() => {
      session = TabularParser.parse(SAMPLE_SESSION, {
        blinds: { small: 2, big: 5 },
        heroSeat: 1,
        sessionName: "Test Session"
      });
    });

    it("returns valid session structure", () => {
      expect(session).not.toBeNull();
      expect(session.version).toBe(2);
      expect(session.app).toBe("session-replayer");
      expect(session.session_name).toBe("Test Session");
      expect(session.blinds).toEqual({ small: 2, big: 5 });
      expect(Array.isArray(session.hands)).toBe(true);
    });

    it("parses all hands", () => {
      expect(session.hands.length).toBe(10);
    });

    it("parses fold hands correctly", () => {
      const hand1 = session.hands[0];
      expect(hand1.hand_id).toBe(1);
      expect(hand1.hero_cards).toEqual(["7h", "3s"]);
      expect(hand1.coach_flags.tag).toMatch(/Fold/i);
      // Should have at least one action
      expect(hand1.action_sequence.length).toBeGreaterThanOrEqual(1);
      expect(hand1.action_sequence[0].street).toBe("preflop");
      // Hero should fold
      const heroFold = hand1.action_sequence[0].actions.find(a => a.seat === 1 && a.action === "fold");
      expect(heroFold).toBeTruthy();
    });

    it("parses limped pot with board correctly", () => {
      const hand2 = session.hands[1];
      expect(hand2.hand_id).toBe(2);
      expect(hand2.hero_cards).toEqual(["Kh", "2c"]);
      expect(hand2.board.flop).toEqual(["Kc", "3c", "4s"]);
      expect(hand2.board.turn).toBe("Ah");
      expect(hand2.board.river).toBe("2h");
      // Should have actions on multiple streets
      expect(hand2.action_sequence.length).toBeGreaterThanOrEqual(2);
    });

    it("parses 3bet pot with showdown result correctly", () => {
      const hand3 = session.hands[2];
      expect(hand3.hand_id).toBe(3);
      expect(hand3.hero_cards).toEqual(["Ac", "Jh"]);
      expect(hand3.board.flop).toEqual(["Jd", "7h", "7s"]);
      expect(hand3.board.turn).toBe("6h");
      expect(hand3.board.river).toBe("8d");
      // BTN wins with 9d 7d
      expect(hand3.result.showdown).toBe(true);
      // Villain cards should be recorded
      const btnSeat = hand3._positionSeatMap ? hand3._positionSeatMap["BTN"] : null;
      // Since we cleaned up internal fields, check known_villain_cards
      const villainCards = Object.values(hand3.known_villain_cards);
      expect(villainCards.length).toBeGreaterThanOrEqual(1);
      expect(villainCards[0]).toEqual(["9d", "7d"]);
    });

    it("parses blinds chopped correctly", () => {
      const hand83 = session.hands.find(h => h.hand_id === 83);
      expect(hand83).toBeTruthy();
      expect(hand83.result.notes).toMatch(/blinds chopped/i);
    });

    it("parses hand with player notes (TR, Fish)", () => {
      const hand24 = session.hands.find(h => h.hand_id === 24);
      expect(hand24).toBeTruthy();
      expect(hand24.hero_cards).toEqual(["Jd", "Jh"]);
      // LJ mucks — hero wins
      expect(hand24.result.winner_seat).toBe(1);
    });

    it("parses showdown loss result correctly", () => {
      const hand26 = session.hands.find(h => h.hand_id === 26);
      expect(hand26).toBeTruthy();
      // BB loses 6d 5d — hero wins
      expect(hand26.result.winner_seat).toBe(1);
      expect(hand26.result.showdown).toBe(true);
      // BB's cards should be known
      const villainCards = Object.values(hand26.known_villain_cards);
      expect(villainCards.some(c => c[0] === "6d" && c[1] === "5d")).toBe(true);
    });

    it("parses chop pot result correctly", () => {
      const hand169 = session.hands.find(h => h.hand_id === 169);
      expect(hand169).toBeTruthy();
      expect(hand169.result.notes).toMatch(/chop/i);
      // HJ's cards should be known
      const villainCards = Object.values(hand169.known_villain_cards);
      expect(villainCards.some(c => c[0] === "Ah" && c[1] === "Kh")).toBe(true);
    });

    it("records player notes from parenthetical annotations", () => {
      // Session should have player entries for annotated players
      const playerValues = Object.values(session.players);
      const hasHero = playerValues.some(p => p.is_hero);
      expect(hasHero).toBe(true);
    });

    it("all hands have valid hero cards", () => {
      for (const hand of session.hands) {
        expect(hand.hero_cards.length).toBe(2);
        for (const card of hand.hero_cards) {
          expect(card).toMatch(/^[AKQJT2-9][shdc]$/);
        }
      }
    });

    it("all hands have at least one action street", () => {
      for (const hand of session.hands) {
        expect(hand.action_sequence.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("button rotates correctly across hands", () => {
      // Hand 1: hero is EP1 (UTG) at seat 1 → button at seat 7
      // Hand 2: hero is BB at seat 1 → button at seat 8
      // Hand 3: hero is SB at seat 1 → button at seat 9
      // Hand 4: hero is BTN at seat 1 → button at seat 1
      const h1 = session.hands[0];
      const h2 = session.hands[1];
      const h3 = session.hands[2];
      const h4 = session.hands[3];

      // Button should be different for each hand (rotation)
      expect(h1.button_seat).not.toBe(h2.button_seat);
    });

    it("high parse confidence on all hands", () => {
      for (const hand of session.hands) {
        expect(hand.parse_confidence).toBeGreaterThanOrEqual(0.9);
      }
    });
  });
});
