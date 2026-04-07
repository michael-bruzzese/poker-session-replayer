---
title: "feat: Phase 1 — Session Library + Hand Folders"
type: feat
status: draft
date: 2026-04-03
parent: docs/plans/2026-04-03-005-feat-comprehensive-feature-roadmap-plan.md
---

# Phase 1: Session Library + Hand Folders

## Overview

Transform the app from a single-session tool into a multi-session coaching platform. Coaches save sessions automatically, organize hands into themed folders, and never lose their work. This is the foundation that Phases 2-4 build on.

## Problem Frame

Today the app holds one session at a time. If the coach reloads the page, they rely on crash-recovery auto-save which stores exactly one session. There's no way to build a library of sessions, revisit old sessions, or organize hands across sessions for themed coaching lessons. A coach preparing for a call with a student who struggles with 3-bet pots has no way to pull together relevant hands from different sessions.

## Requirements

- SL1. Multiple sessions stored in localStorage with save/load/rename/delete
- SL2. Every loaded session auto-saves to library — no manual save step
- SL3. Sessions auto-expire after 90 days unless favorited
- SL4. Upload zone is primary on app open, saved sessions listed below
- SL5. Coach creates named folders and copies hand snapshots into them
- SL6. Folders playable as standalone coaching sessions
- SL7. Data format versioned with migration support
- SL8. Total localStorage usage under 5MB for 100+ sessions
- SL9. Individual session export as JSON file
- SL10. Favorite/pin sessions that never expire, sort to top
- SL11. Inline rename in session list
- SL12. Size display per session in list
- SL13. Smoke test: gold fixture upload → playback works (runs after every phase)

## Key Technical Decisions

- **Manifest + individual keys** — `session_manifest` holds lightweight index (id, name, date, hand count, size, favorited). Each session stored as `session_<id>`. Folders as `folder_manifest` + `folder_<id>`. Manifest loads on startup, full session data loads on demand.
- **Auto-save replaces crash recovery** — current `sessionReplayerLastSession` key replaced by the library. Every `loadSession()` call triggers a save to the library.
- **Deep copy for folders** — hands flagged to folders are deep-copied via `JSON.parse(JSON.stringify(hand))`. Folder is self-contained, edits don't affect original session.
- **Expiry on startup** — when app loads and reads the manifest, check `_lastAccessedAt` for each unfavorited session. If >90 days, delete the session data and remove from manifest.
- **Size estimation** — `JSON.stringify(session).length` gives byte count. Store in manifest. Sum all sizes for total usage display.

## Implementation Units

- [ ] **1.1: Session storage module**

  **Goal:** Pure JS module for session CRUD, versioning, migration, and manifest management. No DOM.

  **Requirements:** SL1, SL2, SL7, SL8

  **Files:**
  - Create: `shared/session_storage.js`
  - Test: `tests/session_storage.test.js`

  **Approach:**
  - Functions: `saveSession(session)`, `loadSession(id)`, `deleteSession(id)`, `listSessions()`, `renameSession(id, newName)`, `toggleFavorite(id)`, `getStorageUsage()`, `expireOldSessions(maxAgeDays)`
  - `saveSession` generates UUID if new, writes `session_<id>`, updates manifest with metadata
  - `loadSession` reads from localStorage, calls `migrateSession()` if `_storageVersion` is outdated
  - `migrateSession(data)` applies sequential migrations: v1→v2 adds `description` field, etc.
  - Manifest schema: `[{ id, name, date, handCount, sizeBytes, favorited, lastAccessedAt }]`
  - `expireOldSessions(90)` called on app startup — deletes unfavorited sessions older than 90 days

  **Test scenarios:**
  - Happy path: save session → loadSession returns identical data
  - Happy path: save 3 sessions → listSessions returns all 3 with correct metadata
  - Happy path: deleteSession → removed from storage and manifest
  - Happy path: renameSession → manifest updated, session data name updated
  - Happy path: toggleFavorite → favorited flag flips in manifest
  - Happy path: save v1 session, migrate to v2 → new fields added with defaults
  - Happy path: expireOldSessions with 100-day-old unfavorited session → deleted
  - Happy path: expireOldSessions with 100-day-old FAVORITED session → kept
  - Edge case: localStorage full → saveSession returns error with clear message
  - Edge case: corrupted manifest (invalid JSON) → rebuild from individual session keys
  - Edge case: session key exists but not in manifest → add to manifest on discovery
  - Edge case: manifest entry exists but session key missing → remove stale manifest entry
  - Integration: save → load → verify hands play back through engine correctly

  **Verification:**
  - All tests pass
  - 50+ sessions can be saved and listed without issue
  - Migrations run correctly for version upgrades

