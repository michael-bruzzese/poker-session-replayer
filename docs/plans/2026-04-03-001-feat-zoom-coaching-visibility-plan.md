---
title: "feat: Zoom coaching visibility — action callouts, stacks, pot, cards, and game context"
type: feat
status: completed
date: 2026-04-03
---

# Zoom Coaching Visibility — UX Polish

## Overview

The Session Replayer's core mechanics are complete and battle-tested in a real Zoom coaching session. The #1 pain point from that session: **students couldn't easily see what action just happened.** This plan addresses all seven visual/UX items from TODO_NEXT.md, prioritized by coaching impact. No engine changes needed — this is purely CSS, rendering logic, and DOM work in `session_replayer_web.html`.

## Problem Frame

When coaching poker over Zoom screen-share, visual clarity is everything. Students are watching a compressed video stream on various screen sizes. The current UI was built for local development — action popups are too small (36px, 1.4s), stack numbers are readable but not prominent (20px), pot overlaps the board, and cards are text symbols. Every pixel of ambiguity costs coaching effectiveness.

## Requirements Trace

- R1. Action callouts must be immediately obvious to Zoom viewers at a glance
- R2. Stack sizes must be large, bold, and show changes after each action
- R3. Pot display must not overlap board cards and must be prominently visible
- R4. A session header must show game context (stakes, straddle, game description)
- R5. Board cards must use actual card images at a larger size for Zoom readability
- R6. Chip graphics should provide visual feedback when money moves
- R7. Text paste input must auto-detect JSON vs natural language and route accordingly

## Scope Boundaries

- No engine changes — all work is in CSS, DOM rendering, and app-specific JS
- No new dependencies or frameworks
- No Playwright/E2E tests — visual changes verified manually + existing unit tests must continue passing
- No browser-side Claude API integration (deferred)
- No multi-session library (deferred)

## Context & Research

### Relevant Code and Patterns

- **Action popup system** (`session_replayer_web.html` lines ~413-460): `action-popup` class, 36px bold, positioned 55% from seat toward center, 1400ms display, CSS scale-in/fade-out transitions
- **Seat action badges** (lines ~389-411): `seat-action` class, 13px text, color-coded by action type, persists per street
- **Stack rendering** (line ~309): 20px/800-weight green text on seats
- **Pot display** (line ~187): positioned at `top: 62%`, 28px bold gold with text-shadow
- **Board cards** (lines ~257-266): 73x104px, `renderCardContent()` already tries embedded images before text fallback
- **Card image pipeline**: `embedded_cards.js` has base64 PNGs keyed by "As", "Kh" etc.; `CardUtils.cardImageCandidates()` generates lookup keys
- **Chip animation**: `rakeChipsToPot()` uses CSS `transition: left/top 0.4s` with `chipUpdatesSuppressed` flag
- **Game banner**: `game-banner` CSS and DOM partially exist; `loadSession()` populates blind info
- **All animations are CSS transition-based** — no `@keyframes` in codebase yet

### Institutional Learnings

None documented yet. Consider compounding learnings from this session via `/ce:compound`.

## Key Technical Decisions

- **Introduce `@keyframes` for attention animations**: The codebase is 100% CSS transitions, but a pulse/bounce-in for the action popup warrants a simple keyframe animation. Keep it to 1-2 keyframe definitions max.
- **Stack change deltas**: Store previous stack value, compare on render, show a brief animated delta (e.g., "-30" that fades). This requires minimal state tracking — just a `previousStacks` map.
- **Pot repositioned above board**: Move from `top: 62%` to `top: 18-22%` range so it's clearly above the board cards at `top: 40%`.
- **Board card size increase**: From 73x104px to ~95x135px (~30% larger per TODO spec).
- **Text paste routing**: Simple heuristic — if input starts with `{` or `[`, treat as JSON; otherwise treat as natural language notes for the shorthand learner.

## Open Questions

### Resolved During Planning

