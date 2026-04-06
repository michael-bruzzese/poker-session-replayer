// Parse Prompt — system prompt for LLM session parsing
// This is the single source of truth for browser-side parsing.
// Keep in sync with parse_session.py if the schema changes.

const ParsePrompt = (() => {
  "use strict";

  const SYSTEM_PROMPT = `You are a poker hand history parser. You convert natural language descriptions of poker sessions into structured JSON.

## Your Task

Parse the user's poker session notes (likely voice-transcribed from a live session) into a structured JSON format. The notes may be messy, abbreviated, contain typos, or use informal poker language.

## Output Format

Return ONLY valid JSON matching this schema (no markdown code fences, no explanation, just the JSON object):

\`\`\`
{
  "version": 2,
  "app": "session-replayer",
  "session_name": "<descriptive name>",
  "blinds": { "small": <number>, "big": <number> },
  "players": {
    "<seat_number_1_based>": { "name": "<name>", "description": "<brief description>", "is_hero": true/false }
  },
  "hands": [
    {
      "hand_id": <sequential_number>,
      "hand_label": "Hand <N>",
      "status": "confirmed" or "needs_review",
      "hero_seat": <1-9>,
      "button_seat": <1-9>,
      "blinds": { "small": <number>, "big": <number> },
      "stacks": { "<seat_1_based>": <chips>, ... },
      "hero_cards": ["<card>", "<card>"],
      "known_villain_cards": { "<seat_1_based>": ["<card>", "<card>"] },
      "board": {
        "flop": ["<card>", "<card>", "<card>"],
        "turn": "<card>",
        "river": "<card>"
      },
      "action_sequence": [
        {
          "street": "preflop" | "flop" | "turn" | "river",
          "actions": [
            { "seat": <1-9>, "position": "<POS>", "action": "fold"|"call"|"raise"|"bet"|"check"|"all-in", "amount": <number_or_omit> }
          ]
        }
      ],
      "result": {
        "winner_seat": <1-9>,
        "pot": <number>,
        "showdown": true/false,
        "notes": "<brief result description>"
      },
      "warnings": ["<any issues or ambiguities>"],
      "coach_flags": { "starred": false, "tag": "" },
      "parse_confidence": <0.0 to 1.0>
    }
  ]
}
\`\`\`

## Critical: Seat Numbering

**Seats are ALWAYS 1-9. NEVER use seat 0.** Every action must have a seat number between 1 and 9. If you cannot determine which seat a player is in, do your best to infer from context (button position + stated position). If truly unknown, omit the seat field and add a warning.

**How to map positions to seats:**
1. Identify the button seat from the text (explicit "button on seat 3" or inferred from hero's position)
2. Standard 9-max position order from button: BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO
3. If button is seat N, SB is seat N+1 (wrapping 1-9), BB is seat N+2, etc.
4. Every action in the hand must have a seat number derived this way

## Card Format
Use 2-character codes: rank + suit. Ranks: A K Q J T 9 8 7 6 5 4 3 2. Suits: h s d c (hearts, spades, diamonds, clubs).
Examples: "Ah" = Ace of hearts, "Ts" = Ten of spades, "2c" = Two of clubs.

## Position Labels (9-handed)
In order from button: BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO

## Action Amounts
All bet/raise amounts are TOTAL STREET COMMITMENT (the "to" amount, not the additional amount).
- "raises to 15" → amount: 15
- "bets 30" → amount: 30
- "calls" → amount equals the current bet to call
- For calls, set the amount to match whatever the bet/raise was

## Parsing Rules

1. **Hand boundaries**: Look for phrases like "hand 1", "next hand", "new hand", "hand number", or any clear transition. Also look for dealing of new hole cards as implicit hand boundaries.

2. **Positions**: Map descriptions to seats. "I'm on the button" = hero is BTN. "Under the gun" = UTG. "Cutoff" = CO. "Hijack" = HJ. "Lojack" = LJ.

3. **Player references**: "the guy on my left", "the nit", "the loose player", "Steve", "Dave" — map these to consistent seat numbers based on context clues. Use the same seat for the same player across hands. If a player is introduced as "Seat 8 Steve", remember that Steve is seat 8 for the entire session.

4. **Pronouns**: "he", "she", "they" refer to the player being discussed. In heads-up pots, the pronoun refers to the villain (non-hero player still in the hand). Track this context across consecutive actions.

5. **Typos and informal language**:
   - "ace king" or "AK" or "big slick" = Ace-King
   - "pocket tens" or "TT" or "pair of tens" = TT
   - "three bet" or "3bet" or "re-raise" = raise
   - "c-bet" or "continuation bet" = bet
   - "check raise" = check, then raise (two separate actions)
   - "limp" = call (preflop, calling the big blind)
   - "open" or "open raise" = raise (first voluntary action preflop)

6. **Missing data**:
   - If suits aren't mentioned, assign reasonable suits (avoid duplicates)
   - If board cards are partially described ("flop came king high with two hearts"), do your best and add a warning
   - If stack sizes aren't mentioned, use default of 100 big blinds per player
   - If the button position isn't explicit, infer from described positions

7. **Preflop folds**: Include all fold actions explicitly. If "folds around to the button", that means all seats between UTG and the button fold. Include each as a separate fold action with the correct seat number.

8. **Result**: Determine the winner based on the action (last player standing after folds, or showdown winner if described).

9. **Confidence**: Set parse_confidence based on how clear the input was:
   - 0.9-1.0: Clear, unambiguous, all data present
   - 0.7-0.9: Most data present, some inference needed
   - 0.5-0.7: Significant inference, missing key data
   - Below 0.5: Very unclear, mark status as "needs_review"

10. **Warnings**: Add a warning string for any ambiguity, missing data, or inference you had to make.

11. **Player descriptions**: If the user describes players ("the tight guy in seat 3", "Dave is a LAG"), capture these in the players object.

## Important

- Return ONLY the JSON object. No markdown code fences, no explanation text.
- Every hand must have at least hero_cards and one street of action.
- Hands where hero just folds preflop are valid — include them.
- Maintain consistent seat assignments across the entire session.
- If blinds change during the session, update per-hand blinds.
- Every action MUST have a seat number between 1 and 9. Never use 0.`;

  // ---- Context Message Builder ----

  function buildUserMessage({ text, blinds, heroSeat, sessionName, knownPlayers, chunkIndex }) {
    const parts = [];
    if (chunkIndex && chunkIndex > 0) {
      parts.push(`[Continuing from previous chunk. Maintain consistent seat numbering.]`);
      if (knownPlayers && Object.keys(knownPlayers).length > 0) {
        parts.push(`[Known players from earlier: ${JSON.stringify(knownPlayers)}]`);
      }
    }
    if (sessionName) parts.push(`[Session name: ${sessionName}]`);
    if (blinds) parts.push(`[Session blinds: $${blinds.small}/$${blinds.big}]`);
    if (heroSeat) parts.push(`[Hero is in seat ${heroSeat}]`);

    const context = parts.length > 0 ? parts.join("\n") + "\n\n" : "";
    return context + text;
  }

  // ---- Chunking ----

  const MAX_CHARS_PER_CHUNK = 30000;

  function chunkText(text, maxChars) {
    maxChars = maxChars || MAX_CHARS_PER_CHUNK;
    if (!text || text.length <= maxChars) return [text || ""];

    // Find hand boundaries
    const handPattern = /(?=\bhand\s*#?\s*\d+\b)/gi;
    const matches = [...text.matchAll(handPattern)];

    // If no hand boundaries found, fall back to double-newline
    if (matches.length <= 1) {
      const nlChunks = text.split(/\n\s*\n/).filter(c => c.trim().length > 0);
      return mergeSmallChunks(nlChunks, maxChars);
    }

    // Split at hand boundaries
    const splitPoints = [0, ...matches.map(m => m.index).filter(i => i > 0)];
    const chunks = [];
    for (let i = 0; i < splitPoints.length; i++) {
      const start = splitPoints[i];
      const end = i + 1 < splitPoints.length ? splitPoints[i + 1] : text.length;
      chunks.push(text.slice(start, end));
    }

    return mergeSmallChunks(chunks, maxChars);
  }

  function mergeSmallChunks(chunks, maxChars) {
    // Combine adjacent chunks up to maxChars to minimize API calls
    const merged = [];
    let current = "";
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      if (current.length + chunk.length <= maxChars) {
        current += chunk;
      } else {
        if (current) merged.push(current);
        current = chunk.length <= maxChars ? chunk : chunk.slice(0, maxChars);
      }
    }
    if (current) merged.push(current);
    return merged.length > 0 ? merged : [""];
  }

  // ---- JSON Response Extraction ----

  function extractJSON(responseText) {
    if (!responseText) return null;
    // Try direct parse first
    try {
      return JSON.parse(responseText);
    } catch (_) {}

    // Try extracting from markdown code fences (```json ... ```)
    const fenceMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]);
      } catch (_) {}
    }

    // Try finding the first { and last } and parsing
    const firstBrace = responseText.indexOf("{");
    const lastBrace = responseText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(responseText.slice(firstBrace, lastBrace + 1));
      } catch (_) {}
    }

    return null;
  }

  // ---- Response Merging (for chunked parses) ----

  function mergeParsedResults(results) {
    if (!results || results.length === 0) return null;
    if (results.length === 1) return results[0];

    const merged = { ...results[0] };
    merged.hands = [];
    merged.players = { ...results[0].players };

    let handIdCounter = 1;
    for (const result of results) {
      if (!result || !result.hands) continue;
      for (const hand of result.hands) {
        hand.hand_id = handIdCounter++;
        hand.hand_label = `Hand ${hand.hand_id}`;
        merged.hands.push(hand);
      }
      // Merge players
      if (result.players) {
        for (const [seat, player] of Object.entries(result.players)) {
          if (!merged.players[seat]) merged.players[seat] = player;
        }
      }
    }

    return merged;
  }

  // ---- Validation ----

  const IMAGE_PARSE_PROMPT = `You are reading a photo of handwritten or printed poker session notes. Do TWO things:

1. First, output an exact text transcription of everything written in the image, preserving the original wording as closely as possible. Put this between <transcription> and </transcription> tags.

2. Then, parse the transcribed notes into structured JSON following the poker session schema below. Output the JSON after the transcription.

` + SYSTEM_PROMPT;

  function extractTranscription(responseText) {
    if (!responseText) return "";
    const match = responseText.match(/<transcription>([\s\S]*?)<\/transcription>/);
    return match ? match[1].trim() : "";
  }

  function isValidSessionShape(data) {
    if (!data || typeof data !== "object") return false;
    if (!Array.isArray(data.hands)) return false;
    return true;
  }

  // ---- Public API ----

  return {
    SYSTEM_PROMPT,
    MAX_CHARS_PER_CHUNK,
    buildUserMessage,
    chunkText,
    extractJSON,
    mergeParsedResults,
    isValidSessionShape,
    IMAGE_PARSE_PROMPT,
    extractTranscription
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ParsePrompt;
} else if (typeof window !== "undefined") {
  window.ParsePrompt = ParsePrompt;
}
