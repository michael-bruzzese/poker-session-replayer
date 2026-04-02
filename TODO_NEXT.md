# Next Session — UI Polish & Visual Feedback

## Priority Fixes

### 1. Action Callouts — Make Bets/Actions Way More Obvious
- Big pop-up overlay when a player acts (BET 30, RAISE 150, FOLD, etc.)
- Should be visible to Zoom students at a glance
- Applies to both script playback AND coach branch-mode actions
- Consider a brief animated slide-in or scale-up effect
- Action stays visible for a beat before fading

### 2. Stack Sizes — More Prominent Display
- Stack numbers on seats need to be larger/bolder
- Consider showing stack change after each action (e.g., stack goes from 500 → 470 with a visible tick-down)

### 3. Pot Display — Fix Overlap with Board Cards
- Pot is currently hidden behind the board cards in the center of the felt
- Move pot display above the board or to a clearly separated position
- Make pot number larger and more prominent

### 4. Session Header / Game Description
- Add a header banner that shows session context
- User provides info like "Playing 2-5 at the Wynn - straddle is on most hands"
- Should be visible during coaching playback so students know the game context
- Support straddle as a blind structure option in the data model

### 5. Chip Graphics
- Simple chip stack visual near the pot that grows as the pot increases
- Small chip animation when a player bets/raises (chips slide from seat toward pot)
- Doesn't need to be fancy — basic colored circles/stacks that scale with pot size
- Visual feedback that money is moving

### 6. Card Images — Use RTP Drillz Card PNGs
- Current cards are plain text symbols — need the actual card images from RTP Drillz
- Card PNGs are embedded in the RTP Drillz build as base64 — extract and share
- Board cards should be ~30% larger than current for Zoom visibility

### 7. Upload / Input Flow — Text Paste Support
- Drag-and-drop JSON upload already works great
- Also support raw text cut-and-paste directly (user copies session notes from phone/doc)
- "Paste Session Notes" button already exists but needs to flow into parsing smoothly
- Consider: paste text → auto-detect if JSON or natural language → route accordingly

## Notes
- These are all visual/UX improvements — no engine changes needed
- Focus is on making the coaching experience clear for Zoom viewers
- Big, bold, obvious visual feedback for every action
