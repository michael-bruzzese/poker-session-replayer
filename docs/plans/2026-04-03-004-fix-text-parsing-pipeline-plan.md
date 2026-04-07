---
title: "fix: Text/docx parsing pipeline — seat assignment, position mapping, and error resilience"
type: fix
status: completed
date: 2026-04-03
---

# Fix Text/Docx Parsing Pipeline

## Overview

The text-to-session parsing pipeline is fundamentally broken. When users upload .docx or paste text session notes, the ShorthandLearner outputs `seat: 0` for every non-Hero action because it has no seat-assignment logic. This produces garbage data that breaks the QA screen, shows "Seat 0" to users, and causes the replayer to malfunction. The JSON upload path works correctly — this is purely a text parsing issue.

## Problem Frame

The intended workflow is: user records voice notes → transcribes → uploads text → app parses into structured session → QA → coaching playback. The parser (ShorthandLearner) was built for shorthand notation patterns but lacks the ability to:

1. **Map positions to seats** — It recognizes "CO raises 15" but outputs `seat: 0, position: "CO"` because it doesn't know which seat number CO is. It needs the button position to compute this.
2. **Parse seat numbers from text** — "Seat 9 raises 15" is not recognized. The parser doesn't extract "Seat N" patterns.
3. **Parse board cards separately from hero cards** — Board cards on the flop line get mixed with hero card extraction.
4. **Assign seats based on button position** — Even when it knows the button seat and a player's position, it doesn't compute the seat number.

**What works:** JSON upload → QA → playback is 100% functional. The engine, validator, QA system, and replayer are all fine. Only the text→JSON translation layer is broken.

## Root Cause Analysis (verified by running the parser)

**Test 1: Natural language** ("Folds to seat 9 in the cutoff, she opens to 15")
- Result: All non-Hero actions have `seat: 0, position: "?"` or `position: "Villain"`
- Hero cards parsed wrong (Ah Td instead of As Kd)
- Button seat always defaults to 1
- No board cards extracted
- Hand boundaries misidentified (Table Lineup section parsed as a hand)

**Test 2: Shorthand notation** ("CO raises 15, BTN calls, SB folds, BB folds")  
- Result: Positions recognized (CO, BTN, SB, BB) but `seat: 0` for all
- Board cards extracted correctly
- No seat-to-position mapping attempted

**Test 3: Explicit seat numbers** ("Seat 9 raises 15, Seat 1 calls")
- Result: `seat: 0` for everything — parser doesn't extract "Seat N" patterns at all

**Test 4: JSON upload** (gold_session.json)
- Result: Works perfectly — all actions succeed, correct pots, correct playback

## Requirements Trace

- R1. Position names (CO, BTN, SB, BB, UTG, etc.) must be mapped to correct seat numbers using the button position
- R2. Explicit "Seat N" references in text must be parsed into the correct seat number
- R3. When seat cannot be determined, use `null` (not 0) and surface it as a QA question
- R4. Board cards must be extracted separately from hero cards
- R5. Hand boundaries must correctly separate hands from non-hand text (player descriptions, session preamble)
- R6. Button position must be extracted from text when stated ("Button on seat 3")
- R7. The QA/review screens must never display "Seat 0" — unknown seats shown as "Unknown" with a prompt to fix
- R8. Bad parser output must never crash the replayer — graceful degradation at every stage
- R9. JSON upload path must remain 100% functional (no regressions)
- R10. All 191 existing tests must continue to pass

## Scope Boundaries

- Fix the ShorthandLearner's seat assignment and position mapping
- Fix the QA/review screen display of seat 0
- Add error resilience so bad parser output degrades gracefully instead of crashing
- Do NOT rewrite the parser from scratch — fix the specific broken behaviors
- Do NOT change the JSON data format or engine
- Graphics/animation work is deferred to a separate plan

## Key Technical Decisions

- **Position→seat mapping via button position**: In Hold'em, if you know the button seat and the table size, every position maps to exactly one seat. The parser already extracts button seat sometimes. When it has both position and button, it should compute the seat. Use `PokerEngine.computePositionsFromButton()` which already exists.
- **Seat 0 → null sentinel**: Change the parser to output `seat: null` instead of `seat: 0` when unknown. This distinguishes "unknown" from "seat 1 in 0-indexed" and prevents the engine from treating unknown seats as valid.
- **QA screen as the safety net**: When the parser can't determine a seat, the QA system should ask the user. This is already partially how it works — the validator generates questions — but the seat 0 display needs fixing.

