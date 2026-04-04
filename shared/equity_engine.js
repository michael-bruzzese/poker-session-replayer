// Equity Engine — Texas Hold'em equity calculator
// Given hero's hand, villain ranges, and board, compute true multiway equity.
// Postflop: exact enumeration. Preflop or multiway: Monte Carlo.

const EquityEngine = (() => {
  "use strict";

  // Lazy-load HandEvaluator (works in node, browser, and worker contexts)
  function getHE() {
    if (typeof HandEvaluator !== "undefined") return HandEvaluator;
    if (typeof window !== "undefined" && window.HandEvaluator) return window.HandEvaluator;
    if (typeof require !== "undefined") return require("./hand_evaluator.js");
    throw new Error("HandEvaluator not available");
  }

  // ---- Deck ----

  const ALL_CARDS = (() => {
    const ranks = "23456789TJQKA";
    const suits = "hsdc";
    const deck = [];
    for (const r of ranks) {
      for (const s of suits) {
        deck.push(r + s);
      }
    }
    return deck;
  })();

  function removeFromDeck(deck, cards) {
    const removed = new Set(cards.map(c => c.toLowerCase()));
    return deck.filter(c => !removed.has(c.toLowerCase()));
  }

  // ---- Range Expansion ----
  // A range is an array of combos, each combo is ["Ah", "Ks"].
  // The 13x13 grid (when we build it) expands to this flat combo list.

  function filterBlockedCombos(combos, blockedCards) {
    const blocked = new Set(blockedCards.map(c => c.toLowerCase()));
    return combos.filter(combo => {
      return !combo.some(card => blocked.has(card.toLowerCase()));
    });
  }

  // ---- Runout Enumeration ----

  function* enumerateRunouts(deck, cardsNeeded) {
    // Generate all possible runout combinations of `cardsNeeded` cards from deck
    if (cardsNeeded === 0) {
      yield [];
      return;
    }
    if (cardsNeeded === 1) {
      for (const c of deck) yield [c];
      return;
    }
    if (cardsNeeded === 2) {
      for (let i = 0; i < deck.length; i++) {
        for (let j = i + 1; j < deck.length; j++) {
          yield [deck[i], deck[j]];
        }
      }
      return;
    }
    // For 3+ cards (preflop), Monte Carlo is used instead
    throw new Error("Exact enumeration only supports 0-2 cards remaining");
  }

  // ---- Card Collision Check ----

  function hasCollision(cardArrays) {
    // cardArrays is an array of string arrays. Returns true if any card appears twice.
    const seen = new Set();
    for (const arr of cardArrays) {
      for (const c of arr) {
        const key = c.toLowerCase();
        if (seen.has(key)) return true;
        seen.add(key);
      }
    }
    return false;
  }

  // ---- Exact Enumeration (postflop) ----

  function calculateExact({ heroCards, villainRanges, board }) {
    const HE = getHE();
    const boardLen = board.length;

    if (boardLen < 3) {
      throw new Error("Exact enumeration requires flop+ (3+ board cards)");
    }

    // Determine cards needed to complete the board
    const cardsNeeded = 5 - boardLen;

    // Expand/filter villain ranges — remove combos blocked by hero and board
    const knownCards = [...heroCards, ...board];
    const filteredRanges = villainRanges.map(range =>
      filterBlockedCombos(range, knownCards)
    );

    // If any villain has no combos, bail
    if (filteredRanges.some(r => r.length === 0)) {
      return {
        equities: [0, ...villainRanges.map(() => 0)],
        evaluations: 0,
        error: "A villain has no combos after removing blocked cards"
      };
    }

    // Counters per player
    const numPlayers = 1 + villainRanges.length;
    const equityPoints = new Array(numPlayers).fill(0);
    let totalEvals = 0;

    // Build the remaining deck (without hero cards or board)
    const deck = removeFromDeck(ALL_CARDS, knownCards);

    // Enumerate all valid villain combo assignments
    // For 1 villain: iterate combos
    // For 2+ villains: nested iteration with card collision rejection
    const villainCombos = filteredRanges;

    function* enumerateAssignments(idx, current) {
      if (idx === villainCombos.length) {
        yield current;
        return;
      }
      for (const combo of villainCombos[idx]) {
        // Check for collision with previously assigned combos
        const collisionCheck = [...current, combo];
        if (!hasCollision(collisionCheck)) {
          yield* enumerateAssignments(idx + 1, collisionCheck);
        }
      }
    }

    // For each valid villain combo assignment
    for (const assignment of enumerateAssignments(0, [])) {
      // Remove all villain combo cards from deck for runout enumeration
      const villainCards = assignment.flat();
      const runoutDeck = removeFromDeck(deck, villainCards);

      // For each possible runout
      for (const runout of enumerateRunouts(runoutDeck, cardsNeeded)) {
        const completeBoard = [...board, ...runout];

        // Evaluate hero
        const heroResult = HE.evaluateHand([...heroCards, ...completeBoard]);

        // Evaluate each villain
        const results = [heroResult];
        for (const combo of assignment) {
          results.push(HE.evaluateHand([...combo, ...completeBoard]));
        }

        // Determine winners
        const winners = HE.determineWinners(results);
        const share = 1 / winners.length;
        for (const w of winners) {
          equityPoints[w] += share;
        }
        totalEvals++;
      }
    }

    // Convert to percentages
    const equities = equityPoints.map(p => totalEvals > 0 ? (p / totalEvals) * 100 : 0);
    return { equities, evaluations: totalEvals };
  }

  // ---- Monte Carlo (preflop or multiway) ----

  function calculateMonteCarlo({ heroCards, villainRanges, board, samples }) {
    const HE = getHE();
    samples = samples || 50000;
    const boardLen = board.length;
    const cardsNeeded = 5 - boardLen;

    const knownCards = [...heroCards, ...board];
    const filteredRanges = villainRanges.map(range =>
      filterBlockedCombos(range, knownCards)
    );

    if (filteredRanges.some(r => r.length === 0)) {
      return {
        equities: [0, ...villainRanges.map(() => 0)],
        evaluations: 0,
        error: "A villain has no combos after removing blocked cards"
      };
    }

    const numPlayers = 1 + villainRanges.length;
    const equityPoints = new Array(numPlayers).fill(0);
    let totalEvals = 0;
    let rejections = 0;
    const maxRejections = samples * 10; // safety valve

    const deck = removeFromDeck(ALL_CARDS, knownCards);

    while (totalEvals < samples && rejections < maxRejections) {
      // Pick random combos for each villain
      const assignment = [];
      let collision = false;
      for (const range of filteredRanges) {
        const combo = range[Math.floor(Math.random() * range.length)];
        assignment.push(combo);
      }

      // Check for cross-villain and hero card collisions
      if (hasCollision([heroCards, ...assignment])) {
        rejections++;
        continue;
      }

      // Remove villain cards from deck for runout
      const villainCards = assignment.flat();
      const runoutDeck = removeFromDeck(deck, villainCards);

      // Random runout
      const runout = sampleWithoutReplacement(runoutDeck, cardsNeeded);
      const completeBoard = [...board, ...runout];

      // Evaluate
      const heroResult = HE.evaluateHand([...heroCards, ...completeBoard]);
      const results = [heroResult];
      for (const combo of assignment) {
        results.push(HE.evaluateHand([...combo, ...completeBoard]));
      }

      const winners = HE.determineWinners(results);
      const share = 1 / winners.length;
      for (const w of winners) {
        equityPoints[w] += share;
      }
      totalEvals++;
    }

    const equities = equityPoints.map(p => totalEvals > 0 ? (p / totalEvals) * 100 : 0);
    return {
      equities,
      evaluations: totalEvals,
      rejections,
      monteCarlo: true
    };
  }

  function sampleWithoutReplacement(deck, n) {
    const result = [];
    const available = deck.slice();
    for (let i = 0; i < n; i++) {
      if (available.length === 0) break;
      const idx = Math.floor(Math.random() * available.length);
      result.push(available[idx]);
      available.splice(idx, 1);
    }
    return result;
  }

  // ---- Main Entry ----

  function calculateEquity({ heroCards, villainRanges, board, samples, forceMonteCarlo }) {
    board = board || [];
    villainRanges = villainRanges || [];

    if (!heroCards || heroCards.length !== 2) {
      throw new Error("Hero must have exactly 2 hole cards");
    }

    const startTime = Date.now();

    // Decision: exact vs Monte Carlo
    // Exact when: postflop (3+ board cards) AND single villain OR few enough combos
    const useExact = !forceMonteCarlo &&
                     board.length >= 3 &&
                     villainRanges.length === 1;

    // River: special case, just evaluate once
    if (board.length === 5 && villainRanges.length === 1) {
      // Filter villain range
      const HE = getHE();
      const knownCards = [...heroCards, ...board];
      const filtered = filterBlockedCombos(villainRanges[0], knownCards);

      if (filtered.length === 0) {
        return { equities: [0, 0], evaluations: 0, error: "No valid combos" };
      }

      let heroPts = 0;
      let villainPts = 0;
      const heroResult = HE.evaluateHand([...heroCards, ...board]);

      for (const combo of filtered) {
        const vResult = HE.evaluateHand([...combo, ...board]);
        const winners = HE.determineWinners([heroResult, vResult]);
        if (winners.length === 2) {
          heroPts += 0.5;
          villainPts += 0.5;
        } else if (winners[0] === 0) {
          heroPts += 1;
        } else {
          villainPts += 1;
        }
      }

      const total = filtered.length;
      return {
        equities: [(heroPts / total) * 100, (villainPts / total) * 100],
        evaluations: total,
        elapsed: Date.now() - startTime
      };
    }

    let result;
    if (useExact) {
      result = calculateExact({ heroCards, villainRanges, board });
    } else {
      result = calculateMonteCarlo({ heroCards, villainRanges, board, samples });
    }

    result.elapsed = Date.now() - startTime;
    return result;
  }

  // ---- Range Helpers ----

  // Expand a 13x13 grid cell to its combos
  // Grid coords: row = first rank (0=A, 1=K, ..., 12=2), col = second rank
  // Diagonal: pairs. Above: suited. Below: offsuit.
  function expandGridCell(row, col) {
    const RANKS = "AKQJT98765432";
    const r1 = RANKS[row];
    const r2 = RANKS[col];
    const suits = ["h", "s", "d", "c"];
    const combos = [];

    if (row === col) {
      // Pair — 6 combos
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          combos.push([r1 + suits[i], r1 + suits[j]]);
        }
      }
    } else if (row < col) {
      // Suited (row rank is higher since AKQ... is high-to-low indexed)
      for (const s of suits) {
        combos.push([r1 + s, r2 + s]);
      }
    } else {
      // Offsuit
      for (const s1 of suits) {
        for (const s2 of suits) {
          if (s1 !== s2) combos.push([r2 + s1, r1 + s2]);
          // r2 is the lower rank (row > col means r2 is listed as the higher)
          // Wait: AKQJT98765432, row=0 is A, row=12 is 2
          // row > col means row comes later → row is lower rank
          // So r1 is LOWER, r2 is HIGHER. Let me fix.
        }
      }
    }
    return combos;
  }

  // Proper grid cell expansion
  function expandCell(row, col) {
    const RANKS = "AKQJT98765432";
    const suits = ["h", "s", "d", "c"];
    const combos = [];

    if (row === col) {
      // Pair
      const r = RANKS[row];
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          combos.push([r + suits[i], r + suits[j]]);
        }
      }
    } else {
      // Figure out high and low rank
      // Lower row index = higher rank (A is at 0)
      const highIdx = Math.min(row, col);
      const lowIdx = Math.max(row, col);
      const highR = RANKS[highIdx];
      const lowR = RANKS[lowIdx];

      if (row < col) {
        // Suited (above diagonal)
        for (const s of suits) {
          combos.push([highR + s, lowR + s]);
        }
      } else {
        // Offsuit (below diagonal)
        for (const s1 of suits) {
          for (const s2 of suits) {
            if (s1 !== s2) {
              combos.push([highR + s1, lowR + s2]);
            }
          }
        }
      }
    }
    return combos;
  }

  function expandRangeFromGrid(grid) {
    // grid is 13x13 boolean matrix
    const combos = [];
    for (let row = 0; row < 13; row++) {
      for (let col = 0; col < 13; col++) {
        if (grid[row] && grid[row][col]) {
          combos.push(...expandCell(row, col));
        }
      }
    }
    return combos;
  }

  // ---- Public API ----

  return {
    calculateEquity,
    calculateExact,
    calculateMonteCarlo,
    filterBlockedCombos,
    expandCell,
    expandRangeFromGrid,
    ALL_CARDS
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = EquityEngine;
} else if (typeof window !== "undefined") {
  window.EquityEngine = EquityEngine;
}
