---
title: "feat: Comprehensive feature roadmap — session library, AI parsing, equity calculator, audio transcription"
type: feat
status: draft
date: 2026-04-03
---

# Comprehensive Feature Roadmap

## Overview

Four features that transform the Session Replayer from a single-session coaching tool into a full coaching platform. Built in dependency order, each with its own testing infrastructure. Nothing ships without guardrails.

## Problem Frame

A poker coach using this tool today has to: (1) run a Python CLI script to parse session notes, (2) upload JSON manually, (3) can only hold one session at a time, (4) has no way to organize hands across sessions for themed lessons, (5) can't show students equity during coaching, and (6) can't use audio recordings directly. Each feature removes a friction point in the coaching workflow.

## Requirements Trace

### Session Library + Hand Folders
- SL1. Store multiple sessions in localStorage with save/load/rename/delete
- SL2. Session list visible in sidebar alongside the upload zone on app open
- SL3. Coach can create named folders and copy hand snapshots into them
- SL4. Folders are playable as standalone coaching sessions
- SL5. Data format versioned so saved sessions survive future schema changes
- SL6. localStorage usage stays under 5MB with 100+ sessions

### AI Parsing (Multi-Provider)
- AP1. Upload zone presents all input options upfront — file drop, paste, AI toggle
- AP2. AI parsing toggle visible on upload screen, on by default when key is configured
- AP3. Support Anthropic and OpenAI APIs, plus any OpenAI-compatible endpoint
- AP4. API key saved to localStorage, entered once via inline prompt (not buried in settings)
- AP5. ShorthandLearner remains as free fallback when no key is configured
- AP6. Parse confidence indicator so coach knows how much QA to expect
- AP7. Coach can set default blinds, hero seat, and table size in settings

### Equity Calculator
- EQ1. Button on the table during playback — click to open equity display
- EQ2. 13x13 range grid for each villain still in the hand
- EQ3. Grid auto-removes impossible combos (board cards, hero blockers)
- EQ4. Equity calculated for ALL players in hand simultaneously
- EQ5. Works at every street: preflop, flop, turn, river
- EQ6. Exact enumeration on flop/turn/river; Monte Carlo with 50K+ samples for preflop
- EQ7. Runs in Web Worker — UI never freezes
- EQ8. Hand evaluator verified against 100+ known matchups before shipping
- EQ9. Equity display is optional — never visible unless coach clicks the button

### Audio Transcription
- AT1. Accept raw audio files (m4a, mp3, wav) via the same upload zone
- AT2. Transcribe via Whisper API (requires configured API key)
- AT3. Feed transcription directly into AI parser — one-click upload-to-session
- AT4. Show transcription progress and allow coach to review/edit before parsing
- AT5. Graceful message when audio uploaded but no API key configured

## Scope Boundaries

- All data stored in localStorage — no backend, no server, no accounts
- No real-time collaboration between coaches
- No range presets in equity calculator — coach selects manually
- No advanced equity features (range vs range equity, GTO recommendations)
- No mobile-optimized layout (desktop/Zoom coaching is the primary use case)
- Audio transcription requires API key — no free-tier audio support

## Phased Delivery

### Phase 1: Session Library + Hand Folders
Foundation for everything else. Must exist before AI parsing can save multiple sessions.

### Phase 2: AI Parsing (Multi-Provider)
Biggest workflow improvement. Depends on session library for storing parsed sessions.

### Phase 3: Equity Calculator
Independent of other features. Highest technical risk — hand evaluator must be verified.

### Phase 4: Audio Transcription
Builds on AI parsing infrastructure. Last because it requires API key and is an extension of Phase 2.

---

# Phase 1: Session Library + Hand Folders

## Key Technical Decisions

- **localStorage with JSON** — Each session stored as a separate key (`session_<id>`). A manifest key (`session_manifest`) holds the list of session IDs, names, dates, and hand counts. Folders stored similarly (`folder_manifest` + `folder_<id>`).
- **Data format version field** — Every saved session gets a `_storageVersion: 1` field. On load, a migration function checks the version and upgrades the schema if needed. This prevents old sessions from breaking the app when we add fields.
- **Copy, not reference** — When a hand is flagged to a folder, it's deep-copied. The folder is self-contained and playable independently.
- **Lazy loading** — The manifest loads on app start (tiny — just names and IDs). Full session data loads only when selected.

