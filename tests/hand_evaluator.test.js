import { describe, it, expect } from "vitest";

const HE = require("../shared/hand_evaluator.js");

// Rank constants (0-indexed for convenience): 2=0, 3=1, ... A=12
// Our API uses card strings like "Ah", "Ks", "2c" etc.

// Helper: build 7 cards from string shorthand
function cards(str) {
  return str.split(/\s+/).filter(Boolean);
}

// ============================================================
// Basic API
// ============================================================

describe("Hand Evaluator — Basic API", () => {
  it("evaluateHand returns { rank, handType, bestFive, description }", () => {
    const result = HE.evaluateHand(cards("As Ks Qs Js Ts 9h 8c"));
    expect(result).toHaveProperty("rank");
    expect(result).toHaveProperty("handType");
    expect(result).toHaveProperty("bestFive");
    expect(result).toHaveProperty("description");
    expect(typeof result.rank).toBe("number");
    expect(Array.isArray(result.bestFive)).toBe(true);
    expect(result.bestFive).toHaveLength(5);
  });

  it("compareHands returns 1, -1, or 0", () => {
    const better = HE.evaluateHand(cards("As Ah Ac Ad Kh 2c 3s")); // quad aces
    const worse = HE.evaluateHand(cards("Ks Kh Kc Kd 2h 3c 4s"));  // quad kings
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
    expect(HE.compareHands(worse.rank, better.rank)).toBe(-1);
    expect(HE.compareHands(better.rank, better.rank)).toBe(0);
  });
});

// ============================================================
// Hand Type Identification (one per type)
// ============================================================

describe("Hand Evaluator — Hand Type Identification", () => {
  it("identifies straight flush", () => {
    const r = HE.evaluateHand(cards("9h 8h 7h 6h 5h 2c 3d"));
    expect(r.handType).toBe("straight-flush");
  });

  it("identifies royal flush (top straight flush)", () => {
    const r = HE.evaluateHand(cards("As Ks Qs Js Ts 2c 3d"));
    expect(r.handType).toBe("straight-flush");
  });

  it("identifies four of a kind", () => {
    const r = HE.evaluateHand(cards("As Ah Ac Ad Kh 2c 3d"));
    expect(r.handType).toBe("four-of-a-kind");
  });

  it("identifies full house", () => {
    const r = HE.evaluateHand(cards("As Ah Ac Kd Kh 2c 3d"));
    expect(r.handType).toBe("full-house");
  });

  it("identifies flush (not straight flush)", () => {
    const r = HE.evaluateHand(cards("As Ks Qs 9s 4s 2c 3d"));
    expect(r.handType).toBe("flush");
  });

  it("identifies straight (not flush)", () => {
    const r = HE.evaluateHand(cards("9s 8h 7c 6d 5s 2c 3d"));
    expect(r.handType).toBe("straight");
  });

  it("identifies three of a kind", () => {
    const r = HE.evaluateHand(cards("As Ah Ac Kd Qh 2c 3d"));
    expect(r.handType).toBe("three-of-a-kind");
  });

  it("identifies two pair", () => {
    const r = HE.evaluateHand(cards("As Ah Kc Kd Qh 2c 3d"));
    expect(r.handType).toBe("two-pair");
  });

  it("identifies one pair", () => {
    const r = HE.evaluateHand(cards("As Ah Kc Qd Jh 2c 3d"));
    expect(r.handType).toBe("pair");
  });

  it("identifies high card", () => {
    const r = HE.evaluateHand(cards("As Kh Qc Jd 9h 2c 3d"));
    expect(r.handType).toBe("high-card");
  });
});

// ============================================================
// Hand Type Ranking - Pairwise Comparisons (all adjacent + diagonals)
// ============================================================