- **Q: Are card images already loading from embedded_cards.js?** Yes — `renderCardContent()` already tries `EMBEDDED_CARDS[key]` lookup. If images aren't showing, it's a key format mismatch, not a missing pipeline. Verify during implementation.
- **Q: Should we use `@keyframes` or stick with transitions?** Introducing minimal `@keyframes` is appropriate for the popup attention effect. CSS transitions can't do repeating pulses.

### Deferred to Implementation

- **Exact popup position tuning**: Whether 55% toward center or closer to the seat works better — needs visual testing on a Zoom screen share. Must clamp popup coordinates to felt bounds so corner-seat popups (seats 2, 3, 7, 8) don't overflow at 720p
- **Stack delta animation duration**: Needs visual testing to find the right balance between noticeable and distracting
- **Card image dev vs build mode**: Card images from `embedded_cards.js` only load in the built `index.html`, not in dev mode (expected). Verify in built mode; accept text fallback in dev
- **renderPotChips() in render loop**: Verify whether pot chip rendering is called on every step or only during rake animations. If only during rake, add it to `render()` so pot chip scaling (Unit 6) works on every action

## Implementation Units

- [x] **Unit 1: Action Callout Overhaul**

  **Goal:** Make action popups unmissable on Zoom — the single highest-impact change.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `session_replayer_web.html` (CSS for `.action-popup`, `.seat-action`; JS for popup timing/positioning)

  **Approach:**
  - Increase popup font from 36px to 52-60px with heavier weight
  - Extend display time from 1400ms to 2500-3000ms
  - Add a `@keyframes` bounce-in or pulse animation for attention
  - Increase seat-level badge font from 13px to 18-20px
  - Consider adding a semi-transparent backdrop behind the popup for contrast
  - Action type should use distinct colors: raise/bet = bright gold, fold = red, check = green, call = blue, all-in = pulsing red/gold
  - Both script and branch modes must use the enhanced popup
  - Clamp popup position to felt bounds — corner seats (2, 3, 7, 8) will overflow at 52-60px if unclamped at 720p

  **Patterns to follow:**
  - Existing `popupPositionForSeat()` function for positioning math
  - Existing CSS transition patterns for fade-out
  - Street banner scale-in pattern for reference animation timing

  **Test scenarios:**
  - Test expectation: none — visual CSS/DOM changes only; verify manually + existing unit tests pass

  **Verification:**
  - Action popup is immediately readable at 720p Zoom resolution
  - Popup persists long enough to register (2.5-3s)
  - Seat badges readable without squinting
  - Both script playback and branch mode show enhanced popups
  - Run `npm test` — all 144 tests still pass

- [x] **Unit 2: Pot Display Repositioning**

  **Goal:** Move pot above board cards so it's always visible.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `session_replayer_web.html` (CSS for `.pot-display` positioning, pot font size)

  **Approach:**
  - Move pot from `top: 62%` to `top: 18-22%` (above board cards at `top: 40%`)
  - Increase pot font from 28px to 34-38px
  - Ensure pot chip graphic still scales properly at new position
  - Test with large pots (4-5 digit numbers) to ensure no overflow

  **Patterns to follow:**
  - Existing pot rendering in `renderPot()` function
  - Board card positioning as reference anchor

  **Test scenarios:**
  - Test expectation: none — CSS positioning change; verify visually

  **Verification:**
  - Pot is clearly visible and never overlaps board cards
  - Pot readable at Zoom resolution with both small and large pot sizes
  - Chip graphic renders correctly at new position

