---
title: "feat: Phase 2 — AI Parsing (Multi-Provider)"
type: feat
status: draft
date: 2026-04-03
parent: docs/plans/2026-04-03-005-feat-comprehensive-feature-roadmap-plan.md
---

# Phase 2: AI Parsing (Multi-Provider)

## Overview

Coach drops a file, app parses it with AI, session loads. No CLI, no manual formatting, no friction. Supports any LLM provider the coach has a key for. ShorthandLearner remains as the free fallback.

## Problem Frame

Today the coach must either (a) run a Python CLI script with their own API key to parse session notes, or (b) rely on the ShorthandLearner which produces garbage for natural language input. The coach's workflow should be: open app → drop file → coaching. AI parsing bridges the gap between messy human notes and structured session data.

## Requirements

- AP1. "Upload & Parse with AI" is the primary, obvious action on the upload screen
- AP2. "Upload manually" is the secondary path for coaches without API keys
- AP3. AI parsing on by default when key is configured
- AP4. Auto-detect provider from API key format (sk-ant- = Anthropic, sk- = OpenAI)
- AP5. If key format is unrecognized, ask provider once — never again
- AP6. Key saved to localStorage, entered via inline prompt on upload screen
- AP7. Support multiple keys (one per provider) for future audio transcription
- AP8. Key validation on entry — small test call to verify it works
- AP9. ShorthandLearner as automatic fallback when AI parse fails
- AP10. Explicit fallback chain: AI parse → ShorthandLearner → manual parse screen
- AP11. Parse confidence indicator so coach knows quality of parse
- AP12. Cost estimate shown before AI parse — honest, no provider favoritism
- AP13. Clean hands auto-confirmed, problem hands shown separately for review
- AP14. Chunking for sessions over 30K characters
- AP15. Parsing prompt maintained in sync between Python CLI and browser
- AP16. Coach can set default blinds, hero seat, table size
- AP17. Retry on partial failure — keep good hands, flag bad ones

## Key Technical Decisions

- **Provider auto-detection** — `sk-ant-api03-` prefix = Anthropic. `sk-` prefix = OpenAI. Anything else = ask once, store the answer. No dropdown cluttering the UI.
- **Multiple key storage** — `localStorage.llmKeys` stores `{ anthropic: { key, model }, openai: { key, model }, custom: { key, model, endpoint } }`. Each provider's key is independent.
- **CORS reality** — Anthropic requires `anthropic-dangerous-direct-browser-access: true` header. OpenAI works directly. Custom endpoints vary. If CORS fails, the error message must explain why clearly and suggest alternatives (different provider, paste text manually).
- **Chunking** — sessions over 30K chars split at hand boundaries (look for "Hand N" markers). Each chunk parsed as a separate API call. Results merged. Coach sees one progress bar.
- **Clean/problem split** — after AI parse, run the validator. Hands with 0 errors go to "confirmed" status. Hands with errors go to QA review. Coach only sees the problems.
- **Cost estimation** — count input characters, estimate tokens (÷4 for English), multiply by provider's per-token rate. Show before the API call: "Estimated cost: ~$0.08". Don't lie, don't round favorably for any provider.

## Implementation Units