## Implementation Units

- [ ] **1.1: Session storage layer**

  **Goal:** Save/load/delete sessions in localStorage with versioning.

  **Requirements:** SL1, SL5, SL6

  **Files:**
  - Create: `shared/session_storage.js`
  - Test: `tests/session_storage.test.js`

  **Approach:**
  - `saveSession(session)` — generates ID if new, stores as `session_<id>`, updates manifest
  - `loadSession(id)` — reads from localStorage, runs migration if version mismatch
  - `deleteSession(id)` — removes data key and manifest entry
  - `listSessions()` — returns manifest (name, id, date, hand count, size estimate)
  - `migrateSession(data)` — upgrades old format sessions to current version
  - Manifest stored as `session_manifest` key, sessions as `session_<id>`
  - Size tracking: estimate each session's size, warn when approaching 4MB total

  **Test scenarios:**
  - Happy path: save a session, load it back, data matches exactly
  - Happy path: save 3 sessions, listSessions returns all 3 with correct metadata
  - Happy path: delete a session, it's gone from list and storage
  - Happy path: save session with version 1, add a new field to version 2, load old session — migration adds the field
  - Edge case: save session with same name as existing — gets unique ID, both coexist
  - Edge case: localStorage full — save fails gracefully with user-facing error message
  - Edge case: corrupted manifest — app doesn't crash, rebuilds manifest from individual session keys
  - Integration: save then load then play back all hands — full pipeline works

  **Verification:**
  - All tests pass
  - Can save and load 50 sessions without issue
  - Migration handles version upgrades correctly

- [ ] **1.2: Session list UI in sidebar**

  **Goal:** Sidebar shows saved sessions alongside upload zone on app open.

  **Requirements:** SL2

  **Dependencies:** 1.1

  **Files:**
  - Modify: `session_replayer_web.html` (sidebar, upload screen)

  **Approach:**
  - On app open, sidebar shows "Saved Sessions" list from manifest
  - Each entry shows: session name, date, hand count, a load button, a delete button
  - Clicking a session loads it directly into playback (skips upload/QA)
  - Upload zone remains the primary action — sessions list is secondary/below
  - Active session highlighted in the list
  - "Save Current Session" button appears during playback (replaces the auto-save behavior with explicit save)

  **Test scenarios:**
  - Test expectation: none — UI rendering; verify manually

  **Verification:**
  - App opens showing both upload zone and saved sessions
  - Can load a saved session by clicking it
  - Can delete a session from the list
  - Active session is visually highlighted

- [ ] **1.3: Hand folders — create, flag, play**

  **Goal:** Coach creates named folders, flags hands into them, plays folders as sessions.

  **Requirements:** SL3, SL4

  **Dependencies:** 1.1, 1.2

  **Files:**
  - Modify: `shared/session_storage.js` (folder CRUD)
  - Modify: `session_replayer_web.html` (folder UI, flag button on hands)
  - Test: `tests/session_storage.test.js` (folder tests)

  **Approach:**
  - Folder data model: `{ id, name, created, hands: [...] }` — hands are full deep copies
  - "Create Folder" button in sidebar opens inline name input
  - During playback, each hand in the hand list has a "Flag" button (folder icon)
  - Clicking Flag shows a dropdown of existing folders + "New Folder"
  - Hand is deep-copied into the selected folder
  - Folders appear in sidebar under "Folders" section
  - Clicking a folder loads it as a session (same playback flow, just sourced from folder data)
  - Folders can be renamed and deleted

  **Test scenarios:**
  - Happy path: create folder, flag a hand into it, folder contains the hand
  - Happy path: flag hands from different sessions into same folder
  - Happy path: load a folder, play through its hands — full playback works
  - Happy path: edit a hand in a folder, original session's hand is unchanged (copy confirmed)
  - Edge case: flag same hand twice into same folder — no duplicate
  - Edge case: delete a folder — hands in original sessions unaffected

  **Verification:**
  - Can create folders, flag hands, play folders
  - Folder hands are independent copies
  - All existing tests still pass

