---
title: "feat: Phase 3 — Equity Calculator"
type: feat
status: draft
date: 2026-04-03
parent: docs/plans/2026-04-03-005-feat-comprehensive-feature-roadmap-plan.md
---

# Phase 3: Equity Calculator

## Overview

Coach clicks an equity button during playback, assigns ranges to each villain via 13x13 grids, and sees true multiway equity calculated against the current board. Exact enumeration for flop/turn/river, Monte Carlo for preflop. Runs in a Web Worker so the UI never freezes. Hand evaluator verified against 100+ known matchups before shipping.

## Problem Frame

During coaching, the coach explores "what if" scenarios — different actions, different board runouts, different villain holdings. Without equity, these discussions are based on feel. With equity, the coach can show students concrete numbers: "You have 35% equity here with a flush draw, so a pot-sized bet is calling you to put in 50% of the pot — bad call." The equity display must be correct, fast, and unobtrusive.

## Requirements

- EQ1. Equity button on the table — only appears during playback, never automatically visible
- EQ2. 13x13 range grid for each villain still in the hand
- EQ3. Grid auto-removes combos blocked by board cards and hero's hole cards
- EQ4. Equity calculated for ALL players in hand simultaneously (true multiway)
- EQ5. Works at every street: preflop, flop, turn, river
- EQ6. Exact enumeration on flop (1,081 runouts), turn (46), river (1). Monte Carlo for preflop (50K+ samples)
- EQ7. Runs in Web Worker — UI never freezes during calculation
- EQ8. Hand evaluator verified against 100+ known matchups before shipping
- EQ9. Side panel layout — table stays visible alongside range grids
- EQ10. Click-drag selection on range grid for fast range building
- EQ11. Board cards auto-blocked (greyed out, unclickable) in all grids
- EQ12. Combo count and range percentage displayed per grid
- EQ13. Clear range / Select all buttons per grid
- EQ14. Ranges persist per hand during session (navigating away and back preserves ranges)
- EQ15. Performance: heads-up flop <500ms, 3-way Monte Carlo <3 seconds
- EQ16. True multiway simulation with real card constraints between villain combos
- EQ17. Progressive Monte Carlo updates for preflop (show converging results)

## Key Technical Decisions

- **Hand evaluator: 21-combo approach** — For each 7-card hand, evaluate all C(7,5)=21 five-card combinations and return the best. Simple, verifiable, zero dependencies. Performance is sufficient because per-runout caching means each combo is evaluated once per runout regardless of how many matchups use it.
- **Five-card encoding** — Encode hand type (0-8) + primary ranks + kickers into a single integer. Higher integer = better hand. Ties produce equal integers. This makes comparison a single integer compare.
- **Per-runout caching** — For each turn+river runout: evaluate hero's 7 cards once, evaluate each villain combo's 7 cards once, then cross-compare all valid combo tuples using cached ranks. This reduces evaluations from O(combos² × runouts × 21) to O(combos × runouts × 21).
- **Multiway Monte Carlo** — For each sample: pick one random combo per villain (weighted by range), reject if any card collision between villains or with hero/board, deal remaining board cards, evaluate all hands, determine winner. Rejection sampling works well for 2-3 villains. For 4+ villains with overlapping ranges, collision rate increases but 50K samples still converges.
- **Web Worker as Blob URL** — Worker script combines hand_evaluator.js + equity_engine.js. Build script inlines both into the Worker. In dev mode, Worker loads the scripts directly. Main thread posts calculation requests, Worker posts results. Progressive updates every 5K samples for Monte Carlo.

## High-Level Technical Design

> *Directional guidance, not implementation specification.*

### Hand Evaluation

```
evaluateHand(7 cards):
  bestRank = 0
  for each 5-card combination of the 7 cards (21 total):
    rank = encodeFiveCardHand(5 cards)
    if rank > bestRank: bestRank = rank
  return { rank: bestRank, handType, description }

encodeFiveCardHand(5 cards):
  detect hand type (straight flush through high card)
  encode as: handType × 10^8 + primary × 10^6 + secondary × 10^4 + kickers
  → single comparable integer
```

### Equity Calculation (Postflop)

```
calculateEquity(hero, villainRanges[], board):
  expand each villain range to combo list
  remove blocked combos (board cards, hero cards)
  
  for each possible turn+river runout:
    evaluate hero's 7-card hand → heroRank
    for each villain: evaluate each combo's 7-card hand → comboRanks[]
    
    for each valid combo tuple (one per villain, no card collisions):
      compare all players' ranks
      winner gets equity point (ties split)
  
  equity[player] = points / totalComparisons
```

### Equity Calculation (Preflop Monte Carlo)