- [ ] **2.1: LLM provider adapter module**

  **Goal:** Provider-agnostic interface for making LLM API calls. Handles request formatting, auth, CORS, and errors per provider.

  **Requirements:** AP4, AP5, AP7

  **Files:**
  - Create: `shared/llm_adapter.js`
  - Test: `tests/llm_adapter.test.js`

  **Approach:**
  - `detectProvider(apiKey)` → "anthropic" | "openai" | "unknown"
  - `callLLM({ provider, apiKey, endpoint, model, systemPrompt, userMessage, maxTokens })` → `{ success, text, error, tokensUsed, cost }`
  - `estimateCost({ provider, inputChars, maxOutputTokens })` → `{ estimatedTokens, estimatedCost, pricePerToken }`
  - `validateKey({ provider, apiKey, endpoint })` → `{ valid, error, model }` — makes a minimal API call to verify
  - Per-provider request builders:
    - Anthropic: Messages API, `anthropic-dangerous-direct-browser-access` header, default model claude-sonnet-4-5-20250514
    - OpenAI: Chat Completions API, default model gpt-4o
    - Custom: OpenAI-compatible format with user-provided endpoint
  - Error handling: parse HTTP status, return human-readable messages:
    - 401 → "Invalid API key. Check that you copied the full key."
    - 403 → "API key doesn't have permission for this model."
    - 429 → "Rate limited. Wait a moment and try again."
    - CORS error → "This provider blocks browser requests. Try a different provider or paste your notes manually."
    - Network error → "Network error. Check your internet connection."

  **Test scenarios:**
  - Happy path: detectProvider("sk-ant-api03-xxx") → "anthropic"
  - Happy path: detectProvider("sk-xxx") → "openai"
  - Happy path: detectProvider("custom-xxx") → "unknown"
  - Happy path: mock fetch, callLLM with anthropic → correct headers, body format
  - Happy path: mock fetch, callLLM with openai → correct headers, body format
  - Happy path: estimateCost for 10K chars → reasonable estimate
  - Error path: 401 response → clear "Invalid API key" error
  - Error path: CORS blocked → clear "browser requests blocked" error
  - Error path: network failure → clear "check internet" error
  - Edge case: empty API key → immediate error, no API call made

  **Verification:**
  - All tests pass
  - Each provider's request format matches their API docs
  - Error messages are human-readable for every failure mode

- [ ] **2.2: API key management UI**

  **Goal:** Inline key setup on the upload screen. Two clear upload paths: AI-powered (primary) and manual (secondary).

  **Requirements:** AP1, AP2, AP3, AP6, AP7, AP8

  **Dependencies:** 2.1

  **Files:**
  - Modify: `session_replayer_web.html` (upload screen layout, key storage)

  **Approach:**
  - Upload screen layout (top to bottom):
    1. **"Upload & Parse with AI"** — big primary button/drop zone
       - If key saved: opens file picker, parses on drop
       - If no key: inline key input appears below: text field + "Save" button + link "Get a key"
       - Auto-detects provider on paste, shows "✓ Anthropic key detected" or "✓ OpenAI key detected"
       - If unknown format: "Which provider?" one-time choice (Anthropic / OpenAI / Custom endpoint)
       - Key validated on save — spinner then "✓ Key works!" or "✗ Invalid key"
    2. **"Upload manually"** — smaller secondary button
       - Uses ShorthandLearner (current behavior)
       - No key needed
    3. **Saved sessions list** (from Phase 1)
  - Key management: "Manage keys" small link shows all saved keys with provider labels, option to add/remove
  - Default settings: blinds, hero seat, table size — small inputs below the upload zone, remembered in localStorage

  **Test scenarios:**
  - Test expectation: none — UI; verified via Playwright

  **Verification:**
  - AI path is visually primary
  - Key entry is inline, not a separate page
  - Provider auto-detected from key format
  - Key validated before saving
  - Multiple keys storable (one per provider)
  - Default settings remembered across sessions

- [ ] **2.3: Parsing prompt module**

  **Goal:** The system prompt that instructs the LLM to parse poker session notes into structured JSON. Single source of truth for both browser and Python CLI.

  **Requirements:** AP15

  **Dependencies:** None

  **Files:**
  - Create: `shared/parse_prompt.js`
  - Modify: `parse_session.py` (import prompt from shared source or keep in sync)
  - Test: `tests/parse_prompt.test.js` (schema validation of prompt output)

  **Approach:**
  - Extract the system prompt from `parse_session.py` into a JS constant
  - Prompt includes: session JSON schema, poker terminology, seat numbering rules (always 1-9), position mapping instructions, natural language handling, edge cases (straddle, all-in, missing info)
  - Explicitly instructs: "Use seat numbers 1-9. Never use seat 0. Map positions to seats using the button position."
  - Explicitly instructs: "If you cannot determine information, set the value to null. Do not guess."
  - Add a sync test: compare the JS prompt's key instructions against the Python prompt's key instructions

  **Test scenarios:**
  - Happy path: prompt constant is a non-empty string containing key terms (hand_id, action_sequence, hero_seat, etc.)
  - Happy path: prompt contains "1-9" seat instruction
  - Happy path: prompt contains JSON schema example
  - Integration: feed prompt + sample text to a mock LLM response → validate the response matches session schema

  **Verification:**
  - Prompt is comprehensive and produces valid session JSON
  - Key instructions present (seat numbering, null for unknowns)
  - Python CLI prompt stays in sync

