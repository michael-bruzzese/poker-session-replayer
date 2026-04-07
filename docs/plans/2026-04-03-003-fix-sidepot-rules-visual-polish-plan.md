---
title: "fix: Side pot calculation follows Hold'em rules + visual polish for Zoom coaching"
type: fix
status: completed
date: 2026-04-03
---

# Fix Side Pot Rules & Visual Polish

## Overview

Two related fixes: (1) The side pot engine creates pot entries for every distinct `committedHand` level during normal betting, incorrectly showing "Main" + "Side 1" on every hand. Side pots should only exist when a player is all-in. (2) Visual elements need verification and tuning after the recent layout changes to ensure clean rendering at 720p Zoom resolution.

## Problem Frame

**Side pot bug:** `calculateSidePots()` in `shared/table_engine.js` splits the pot whenever players have different `committedHand` values — which happens every hand (BB posts 5, raiser puts in 15, etc.). In Hold'em, side pots only occur when a player is all-in and cannot match other players' bets. Until someone's stack hits zero, there is one pot.

**Visual polish:** After moving pot to `top: 55%` and board to `top: 35%`, the chip animations, bet chip offsets, action popups, and seat positions need verification that nothing overlaps or looks off at coaching resolution.

## Requirements Trace

- R1. Side pots only created when at least one player is all-in (stack = 0, status = "allin")
- R2. When no player is all-in, `tableState.pots` must be a single entry containing the full pot
- R3. When a player IS all-in, side pot math must correctly divide the pot per Hold'em rules
- R4. Existing 177 tests continue to pass
- R5. Visual elements (pot, board, chips, popups, seats) must not overlap at 1280x720
- R6. Chip rake animation targets the pot's actual position

## Scope Boundaries

- No new features — bug fix and visual tuning only
- Side pot logic change is in the shared engine; UI rendering stays the same (it already shows side pots only when `pots.length > 1`)
- No changes to the playback engine, branch mode, or parser

## Key Technical Decisions

- **Gate side pot splitting on all-in status**: The simplest correct fix is to check whether any non-folded player has status `"allin"` before running the multi-pot algorithm. If nobody is all-in, return a single pot entry. This avoids rewriting the splitting algorithm — it's correct for the all-in case, just overeager about when to run.
- **Keep the existing splitting algorithm for the all-in case**: The level-based splitting logic in `calculateSidePots()` is conceptually correct for all-in scenarios. It walks ascending commitment levels and creates a pot for each tier. The bug is that it runs unconditionally.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
calculateSidePots(players, tableState):
  contenders = non-folded players
  
  IF no contender has status "allin":
    → single pot: { amount: tableState.pot, eligible: all contender seats }
    → return
  
  // At least one player is all-in — run the tiered splitting algorithm
  sort contenders by committedHand ascending
  for each distinct commitment level:
    compute pot tier amount from ALL players (including folded)
    eligible = contenders at or above this level
    add pot entry
