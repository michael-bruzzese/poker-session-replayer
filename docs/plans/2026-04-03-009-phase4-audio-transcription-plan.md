---
title: "feat: Phase 4 — Audio Transcription"
type: feat
status: draft
date: 2026-04-03
parent: docs/plans/2026-04-03-005-feat-comprehensive-feature-roadmap-plan.md
---

# Phase 4: Audio Transcription

## Overview

Coach drops an audio file (m4a, mp3, wav from Voice Memos or any recorder), app transcribes it via Whisper API, auto-parses the transcription with AI, and loads the session. One-click from audio to coaching. Builds on Phase 2's AI parsing infrastructure.

## Problem Frame

The coach records voice notes during or after a poker session. Today they have to: (1) transcribe the audio externally (Otter.ai, Voice Memos transcription, etc.), (2) copy the text, (3) paste/upload into the app, (4) parse. Steps 1-3 are friction. If the app accepts audio directly, the coach drops one file and coaches.

## Requirements

- AT1. Accept raw audio files (m4a, mp3, wav, webm) via the same upload zone
- AT2. Transcribe via Whisper API (OpenAI)
- AT3. Auto-parse transcription immediately after completion — no manual step
- AT4. Coach can review/edit transcription and re-parse if needed
- AT5. Graceful message when audio uploaded but no OpenAI key configured
- AT6. File size check before upload — warn if >25MB (Whisper API limit)
- AT7. Progress estimate shown during transcription based on file size
- AT8. Whisper poker jargon prompt for better transcription accuracy
- AT9. Multiple API keys supported — transcription uses OpenAI key, parsing uses whichever provider coach configured
- AT10. Architecture extensible for future transcription providers (don't hard-wire Whisper-only)

## Key Technical Decisions

- **Whisper API for transcription** — OpenAI's Whisper is the standard. Costs ~$0.006/min. A 20-hand session (~10 min of audio) costs $0.06. Negligible.
- **Poker jargon prompt** — Whisper API accepts an optional `prompt` parameter for domain vocabulary. We send: "Poker session recording. Terms: UTG, UTG+1, UTG+2, lojack, hijack, cutoff, button, small blind, big blind, three-bet, check-raise, all-in, straddle, pocket aces, ace king suited, flop, turn, river, pot, fold, raise, call, bet." This dramatically improves accuracy for poker-specific words.
- **Two-step display, auto-triggered** — Transcription appears in the parse text area AND auto-parsing starts immediately. The coach sees the text filling in AND the parse results loading. If the transcription was wrong, they edit and re-parse.
- **OpenAI key required** — Anthropic doesn't offer transcription. If coach only has Anthropic key, audio shows: "Audio transcription requires an OpenAI API key. Add one to enable audio uploads." This uses the multi-key storage from Phase 2.

## Implementation Units

- [ ] **4.1: Audio transcription adapter**

  **Goal:** Accept audio blob, send to Whisper API, return text. Extensible for future providers.

  **Requirements:** AT2, AT8, AT10

  **Dependencies:** Phase 2, Unit 2.1 (LLM adapter infrastructure)

  **Files:**
  - Modify: `shared/llm_adapter.js` (add transcribeAudio function)
  - Test: `tests/llm_adapter.test.js` (transcription tests)

  **Approach:**
  - `transcribeAudio({ apiKey, audioBlob, language, pokerPrompt })` → `{ success, text, error, durationSeconds }`
  - Sends multipart/form-data to `https://api.openai.com/v1/audio/transcriptions`
  - Fields: `file` (audio blob), `model` ("whisper-1"), `language` ("en"), `prompt` (poker jargon)
  - Poker prompt: pre-built string with common poker terms, stored as a constant
  - Returns raw transcription text
  - `estimateTranscriptionTime(fileSizeBytes)` → estimated seconds (rough: ~1 second per 100KB of audio)
  - Provider abstraction: `transcribeAudio` takes an optional `provider` param, defaults to "openai-whisper". Future providers plug in here.

  **Test scenarios:**
  - Happy path: mock fetch, call with audio blob → correct multipart form data built
  - Happy path: mock response → returns transcribed text
  - Error path: no API key → returns `{ success: false, error: "Audio transcription requires an OpenAI API key" }`
  - Error path: API returns 413 (file too large) → clear error message
  - Error path: API returns 400 (bad format) → "Unsupported audio format" error
  - Error path: network failure → "Network error" message
  - Edge case: estimateTranscriptionTime for 5MB file → reasonable estimate

  **Verification:**
  - Correct multipart request format for Whisper API
  - Poker prompt included in request
  - Error handling covers all failure modes
  - All tests pass

- [ ] **4.2: Audio upload flow in UI**

  **Goal:** Coach drops audio file → transcription → auto-parse → session loaded. Review and re-parse if needed.

  **Requirements:** AT1, AT3, AT4, AT5, AT6, AT7, AT9

  **Dependencies:** 4.1, Phase 2 Unit 2.4 (AI parsing pipeline)

  **Files:**
  - Modify: `session_replayer_web.html` (handleFile audio detection, transcription UI, progress display)

  **Approach:**
  - **Audio detection:** in `handleFile`, check `file.type.startsWith("audio/")` or extension `.m4a`, `.mp3`, `.wav`, `.webm`
  - **File size check:** if file >25MB, show: "Audio file is too large for transcription (max 25MB). Try trimming the recording or splitting into shorter clips."
  - **No OpenAI key:** if no OpenAI key in stored keys, show: "Audio transcription requires an OpenAI API key. Add one in the AI Parsing setup above." Don't crash, don't attempt.
  - **Happy path flow:**
    1. Coach drops audio file
    2. App shows: "Transcribing audio... (~15 seconds for a 5-minute recording)" with spinner
    3. Transcription completes → text appears in the parse text area (editable)
    4. Simultaneously: auto-parse triggers using the AI parsing pipeline (Phase 2)
    5. Parse completes → session loads via the normal clean/problem split flow
    6. If coach spots transcription errors: edit the text, click "Re-parse"
  - **Progress:** show estimated time based on file size. No real-time progress from Whisper API (it doesn't stream).
  - **The parse text area serves dual purpose:** shows the transcription AND is where the coach edits if needed. "Re-parse" button re-triggers the AI parsing pipeline on the edited text.

  **Test scenarios:**
  - Test expectation: none — UI flow; verified via Playwright

  **Verification:**
  - Audio file detected by MIME type and extension
  - File size warning for >25MB
  - No-key message when OpenAI key missing
  - Transcription appears in editable text area
  - Auto-parse triggers after transcription
  - Coach can edit and re-parse
  - Full flow: audio → transcription → parse → QA → playback
  - Non-audio files still work unchanged

- [ ] **4.3: Browser tests for audio flow**

  **Goal:** Playwright tests verifying the audio upload flow works end-to-end in the built app.

  **Requirements:** AT1-AT9 (integration coverage)

  **Dependencies:** 4.1, 4.2

  **Files:**
  - Create: `tests/browser/audio.spec.js`

  **Approach:**
  - Test with a mock Whisper API (intercept fetch calls to OpenAI, return canned transcription)
  - Test: drop audio file → transcription appears → parse triggers → session loads
  - Test: no OpenAI key → helpful message shown
  - Test: file >25MB → size warning shown
  - Smoke test still passes after this phase

  **Test scenarios:**
  - Happy path: mock Whisper → transcription → auto-parse → session loaded
  - Error path: no OpenAI key → message displayed, no crash
  - Error path: oversized file → warning displayed
  - Regression: smoke test passes, all unit tests pass

  **Verification:**
  - Playwright tests pass against built index.html
  - All existing tests (211+ unit + browser) still pass
  - Smoke test passes

## System-Wide Impact

- **Upload zone:** Audio files now accepted alongside text/JSON/docx. Same drop zone, same UI, different processing path.
- **LLM adapter:** Extended with transcription capability. Existing LLM call functions unchanged.
- **Parse pipeline:** Transcription feeds into the same AI parsing pipeline from Phase 2. No new parsing logic.
- **Key management:** Audio requires OpenAI key specifically. Multi-key storage from Phase 2 handles this.
- **Build system:** No new files to inline — just modifications to llm_adapter.js which is already inlined.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Whisper transcription inaccurate for poker terms | Poker jargon prompt, plus coach can edit before re-parsing |
| Audio files too large for Whisper API | File size check before upload, clear message |
| Coach only has Anthropic key, no OpenAI | Clear message explaining audio needs OpenAI key, link to sign up |
| Transcription takes too long | Progress estimate sets expectations; most session recordings are <10 min |
| Auto-parse starts on bad transcription | Coach sees the text and can cancel/edit/re-parse |
| Future Whisper API changes | Adapter layer isolates API specifics |