## High-Level Technical Design

> *Directional guidance, not implementation specification.*

```
Text Input
  ↓
ShorthandLearner.parseWithProfile()
  ├── chunkIntoHands() — split text at "Hand N" boundaries
  │   └── FIX: skip preamble/lineup sections that aren't hands
  ├── parseHandChunk() — extract per-hand data
  │   ├── extractHeroCards() — parse hero's hole cards
  │   ├── extractBoard() — parse flop/turn/river
  │   │   └── FIX: don't mix board cards with hero cards
  │   ├── extractButtonSeat() — parse "button on seat N"
  │   │   └── NEW: extract button position from text
  │   ├── parseActions() — parse action lines
  │   │   ├── findActorBefore() — determine who acted
  │   │   │   ├── FIX: parse "Seat N" patterns → seat: N
  │   │   │   ├── FIX: when position known + button known → compute seat
  │   │   │   └── FIX: output seat: null instead of seat: 0 when unknown
  │   │   └── matchAction() — determine action type and amount
  │   └── assignSeatsFromPositions() — NEW: post-process pass
  │       └── Use button seat + computePositionsFromButton() to fill in
  │           null seats based on known positions
  ↓
Session JSON (with seat: null for unknowns)
  ↓
HoldemValidator.validateSession()
  └── FIX: generate QA questions for seat: null actions
  ↓
startQA() → QA Screen
  └── FIX: display "Unknown seat" instead of "Seat 0"
  ↓
loadSession() → Replayer
  └── FIX: skip/ignore actions with seat: null instead of crashing
```

## Implementation Units

### Phase 1: Safety First — Stop Crashing on Bad Data

- [ ] **Unit 1: Replace seat 0 with null throughout parser output**

  **Goal:** Eliminate seat 0 as a sentinel. Use null for unknown seats so downstream code can distinguish unknown from valid.

  **Requirements:** R3, R8

  **Files:**
  - Modify: `shared/shorthand_learner.js` (findActorBefore, folds-around logic, all seat: 0 outputs)
  - Test: `tests/shorthand.test.js`

  **Approach:**
  - Find every `seat: 0` in shorthand_learner.js and replace with `seat: null`
  - Update any internal logic that checks `if (seat)` or `seat === 0` to handle null correctly
  - The parser's public output should use null for unknown, 1-9 for known seats

  **Execution note:** Characterization-first — run existing shorthand tests before changing to confirm baseline.

  **Patterns to follow:**
  - Existing `findActorBefore` function structure

  **Test scenarios:**
  - Happy path: Hero actions still get seat: 1 (or heroSeat)
  - Happy path: Known positions still get their position string
  - Edge case: Unknown actor → seat: null, position: "?"
  - Edge case: "folds around" → seat: null for each fold
  - Integration: parseWithProfile with natural language text → no seat: 0 in output

  **Verification:**
  - `grep "seat: 0" shared/shorthand_learner.js` returns zero matches (excluding comments)
  - All existing shorthand tests pass (may need updates for 0→null)
  - Parser output never contains seat: 0

- [ ] **Unit 2: QA and review screens handle null seats gracefully**

  **Goal:** "Seat 0" never displayed to users. Unknown seats shown as "Unknown" with a prompt.

  **Requirements:** R7, R8

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `session_replayer_web.html` (QA screen rendering, review screen rendering)

  **Approach:**
  - Where QA screen displays `Seat ${action.seat}`: check for null/0, display "Unknown seat" instead
  - Where review screen displays `S${action.seat}`: same treatment
  - The validator already flags invalid seats — ensure these produce user-friendly QA questions

  **Test scenarios:**
  - Test expectation: none — UI rendering; verify manually

  **Verification:**
  - Upload a .docx file → QA screen never shows "Seat 0"
  - Unknown seats shown as "Unknown seat" with option to specify

