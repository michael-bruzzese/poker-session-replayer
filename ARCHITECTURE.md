# Session Replayer — Architecture Document

## 1. Product Overview

Session Replayer is a standalone poker coaching playback tool. A player imports their entire live session (up to ~200 hands) from natural language notes (typically voice-transcribed), and a coach replays hands step-by-step on a Zoom call with students, with the ability to branch off-script and explore "what if" scenarios at any decision point.

### Core Workflow
1. Player records voice notes during a live 9-handed poker session
2. Player uploads transcription (txt/docx) into Session Replayer
3. Claude API parses natural language into structured hand data
4. System flags ambiguities and asks specific guided questions to resolve gaps
5. Player reviews hand-by-hand, fixes remaining errors, confirms session
6. Coach loads confirmed session, screen-shares on Zoom
7. Coach clicks through hands step-by-step (each action is a click, like a slideshow)
8. At any point coach can branch off-script — controls all seats with big, clear, Zoom-visible action input
9. Coach can "rewind to script," replay differently, or jump to next hand
10. Player names and descriptions persist across hands

---

## 2. Code Structure — Shared Engine with RTP Drillz

### File Organization

```
rtp-drillz-shareable/
  shared/
    table_engine.js          # Extracted core engine (pure logic, no DOM)
    card_utils.js            # Card formatting, deck building, image resolution
    constants.js             # Shared constants (ranks, suits, position arrays)
  rtp_drillz_web.html        # RTP Drillz app (imports shared engine inline at build)
  session_replayer_web.html   # Session Replayer app (imports shared engine inline at build)
  build_embedded.py           # Unified build script (embeds cards + inlines shared JS)
  build_embedded_rtp_drillz.py  # Legacy alias
```

### Extraction Boundary

**Shared engine (pure logic, no DOM):**
- `createPlayerState(seat, stackChips)`
- `seatAtOffset(startSeat, offset, seatCount)`
- `computePositionsFromButton(buttonSeat, positionArray, seatCount)`
- `getLegalActions(seat, players, tableState)`
- `applyPlayerAction(seat, action, sizeChips, players, tableState)`
- `applyCommittedChips(player, targetStreetCommit)`
- `recomputePotAndToCall(players, tableState)`
- `recomputeMinRaiseTo(tableState, bigBlindChips)`
- `resetPendingActionSeatsFrom(startSeat, excludedSeats, players, seatCount)`
- `sanitizePendingActionSeats(players, tableState)`
- `isBettingRoundComplete(tableState)`
- `isHandWonByFold(players)`
- `captureStreetSnapshot(street, boardBase, players, tableState)`
- `restoreStreetSnapshot(street, tableState)`
- `buildFullDeck()`, `shuffle(array)`
- Card utilities: `formatCard`, `cardPrettyName`, etc.

Functions are refactored from closure-over-globals to parameter-passing style. Exposed via `window.PokerEngine` namespace.

**Kept per-app (not shared):**
- All DOM rendering, event binding, CSS
- Range/profile engine (RTP Drillz only)
- Parser pipeline, playback engine, hand list UI (Session Replayer only)
- Recording/capture (RTP Drillz only)

### Build Strategy

The build script reads the target app's template HTML, inlines shared JS files at a `<!-- SHARED_ENGINE -->` marker, embeds base64 card images, and outputs a single deployable HTML file. Same single-file deployment as current RTP Drillz.

---

## 3. 9-Handed Upgrade

| Aspect | Current (6-max) | Target (9-max) |
|--------|-----------------|-----------------|
| `SEAT_COUNT` | 6 | 9 |
| Position array | `BTN,SB,BB,UTG,HJ,CO` | `BTN,SB,BB,UTG,UTG+1,UTG+2,LJ,HJ,CO` |
| Visual layout | 6 CSS positions | 9 CSS positions around oval |
| Stack editor | 6 inputs | 9 inputs |
| Villain card slots | 5 | 8 |