- [ ] **1.4: Browser tests for session library**

  **Goal:** Automated Playwright tests verifying the upload → save → load → playback pipeline.

  **Requirements:** SL1-SL6 (integration coverage)

  **Dependencies:** 1.1-1.3

  **Files:**
  - Create: `tests/browser/session_library.spec.js`

  **Approach:**
  - Use Playwright (already in devDependencies) to test the actual app in a browser
  - Test: open app → upload JSON fixture → session loads → save → reload page → session appears in list → click to load → playback works
  - Test: create folder → flag hand → load folder → hand plays back
  - Test: delete session → gone from list
  - These catch DOM bugs, localStorage issues, and build-vs-dev divergence

  **Test scenarios:**
  - Happy path: upload → save → reload → load from list → playback
  - Happy path: create folder → flag hand → play folder
  - Edge case: reload app with saved sessions → they appear in list
  - Edge case: upload new session while another is loaded → no data corruption

  **Verification:**
  - Playwright tests pass in both dev mode and built index.html

---

# Phase 2: AI Parsing (Multi-Provider)

## Key Technical Decisions

- **Provider abstraction** — A thin adapter layer: `callLLM(provider, apiKey, systemPrompt, userMessage)` that handles Anthropic, OpenAI, and OpenAI-compatible endpoints. The parsing prompt is the same regardless of provider.
- **API key inline prompt, not settings page** — When coach toggles "AI Parsing" on the upload screen and no key is saved, a clean inline UI appears right there: provider dropdown, key field, save button. One interaction, not a separate settings page.
- **CORS handling** — Anthropic API requires `anthropic-dangerous-direct-browser-access: true` header. OpenAI API allows browser CORS directly. OpenAI-compatible endpoints vary. We'll document this and handle each provider's requirements in the adapter.
- **Parsing prompt** — Reuse the existing `parse_session.py` system prompt (detailed poker parsing spec with JSON schema). It's already battle-tested.
- **Confidence scoring** — After AI parse, run the ShorthandLearner's basic validation to score confidence. If high, go straight to QA. If low, show a warning.

## Implementation Units

- [ ] **2.1: LLM provider adapter**

  **Goal:** Abstract LLM API calls behind a provider-agnostic interface.

  **Requirements:** AP3

  **Files:**
  - Create: `shared/llm_adapter.js`
  - Test: `tests/llm_adapter.test.js`

  **Approach:**
  - `callLLM({ provider, apiKey, endpoint, model, systemPrompt, userMessage })` → returns response text
  - Providers: "anthropic" (Messages API), "openai" (Chat Completions), "openai-compatible" (same as openai, custom endpoint)
  - Each provider builds its own request format (headers, body structure)
  - Returns `{ success, text, error, tokensUsed }` — uniform output regardless of provider
  - Handles rate limits, auth errors, and network failures with clear error messages
  - No retry logic — surface errors to the user immediately

  **Test scenarios:**
  - Happy path: mock fetch, call with "anthropic" provider → correct request format built
  - Happy path: mock fetch, call with "openai" provider → correct request format built
  - Error path: 401 auth error → returns `{ success: false, error: "Invalid API key" }`
  - Error path: network failure → returns `{ success: false, error: "Network error..." }`
  - Edge case: empty response → handled gracefully

  **Verification:**
  - Adapter builds correct request format for each provider
  - Error handling covers auth, network, and malformed response cases
  - All tests pass

- [ ] **2.2: API key management UI**

  **Goal:** Inline API key setup on the upload screen — not buried in settings.

  **Requirements:** AP2, AP4

  **Dependencies:** 2.1

  **Files:**
  - Modify: `session_replayer_web.html` (upload screen UI, localStorage key management)

  **Approach:**
  - "AI Parsing" toggle on the upload screen — prominent, next to the upload zone
  - When toggled on and no key saved: inline panel appears with provider dropdown (Anthropic / OpenAI / Custom), API key field, optional custom endpoint field, Save button
  - Key saved to `localStorage.llmApiKey`, provider to `localStorage.llmProvider`
  - Once saved, toggle shows green indicator, panel collapses to just "AI Parsing: On (Anthropic)" with an edit link
  - Default blinds/hero seat inputs also visible on the upload screen (not settings page)

  **Test scenarios:**
  - Test expectation: none — UI; verify manually

  **Verification:**
  - Toggle visible immediately on upload screen
  - Key entry is inline, not a separate page
  - Saved key persists across app reloads
  - Provider selection works for all three options