```
monteCarloEquity(hero, villainRanges[], samples=50000):
  for i in 1..samples:
    for each villain: pick random combo from range
    if any card collision between villains or hero: resample
    remove all known cards from deck
    deal 5 board cards randomly
    evaluate all hands, determine winner
    accumulate equity points
    
    if i % 5000 == 0: post progressive update to main thread
  
  return equity points / samples for each player
```

## Implementation Units

- [ ] **3.1: Hand evaluator module**

  **Goal:** Given 7 cards, determine the best 5-card poker hand. Correct for every possible combination. This is the single source of truth for hand ranking — if this is wrong, all equity is wrong.

  **Requirements:** EQ8

  **Files:**
  - Create: `shared/hand_evaluator.js`
  - Test: `tests/hand_evaluator.test.js`

  **Execution note:** Test-first. Write ALL 100+ tests before writing the evaluator. The evaluator must be written to pass the tests, not the other way around.

  **Approach:**
  - `evaluateHand(sevenCards)` → `{ rank, handType, bestFive, description }`
  - `rank` is a single comparable integer. Higher = better. Equal = tie.
  - `handType` is one of: "high-card", "pair", "two-pair", "three-of-a-kind", "straight", "flush", "full-house", "four-of-a-kind", "straight-flush"
  - `compareHands(rankA, rankB)` → 1, -1, or 0
  - Internal: generate all 21 five-card combos, evaluate each with `encodeFiveCardHand`, return max
  - `encodeFiveCardHand(fiveCards)`:
    - Detect: is it a straight? flush? both? pairs? trips? quads?
    - Encode hand type (0=high card, 1=pair, ..., 8=straight flush) as the highest bits
    - Encode primary rank, secondary rank, kickers as lower bits
    - Result: single integer where higher always means better hand

  **Test scenarios (organized by category — 100+ total):**

  *Hand type identification (9 tests):*
  - 7 cards containing a straight flush → handType: "straight-flush"
  - 7 cards containing quads → handType: "four-of-a-kind"
  - 7 cards containing a full house → handType: "full-house"
  - 7 cards containing a flush (not straight) → handType: "flush"
  - 7 cards containing a straight (not flush) → handType: "straight"
  - 7 cards containing trips (no pair, not full house) → handType: "three-of-a-kind"
  - 7 cards containing two pair → handType: "two-pair"
  - 7 cards containing one pair → handType: "pair"
  - 7 cards high card only → handType: "high-card"

  *Hand type ranking — all pairwise comparisons (36 tests):*
  - straight flush > four of a kind > full house > flush > straight > trips > two pair > pair > high card
  - Each adjacent pair tested (SF > quads, quads > FH, FH > flush, etc.)
  - Non-adjacent pairs sampled (SF > pair, flush > high card, etc.)

  *Kicker comparisons (15+ tests):*
  - AA with K kicker > AA with Q kicker
  - KK with A kicker > KK with Q kicker
  - Two pair AA-KK with Q kicker > AA-KK with J kicker
  - Trips 777 with AK kickers > 777 with AQ kickers
  - High card AKQJ9 > AKQJ8

  *Straight edge cases (8+ tests):*
  - A2345 (wheel) is a valid straight, ranked lowest
  - AKQJT (broadway) is a valid straight, ranked highest
  - KA234 is NOT a straight
  - QKA23 is NOT a straight
  - Straight with 7 cards: best 5 used (e.g., 3456789 → 56789)
  - Straight vs straight: higher top card wins

  *Flush edge cases (6+ tests):*
  - Ace-high flush > king-high flush
  - 7-card flush: best 5 used
  - Flush with straight possibility: if straight flush exists, it's straight flush
  - Same flush rank: compare second card, third, etc.

  *Full house edge cases (5+ tests):*
  - Bigger trips wins (KKK-22 > QQQ-AA)
  - Same trips, bigger pair wins (AAA-KK > AAA-QQ)
  - Two trips in 7 cards: best full house chosen (AAA + KKK + 2 → AAA-KK)
  - Three pair in 7 cards: best two pair + best kicker

  *Tie detection (5+ tests):*
  - Identical hands → rank tie (same integer)
  - Same hand type, same ranks, different suits → tie (suits don't matter)
  - Split pot scenario: both players make the same straight from the board

  *7-card best-of selection (10+ tests):*
  - From 7 cards, correctly picks the best 5
  - Board makes a flush but hero has a better flush using hole cards
  - Board makes a straight but hero has a better straight using hole cards
  - Board is the best hand (hero plays the board) — both players tie

  *Cross-reference against published values (10+ tests):*
  - Specific 7-card hands with known correct evaluations
  - AA vs KK on a blank board → AA wins
  - Set vs flush on appropriate board → flush wins
  - Two pair vs trips → trips wins
  - Full house vs flush → full house wins

  **Verification:**
  - ALL 100+ tests pass
  - Every hand type correctly identified and ranked
  - Every tiebreaker scenario correct
  - No hand type ever ranks above a hand type it shouldn't

- [ ] **3.2: Equity calculation engine**

  **Goal:** Given hero's hand, villain range(s), and board state, compute true multiway equity for all players.

  **Requirements:** EQ4, EQ5, EQ6, EQ15, EQ16

  **Dependencies:** 3.1

  **Files:**
  - Create: `shared/equity_engine.js`
  - Test: `tests/equity_engine.test.js`

  **Approach:**
  - `calculateEquity({ heroCards, villainRanges, board, samples })` → `{ equities: [hero%, v1%, v2%, ...], evaluations, elapsed }`
  - `expandRange(range13x13, blockedCards)` → array of specific combos, blocked combos removed
  - Street detection: board.length determines algorithm (0 = preflop MC, 3 = flop enum, 4 = turn enum, 5 = river eval)
  - Postflop exact: enumerate all remaining board cards, evaluate all hands per runout, cross-compare valid combo tuples
  - Preflop Monte Carlo: sample random combos per villain, reject card collisions, deal random board, evaluate, accumulate
  - Per-runout caching: compute each combo's rank once per runout, then compare cached ranks for all valid tuples
  - `progressCallback(partialResult)` — called every 5K samples during Monte Carlo

  **Test scenarios:**
  - Happy path: AA vs KK preflop → hero equity 81-82% (Monte Carlo ±1%)
  - Happy path: AKs vs QQ preflop → hero equity 45-47%
  - Happy path: set (6s6c on 6d Jh 9s board) vs top pair range → hero equity >80%
  - Happy path: flush draw (Ah5h on 9h 4h 2c board) vs top pair → hero equity ~45%
  - Happy path: nut flush on turn vs any range → equity >90%
  - Happy path: river (board complete) → equity is binary win/lose/tie
  - Happy path: 3-way pot → equities sum to 100% (within rounding)
  - Edge case: villain range is single combo → exact heads-up matchup
  - Edge case: villain range is 100% of hands → correct wide-range equity
  - Edge case: all combos in range are blocked → return 0% for that villain or handle gracefully
  - Edge case: board cards block hero cards → impossible (shouldn't happen, but handle)
  - Performance: heads-up flop equity completes in <500ms
  - Performance: 3-way Monte Carlo 50K samples completes in <3s
  - Integration: known flop equities from published source match within tolerance

  **Verification:**
  - Known preflop matchups within ±1% of published values
  - Postflop exact matchups match published values exactly
  - Equities always sum to 100% (within rounding tolerance)
  - Performance targets met
  - All tests pass

- [ ] **3.3: Web Worker wrapper**

  **Goal:** Run equity calculation in a background thread. UI never freezes. Progressive updates for Monte Carlo.

  **Requirements:** EQ7, EQ17

  **Dependencies:** 3.2

  **Files:**
  - Create: `shared/equity_worker.js`
  - Modify: `session_replayer_web.html` (Worker initialization, message passing)
  - Modify: `build_embedded.py` (inline Worker as Blob URL)

  **Approach:**
  - Worker script imports hand_evaluator.js + equity_engine.js
  - Message protocol:
    - Main → Worker: `{ type: "calculate", heroCards, villainRanges, board, samples }`
    - Worker → Main: `{ type: "progress", equities, evaluations, samplesComplete }` (every 5K samples)
    - Worker → Main: `{ type: "result", equities, evaluations, elapsed }`
    - Main → Worker: `{ type: "cancel" }` (coach closes panel mid-calculation)
  - Build script: read equity_worker.js + its dependencies, inline as `new Worker(URL.createObjectURL(new Blob([code])))`
  - Dev mode: Worker loads scripts via importScripts
  - Fallback: if Workers unavailable, run synchronously with "Calculating..." overlay preventing interaction

  **Test scenarios:**
  - Test expectation: none — Worker communication tested via Playwright in 3.5

  **Verification:**
  - Equity calculation runs without freezing UI
  - Progressive updates arrive for Monte Carlo
  - Cancel stops computation
  - Built index.html correctly inlines Worker

- [ ] **3.4: Range grid UI + equity display panel**

  **Goal:** Side panel with 13x13 range grids per villain, equity results, and board display. Fast and intuitive for Zoom coaching.

  **Requirements:** EQ1, EQ2, EQ3, EQ9, EQ10, EQ11, EQ12, EQ13, EQ14

  **Dependencies:** 3.3

  **Files:**
  - Modify: `session_replayer_web.html` (equity button, side panel, grid rendering, results display)

  **Approach:**
  - **Equity button:** appears on the table during playback (near status bar or hand controls). Click opens side panel.
  - **Side panel layout (right side, table shrinks to accommodate):**
    - Top: hero's cards + current board displayed
    - Below: equity results for all players (big, clear percentages)
    - Below: one 13x13 grid per villain, labeled "Villain — Seat N (position)"
    - Each grid: rows = first card rank (A-2), columns = second card rank (A-2)
    - Diagonal = pairs, above diagonal = suited, below = offsuit
    - Color coding: selected = green, blocked = dark grey, unselected = light
    - Below each grid: "142 combos (10.7%)" + "Clear" + "Select All" buttons
    - If grids overflow vertically: scrollable
  - **Click-drag selection:** mousedown on a cell starts selection mode. Dragging across cells toggles them. This lets the coach select "all broadways" or "all suited aces" in one drag.
  - **Auto-blocking:** on panel open, compute blocked cards (hero + board). Grey out any cell where ALL combos are blocked. Partially blocked cells still selectable but show reduced combo count.
  - **Range persistence:** store selected ranges in `playback.equityRanges[handIndex][villainSeat]`. Navigating away and back restores the ranges.
  - **Equity recalculation:** triggers when coach changes any range. Debounce 300ms so rapid clicking doesn't spam the Worker. Show "Calculating..." during computation.
  - **Close:** button or Escape key. Table returns to full width.

  **Test scenarios:**
  - Test expectation: none — UI; verified via Playwright in 3.5

  **Verification:**
  - Grid renders 13x13 correctly with proper labels
  - Blocked combos visually distinct and unclickable
  - Click-drag selects/deselects range of cells
  - Equity updates on range change
  - Multiple villain grids for multiway pots
  - Ranges persist when navigating between hands
  - Close returns to clean playback view
  - Panel doesn't obscure critical table elements

- [ ] **3.5: Equity verification suite + browser tests**

  **Goal:** Automated verification that equity calculations are correct. Playwright tests for the full UI flow.

  **Requirements:** EQ8 (final verification)

  **Dependencies:** 3.1-3.4

  **Files:**
  - Create: `tests/browser/equity.spec.js`
  - Modify: `tests/hand_evaluator.test.js` (add cross-reference tests if not already at 100+)
  - Modify: `tests/equity_engine.test.js` (add published matchup cross-references)

  **Approach:**
  - **Cross-reference suite:** 50+ equity calculations verified against PokerStove/Equilab published results:
    - 10 preflop hand-vs-hand matchups
    - 10 preflop hand-vs-range matchups
    - 10 flop equity scenarios
    - 10 turn equity scenarios
    - 10 multiway scenarios
  - **Playwright tests:**
    - Open app → load session → navigate to flop → open equity panel → select range → verify equity displays
    - Open equity → multiple villains → verify all grids render
    - Open equity → close → table returns to normal
  - **Regression:** all cross-reference values stored in test fixtures, re-verified on every build

  **Test scenarios:**
  - 50+ cross-reference matchups at various streets
  - Multi-way equity sums to 100%
  - Blocked combos correctly removed
  - Worker doesn't crash on edge cases (empty range, all blocked)
  - Playwright: full equity UI flow works in built app

  **Verification:**
  - Every cross-reference matches published value within tolerance
  - Playwright tests pass against built index.html
  - Smoke test still passes
  - All unit tests (200+) still pass

## System-Wide Impact

- **New shared modules:** hand_evaluator.js, equity_engine.js, equity_worker.js — all inlined by build script
- **UI:** New side panel. Table width adjusts when panel is open. Equity button added to playback controls.
- **Build size:** Equity modules add ~30-50KB. Worker inlined as Blob URL.
- **Existing functionality:** Playback, parsing, session library — all unchanged. Equity is purely additive.
- **Performance:** Web Worker ensures no UI impact. Main thread only posts messages and receives results.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Hand evaluator wrong for edge cases | 100+ test-first tests, cross-reference against published values |
| Equity too slow for wide ranges | Per-runout caching, Monte Carlo for preflop, Web Worker for non-blocking |
| Worker inlining breaks in build | Test built index.html specifically in Playwright |
| 13x13 grid too small on screen | Side panel gets adequate width, grid cells minimum 20x20px |
| Multiway rejection sampling too slow with overlapping ranges | 50K samples with timeout — if >50% rejected, warn coach to narrow ranges |
| Range persistence bloats memory | Only store range selections (compact 169-element arrays), not computed equity |