- [ ] **2.4: AI parsing pipeline**

  **Goal:** Complete flow: text input → AI parse → validate → split clean/problem hands → QA/confirm.

  **Requirements:** AP9, AP10, AP11, AP12, AP13, AP14, AP17

  **Dependencies:** 2.1, 2.2, 2.3, Phase 1 (session storage for auto-save)

  **Files:**
  - Modify: `session_replayer_web.html` (handleFile, processTextInput, new AI flow)
  - Modify: `build_embedded.py` (inline llm_adapter.js, parse_prompt.js)

  **Approach:**
  - **AI parse flow:**
    1. Extract text from file (existing: readAsText for txt, JSZip for docx)
    2. Show cost estimate: "~X tokens, estimated cost: $0.XX. Parse?"
    3. If text > 30K chars: split at hand boundaries, parse each chunk separately
    4. Call `callLLM()` with parse prompt + text. Show spinner.
    5. Parse JSON response. If invalid JSON: retry once asking LLM to fix. If still invalid: fall to ShorthandLearner.
    6. Run `HoldemValidator.validateSession()` on parsed data
    7. Split hands: 0 errors → status "confirmed". Any errors → status "needs_review"
    8. If all confirmed: skip QA, load session directly into playback
    9. If some need review: show QA screen with ONLY the problem hands. Clean hands already confirmed.
    10. Auto-save to session library (Phase 1)
  - **Fallback chain:**
    - AI parse succeeds → step 6
    - AI parse returns invalid JSON → ShorthandLearner parse → step 6
    - ShorthandLearner returns 0 hands → show parse screen with raw text for manual review
    - Every step has a clear next step. Coach is never stuck.
  - **Chunking:**
    - Split text at `Hand N` markers (same regex as ShorthandLearner)
    - Each chunk gets its own API call with the same system prompt
    - Merge results: concatenate hands arrays, merge player info, keep first chunk's session metadata
    - Progress bar updates per chunk: "Parsing chunk 3 of 7..."
  - **Parse confidence:**
    - Calculate from validator results: (confirmed hands / total hands) × 100
    - Display on QA screen: "Parse confidence: 85% (17/20 hands clean)"

  **Test scenarios:**
  - Happy path: mock LLM returns valid session JSON → validator runs → clean hands confirmed → loads into playback
  - Happy path: no API key → ShorthandLearner used, no error, normal flow
  - Happy path: AI returns 10 hands, 2 have errors → 8 confirmed, 2 go to QA
  - Error path: LLM returns garbage JSON → fallback to ShorthandLearner
  - Error path: API call fails (network/auth) → shows error, offers manual parse
  - Error path: LLM returns valid JSON but 0 hands → ShorthandLearner fallback
  - Edge case: very long text (50K chars) → chunked into 3 API calls → merged correctly
  - Edge case: chunk merge handles different hand numbering across chunks
  - Integration: full pipeline from text file to playback with mocked LLM

  **Verification:**
  - AI parse → QA → playback works end to end
  - Fallback chain works at every failure point
  - Chunking produces correct merged results
  - Clean/problem split works correctly
  - All existing tests pass
  - Smoke test passes

## System-Wide Impact

- **Upload screen:** Redesigned with two paths (AI primary, manual secondary). Existing paste/file functionality still works.
- **QA system:** Now receives pre-split hands (some confirmed, some needing review). QA screen only shows "needs_review" hands.
- **Session storage:** AI-parsed sessions auto-save to library via Phase 1.
- **Build system:** Two new files inlined: `llm_adapter.js`, `parse_prompt.js`.
- **Existing flows:** JSON upload unchanged. ShorthandLearner unchanged (still used as fallback). Playback unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| CORS blocks Anthropic/provider API | Clear error message explaining the issue, suggest alternative provider |
| LLM returns wrong JSON schema | Validator catches structural issues, QA catches content issues |
| Cost estimate inaccurate | Base on actual token counting, show range not exact number |
| Parsing prompt too long (eats context) | Keep prompt under 2K tokens, session text gets the remaining context |
| Chunking splits a hand across two chunks | Split at clear "Hand N" boundaries only, never mid-hand |
| Provider API changes | Adapter layer isolates provider specifics from parsing logic |