- [ ] **Unit 3: Replayer skips/handles null-seat actions without crashing**

  **Goal:** If bad data makes it through QA, the replayer degrades gracefully instead of breaking.

  **Requirements:** R8, R9

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `session_replayer_web.html` (applyStepAction, loadHandAtShowdown, replayToStep)

  **Approach:**
  - In `applyStepAction`: if seat is null or invalid, skip the action and log a warning
  - In `loadHandAtShowdown` and `replayToStep`: same guard
  - The conversion `(step.seat || 1) - 1` currently maps seat 0 → seat 0 (engine index 0). With null seats, `(null || 1) - 1 = 0` — this silently assigns to Hero. Change to explicitly check: if seat is null/undefined/0, skip the action.

  **Test scenarios:**
  - Test expectation: none — defensive guard; verify replayer doesn't crash on bad data

  **Verification:**
  - Upload a session with null-seat actions → replayer loads without crashing
  - Actions with valid seats play correctly; null-seat actions skipped
  - JSON upload path completely unaffected

### Phase 2: Make the Parser Actually Work

- [ ] **Unit 4: Extract button seat from text**

  **Goal:** Parse "Button on seat 3", "BTN seat 3", "Button is seat 3" from hand text.

  **Requirements:** R6

  **Dependencies:** None

  **Files:**
  - Modify: `shared/shorthand_learner.js` (add extractButtonSeat function or enhance existing)
  - Test: `tests/shorthand.test.js`

  **Approach:**
  - Add regex patterns for button seat extraction: `/button\s+(?:is\s+)?(?:on\s+)?seat\s*(\d)/i`, etc.
  - Store as `hand.button_seat` in the parsed output
  - Default to 1 if not found (current behavior)

  **Test scenarios:**
  - Happy path: "Button on seat 3" → button_seat: 3
  - Happy path: "Button seat 7" → button_seat: 7
  - Happy path: "BTN is seat 1" → button_seat: 1
  - Edge case: No button mentioned → button_seat: 1 (default)
  - Edge case: "Button on me" with heroSeat: 1 → button_seat: 1

  **Verification:**
  - Parser extracts button seat from various phrasings
  - Existing tests pass

- [ ] **Unit 5: Parse "Seat N" patterns in action text**

  **Goal:** When text says "Seat 9 raises 15", extract seat: 9.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `shared/shorthand_learner.js` (findActorBefore or action parsing)
  - Test: `tests/shorthand.test.js`

  **Approach:**
  - In `findActorBefore`, add a regex check for `seat\s*(\d)` before the action
  - If found, use that seat number directly (1-indexed)
  - This takes priority over position-based guessing

  **Test scenarios:**
  - Happy path: "Seat 9 raises 15" → seat: 9, action: raise, amount: 15
  - Happy path: "Seat 2 folds" → seat: 2, action: fold
  - Happy path: "Seat 4 Tyler calls" → seat: 4, action: call
  - Edge case: "Seat 1 bets 20" → seat: 1 (hero seat)

  **Verification:**
  - Explicit seat references produce correct seat numbers in output

- [ ] **Unit 6: Map positions to seats using button position**

  **Goal:** When the parser knows the button seat and an action's position (CO, SB, BB, etc.), compute the correct seat number.

  **Requirements:** R1

  **Dependencies:** Unit 4, Unit 5

  **Files:**
  - Modify: `shared/shorthand_learner.js` (add post-processing step after action parsing)
  - Test: `tests/shorthand.test.js`

  **Approach:**
  - After parsing all actions for a hand, if button_seat is known:
    - Call `PokerEngine.computePositionsFromButton(buttonSeat - 1, 9)` to get the seat→position map
    - Invert it to get position→seat map
    - For any action with `seat: null` but a known position, look up the seat from the map
    - Set the seat number (1-indexed in the output)
  - This is a post-processing pass, not inline with action parsing

  **Test scenarios:**
  - Happy path: Button on seat 1, "CO raises" → seat: 9 (CO is seat 9 when button is seat 1 in 9-max)
  - Happy path: Button on seat 5, "SB folds" → seat: 6
  - Happy path: Button on seat 3, "BB checks" → seat: 5
  - Edge case: Position not in the standard set → seat stays null
  - Edge case: No button seat known → no mapping attempted, seats stay null
  - Integration: Full hand with button + positions → all seats correctly assigned

  **Verification:**
  - Parser output has correct seat numbers for all standard positions when button is known
  - Positions map correctly for different button positions