- [ ] **2.3: AI parsing pipeline**

  **Goal:** Upload file → AI parses → session loaded. The complete pipeline.

  **Requirements:** AP1, AP2, AP5, AP6

  **Dependencies:** 2.1, 2.2

  **Files:**
  - Modify: `session_replayer_web.html` (handleFile, processTextInput, new AI parse flow)
  - Modify: `build_embedded.py` (inline llm_adapter.js)

  **Approach:**
  - When AI parsing is on and coach uploads text/docx:
    1. Extract text (existing: plain text read or JSZip for docx)
    2. Build the parsing prompt (reuse parse_session.py's system prompt, adapted for JS)
    3. Call `callLLM()` with the text as user message
    4. Parse the JSON response
    5. If valid session JSON, go to `startQA()`
    6. If parse fails, fall back to ShorthandLearner
  - When AI parsing is off: use ShorthandLearner only (current behavior)
  - Show spinner with "Parsing with AI..." during the API call
  - Parse confidence based on: number of hands found, percentage of seats resolved, number of validation warnings

  **Test scenarios:**
  - Happy path: mock LLM returns valid session JSON → loads into QA
  - Happy path: no API key configured → ShorthandLearner used, no error
  - Error path: LLM returns garbage → falls back to ShorthandLearner
  - Error path: API call fails → shows error, offers ShorthandLearner fallback
  - Integration: full pipeline from text input to QA screen with mocked LLM

  **Verification:**
  - Upload with AI on → session parses and loads
  - Upload with AI off → ShorthandLearner handles it
  - API errors don't crash the app
  - All existing tests pass

- [ ] **2.4: Parsing prompt and system message**

  **Goal:** Port the parse_session.py system prompt to the browser-side adapter.

  **Requirements:** AP1

  **Dependencies:** 2.1

  **Files:**
  - Create: `shared/parse_prompt.js` (system prompt constant)
  - Reference: `parse_session.py` (existing prompt to port)

  **Approach:**
  - Extract the system prompt from parse_session.py into a JS module
  - Include the session JSON schema, poker terminology guide, and parsing instructions
  - The prompt must produce output matching the existing session data format
  - Add instruction for the LLM to assign seat numbers using button position + standard position mapping

  **Test scenarios:**
  - Test expectation: none — the prompt is a string constant. Its effectiveness is tested via 2.3's integration tests.

  **Verification:**
  - Prompt produces valid session JSON when tested manually against each provider

---

# Phase 3: Equity Calculator

## Key Technical Decisions

- **Hand evaluator: build from scratch with exhaustive tests** — Rather than pulling in a large library with unknown browser compatibility, build a clean 7-card hand evaluator using the standard algorithm (iterate all C(7,5)=21 five-card combinations, evaluate each, return best). This is slower than lookup-table approaches but is simple, verifiable, and has zero dependencies. For our use case (max ~1,081 runouts × ~1,000 range combos), this is fast enough.
- **Exact enumeration everywhere except preflop** — Flop: 1,081 runouts. Turn: 46 runouts. River: 0 (just evaluate). All exact. Preflop with ranges: Monte Carlo 50K samples in a Web Worker.
- **Web Worker for all equity computation** — Even flop enumeration should run in a Worker to prevent any UI freeze. Post a message with the inputs, get back the equity percentages.
- **13x13 grid is the ONLY range input** — No presets, no text input, no import. Coach clicks the grid. Simple.

## Implementation Units

- [ ] **3.1: Hand evaluator module**

  **Goal:** Given 7 cards, determine the best 5-card poker hand and its rank. Correct for every possible combination.

  **Requirements:** EQ8

  **Files:**
  - Create: `shared/hand_evaluator.js`
  - Test: `tests/hand_evaluator.test.js`

  **Approach:**
  - `evaluateHand(sevenCards)` → `{ rank, handType, bestFive, description }`
  - `rank` is a comparable integer — higher is better. Ties must produce equal ranks.
  - `handType` is one of: "high-card", "pair", "two-pair", "three-of-a-kind", "straight", "flush", "full-house", "four-of-a-kind", "straight-flush"
  - Internally: generate all 21 five-card combos from 7 cards, evaluate each, return the best
  - Five-card evaluation: encode hand type + kickers into a single integer for fast comparison
  - `compareHands(hand1, hand2)` → 1, -1, or 0 (tie)

  **Execution note:** Test-first. Write the 100+ verification tests before writing the evaluator.

  **Test scenarios (100+ tests organized by category):**
  - Hand type identification: one test per hand type with unambiguous 7 cards
  - Hand type ranking: high card < pair < two pair < trips < straight < flush < full house < quads < straight flush (all 36 pairwise comparisons)
  - Kicker comparisons: AA with K kicker beats AA with Q kicker
  - Straight edge cases: A2345 (wheel) is valid, AKQJT is valid, KA234 is NOT a straight
  - Flush edge cases: ace-high flush beats king-high flush, suit doesn't matter for comparison
  - Full house tiebreaker: bigger trips wins, then bigger pair
  - Two pair tiebreaker: bigger top pair, then bigger bottom pair, then kicker
  - Tie detection: identical hands produce rank tie
  - 7-card best-of: from 7 cards, correctly identifies the best 5-card combination
  - Known matchups: AA vs KK on blank board → AA wins. Set vs flush on appropriate board → flush wins. Etc.
  - Cross-reference: 50+ specific 7-card hands verified against an external hand evaluator or published reference

  **Verification:**
  - 100+ tests pass
  - Every hand type correctly identified
  - Every tiebreaker scenario correct
  - Known matchup results match published references

- [ ] **3.2: Equity calculation engine**

  **Goal:** Given hero's hand, villain range(s), and board, compute equity for all players.

  **Requirements:** EQ4, EQ5, EQ6

  **Dependencies:** 3.1

  **Files:**
  - Create: `shared/equity_engine.js`
  - Test: `tests/equity_engine.test.js`

  **Approach:**
  - `calculateEquity({ heroCards, villainRanges: [range1, range2, ...], board, samples })` → `{ equities: [heroEq, v1Eq, v2Eq, ...], evaluations, elapsed }`
  - `range` is an array of combo objects: `[{ cards: ["As", "Kd"], weight: 1.0 }, ...]`
  - Algorithm:
    1. Expand each villain range to combo list, remove combos blocked by hero cards and board
    2. If postflop (board.length >= 3): exact enumeration of remaining runouts
    3. If preflop: Monte Carlo with configurable sample count (default 50K)
    4. For each runout: evaluate all hands, determine winner(s), accumulate equity
  - Card removal: for each combo tuple across all villains, remove cross-collisions (Villain 1 holding Ah means Villain 2 can't have Ah)
  - Multi-way: winner determination compares ALL players' evaluated hands, splits on ties

  **Test scenarios:**
  - Happy path: AA vs KK preflop → hero equity ~81.5% (±1% for Monte Carlo)
  - Happy path: AKs vs QQ preflop → hero equity ~46% (±1%)
  - Happy path: set vs flush draw on flop → correct equity reflecting future cards
  - Happy path: nut flush on river vs any range → 100% equity minus chops
  - Happy path: 3-way pot, hero vs two villain ranges → equities sum to 100%
  - Edge case: hero and villain have same hand → 50/50 equity
  - Edge case: villain range is single combo → exact matchup
  - Edge case: villain range is 100% of hands → correct wide-range equity
  - Edge case: board has 4 cards (turn) → only 46 river cards enumerated
  - Edge case: board has 5 cards (river) → single evaluation, no runout
  - Integration: known flop equity from published source (e.g., AsKs vs range on Ks8c3d)

  **Verification:**
  - Known preflop matchups within 1% of published values
  - Postflop exact matchups match published values exactly
  - Equities always sum to 100% (within rounding)
  - All tests pass

- [ ] **3.3: Web Worker wrapper**

  **Goal:** Run equity calculation in a background thread so UI never freezes.

  **Requirements:** EQ7

  **Dependencies:** 3.2

  **Files:**
  - Create: `shared/equity_worker.js` (Worker script)
  - Modify: `session_replayer_web.html` (Worker initialization, message passing)

  **Approach:**
  - Worker script imports hand_evaluator.js and equity_engine.js
  - Main thread sends: `{ heroCards, villainRanges, board, samples }`
  - Worker responds: `{ equities, evaluations, elapsed }`
  - For preflop Monte Carlo: Worker sends progressive updates every 10K samples so UI can show converging results
  - Build script inlines the Worker as a Blob URL (single-file deployment)
  - Fallback: if Workers aren't available, run synchronously with a "Calculating..." overlay

  **Test scenarios:**
  - Test expectation: none — Worker communication tested via Playwright browser tests in 3.5

  **Verification:**
  - Equity calculation runs without freezing the UI
  - Progressive updates arrive for preflop calculations
  - Built index.html correctly inlines the Worker

- [ ] **3.4: Range grid UI + equity display**

  **Goal:** 13x13 range selection grid per villain, equity results display on the table.

  **Requirements:** EQ1, EQ2, EQ3, EQ9

  **Dependencies:** 3.3

  **Files:**
  - Modify: `session_replayer_web.html` (equity button, grid UI, results display)

  **Approach:**
  - "Equity" button on the table — only appears during playback, never automatically shown
  - Clicking opens a modal/panel with:
    - Hero's hand displayed (not editable — it's whatever the current hand is)
    - For each villain still in hand: a 13x13 grid labeled with ranks
    - Board cards displayed above the grids
    - Impossible combos (blocked by board + hero) greyed out and unclickable
    - Click to toggle combos in/out. Click-drag to select/deselect ranges quickly.
    - Equity percentages displayed prominently for each player, updating as coach adjusts ranges
  - Grid cells: diagonal = pairs (6 combos), above diagonal = suited (4 combos), below = offsuit (12 combos)
  - Color coding: selected combos highlighted, blocked combos greyed
  - Close button returns to normal playback view

  **Test scenarios:**
  - Test expectation: none — UI; verify manually + Playwright tests in 3.5

  **Verification:**
  - Grid renders correctly with all 169 cells
  - Blocked combos visually distinct and unclickable
  - Equity updates when range changes
  - Multiple villain grids work for multi-way pots
  - Closing equity display returns to clean playback view

- [ ] **3.5: Equity calculator browser tests + verification suite**

  **Goal:** Automated tests proving the equity calculator is correct in the actual browser environment.

  **Requirements:** EQ8 (verification)

  **Dependencies:** 3.1-3.4

  **Files:**
  - Create: `tests/browser/equity.spec.js`
  - Modify: `tests/hand_evaluator.test.js` (add cross-reference tests)

  **Approach:**
  - Playwright test: open app → load session → navigate to flop → open equity → select villain range → verify equity display shows reasonable numbers
  - Cross-reference suite: 50 known matchups at various streets verified against published PokerStove/Equilab results
  - Regression tests: save equity test inputs/outputs, re-run on every build

  **Test scenarios:**
  - 50+ known equity matchups across all streets
  - Multi-way equity sums to 100%
  - Blocked combos correctly removed from ranges
  - Worker doesn't crash on edge cases (empty range, all combos blocked)

  **Verification:**
  - All equity values match published references within tolerance (exact for postflop, ±1% for preflop Monte Carlo)
  - Playwright tests pass

---

# Phase 4: Audio Transcription

## Key Technical Decisions

- **Whisper API via the same LLM adapter pattern** — Extend the provider adapter with a `transcribeAudio(provider, apiKey, audioBlob)` function. OpenAI's Whisper API is the standard. Anthropic doesn't have a transcription API, so audio always routes through OpenAI (or compatible).
- **Two-step process with review** — Transcribe first, show the transcription to the coach for review/edit, then parse. This prevents garbage-in-garbage-out and lets the coach fix transcription errors before they become parsing errors.
- **Audio file detection** — Check file MIME type on upload. If audio/*, route to transcription flow.

## Implementation Units

- [ ] **4.1: Audio transcription adapter**

  **Goal:** Accept audio blob, send to Whisper API, return text transcription.

  **Requirements:** AT1, AT2

  **Dependencies:** 2.1 (LLM adapter infrastructure)

  **Files:**
  - Modify: `shared/llm_adapter.js` (add transcribeAudio function)
  - Test: `tests/llm_adapter.test.js` (transcription tests)

  **Approach:**
  - `transcribeAudio({ apiKey, audioBlob, language })` → `{ success, text, error, duration }`
  - Sends multipart/form-data to OpenAI Whisper endpoint
  - Supports m4a, mp3, wav, webm formats
  - Returns raw transcription text
  - If no OpenAI key configured (user has Anthropic only), show clear message: "Audio transcription requires an OpenAI API key"

  **Test scenarios:**
  - Happy path: mock fetch with audio blob → correct multipart request format
  - Error path: no API key → clear error message about OpenAI requirement
  - Error path: unsupported audio format → error before API call
  - Error path: API failure → graceful error message

  **Verification:**
  - Correct multipart request format for Whisper API
  - Error handling covers all failure modes

- [ ] **4.2: Audio upload flow**

  **Goal:** Coach drops an audio file, sees transcription, reviews, then parses.

  **Requirements:** AT1, AT3, AT4, AT5

  **Dependencies:** 4.1, 2.3

  **Files:**
  - Modify: `session_replayer_web.html` (handleFile audio detection, transcription review screen)

  **Approach:**
  - In `handleFile`: detect audio MIME type (`audio/*`)
  - If audio and no API key: show message "Audio files require an API key for transcription. Add one above, or transcribe your audio elsewhere and paste the text."
  - If audio and key configured:
    1. Show "Transcribing audio..." with progress spinner
    2. Call `transcribeAudio()` with the audio file
    3. Show transcription in the parse text area for review
    4. Coach can edit the transcription
    5. "Parse & Load" button processes the (possibly edited) transcription through AI parser or ShorthandLearner
  - Same two-step process: transcribe → review → parse → QA → playback

  **Test scenarios:**
  - Test expectation: none — UI flow; verify manually

  **Verification:**
  - Audio file upload detected correctly
  - Transcription appears in editable text area
  - Coach can edit before parsing
  - No API key shows helpful message, doesn't crash
  - Full flow: audio → transcription → parse → QA → playback

---

## System-Wide Impact

- **localStorage schema**: New keys for session manifest, individual sessions, folders, API keys, provider settings. Total usage must stay under 5MB.
- **Build system**: New shared JS files (session_storage.js, llm_adapter.js, parse_prompt.js, hand_evaluator.js, equity_engine.js, equity_worker.js) must be inlined by build_embedded.py.
- **Existing functionality**: JSON upload → QA → playback pipeline unchanged. All existing 211 tests must pass throughout.
- **Single-file deployment**: All new code inlined into index.html. Web Worker inlined as Blob URL. No external dependencies except CDN JSZip (already inlined).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| localStorage 5MB limit hit with many sessions | Size tracking in manifest, warn user, compress JSON |
| CORS issues with AI provider APIs | Document per-provider requirements, test each provider |
| Hand evaluator incorrect for edge cases | 100+ test-first verification before shipping |
| Web Worker inlining breaks in built version | Test built index.html specifically in Playwright |
| Equity calc too slow for preflop wide ranges | Monte Carlo with progressive updates, 50K sample cap |
| Audio transcription cost surprises coaches | Show estimated cost before transcribing ($0.006/min) |
| New features break existing playback | Every phase includes its own test infrastructure |

## Sources & References

- Existing codebase: `session_replayer_web.html`, `shared/table_engine.js`, `parse_session.py`
- Equity algorithm: PokerStove (github.com/andrewprock/pokerstove), OMPEval
- Hand evaluator reference: PokerHandEvaluator (github.com/HenryRLee/PokerHandEvaluator)
- Whisper API: OpenAI transcription endpoint
- Anthropic Messages API: docs.anthropic.com
- OpenAI Chat Completions API: platform.openai.com