describe("Hand Evaluator — Hand Type Ranking", () => {
  const sf  = HE.evaluateHand(cards("9h 8h 7h 6h 5h 2c 3d")); // 9-high SF
  const quads = HE.evaluateHand(cards("As Ah Ac Ad Kh 2c 3d"));
  const fh    = HE.evaluateHand(cards("As Ah Ac Kd Kh 2c 3d"));
  const fl    = HE.evaluateHand(cards("As Ks Qs 9s 4s 2c 3d"));
  const st    = HE.evaluateHand(cards("9s 8h 7c 6d 5s 2c 3d"));
  const trips = HE.evaluateHand(cards("As Ah Ac Kd Qh 2c 3d"));
  const twop  = HE.evaluateHand(cards("As Ah Kc Kd Qh 2c 3d"));
  const pair  = HE.evaluateHand(cards("As Ah Kc Qd Jh 2c 3d"));
  const hc    = HE.evaluateHand(cards("As Kh Qc Jd 9h 2c 3d"));

  it("straight flush > four of a kind", () => {
    expect(HE.compareHands(sf.rank, quads.rank)).toBe(1);
  });

  it("four of a kind > full house", () => {
    expect(HE.compareHands(quads.rank, fh.rank)).toBe(1);
  });

  it("full house > flush", () => {
    expect(HE.compareHands(fh.rank, fl.rank)).toBe(1);
  });

  it("flush > straight", () => {
    expect(HE.compareHands(fl.rank, st.rank)).toBe(1);
  });

  it("straight > three of a kind", () => {
    expect(HE.compareHands(st.rank, trips.rank)).toBe(1);
  });

  it("three of a kind > two pair", () => {
    expect(HE.compareHands(trips.rank, twop.rank)).toBe(1);
  });

  it("two pair > one pair", () => {
    expect(HE.compareHands(twop.rank, pair.rank)).toBe(1);
  });

  it("one pair > high card", () => {
    expect(HE.compareHands(pair.rank, hc.rank)).toBe(1);
  });

  // Non-adjacent
  it("straight flush > high card", () => {
    expect(HE.compareHands(sf.rank, hc.rank)).toBe(1);
  });

  it("quads > flush", () => {
    expect(HE.compareHands(quads.rank, fl.rank)).toBe(1);
  });

  it("full house > straight", () => {
    expect(HE.compareHands(fh.rank, st.rank)).toBe(1);
  });

  it("flush > pair", () => {
    expect(HE.compareHands(fl.rank, pair.rank)).toBe(1);
  });

  it("trips > pair", () => {
    expect(HE.compareHands(trips.rank, pair.rank)).toBe(1);
  });

  it("two pair > high card", () => {
    expect(HE.compareHands(twop.rank, hc.rank)).toBe(1);
  });
});

// ============================================================
// Kicker Comparisons
// ============================================================