### Approach: Configurable Seat Count

The shared engine accepts `seatCount` as a parameter. Session Replayer passes 9, RTP Drillz can stay 6 initially and upgrade later. `seatAtOffset()` already uses modular arithmetic — just needs the parameter.

### 9-Seat Visual Layout

```
         top-left-center (35%, 10%)   top-center (51%, 6%)   top-right-center (67%, 10%)
top-left (14%, 25%)                                                      top-right (88%, 25%)
mid-left (8%, 55%)                                                        mid-right (94%, 55%)
               bottom-left (30%, 85%)  bottom-center (51%, 88%)
```

Hero (seat 0) at bottom-center. Coordinates will need visual tuning.

---

## 4. Data Model

### Session Schema

```json
{
  "version": 2,
  "app": "session-replayer",
  "session_name": "Tuesday $2/5 at Bellagio",
  "created_at": "2026-04-01T18:30:00Z",
  "parse_source": "voice_notes_tuesday.txt",
  "blinds": { "small": 2, "big": 5, "ante": 0, "straddle": 0 },
  "players": {
    "1": { "name": "Hero", "description": "Us", "is_hero": true },
    "3": { "name": "Mike", "description": "Tight reg, 40s, hoodie" },
    "7": { "name": "Old guy SB", "description": "Passive, limp-calls a lot" }
  },
  "hand_count": 47,
  "hands": [],
  "flags": {
    "has_unresolved_ambiguities": false,
    "confirmed_by_user": true
  }
}
```

### Hand Record Schema

```json
{
  "hand_id": 14,
  "hand_label": "Hand 14",
  "status": "confirmed",
  "hero_seat": 3,
  "button_seat": 8,
  "blinds": { "small": 2, "big": 5 },
  "stacks": {
    "1": 500, "2": 1200, "3": 800, "4": 500,
    "5": 500, "6": 650, "7": 300, "8": 500, "9": 1000
  },
  "hero_cards": ["Ah", "Kd"],
  "known_villain_cards": { "7": ["9s", "9h"] },
  "board": {
    "flop": ["Qs", "Jd", "4c"],
    "turn": "Th",
    "river": "2s"
  },
  "action_sequence": [
    {
      "street": "preflop",
      "actions": [
        { "seat": 1, "position": "UTG", "action": "fold" },
        { "seat": 2, "position": "UTG+1", "action": "raise", "amount": 15 },
        { "seat": 3, "position": "UTG+2", "action": "call", "amount": 15 }
      ]
    },
    {
      "street": "flop",
      "actions": [
        { "seat": 9, "position": "BB", "action": "check" },
        { "seat": 2, "position": "UTG+1", "action": "bet", "amount": 25 }
      ]
    }
  ],
  "result": {
    "winner_seat": 3,
    "pot": 395,
    "showdown": false,
    "notes": "Hero takes it with river bet"
  },
  "warnings": [],
  "coach_flags": { "starred": false, "tag": "" },
  "parse_confidence": 0.92
}
```