- [ ] **1.2: Folder storage**

  **Goal:** Create, populate, list, delete, and rename folders. Folders contain deep-copied hand snapshots.

  **Requirements:** SL5, SL6

  **Dependencies:** 1.1

  **Files:**
  - Modify: `shared/session_storage.js` (add folder functions)
  - Test: `tests/session_storage.test.js` (folder tests)

  **Approach:**
  - Functions: `createFolder(name)`, `deleteFolder(id)`, `renameFolder(id, name)`, `listFolders()`, `addHandToFolder(folderId, hand, sourceSessionName)`, `removeHandFromFolder(folderId, handIndex)`, `loadFolder(id)`
  - `addHandToFolder` deep-copies the hand, adds `_sourceSession` metadata
  - Folder data: `{ id, name, created, blinds, hands: [...] }` — same shape as a session so it's directly playable
  - Folder manifest: `[{ id, name, created, handCount }]`
  - Duplicate detection: check if hand with same `hand_id` from same source session already exists in folder

  **Test scenarios:**
  - Happy path: createFolder → listFolders includes it
  - Happy path: addHandToFolder → folder contains the hand
  - Happy path: loadFolder → returns playable session-shaped data
  - Happy path: add hands from 2 different sessions to same folder → both present
  - Happy path: edit hand in folder → original session hand unchanged (deep copy verified)
  - Happy path: deleteFolder → gone from storage and manifest
  - Edge case: add same hand twice to same folder → rejected (no duplicate)
  - Edge case: delete folder with 10 hands → all hand data removed

  **Verification:**
  - All tests pass
  - Folders are playable through the standard playback pipeline
  - Deep copy confirmed — changes don't propagate

- [ ] **1.3: Session list and folder UI**

  **Goal:** Upload zone primary, sessions and folders listed below. Inline rename, favorite toggle, size display, flag button in hand sidebar, export button.

  **Requirements:** SL2, SL3, SL4, SL9, SL10, SL11, SL12

  **Dependencies:** 1.1, 1.2

  **Files:**
  - Modify: `session_replayer_web.html` (upload screen, sidebar, hand list)
  - Modify: `build_embedded.py` (inline session_storage.js)

  **Approach:**
  - **Upload screen layout:**
    - Upload zone remains big and primary at top
    - Below: "Saved Sessions" section — list of sessions from manifest
    - Each entry: name (click to rename inline), date, hand count, size, star icon (favorite), load button, delete button, export button
    - Favorited sessions sort to top, then by most recently accessed
    - Below sessions: "Folders" section — list of folders
    - Each folder entry: name, hand count, load button, delete button
    - "Create Folder" button with inline name input
  - **During playback — sidebar hand list:**
    - Each hand entry gets a folder icon/flag button
    - Clicking it shows dropdown: list of existing folders + "New Folder" option
    - Selecting a folder copies the hand into it, shows brief confirmation
  - **Auto-save integration:**
    - `loadSession()` now calls `SessionStorage.saveSession()` after loading
    - Update `_lastAccessedAt` on every load
    - On app startup, call `expireOldSessions(90)` before rendering the list
  - **Export:** button generates a downloadable JSON file for the individual session

  **Test scenarios:**
  - Test expectation: none — UI rendering; verified via Playwright in 1.4

  **Verification:**
  - Upload zone is visually dominant
  - Sessions listed below with all metadata
  - Inline rename works
  - Favorite toggle works, favorited sessions sort to top
  - Flag button in sidebar copies hand to folder
  - Export downloads valid JSON
  - Expired sessions don't appear in list

- [ ] **1.4: Browser tests + smoke test**

  **Goal:** Playwright E2E tests for the session library. Plus a smoke test that verifies gold fixture upload → full playback works — this smoke test runs after every future phase.

  **Requirements:** SL13

  **Dependencies:** 1.1-1.3

  **Files:**
  - Create: `tests/browser/session_library.spec.js`
  - Create: `tests/browser/smoke.spec.js`
  - Modify: `package.json` (add `test:browser` script)

  **Approach:**
  - **Smoke test** (runs after every phase): open app → upload gold_session.json → session loads → click through all 5 hands → no crashes → verify pot and stacks display
  - **Session library tests:**
    - Upload JSON → session auto-saved → reload page → session in list → click to load → plays back
    - Rename session inline → name updates in list
    - Favorite session → reload → still at top of list
    - Delete session → gone from list and localStorage
    - Create folder → flag hand from playback → folder shows in list → load folder → hand plays back
    - Export session → valid JSON downloaded
  - Both test suites run against the BUILT `index.html` to catch build divergence
  - `npm run test:browser` command (separate from `npm test` which stays fast for unit tests)

  **Test scenarios:**
  - As described above — each is a Playwright test case

  **Verification:**
  - All browser tests pass against built index.html
  - Smoke test passes
  - Unit tests (211+) still pass
  - `npm test` stays fast (<1 second), `npm run test:browser` runs separately

## System-Wide Impact

- **localStorage schema:** New keys: `session_manifest`, `session_<id>` (per session), `folder_manifest`, `folder_<id>` (per folder). Old `sessionReplayerLastSession` key migrated to new format on first startup.
- **Build system:** `shared/session_storage.js` added to inline list in `build_embedded.py`.
- **Existing playback:** Completely unchanged. `loadSession()` gains a save-to-library side effect but the session data flowing into the engine is identical.
- **Crash recovery:** Old auto-save mechanism replaced by always-on library save. On startup, the most recently accessed session is loadable from the list — same effect as crash recovery but cleaner.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| localStorage 5MB limit | Size tracking in manifest, expiry of old sessions, warn at 4MB |
| Manifest corruption | Rebuild from individual session keys (scan localStorage for session_ prefixed keys) |
| Migration breaks old sessions | Sequential migration with version checks, tested for each version transition |
| Browser tests flaky | Run against static built file, no network dependencies |
| Auto-save performance | Only save on session load and hand navigation, not on every render tick |