```

## Open Questions

### Resolved During Planning

- **Q: Should `calculateSidePots` also consider `"allin"` in the folded players?** No — a folded player who was all-in already lost. Only active/all-in players create pot tiers. Folded players just contribute dead money.
- **Q: Is the existing tier algorithm's math correct?** Yes — lines 270-274 correctly compute each tier by summing `min(committedHand, level) - min(committedHand, previousLevel)` across ALL players. The amounts correctly account for folded contributions.

### Deferred to Implementation

- **Exact visual position tuning**: Whether chip offsets, popup clamping, or seat positions need pixel adjustments at 720p — requires visual inspection during implementation.

## Implementation Units

### Phase 1: Engine Fix

- [ ] **Unit 1: Fix calculateSidePots to gate on all-in**

  **Goal:** Side pots only split when at least one player is all-in. Normal betting produces a single pot entry.

  **Requirements:** R1, R2, R3

  **Dependencies:** None

  **Files:**
  - Modify: `shared/table_engine.js` (`calculateSidePots` function)
  - Test: `tests/validator.test.js` or `tests/e2e_playback.test.js`

  **Approach:**
  - At the top of `calculateSidePots`, check if any non-folded player has `status === "allin"`
  - If no one is all-in: set `tableState.pots` to a single entry `[{ amount: tableState.pot, eligible: [all non-folded seats] }]` and return early
  - If someone IS all-in: run the existing tiered algorithm (unchanged)
  - This preserves the correct all-in splitting behavior while eliminating false side pots

  **Execution note:** Write the test scenarios first (characterization + new cases), then make the fix.

  **Patterns to follow:**
  - Existing `calculateSidePots` structure
  - Existing player status checks: `p.status !== "folded"`, `p.status === "allin"`

  **Test scenarios:**
  - Happy path: Normal 2-player pot (raise + call, no all-in) → single pot entry, no side pots
  - Happy path: 3-player pot, one folds, no all-in → single pot entry
  - Happy path: Preflop action with blinds + raise + call + folds → single pot entry
  - Happy path: Player goes all-in for less than the bet → 2 pot entries (main + side), correct amounts
  - Happy path: Two players all-in at different levels → 3 pot entries (main + side 1 + side 2)
  - Edge case: All players all-in at same level → single pot (all eligible)
  - Edge case: One player all-in, rest fold → single pot (only the all-in player eligible)
  - Edge case: Short stack all-in for less than BB → main pot capped at short stack's contribution per player
  - Integration: Full hand playback from gold session — `pots.length` should be 1 for every hand (no all-ins in gold session)
  - Integration: Synthetic all-in hand — `pots.length` should be 2, amounts sum to `tableState.pot`

  **Verification:**
  - All 177 existing tests pass
  - New side pot tests pass
  - Gold session hands all produce `pots.length === 1`
  - Side pot UI no longer shows during normal hands

- [ ] **Unit 2: Add E2E side pot invariant to playback tests**

  **Goal:** Ensure the E2E test suite verifies side pot correctness across all gold session hands.

  **Requirements:** R1, R4

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `tests/e2e_playback.test.js`

  **Approach:**
  - Add a cross-cutting invariant: for every hand in the gold session (none have all-ins), verify `tableState.pots.length === 1` at end of hand
  - Add a synthetic all-in hand test that verifies `pots.length === 2` and amounts sum correctly

  **Patterns to follow:**
  - Existing "Hold'em Rule Invariants" describe block in `tests/e2e_playback.test.js`

  **Test scenarios:**
  - Happy path: Gold session hands all end with `pots.length === 1`
  - Happy path: Synthetic all-in hand ends with `pots.length === 2`, main + side amounts sum to total pot
  - Edge case: Synthetic hand where all-in player's side of main pot matches their max contribution × eligible players

  **Verification:**
  - All tests pass including the new invariants

### Phase 2: Visual Polish

- [ ] **Unit 3: Verify and tune visual layout at 720p**

  **Goal:** Ensure all felt elements render cleanly without overlap after the pot/board position changes.

  **Requirements:** R5, R6

  **Dependencies:** Unit 1 (side pot fix eliminates spurious side pot display)

  **Files:**
  - Modify: `session_replayer_web.html` (CSS positions, chip offsets as needed)

  **Approach:**
  - Load a multi-street hand and step through all actions at 1280x720
  - Verify these don't overlap:
    - Board cards at `top: 35%` vs top seats at `top: 12%` / `top: -3%`
    - Pot at `top: 55%` vs board cards above and bottom seats at `top: 88%`
    - Side pots at `top: 65%` vs bottom seats (only visible during all-in, now correctly gated)
    - Bet chip offsets (`CHIP_OFFSETS_9`) vs pot display — chips should animate toward `0.55` not overlap the pot statically
    - Action popup (dynamically positioned, clamped to felt) vs pot and board
    - Game banner (top of center-area, outside felt) vs board cards
    - Stack delta labels vs seat action badges
  - Adjust any positions or offsets that collide
  - Rebuild `index.html` after changes

  **Test scenarios:**
  - Test expectation: none — visual CSS tuning; verify manually at 1280x720 + run existing test suite

  **Verification:**
  - No visual overlaps when stepping through a full hand at 720p
  - Chip rake animation lands at pot position (55% of felt height)
  - All 177+ tests still pass
  - Rebuilt `index.html` deployed

## System-Wide Impact

- **Interaction graph:** `calculateSidePots` is called from `recomputePotAndToCall` which runs after every action. The UI reads `tableState.pots` in `renderPotChips()`. No other consumers.
- **Unchanged invariants:** `tableState.pot` (the total pot number) is unaffected — only the `pots` array breakdown changes. Pot display amount, chip conservation, and all engine action logic remain identical.
- **Integration coverage:** E2E tests exercise the full action→recompute→render chain. The new side pot invariant catches regressions at that level.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Changing side pot logic breaks the all-in case | Test-first: write all-in test scenarios before touching the code |
| Visual tuning is subjective | Use 1280x720 as the hard baseline; the user will test on actual Zoom |
| Bet chip offsets may need per-seat tweaking | CHIP_OFFSETS_9 is already a per-seat config array; adjustments are isolated |

## Sources & References

- Engine: `shared/table_engine.js` — `calculateSidePots` (line ~225), `recomputePotAndToCall` (line ~204)
- UI: `session_replayer_web.html` — `renderPotChips` (line ~1958), `.pot-display` CSS, `.side-pots` CSS
- Tests: `tests/e2e_playback.test.js`, `tests/validator.test.js`
- Hold'em side pot rules: main pot = amount matched by all players; side pot = excess bet(s) only contested by players who can cover them