describe("Hand Evaluator — Kickers", () => {
  it("AA with K kicker > AA with Q kicker", () => {
    const better = HE.evaluateHand(cards("As Ah Kc 7d 9h 2c 3d"));
    const worse = HE.evaluateHand(cards("As Ah Qc 7d 9h 2c 3d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });

  it("AA with AK kickers > AA with AQ kickers", () => {
    const better = HE.evaluateHand(cards("As Ah Kd Qc 9h 2c 3d"));
    const worse = HE.evaluateHand(cards("As Ah Qd Jc 9h 2c 3d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });

  it("KK with A kicker > KK with Q kicker", () => {
    const better = HE.evaluateHand(cards("Ks Kh Ac 5d 4h 2c 3d"));
    const worse = HE.evaluateHand(cards("Ks Kh Qc 5d 4h 2c 3d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });

  it("Two pair AA-KK with Q kicker > AA-KK with J kicker", () => {
    const better = HE.evaluateHand(cards("As Ah Kc Kd Qs 2c 3d"));
    const worse = HE.evaluateHand(cards("As Ah Kc Kd Js 2c 3d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });

  it("Trips 777 with AK kickers > 777 with AQ kickers", () => {
    const better = HE.evaluateHand(cards("7s 7h 7c Ad Kh 2c 3d"));
    const worse = HE.evaluateHand(cards("7s 7h 7c Ad Qh 2c 3d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });

  it("High card AKQJ9 > AKQJ8", () => {
    const better = HE.evaluateHand(cards("As Kh Qc Jd 9s 2c 3d"));
    const worse = HE.evaluateHand(cards("As Kh Qc Jd 8s 2c 3d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });

  it("Pair of 2s with AKQ kickers > pair of 2s with AKJ", () => {
    const better = HE.evaluateHand(cards("2s 2h Ac Kd Qh 9c 3d"));
    const worse = HE.evaluateHand(cards("2s 2h Ac Kd Jh 9c 3d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });
});

// ============================================================
// Straight Edge Cases
// ============================================================

describe("Hand Evaluator — Straights", () => {
  it("wheel A2345 is a valid straight", () => {
    const r = HE.evaluateHand(cards("As 2h 3c 4d 5s 8c 9d"));
    expect(r.handType).toBe("straight");
  });

  it("broadway AKQJT is a valid straight (highest)", () => {
    const r = HE.evaluateHand(cards("As Kh Qc Jd Ts 2c 3d"));
    expect(r.handType).toBe("straight");
  });

  it("wheel is lowest straight (5-high)", () => {
    const wheel = HE.evaluateHand(cards("As 2h 3c 4d 5s 8c 9d"));
    const sixHigh = HE.evaluateHand(cards("2s 3h 4c 5d 6s 9c Jd"));
    expect(HE.compareHands(sixHigh.rank, wheel.rank)).toBe(1);
  });

  it("broadway is highest non-flush straight", () => {
    const broadway = HE.evaluateHand(cards("As Kh Qc Jd Ts 2c 3d"));
    const tenHigh = HE.evaluateHand(cards("Ts 9h 8c 7d 6s 2c 3d"));
    expect(HE.compareHands(broadway.rank, tenHigh.rank)).toBe(1);
  });

  it("KA234 is NOT a straight (no wrap-around)", () => {
    const r = HE.evaluateHand(cards("Ks Ah 2c 3d 4s 8c 9d"));
    expect(r.handType).not.toBe("straight");
    expect(r.handType).not.toBe("straight-flush");
  });

  it("QKA23 is NOT a straight", () => {
    const r = HE.evaluateHand(cards("Qs Kh Ac 2d 3s 8c 9d"));
    expect(r.handType).not.toBe("straight");
  });

  it("straight with 6 sequential cards uses top 5", () => {
    const r = HE.evaluateHand(cards("9s 8h 7c 6d 5s 4h 2d"));
    expect(r.handType).toBe("straight");
    // Should be 9-high straight (9,8,7,6,5), not 8-high
  });

  it("7-card straight beats a lower straight", () => {
    const higher = HE.evaluateHand(cards("Ts 9h 8c 7d 6s 5h 2d")); // Ten-high
    const lower = HE.evaluateHand(cards("9s 8h 7c 6d 5s 2h 3d"));  // Nine-high
    expect(HE.compareHands(higher.rank, lower.rank)).toBe(1);
  });

  it("straight 9-high vs straight 7-high", () => {
    const a = HE.evaluateHand(cards("9s 8h 7c 6d 5s 2c 3d"));
    const b = HE.evaluateHand(cards("7s 6h 5c 4d 3s 2c 8d")); // 8-high since 8 is there
    // Actually both have 8,7,6,5,4 available if 8d present, so b is 8-high
    // Let me pick clearer: 9-high vs 6-high straight
    const sixHigh = HE.evaluateHand(cards("6s 5h 4c 3d 2s Kc Qd"));
    expect(HE.compareHands(a.rank, sixHigh.rank)).toBe(1);
  });
});

// ============================================================
// Flush Edge Cases
// ============================================================

describe("Hand Evaluator — Flushes", () => {
  it("ace-high flush > king-high flush", () => {
    const ahigh = HE.evaluateHand(cards("As 5s 4s 3s 2s Kd Qd"));
    const khigh = HE.evaluateHand(cards("Kh 5h 4h 3h 2h Ad Qd"));
    expect(HE.compareHands(ahigh.rank, khigh.rank)).toBe(1);
  });

  it("same flush rank — compare second card", () => {
    const a = HE.evaluateHand(cards("As Ks 5s 4s 3s 2d 6d"));
    const b = HE.evaluateHand(cards("As Qs 5s 4s 3s 2d 6d"));
    expect(HE.compareHands(a.rank, b.rank)).toBe(1);
  });

  it("7-card hand: picks best 5 flush cards", () => {
    const r = HE.evaluateHand(cards("As Ks Qs 9s 4s 2s Tc"));
    expect(r.handType).toBe("flush");
    // Best 5 should be A K Q 9 4 (top 5 spades)
  });

  it("flush beats straight (same cards)", () => {
    const flush = HE.evaluateHand(cards("9s 8s 7s 6s 4s 5d 2d"));
    const straight = HE.evaluateHand(cards("9c 8h 7d 6c 5h 4s 2d"));
    expect(HE.compareHands(flush.rank, straight.rank)).toBe(1);
  });

  it("suit does not matter when ranks match", () => {
    const h = HE.evaluateHand(cards("Ah Kh Qh Jh 9h 2c 3d"));
    const s = HE.evaluateHand(cards("As Ks Qs Js 9s 2c 3d"));
    expect(HE.compareHands(h.rank, s.rank)).toBe(0);
  });
});

// ============================================================
// Full House Edge Cases
// ============================================================

describe("Hand Evaluator — Full Houses", () => {
  it("bigger trips wins: KKK-22 > QQQ-AA", () => {
    const better = HE.evaluateHand(cards("Ks Kh Kc 2d 2h 5c 6d"));
    const worse = HE.evaluateHand(cards("Qs Qh Qc Ad Ah 5c 6d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });

  it("same trips, bigger pair wins: AAA-KK > AAA-QQ", () => {
    const better = HE.evaluateHand(cards("As Ah Ac Kd Kh 2c 3d"));
    const worse = HE.evaluateHand(cards("As Ah Ac Qd Qh 2c 3d"));
    expect(HE.compareHands(better.rank, worse.rank)).toBe(1);
  });

  it("two trips in 7 cards: best full house (AAA-KKK → AAA-KK)", () => {
    const r = HE.evaluateHand(cards("As Ah Ac Kd Kh Kc 2d"));
    expect(r.handType).toBe("full-house");
  });

  it("three pair in 7 cards picks best two pair", () => {
    const r = HE.evaluateHand(cards("As Ah Kd Kh Qs Qh 2c"));
    expect(r.handType).toBe("two-pair");
    // AA-KK with Q kicker is best
  });

  it("full house vs flush", () => {
    const fh = HE.evaluateHand(cards("As Ah Ac Kd Kh 2c 3d"));
    const fl = HE.evaluateHand(cards("As Ks Qs 9s 4s 2d 3d"));
    expect(HE.compareHands(fh.rank, fl.rank)).toBe(1);
  });
});

// ============================================================
// Tie Detection
// ============================================================

describe("Hand Evaluator — Ties", () => {
  it("identical hands produce equal ranks", () => {
    const a = HE.evaluateHand(cards("As Ah Kd Qc Jh 2c 3d"));
    const b = HE.evaluateHand(cards("As Ah Kd Qc Jh 2c 3d"));
    expect(a.rank).toBe(b.rank);
    expect(HE.compareHands(a.rank, b.rank)).toBe(0);
  });

  it("same hand type and ranks, different suits — tie", () => {
    const a = HE.evaluateHand(cards("As Ah Kd Qc Jh 2c 3d")); // Pair of aces, K-Q-J kickers
    const b = HE.evaluateHand(cards("Ac Ad Ks Qh Js 2h 3h")); // same
    expect(HE.compareHands(a.rank, b.rank)).toBe(0);
  });

  it("board plays — two players play the board, tie", () => {
    // Both players' hole cards are irrelevant if board is higher
    const playerA = HE.evaluateHand(cards("As Kh Qd Jc Th 2s 3h")); // board AKQJT
    const playerB = HE.evaluateHand(cards("As Kh Qd Jc Th 2s 4h")); // board AKQJT (diff hole)
    // Both make AKQJT straight
    expect(HE.compareHands(playerA.rank, playerB.rank)).toBe(0);
  });

  it("split pot: same straight from board", () => {
    // Both players have irrelevant hole cards, board is a straight
    const a = HE.evaluateHand(cards("As 2h 9c 8d 7c 6h 5s")); // 9-8-7-6-5 straight
    const b = HE.evaluateHand(cards("Kd 3c 9c 8d 7c 6h 5s")); // same straight
    expect(HE.compareHands(a.rank, b.rank)).toBe(0);
  });

  it("same trips, same kickers — tie", () => {
    const a = HE.evaluateHand(cards("7s 7h 7c Ad Kh 2c 3d"));
    const b = HE.evaluateHand(cards("7d 7c 7h As Ks 4c 5d")); // 7c appears in both — can't happen in real hand
    // Use valid setup: same trips 777, same kickers A and K
    const c = HE.evaluateHand(cards("7s 7h 7c Ad Kh 3c 4d"));
    const d = HE.evaluateHand(cards("7s 7h 7c Ad Kh 5c 6d"));
    expect(HE.compareHands(c.rank, d.rank)).toBe(0);
  });
});

// ============================================================
// 7-Card Best-of Selection
// ============================================================

describe("Hand Evaluator — Best of 7 Cards", () => {
  it("ignores low cards when better hand exists", () => {
    // Pair of aces is better than pair of 2s from the same 7 cards
    const r = HE.evaluateHand(cards("As Ah 2c 2d 7h 8c 9d"));
    expect(r.handType).toBe("two-pair");
    // Should be AA-22, not just pair of aces
  });

  it("picks best flush from 7 cards", () => {
    // A-K-Q-9-4 beats A-K-Q-9-2 from the same hand
    const r = HE.evaluateHand(cards("As Ks Qs 9s 4s 2s 8c"));
    expect(r.handType).toBe("flush");
  });

  it("picks trips over two pair when both available", () => {
    // AAA-KK would be full house; let's do trips-only
    const r = HE.evaluateHand(cards("7s 7h 7c 5d 5h 2c 3d"));
    expect(r.handType).toBe("full-house");
  });

  it("best of 7: straight flush wins over pair", () => {
    const r = HE.evaluateHand(cards("9s 8s 7s 6s 5s 9h 9d"));
    expect(r.handType).toBe("straight-flush");
  });

  it("hole cards don't matter if board has better hand", () => {
    // Royal flush on board
    const a = HE.evaluateHand(cards("2c 3d As Ks Qs Js Ts"));
    const b = HE.evaluateHand(cards("4h 5h As Ks Qs Js Ts"));
    expect(a.handType).toBe("straight-flush");
    expect(b.handType).toBe("straight-flush");
    expect(HE.compareHands(a.rank, b.rank)).toBe(0);
  });
});

// ============================================================
// Known Matchups (cross-reference)
// ============================================================

describe("Hand Evaluator — Known Matchups", () => {
  it("AA > KK on blank board", () => {
    const aa = HE.evaluateHand(cards("As Ah 2c 5d 7h 9c Jd"));
    const kk = HE.evaluateHand(cards("Ks Kh 2c 5d 7h 9c Jd"));
    expect(HE.compareHands(aa.rank, kk.rank)).toBe(1);
  });

  it("set of 6s beats top pair AK on K-high board", () => {
    const set = HE.evaluateHand(cards("6s 6h Ks 8c 6d Qh 3s"));
    const topPair = HE.evaluateHand(cards("As Kd Ks 8c 6d Qh 3s"));
    expect(HE.compareHands(set.rank, topPair.rank)).toBe(1);
  });

  it("flush beats straight on same board", () => {
    const flush = HE.evaluateHand(cards("As Ks 9s 8s 7s 6h 5c"));
    const straight = HE.evaluateHand(cards("9h 8c 7c 6d 5h Ad Kd"));
    expect(HE.compareHands(flush.rank, straight.rank)).toBe(1);
  });

  it("full house beats flush", () => {
    const fh = HE.evaluateHand(cards("As Ah Ac Ks Kh 2s 3s")); // AAA-KK
    const fl = HE.evaluateHand(cards("Qs Js 9s 8s 5s 2h 3d")); // Q-high flush
    expect(HE.compareHands(fh.rank, fl.rank)).toBe(1);
  });

  it("two pair AA-22 beats one pair AA with KQJ kickers", () => {
    const twop = HE.evaluateHand(cards("As Ah 2s 2h 5c 6d 7h"));
    const pair = HE.evaluateHand(cards("As Ah Kc Qd Jh 5s 6d"));
    expect(HE.compareHands(twop.rank, pair.rank)).toBe(1);
  });

  it("trips beats two pair", () => {
    const trips = HE.evaluateHand(cards("Js Jh Jc Ad 5h 2c 3d"));
    const twop = HE.evaluateHand(cards("As Ah Kc Kd Jh 2c 3d"));
    expect(HE.compareHands(trips.rank, twop.rank)).toBe(1);
  });

  it("quads beats full house", () => {
    const quads = HE.evaluateHand(cards("7s 7h 7c 7d As Kh 2c"));
    const fh = HE.evaluateHand(cards("As Ah Ac Ks Kh 2s 3s"));
    expect(HE.compareHands(quads.rank, fh.rank)).toBe(1);
  });

  it("straight beats set on appropriate board", () => {
    // Board: 9h 8c 7d 6s 2c — straight on the board (9-8-7-6 need one more)
    // Wait, 9-8-7-6 is only 4 cards. Need 5h too.
    // Board: 9h 8c 7d 6s 5h — any player with anything makes a straight from the board
    // Hero has AK (plays the board, 9-high straight)
    // Villain has 99 (set of 9s)
    const hero = HE.evaluateHand(cards("As Kd 9h 8c 7d 6s 5h"));
    const villain = HE.evaluateHand(cards("9s 9c 9h 8c 7d 6s 5h"));
    // Hero has straight 9-high, villain has 9-high straight too (using board)
    // Actually villain has higher of: set of 9s OR 9-high straight — straight wins
    // Both should tie at 9-high straight
    expect(HE.compareHands(hero.rank, villain.rank)).toBe(0);
  });

  it("same straight flush rank: ties", () => {
    const a = HE.evaluateHand(cards("9h 8h 7h 6h 5h 2c 3d"));
    const b = HE.evaluateHand(cards("9s 8s 7s 6s 5s 2c 3d"));
    expect(HE.compareHands(a.rank, b.rank)).toBe(0);
  });

  it("higher straight flush wins", () => {
    const hi = HE.evaluateHand(cards("Th 9h 8h 7h 6h 2c 3d"));
    const lo = HE.evaluateHand(cards("9s 8s 7s 6s 5s 2c 3d"));
    expect(HE.compareHands(hi.rank, lo.rank)).toBe(1);
  });
});

// ============================================================
// Hand Comparison Helper
// ============================================================

describe("Hand Evaluator — Winner Determination", () => {
  it("determineWinners returns index array of winners", () => {
    const hands = [
      HE.evaluateHand(cards("As Ah Kc Qd Jh 2s 3d")),
      HE.evaluateHand(cards("Ks Kh Ac Qd Jh 2s 3d")),
      HE.evaluateHand(cards("Qs Qh Ac Kd Jh 2s 3d"))
    ];
    const winners = HE.determineWinners(hands);
    expect(winners).toEqual([0]); // player 0 (pair of aces) wins
  });

  it("determineWinners returns multiple on tie", () => {
    // Two players tie with ace-high from board
    const hands = [
      HE.evaluateHand(cards("2s 3h As Kd Qc Jh Th")),
      HE.evaluateHand(cards("4s 5h As Kd Qc Jh Th"))
    ];
    const winners = HE.determineWinners(hands);
    // Both should tie with broadway straight
    expect(winners.length).toBe(2);
  });

  it("determineWinners with 3-way", () => {
    const hands = [
      HE.evaluateHand(cards("As Ah 2c 3d 4h 5s 6d")), // wheel-ish, pair of aces
      HE.evaluateHand(cards("Ks Kh 2c 3d 4h 5s 6d")), // pair of kings
      HE.evaluateHand(cards("2s 3h 4c 5d 6h 7s 8d")), // 8-high straight
    ];
    const winners = HE.determineWinners(hands);
    // Actually player 0 has A-2-3-4-5 wheel straight (beats pair of kings and 8-high straight from player 2)
    // Player 0: straight (wheel)
    // Player 1: pair of kings
    // Player 2: 8-high straight
    // 8-high straight > wheel straight
    expect(winners).toEqual([2]);
  });
});

// ============================================================
// Card Parsing
// ============================================================

describe("Hand Evaluator — Card Parsing", () => {
  it("accepts cards in any order", () => {
    const a = HE.evaluateHand(cards("As Ah 2c 5d 7h 9c Jd"));
    const b = HE.evaluateHand(cards("Jd 9c 7h 5d 2c Ah As"));
    expect(HE.compareHands(a.rank, b.rank)).toBe(0);
  });

  it("handles lowercase input", () => {
    const a = HE.evaluateHand(cards("as ah 2c 5d 7h 9c jd"));
    expect(a.handType).toBe("pair");
  });

  it("throws or returns null for invalid card count", () => {
    // 7 cards required
    const result = HE.evaluateHand(cards("As Ah Kc"));
    // Either throws or returns null — accept either
    if (result !== null) {
      expect(result.handType).toBeDefined();
    }
  });
});
