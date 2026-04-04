// 7-Card Hand Evaluator
// Given 7 cards, returns the best 5-card poker hand and a comparable rank.
// Uses exhaustive enumeration of C(7,5)=21 combinations.
// Correct for every possible hand; no approximations.

const HandEvaluator = (() => {
  "use strict";

  // Hand type ordering (higher = better)
  const HAND_TYPES = {
    "high-card": 0,
    "pair": 1,
    "two-pair": 2,
    "three-of-a-kind": 3,
    "straight": 4,
    "flush": 5,
    "full-house": 6,
    "four-of-a-kind": 7,
    "straight-flush": 8
  };

  // Rank values: 2=0, 3=1, ... A=12
  const RANK_VALUES = {
    "2": 0, "3": 1, "4": 2, "5": 3, "6": 4, "7": 5, "8": 6,
    "9": 7, "T": 8, "J": 9, "Q": 10, "K": 11, "A": 12
  };

  const RANK_NAMES = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];

  // ---- Card Parsing ----

  function parseCard(cardStr) {
    if (!cardStr || cardStr.length < 2) return null;
    const rank = cardStr[0].toUpperCase();
    const suit = cardStr[1].toLowerCase();
    const rankVal = RANK_VALUES[rank];
    if (rankVal === undefined) return null;
    if (!"hsdc".includes(suit)) return null;
    return { rank: rankVal, suit, str: rank + suit };
  }

  function parseCards(cards) {
    return cards.map(parseCard).filter(Boolean);
  }

  // ---- Five-Card Hand Encoding ----
  // Encode as: handType*10^10 + primary*10^8 + secondary*10^6 + k1*10^4 + k2*10^2 + k3
  // Max handType=8, max rank=12. 12*10^10 ≈ 1.2e11, fits in JS number.

  function encode(handType, ranks) {
    // ranks: array of up to 5 integers, most significant first
    let code = handType * 1e10;
    const mults = [1e8, 1e6, 1e4, 1e2, 1];
    for (let i = 0; i < Math.min(5, ranks.length); i++) {
      code += ranks[i] * mults[i];
    }
    return code;
  }

  // ---- Detect Hand Types (for 5 cards) ----

  function evaluate5(fiveCards) {
    // Input: 5 parsed cards
    // Output: encoded rank (integer)

    const ranks = fiveCards.map(c => c.rank).sort((a, b) => b - a); // descending
    const suits = fiveCards.map(c => c.suit);

    // Count rank frequencies
    const rankCounts = {};
    for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1;

    // Sort rank counts descending, then by rank value descending
    const countEntries = Object.entries(rankCounts)
      .map(([r, c]) => ({ rank: parseInt(r, 10), count: c }))
      .sort((a, b) => b.count - a.count || b.rank - a.rank);

    // Flush check
    const isFlush = suits.every(s => s === suits[0]);

    // Straight check
    const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
    let isStraight = false;
    let straightHigh = -1;
    if (uniqueRanks.length >= 5) {
      // Check descending
      for (let i = 0; i <= uniqueRanks.length - 5; i++) {
        if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) {
          isStraight = true;
          straightHigh = uniqueRanks[i];
          break;
        }
      }
      // Check wheel (A-2-3-4-5): A=12, 5=3, 4=2, 3=1, 2=0
      if (!isStraight && uniqueRanks.includes(12) && uniqueRanks.includes(3) &&
          uniqueRanks.includes(2) && uniqueRanks.includes(1) && uniqueRanks.includes(0)) {
        isStraight = true;
        straightHigh = 3; // 5-high straight
      }
    }

    // Straight flush
    if (isStraight && isFlush) {
      return encode(HAND_TYPES["straight-flush"], [straightHigh]);
    }

    // Four of a kind
    if (countEntries[0].count === 4) {
      const quadRank = countEntries[0].rank;
      const kicker = countEntries[1].rank;
      return encode(HAND_TYPES["four-of-a-kind"], [quadRank, kicker]);
    }

    // Full house
    if (countEntries[0].count === 3 && countEntries[1] && countEntries[1].count >= 2) {
      return encode(HAND_TYPES["full-house"], [countEntries[0].rank, countEntries[1].rank]);
    }

    // Flush
    if (isFlush) {
      return encode(HAND_TYPES["flush"], ranks);
    }

    // Straight
    if (isStraight) {
      return encode(HAND_TYPES["straight"], [straightHigh]);
    }

    // Three of a kind
    if (countEntries[0].count === 3) {
      const tripRank = countEntries[0].rank;
      const kickers = countEntries.slice(1).map(e => e.rank).slice(0, 2);
      return encode(HAND_TYPES["three-of-a-kind"], [tripRank, ...kickers]);
    }

    // Two pair
    if (countEntries[0].count === 2 && countEntries[1] && countEntries[1].count === 2) {
      const highPair = countEntries[0].rank;
      const lowPair = countEntries[1].rank;
      const kicker = countEntries[2].rank;
      return encode(HAND_TYPES["two-pair"], [highPair, lowPair, kicker]);
    }

    // One pair
    if (countEntries[0].count === 2) {
      const pairRank = countEntries[0].rank;
      const kickers = countEntries.slice(1).map(e => e.rank).slice(0, 3);
      return encode(HAND_TYPES["pair"], [pairRank, ...kickers]);
    }

    // High card
    return encode(HAND_TYPES["high-card"], ranks);
  }

  // ---- 21 Combinations of 5 from 7 ----

  function combinations5of7() {
    // Precomputed indices for all C(7,5) = 21 combinations
    const combos = [];
    for (let a = 0; a < 7; a++) {
      for (let b = a + 1; b < 7; b++) {
        for (let c = b + 1; c < 7; c++) {
          for (let d = c + 1; d < 7; d++) {
            for (let e = d + 1; e < 7; e++) {
              combos.push([a, b, c, d, e]);
            }
          }
        }
      }
    }
    return combos;
  }

  const COMBOS_5_OF_7 = combinations5of7();

  // ---- Main Evaluator ----

  function evaluateHand(cards) {
    if (!cards || cards.length !== 7) return null;
    const parsed = parseCards(cards);
    if (parsed.length !== 7) return null;

    let bestRank = -1;
    let bestIndices = null;

    for (const combo of COMBOS_5_OF_7) {
      const fiveCards = [parsed[combo[0]], parsed[combo[1]], parsed[combo[2]], parsed[combo[3]], parsed[combo[4]]];
      const rank = evaluate5(fiveCards);
      if (rank > bestRank) {
        bestRank = rank;
        bestIndices = combo;
      }
    }

    const bestFive = bestIndices.map(i => parsed[i].str);
    const handType = rankToHandType(bestRank);
    const description = describeHand(handType, bestRank);

    return { rank: bestRank, handType, bestFive, description };
  }

  function rankToHandType(rank) {
    const typeIdx = Math.floor(rank / 1e10);
    for (const [name, idx] of Object.entries(HAND_TYPES)) {
      if (idx === typeIdx) return name;
    }
    return "high-card";
  }

  function describeHand(handType, rank) {
    // Simple human-readable description
    const primary = Math.floor((rank % 1e10) / 1e8);
    const secondary = Math.floor((rank % 1e8) / 1e6);
    const primaryName = RANK_NAMES[primary] || "?";
    const secondaryName = RANK_NAMES[secondary] || "?";

    switch (handType) {
      case "straight-flush":
        return primary === 12 ? "Royal Flush" : `Straight Flush, ${primaryName}-high`;
      case "four-of-a-kind":
        return `Four of a Kind, ${primaryName}s`;
      case "full-house":
        return `Full House, ${primaryName}s full of ${secondaryName}s`;
      case "flush":
        return `Flush, ${primaryName}-high`;
      case "straight":
        return `Straight, ${primaryName}-high`;
      case "three-of-a-kind":
        return `Three of a Kind, ${primaryName}s`;
      case "two-pair":
        return `Two Pair, ${primaryName}s and ${secondaryName}s`;
      case "pair":
        return `Pair of ${primaryName}s`;
      default:
        return `${primaryName}-high`;
    }
  }

  // ---- Comparison ----

  function compareHands(rankA, rankB) {
    if (rankA > rankB) return 1;
    if (rankA < rankB) return -1;
    return 0;
  }

  function determineWinners(handResults) {
    // Input: array of { rank, ... }
    // Output: array of indices of winning player(s)
    if (!handResults || handResults.length === 0) return [];
    let maxRank = handResults[0].rank;
    for (let i = 1; i < handResults.length; i++) {
      if (handResults[i].rank > maxRank) maxRank = handResults[i].rank;
    }
    const winners = [];
    for (let i = 0; i < handResults.length; i++) {
      if (handResults[i].rank === maxRank) winners.push(i);
    }
    return winners;
  }

  // ---- Public API ----

  return {
    evaluateHand,
    compareHands,
    determineWinners,
    // Exposed for testing
    evaluate5,
    parseCard,
    HAND_TYPES,
    RANK_VALUES
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = HandEvaluator;
} else if (typeof window !== "undefined") {
  window.HandEvaluator = HandEvaluator;
}