All `amount` values = total street commitment (matching the engine's `committedStreet` model).

### Playback State (Runtime)

```
PlaybackState {
  mode: "script" | "branch"
  currentHandIndex: number
  currentStepIndex: number
  totalSteps: number
  branchPoint: {
    handIndex, stepIndex,
    snapshotPlayers, snapshotTableState, snapshotBoard
  } | null
  engineState: { players, tableState, board, hand }
}
```

---

## 5. Parser Pipeline

```
[Upload File] → [Read Text] → [Claude API Parse] → [Structured JSON]
                                      |
                                      v
                             [Ambiguity Detection]
                                      |
                                      v
                             [Guided Q&A UI] ←→ [Claude API Resolve]
                                      |
                                      v
                             [Hand-by-Hand Review UI]
                                      |
                                      v
                             [Confirmed Session]
```

### File Upload
- `.txt`: read as UTF-8
- `.docx`: unzip, read `word/document.xml`, strip XML tags (~50 lines of JS)
- Raw text preview before parsing

### Claude API Parse
- User provides their own API key (stored in localStorage)
- Browser `fetch()` directly to `https://api.anthropic.com/v1/messages`
- System prompt: detailed poker parsing specification with JSON schema
- For long sessions (>80K chars): chunk at hand boundaries, multiple API calls, merge
- Each hand gets a `warnings[]` array for ambiguities

### Guided Q&A
Each ambiguity generates a structured question:
```json
{
  "hand_id": 14,
  "field": "board.turn",
  "severity": "blocking",
  "question": "Hand 14: You mentioned a bet on the turn but I don't have a turn card. What was it?",
  "input_type": "card",
  "context": "Flop was Qs Jd 4c."
}
```
Input types: `card`, `cards`, `amount`, `action`, `text`, `confirm`.
Complex answers get re-parsed via a follow-up Claude API call.

### Secondary Input: Shorthand Notation
For manual hand entry/editing (no API call):
```
Hero: AhKd  BTN  Stacks: 500
Flop: Qs Jd 4c  Turn: Th  River: 2s
Pre: UTG r15, UTG+1 c, folds, BB c
Flop: BB x, UTG+1 b25, Hero c, BB f
```
Parsed locally with JS pattern matching.

---

## 6. Playback Engine

### Script Mode (Recorded Playback)

**Hand initialization:**
1. Set up 9 seats from `button_seat`
2. Load stacks, post blinds
3. Set hero cards (hidden villain cards)
4. `currentStepIndex = 0`

**Each "Next Step" click:**
1. Read next action from `action_sequence`
2. `applyPlayerAction()` via shared engine
3. Reveal board cards at street transitions
4. Update visual: callout, stacks, pot, highlight acting seat
5. Increment step index

**"Previous Step" (rewind):**
Restore the appropriate street snapshot, replay forward to `targetStep - 1`. Street snapshots are captured automatically at each street boundary during forward play.

### Branch Mode (Off-Script)

**Entering branch mode:**
1. Coach takes any non-script action (or presses "Go Off-Script")
2. System saves full `branchPoint` snapshot
3. Mode switches to `"branch"`
4. Coach controls ALL seats — big action buttons, clear seat indicator

**Acting seat flow in branch:**
- Prominent display: "Acting: Seat 5 (UTG+2) — Mike"
- Large buttons: FOLD, CHECK, CALL [amount], BET, RAISE, ALL-IN
- Size input: big number field + slider for bet/raise amounts
- After each input, auto-advance to next active player
- Coach can click any seat to force-select it

**"Back to Script":**
Restore `branchPoint` snapshot → resume script mode from saved step index.

**"Next Hand":**
Jump to next hand, reset to script mode. No cleanup needed.

### The Mental Model

```
Hand 17 as recorded:
  Pre: Hero opens CO to 15, BTN 3-bets to 45, Hero calls
  Flop Qs 9h 2d: Hero x, BTN bets 60, Hero calls
  Turn 7c: Hero x, BTN bets 150, Hero calls
  River 3h: x/x, BTN shows 99

Coach clicking through. Gets to the turn. "Stop — what should hero do here?"
  → Coach clicks "Go Off-Script" or just inputs a check-raise
  → Branch mode activates, coach controls all seats
  → They play it out

"Now let's see what actually happened"
  → "Back to Script" snaps to the turn as-recorded
  → Continue clicking through the script

"Okay next hand"
  → Hand 18, script mode, clean slate
```

---

## 7. UI Layout

### Screen 1: Upload & Parse
- File upload / paste text area
- Raw text preview
- Session metadata (blinds, hero seat)
- "Parse with Claude" button
- Parse progress/status

### Screen 2: Guided Q&A
- One question at a time with context
- Appropriate input widget per question type
- Submit / Skip controls
- Progress: "3 remaining"

### Screen 3: Review & Confirm
- Left panel: scrollable hand list with one-line summaries, warning badges
- Right panel: expanded hand detail — cards, actions, editable fields
- Per-hand confirm, batch "Confirm All"
- Export session JSON, Add Hand manually

### Screen 4: Coaching Playback (Main View)
- Left sidebar (collapsible): hand list, star/flag, player info panel
- Center (70%+ width): 9-handed table with seats, board, pot
- Bottom: action controls (large, Zoom-visible)
- Status bar: hand X/Y, step X/Y, current street, pot, script/branch indicator
- Navigation: Prev Step, Next Step, Back to Script, Next Hand

### Zoom-Friendly Design Principles
- Action buttons minimum 48px tall, 18px+ font
- Pot and stack numbers large, high-contrast
- Player names visible on seat chips
- Bright border on acting seat
- Visual mode indicator (Script = normal, Branch = highlighted banner)
- Design for 1280px+ width (coach on desktop)

---

## 8. Phased Build Plan

### Phase 0: Shared Engine Extraction
Extract pure game-logic from `rtp_drillz_web.html` into `shared/` files. Refactor to accept `seatCount` as parameter. Update build script. Verify all 22 Playwright tests pass.

**Dependencies:** None.

### Phase 1: 9-Handed Table Rendering
Create `session_replayer_web.html`. 9-seat CSS layout. Seat rendering with names/descriptions. Board, pot, card images. Manual action buttons for all seats. Wire up shared engine.

**Dependencies:** Phase 0.

### Phase 2: Session Data Model & Script Playback
Session JSON import. Hand list sidebar. Step-by-step script playback with Next/Prev. Street snapshots. Hand navigation. Player labels from session data. Star/flag hands.

**Dependencies:** Phase 1.

### Phase 3: Branch Mode
Branch-point snapshots. All-seat action input with big controls. Auto-advance acting seat. "Back to Script" restore. Visual mode indicator. Click-to-select-seat.

**Dependencies:** Phase 2.

### Phase 4: LLM Parse Pipeline
Upload screen. API key management. Claude API system prompt for poker parsing. Fetch call, response parsing, schema validation. Chunking for long sessions. Docx extraction.

**Dependencies:** Phase 2 (needs schema).

### Phase 5: Guided Q&A
Ambiguity scanner. Structured question generation. Input widgets per type. Answer application. Secondary API call for complex clarifications. Skip flow.

**Dependencies:** Phase 4.

### Phase 6: Review UI
Hand-by-hand review screen. Inline editing for all fields. Card pickers. Action sequence editor. Per-hand and batch confirmation. Session export. Shorthand notation parser. Manual hand entry.

**Dependencies:** Phase 5.

### Phase 7: Polish & Deploy
Unified build script for both apps. GitHub Pages deployment. Responsive layout. localStorage auto-save. Keyboard shortcuts. Stack persistence hand-to-hand. Playwright tests. Documentation.

**Dependencies:** All prior phases.

### Dependency Graph

```
Phase 0 (Extract Engine)
  │
  v
Phase 1 (9-Handed Table)
  │
  v
Phase 2 (Data Model + Playback)
  │
  ├──→ Phase 3 (Branch Mode)     ← can parallel
  │
  └──→ Phase 4 (LLM Parse)       ← can parallel
          │
          v
        Phase 5 (Guided Q&A)
          │
          v
        Phase 6 (Review UI)

All ──→ Phase 7 (Polish + Deploy)
```

Phases 3 and 4 can proceed in parallel after Phase 2.

---

## 9. Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Engine extraction breaks RTP Drillz | 22 Playwright tests as regression gate |
| Claude API parsing quality too low | Iterate system prompt with real transcriptions; Q&A system is the safety net |
| CORS / API key security | Anthropic API supports browser CORS; key in localStorage only, sent only to api.anthropic.com |
| Performance with 200 hands | ~500KB total JSON, trivially handled in memory |
| 9-seat layout cramped on small screens | Design for 1280px+; sidebar collapses on smaller viewports |
