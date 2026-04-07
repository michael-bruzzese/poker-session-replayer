---
title: "fix: Resolve visual overlaps — pot below board cards, clean felt layout"
type: fix
status: active
date: 2026-04-03
---

# Fix Visual Overlaps — Pot Below Board Cards

## Overview

The pot display currently sits at `top: 25%` which overlaps with the board cards at `top: 40%`. The pot needs to move **below** the board cards, sitting in the center of the table between the board and the bottom seats. Several other visual elements also need position tuning to prevent overlaps at Zoom resolution.

## Problem Frame

During coaching over Zoom screen-share, overlapping elements make it hard to read both the pot and the board cards simultaneously. The pot, side pots, chip rake animation target, and game banner all need to occupy distinct vertical bands on the felt without collision.

## Requirements Trace

- R1. Pot display must sit below the board cards, clearly separated, in the center of the table
- R2. Side pots must sit below the main pot, also with clear separation
- R3. Chip rake animation must target the pot's actual position
- R4. No visual element should overlap another at 1280x720 (Zoom baseline resolution)
- R5. Game banner must not collide with pot or board

## Scope Boundaries

- Only CSS positioning and the rake animation target coordinate
- No engine changes
- No new features

## Current Layout (top to bottom of felt)

```
top: -3%    — top-center seats (5, 6)
top: 12%    — corner seats (4, 7)
top: 25%    — POT ← PROBLEM: overlaps board
top: 40%    — BOARD CARDS (centered via translate -50%,-50%)
top: 50%    — street/coaching banners, mid seats (3, 8)
top: 62%    — side pots
top: 88%    — bottom-left/right seats (2, 9)
top: 102%   — bottom-center seat (1/Hero)
```

Board cards are 135px tall, centered at 40%. So their actual range is roughly 27%–53% of felt height. The pot at 25% sits right on the board's top edge.

## Target Layout

```
top: -3%    — top-center seats
top: 12%    — corner seats
top: 35%    — BOARD CARDS (moved up slightly from 40% to make room below)
top: 55%    — POT (below board, clear gap)
top: 65%    — side pots (below pot)
top: 50%    — street/coaching banners (centered, z-index above all)
top: 88%    — bottom seats
top: 102%   — hero seat
```

Key changes:
- Board cards: `40%` → `35%` (slight move up to create room)
- Pot: `25%` → `55%` (moved below board)
- Side pots: `62%` → `65%` (nudged down to not overlap pot)
- Rake animation target: `0.25` → `0.55` (match new pot position)

## Implementation Units

- [ ] **Unit 1: Reposition pot below board cards**

  **Goal:** Move pot display from above board to below, with clear visual separation.

  **Requirements:** R1, R4

  **Files:**
  - Modify: `session_replayer_web.html` (CSS for `.pot-display`, `.board-cards`)

  **Approach:**
  - Move `.board-cards` from `top: 40%` to `top: 35%`
  - Move `.pot-display` from `top: 25%` to `top: 55%`
  - Verify pot label, amount, and chip graphic all render cleanly at new position
  - Test with 4-5 digit pot numbers to ensure no overflow

  **Verification:**
  - Board cards and pot are clearly separated with no overlap
  - Pot is visually centered in the lower-middle area of the felt

- [ ] **Unit 2: Reposition side pots and fix rake target**

  **Goal:** Move side pots below main pot, update chip animation target.

  **Requirements:** R2, R3

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `session_replayer_web.html` (CSS for `.side-pots`, JS for `rakeChipsToPot()`)

  **Approach:**
  - Move `.side-pots` from `top: 62%` to `top: 65%`
  - Update `rakeChipsToPot()` target from `feltRect.height * 0.25` to `feltRect.height * 0.55`
  - Verify chip animation lands at the pot, not the old position

  **Verification:**
  - Side pots don't overlap main pot
  - Chip rake animation targets the correct position

- [ ] **Unit 3: Verify no remaining overlaps at 720p**

  **Goal:** Final check that all felt elements (banner, seats, pot, board, side pots) have clear separation.

  **Requirements:** R4, R5

  **Dependencies:** Unit 1, Unit 2

  **Files:**
  - Modify: `session_replayer_web.html` (any remaining CSS tweaks)

  **Approach:**
  - Game banner sits at top of felt area (above the table, in the center-area header) — should not collide with board at 35%
  - Street banner and coaching banner are at `top: 50%` with z-index 25/30 — they're transient overlays, not persistent, so overlap is acceptable
  - Action popup is positioned dynamically with felt-bound clamping — verify it doesn't collide with the new pot position
  - Adjust any element that still overlaps

  **Verification:**
  - Load a multi-street hand and step through all actions
  - Pot, board, side pots, and seat elements all clearly separated
  - No persistent overlaps at 1280x720

## Risks

| Risk | Mitigation |
|------|------------|
| New pot position too close to bottom seats | 55% gives ~33% gap to bottom seats at 88% |
| Board at 35% too close to top seats at 12% | 135px board centered at 35% puts top edge at ~25%, 13% gap to seats |
| Side pots at 65% overlap with bottom-left/right seats at 88% | 23% gap is plenty |