- [x] **Unit 3: Stack Size Enhancement**

  **Goal:** Make stack numbers larger and show stack changes after each action.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `session_replayer_web.html` (CSS for stack display, JS for delta tracking and rendering)

  **Approach:**
  - Increase stack font from 20px to 26-30px
  - Track `previousStacks` map — on each `renderSeats()` call, compare current vs previous
  - When stack decreases, show a brief "-30" delta in red that fades out over 1.5s
  - When stack increases (won pot), show "+257" delta in green that fades out
  - Store previous stacks at the start of each action, update after render
  - Delta element positioned just below or beside the stack number
  - **Critical: Prev/rewind handling** — `replayToStep()` replays the hand from scratch, so `previousStacks` must be set to `null` before the final `render()` call to avoid nonsensical deltas. Same for `loadHand()` and `loadHandAtShowdown()`
  - **Blind posting**: Initialize `previousStacks = null` on hand load so no deltas show for blind/straddle posts. Deltas only appear starting from the first user-initiated Next step

  **Patterns to follow:**
  - Existing `renderSeats()` function for stack display
  - CSS transition fade-out pattern used elsewhere

  **Test scenarios:**
  - Test expectation: none — visual rendering change; verify manually

  **Verification:**
  - Stack numbers clearly readable at Zoom resolution
  - Stack changes show visible delta animation (red for loss, green for gain)
  - Deltas don't persist or stack up — each new action replaces the previous delta
  - No visual glitch when navigating backwards (Prev button)

- [x] **Unit 4: Board Card Images and Size**

  **Goal:** Ensure board cards use actual card images and are 30% larger for Zoom.

  **Requirements:** R5

  **Dependencies:** None

  **Files:**
  - Modify: `session_replayer_web.html` (CSS for `.board-card` dimensions, verify `renderCardContent()` image pipeline)

  **Approach:**
  - Increase `.board-card` from 73x104px to 95x135px
  - Verify `embedded_cards.js` key format matches `renderCardContent()` lookup — if mismatch, fix the lookup
  - Ensure hole cards at seats also render as images (may already work)
  - Verify card images render in the built `index.html` (post `build_embedded.py`)

  **Patterns to follow:**
  - Existing `renderCardContent()` function and `CardUtils.cardImageCandidates()`
  - `embedded_cards.js` key format

  **Test scenarios:**
  - Test expectation: none — verify card images render visually in both dev and built modes

  **Verification:**
  - Board cards show actual PNG images, not text symbols
  - Board cards are visibly larger and clear at Zoom resolution
  - Hole cards at seats also render as images
  - Built `index.html` has card images working (not just dev mode)

- [x] **Unit 5: Session Header / Game Banner**

  **Goal:** Show persistent game context during coaching — stakes, straddle, and session description.

  **Requirements:** R4

  **Dependencies:** Unit 2 (pot position must be finalized to avoid vertical collision)

  **Files:**
  - Modify: `session_replayer_web.html` (CSS for game banner, JS for banner content population, parse screen input)

  **Approach:**
  - Enhance existing `game-banner` element to be more prominent (larger font, better contrast)
  - Display: session name, blinds (e.g., "$2/$5"), straddle info if present, hero name
  - Support user-provided game description (e.g., "Playing 2-5 at the Wynn — straddle is on most hands")
  - Banner should be visible but not distracting during playback — fixed at top of the felt or above the table
  - Pull data from `session.blinds`, `session.session_name`, and a new optional `session.description` field
  - Add an optional text input on the parse/upload screen for entering the game description (alongside the existing session name input)
  - Position banner so it doesn't collide with pot display (Unit 2 moves pot to `top: 24-26%` — banner must be above that)

  **Patterns to follow:**
  - Existing `loadSession()` function that already reads blind info
  - Existing `game-banner` CSS class

  **Test scenarios:**
  - Test expectation: none — visual/DOM change; verify manually

  **Verification:**
  - Banner visible during both script and branch modes
  - Shows accurate blind/straddle info from session data
  - Doesn't obstruct table or important game elements
  - Works with and without optional fields (description, straddle)