- [ ] **Unit 7: Fix hand boundary detection and board card extraction**

  **Goal:** Non-hand text (table lineup, preamble) doesn't get parsed as hands. Board cards extracted correctly.

  **Requirements:** R4, R5

  **Dependencies:** None

  **Files:**
  - Modify: `shared/shorthand_learner.js` (chunkIntoHands, board extraction logic)
  - Test: `tests/shorthand.test.js`

  **Approach:**
  - Hand chunking: reject chunks that have no action keywords (raise, bet, call, fold, check) — these are preamble/descriptions
  - Board extraction: flop/turn/river cards should be parsed from lines starting with "Flop", "Turn", "River" keywords, not from the hero card line
  - Ensure hero card extraction doesn't grab board cards

  **Test scenarios:**
  - Happy path: "Table Lineup" section skipped, not parsed as a hand
  - Happy path: Preamble about session context skipped
  - Happy path: "Flop: Ks 8c 3d" → board.flop: ["Ks", "8c", "3d"]
  - Happy path: "Turn is the five of hearts" → board.turn: "5h"
  - Happy path: "River 2c" → board.river: "2c"
  - Edge case: Natural language cards ("king of spades") → "Ks"
  - Edge case: Hand with no flop (preflop only) → board: {}

  **Verification:**
  - Number of parsed hands matches number of actual hands in input
  - Board cards correctly extracted per hand
  - Hero cards not contaminated by board cards

### Phase 3: End-to-End Validation

- [ ] **Unit 8: End-to-end parsing tests with multiple input formats**

  **Goal:** Automated tests that verify the full parse→validate→playback pipeline with text input.

  **Requirements:** R9, R10

  **Dependencies:** Units 1-7

  **Files:**
  - Create: `tests/parse_pipeline.test.js`
  - Modify: `tests/fixtures/` (add text fixture files)

  **Approach:**
  - Create fixture files: shorthand notation, natural language, explicit seat numbers
  - Test each through `parseWithProfile` → `validateSession` → `simulateHandPlayback`
  - Verify: correct seat numbers, correct actions, no seat 0, no crashes, playback succeeds
  - Also test: JSON input still works (regression guard)

  **Test scenarios:**
  - Happy path: Shorthand format with positions + button → correct seats, successful playback
  - Happy path: Natural language with "Seat N" references → correct seats, successful playback
  - Happy path: JSON file → unchanged behavior, all hands play through
  - Edge case: Text with unparseable hand → skipped gracefully, other hands still work
  - Edge case: Text with no hands → returns empty hands array, app shows parse screen
  - Error path: Malformed text → no crash, parser returns empty or partial result

  **Verification:**
  - All new parse pipeline tests pass
  - All 191 existing tests still pass
  - Three different input formats produce valid session data that plays back correctly

## System-Wide Impact

- **Interaction graph:** Changes to ShorthandLearner affect text parsing only. Changes to QA/review screens affect display only. Changes to applyStepAction add a guard but don't alter engine logic. JSON path completely unaffected.
- **Unchanged invariants:** PokerEngine, HoldemValidator logic, side pot calculation, chip conservation, Hold'em rules — all unchanged. Session JSON format unchanged. Only the text→JSON translation layer and UI display of bad data are modified.
- **Integration coverage:** Unit 8 creates the first automated tests for the text parsing → playback pipeline.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| ShorthandLearner changes break existing shorthand tests | Run tests after every change; characterization-first posture |
| Position→seat mapping wrong for edge cases | Use the existing `computePositionsFromButton` which is well-tested |
| Natural language parsing still imperfect after fixes | The QA system is the safety net — unknown seats become questions |
| Changes to action processing break JSON path | JSON path never touches ShorthandLearner; add explicit regression test |

## Sources & References

- Parser: `shared/shorthand_learner.js` (~1200 lines)
- Validator: `shared/holdem_validator.js`
- QA/Review UI: `session_replayer_web.html` (startQA ~line 2975, review ~line 3047)
- Engine seat math: `shared/table_engine.js` — `computePositionsFromButton()`
- Test fixtures: `tests/fixtures/gold_session.json`
