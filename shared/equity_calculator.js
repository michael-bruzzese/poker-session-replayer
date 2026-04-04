// Equity Calculator — async wrapper that keeps the UI responsive
// Runs calculations in small chunks using setTimeout to yield to the event loop.
// Not a true Web Worker, but achieves the same UX: non-blocking UI + progress updates.

const EquityCalculator = (() => {
  "use strict";

  let cancelled = false;

  function getEE() {
    if (typeof EquityEngine !== "undefined") return EquityEngine;
    if (typeof window !== "undefined" && window.EquityEngine) return window.EquityEngine;
    throw new Error("EquityEngine not available");
  }

  function getHE() {
    if (typeof HandEvaluator !== "undefined") return HandEvaluator;
    if (typeof window !== "undefined" && window.HandEvaluator) return window.HandEvaluator;
    throw new Error("HandEvaluator not available");
  }

  // Exact enumeration is fast (<100ms for flop) — run synchronously
  function calculateExact(input) {
    const EE = getEE();
    return Promise.resolve(EE.calculateExact(input));
  }

  // River is trivially fast — also synchronous
  function calculateRiver(input) {
    const EE = getEE();
    return Promise.resolve(EE.calculateEquity(input));
  }

  // Monte Carlo: run in chunks of 2000 samples, yielding to event loop between chunks
  function calculateMonteCarloChunked(input, onProgress) {
    return new Promise((resolve, reject) => {
      const EE = getEE();
      const HE = getHE();
      cancelled = false;
      const chunkSize = 2000;
      const totalSamples = input.samples || 50000;

      const knownCards = [...input.heroCards, ...(input.board || [])];
      const filtered = input.villainRanges.map(range =>
        EE.filterBlockedCombos(range, knownCards)
      );

      if (filtered.some(r => r.length === 0)) {
        resolve({
          equities: [0, ...input.villainRanges.map(() => 0)],
          evaluations: 0,
          error: "A villain has no valid combos after removing blocked cards"
        });
        return;
      }

      const numPlayers = 1 + input.villainRanges.length;
      const equityPoints = new Array(numPlayers).fill(0);
      let totalEvals = 0;
      let rejections = 0;

      const RANKS = "23456789TJQKA";
      const SUITS = "hsdc";
      const fullDeck = [];
      for (const r of RANKS) for (const s of SUITS) fullDeck.push(r + s);
      const knownSet = new Set(knownCards.map(c => c.toLowerCase()));
      const availableDeck = fullDeck.filter(c => !knownSet.has(c.toLowerCase()));
      const cardsNeeded = 5 - (input.board || []).length;

      const startTime = Date.now();

      function runChunk() {
        if (cancelled) {
          resolve({ cancelled: true, evaluations: totalEvals });
          return;
        }

        const chunkStart = totalEvals;
        const chunkEnd = Math.min(totalEvals + chunkSize, totalSamples);
        const maxRejections = totalSamples * 10;

        while (totalEvals < chunkEnd && rejections < maxRejections) {
          const assignment = [];
          for (const range of filtered) {
            assignment.push(range[Math.floor(Math.random() * range.length)]);
          }

          if (hasCollision([input.heroCards, ...assignment])) {
            rejections++;
            continue;
          }

          const usedInHoles = new Set();
          for (const arr of [input.heroCards, ...assignment]) {
            for (const c of arr) usedInHoles.add(c.toLowerCase());
          }
          const runoutDeck = availableDeck.filter(c => !usedInHoles.has(c.toLowerCase()));

          const runout = [];
          const deckCopy = runoutDeck.slice();
          for (let i = 0; i < cardsNeeded; i++) {
            if (deckCopy.length === 0) break;
            const idx = Math.floor(Math.random() * deckCopy.length);
            runout.push(deckCopy[idx]);
            deckCopy.splice(idx, 1);
          }

          const completeBoard = [...(input.board || []), ...runout];
          const heroResult = HE.evaluateHand([...input.heroCards, ...completeBoard]);
          const results = [heroResult];
          for (const combo of assignment) {
            results.push(HE.evaluateHand([...combo, ...completeBoard]));
          }

          const winners = HE.determineWinners(results);
          const share = 1 / winners.length;
          for (const w of winners) equityPoints[w] += share;
          totalEvals++;
        }

        // Progress update
        if (onProgress) {
          const partialEquities = equityPoints.map(p => totalEvals > 0 ? (p / totalEvals) * 100 : 0);
          onProgress({
            equities: partialEquities,
            samplesComplete: totalEvals,
            samplesTotal: totalSamples
          });
        }

        if (totalEvals < totalSamples && rejections < maxRejections) {
          // Schedule next chunk
          setTimeout(runChunk, 0);
        } else {
          // Done
          const equities = equityPoints.map(p => totalEvals > 0 ? (p / totalEvals) * 100 : 0);
          resolve({
            equities,
            evaluations: totalEvals,
            rejections,
            monteCarlo: true,
            elapsed: Date.now() - startTime
          });
        }
      }

      runChunk();
    });
  }

  function hasCollision(cardArrays) {
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

  // Main entry point
  function calculate(input, onProgress) {
    input = input || {};
    const board = input.board || [];

    // Route based on street and player count
    if (board.length === 5) {
      return calculateRiver(input);
    }

    if (!input.forceMonteCarlo && board.length >= 3 && input.villainRanges.length === 1) {
      // Exact enumeration for heads-up flop/turn
      return calculateExact(input);
    }

    // Otherwise Monte Carlo with chunked progress
    return calculateMonteCarloChunked(input, onProgress);
  }

  function cancel() {
    cancelled = true;
  }

  return {
    calculate,
    cancel,
    isWorkerAvailable: () => true // Always works via setTimeout chunking
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = EquityCalculator;
} else if (typeof window !== "undefined") {
  window.EquityCalculator = EquityCalculator;
}