- [x] **Unit 6: Chip Animation Enhancement**

  **Goal:** Better visual feedback when money moves — chips sliding from seats to pot.

  **Requirements:** R6

  **Dependencies:** Unit 2 (pot position must be finalized first)

  **Files:**
  - Modify: `session_replayer_web.html` (CSS for chip animations, JS for `rakeChipsToPot()` enhancement)

  **Approach:**
  - Enhance existing `rakeChipsToPot()` to animate chips more visibly
  - Scale pot chip graphic with pot size (already partially implemented — verify and tune)
  - Consider adding a brief "chip clink" visual effect (flash/glow) when chips arrive at pot
  - Keep it simple — colored circles/stacks that grow, not elaborate 3D graphics
  - Ensure chip animation targets the new pot position from Unit 2

  **Patterns to follow:**
  - Existing `rakeChipsToPot()` with CSS `transition: left/top 0.4s`
  - Existing `chipUpdatesSuppressed` pattern for preventing render conflicts

  **Test scenarios:**
  - Test expectation: none — animation change; verify visually

  **Verification:**
  - Chips visibly animate from seat toward pot on bets/raises
  - Pot chip graphic scales with pot size
  - No render conflicts or flickering during animation
  - Animation timing feels natural (not too fast, not too slow)

- [x] **Unit 7: Text Paste Input Flow**

  **Goal:** Support pasting raw session notes directly — auto-detect format and route accordingly.

  **Requirements:** R7

  **Dependencies:** None

  **Files:**
  - Modify: `session_replayer_web.html` (JS for paste handler, input routing logic)

  **Approach:**
  - **Note:** JSON-vs-ShorthandLearner routing already exists (lines ~3216-3243). This unit focuses on what's NOT yet built:
  - Add format-detection feedback messages ("Detected JSON session data" vs "Detected session notes — parsing...")
  - Add graceful fallback UX: if JSON parse fails (input starts with `{` but is malformed), show a clear error and offer "Try as session notes instead?" button
  - Ensure the "Paste Session Notes" button smoothly routes into the existing parse flow without extra clicks
  - Handle paste events (Ctrl+V) directly in the text area, not just button click

  **Patterns to follow:**
  - Existing JSON upload handler in the file upload flow
  - Existing ShorthandLearner integration

  **Test scenarios:**
  - Happy path: valid JSON pasted -> loads session correctly
  - Happy path: natural language notes pasted -> routes to ShorthandLearner
  - Edge case: malformed JSON (starts with `{` but invalid) -> graceful error, offers natural language fallback
  - Edge case: empty paste -> no-op or gentle prompt

  **Verification:**
  - Pasting valid JSON loads the session
  - Pasting natural language text routes to the parser
  - Error states show helpful messages, not silent failures
  - Existing file upload still works unchanged

## System-Wide Impact

- **Interaction graph:** All changes are in `session_replayer_web.html` — no shared engine files touched. The build script (`build_embedded.py`) doesn't need changes unless card image keys need fixing.
- **Error propagation:** Text paste flow (Unit 7) is the only unit with error paths — JSON parse failures should surface user-friendly messages.
- **State lifecycle risks:** Stack delta tracking (Unit 3) adds minimal state (`previousStacks` map). Must handle Prev/Next navigation and hand transitions without stale deltas.
- **API surface parity:** N/A — no API changes.
- **Integration coverage:** Unit tests cover engine logic. Visual changes are verified manually. Run `npm test` after each unit to ensure no regressions.
- **Unchanged invariants:** The shared engine (`shared/table_engine.js`, `shared/holdem_validator.js`, `shared/shorthand_learner.js`), the build system, and the data model are all unchanged. Session JSON format is unchanged except for the optional `session.description` field (Unit 5).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Larger fonts/elements may overflow or overlap on smaller screens | Test at 1280x720 (common Zoom share resolution) as the baseline |
| Card image key mismatch in embedded_cards.js | Verify keys match during Unit 4; fallback to text already exists |
| Stack delta animation conflicts with Prev/Next navigation | Clear deltas on any navigation action, not just forward steps |
| Pot repositioning affects chip animation targets | Unit 6 depends on Unit 2; implement in order |
| CSS changes bloat already-large HTML file | Minimal risk — CSS additions are small relative to 127KB template |

## Sources & References

- Feature spec: `TODO_NEXT.md`
- Architecture: `ARCHITECTURE.md`
- Live deployment: https://michael-bruzzese.github.io/poker-session-replayer/
