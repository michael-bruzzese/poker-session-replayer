#!/usr/bin/env python3
"""
Session Parser — Converts natural language poker session notes into structured JSON.

Uses the Claude API to parse voice-transcribed or handwritten session notes
into the Session Replayer JSON format.

Usage:
    python3 parse_session.py input.txt -o session.json
    python3 parse_session.py input.txt --blinds 2/5 --hero-seat 3
    python3 parse_session.py input.docx -o session.json

Requires:
    pip install anthropic
    ANTHROPIC_API_KEY environment variable set
"""

import argparse
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

try:
    import anthropic
except ImportError:
    anthropic = None

# ---- Text Extraction ----

def extract_text_from_txt(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        return f.read()

def extract_text_from_docx(filepath):
    """Extract plain text from a .docx file (which is a ZIP of XML)."""
    text_parts = []
    with zipfile.ZipFile(filepath, "r") as z:
        if "word/document.xml" not in z.namelist():
            raise ValueError("Not a valid .docx file (missing word/document.xml)")
        with z.open("word/document.xml") as f:
            tree = ET.parse(f)
            root = tree.getroot()
            # Namespace handling
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            for para in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
                para_text = []
                for run in para.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"):
                    if run.text:
                        para_text.append(run.text)
                if para_text:
                    text_parts.append("".join(para_text))
    return "\n".join(text_parts)

def extract_text(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    if ext == ".txt":
        return extract_text_from_txt(filepath)
    elif ext == ".docx":
        return extract_text_from_docx(filepath)
    elif ext == ".json":
        # Already structured — pass through
        return None
    else:
        # Try as plain text
        return extract_text_from_txt(filepath)

# ---- Claude API System Prompt ----

SYSTEM_PROMPT = """You are a poker hand history parser. You convert natural language descriptions of poker sessions into structured JSON.

## Your Task

Parse the user's poker session notes (likely voice-transcribed from a live session) into a structured JSON format. The notes may be messy, abbreviated, contain typos, or use informal poker language.

## Output Format

Return ONLY valid JSON matching this schema (no markdown, no explanation, just the JSON object):

```
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
```

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

3. **Player references**: "the guy on my left", "the nit", "the loose player" — map these to consistent seat numbers based on context clues. Use the same seat for the same player across hands.

4. **Typos and informal language**:
   - "ace king" or "AK" or "big slick" = Ace-King
   - "pocket tens" or "TT" or "pair of tens" = TT
   - "three bet" or "3bet" or "re-raise" = raise
   - "c-bet" or "continuation bet" = bet
   - "check raise" = check, then raise
   - "limp" = call (preflop, calling the big blind)
   - "open" or "open raise" = raise (first voluntary action preflop)

5. **Missing data**:
   - If suits aren't mentioned, assign reasonable suits (avoid duplicates)
   - If board cards are partially described ("flop came king high with two hearts"), do your best and add a warning
   - If stack sizes aren't mentioned, use default (e.g., 100bb)
   - If the button position isn't explicit, infer from described positions

6. **Preflop folds**: Include all fold actions explicitly. If "folds around to the button", that means all seats between the last actor and the button fold.

7. **Result**: Determine the winner based on the action (last player standing after folds, or showdown winner if described).

8. **Confidence**: Set parse_confidence based on how clear the input was:
   - 0.9-1.0: Clear, unambiguous, all data present
   - 0.7-0.9: Most data present, some inference needed
   - 0.5-0.7: Significant inference, missing key data
   - Below 0.5: Very unclear, mark status as "needs_review"

9. **Warnings**: Add a warning string for any ambiguity, missing data, or inference you had to make.

10. **Player descriptions**: If the user describes players ("the tight guy in seat 3", "Dave is a LAG"), capture these in the players object.

## Important

- Return ONLY the JSON object. No markdown code fences, no explanation text.
- Every hand must have at least hero_cards and one street of action.
- Hands where hero just folds preflop are valid — include them.
- Maintain consistent seat assignments across the entire session.
- If blinds change during the session, update per-hand blinds.
"""

# ---- Chunking ----

MAX_CHARS_PER_CHUNK = 60000  # Leave room for system prompt and response

def chunk_text(text, max_chars=MAX_CHARS_PER_CHUNK):
    """Split text at hand boundaries into chunks under max_chars."""
    if len(text) <= max_chars:
        return [text]

    # Try to split at hand boundaries
    hand_patterns = [
        r'(?i)\b(?:hand\s*(?:#?\s*\d+|\bnumber\b))',
        r'(?i)\bnext\s+hand\b',
        r'(?i)\bnew\s+hand\b',
        r'\n\s*\n',  # double newline as fallback
    ]

    # Find all potential split points
    split_points = [0]
    for pattern in hand_patterns:
        for m in re.finditer(pattern, text):
            split_points.append(m.start())
    split_points = sorted(set(split_points))

    chunks = []
    chunk_start = 0

    for i, point in enumerate(split_points[1:], 1):
        if point - chunk_start > max_chars:
            # Find the last split point before max_chars
            best = chunk_start
            for p in split_points:
                if p > chunk_start and p - chunk_start <= max_chars:
                    best = p
                elif p - chunk_start > max_chars:
                    break
            if best == chunk_start:
                best = chunk_start + max_chars
            chunks.append(text[chunk_start:best])
            chunk_start = best

    if chunk_start < len(text):
        chunks.append(text[chunk_start:])

    return [c for c in chunks if c.strip()]

# ---- API Call ----

def parse_with_claude(text, blinds=None, hero_seat=None, session_name=None, model="claude-sonnet-4-6"):
    """Send text to Claude API for parsing."""
    if anthropic is None:
        print("ERROR: 'anthropic' package not installed. Run: pip install anthropic")
        sys.exit(1)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable not set.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    chunks = chunk_text(text)
    all_hands = []
    all_players = {}

    for i, chunk in enumerate(chunks):
        print(f"  Parsing chunk {i + 1}/{len(chunks)} ({len(chunk)} chars)...")

        user_message = chunk
        if blinds:
            user_message = f"[Session blinds: ${blinds}]\n\n" + user_message
        if hero_seat:
            user_message = f"[Hero is in seat {hero_seat}]\n\n" + user_message
        if session_name:
            user_message = f"[Session name: {session_name}]\n\n" + user_message
        if i > 0:
            user_message = f"[Continuing from previous chunk. Known players: {json.dumps(all_players)}]\n\n" + user_message

        response = client.messages.create(
            model=model,
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}]
        )

        response_text = response.content[0].text.strip()

        # Try to extract JSON from response
        # Handle potential markdown code fences
        if response_text.startswith("```"):
            response_text = re.sub(r'^```(?:json)?\s*\n?', '', response_text)
            response_text = re.sub(r'\n?```\s*$', '', response_text)

        try:
            parsed = json.loads(response_text)
        except json.JSONDecodeError as e:
            print(f"  WARNING: Failed to parse response as JSON: {e}")
            print(f"  Response preview: {response_text[:500]}...")
            continue

        # Merge results
        if "players" in parsed:
            all_players.update(parsed["players"])
        if "hands" in parsed:
            # Re-number hands to be sequential
            offset = len(all_hands)
            for hand in parsed["hands"]:
                hand["hand_id"] = offset + hand.get("hand_id", 1)
                hand["hand_label"] = f"Hand {hand['hand_id']}"
                all_hands.append(hand)

    # Build final session
    session_data = {
        "version": 2,
        "app": "session-replayer",
        "session_name": session_name or "Parsed Session",
        "blinds": parse_blinds(blinds) if blinds else {"small": 2, "big": 5},
        "players": all_players,
        "hand_count": len(all_hands),
        "hands": all_hands,
        "flags": {
            "has_unresolved_ambiguities": any(h.get("warnings") for h in all_hands),
            "confirmed_by_user": False
        }
    }

    return session_data

def parse_blinds(blinds_str):
    """Parse a blinds string like '2/5' or '1/2' into {small, big}."""
    if not blinds_str:
        return {"small": 2, "big": 5}
    parts = re.split(r'[/\\-]', str(blinds_str))
    if len(parts) == 2:
        return {"small": int(parts[0]), "big": int(parts[1])}
    return {"small": 2, "big": 5}

# ---- Ambiguity Detection ----

def detect_ambiguities(session_data):
    """Scan parsed session for issues and generate questions."""
    questions = []

    for hand in session_data.get("hands", []):
        hand_id = hand.get("hand_id", "?")

        # Check for missing hero cards
        if not hand.get("hero_cards") or len(hand.get("hero_cards", [])) < 2:
            questions.append({
                "hand_id": hand_id,
                "field": "hero_cards",
                "severity": "blocking",
                "question": f"Hand {hand_id}: What were hero's hole cards?",
                "input_type": "cards"
            })

        # Check for missing board cards when later streets have actions
        action_seq = hand.get("action_sequence", [])
        streets_with_actions = {s["street"] for s in action_seq if s.get("actions")}
        board = hand.get("board", {})

        if "flop" in streets_with_actions and not board.get("flop"):
            questions.append({
                "hand_id": hand_id,
                "field": "board.flop",
                "severity": "blocking",
                "question": f"Hand {hand_id}: There's flop action but no flop cards. What was the flop?",
                "input_type": "cards"
            })

        if "turn" in streets_with_actions and not board.get("turn"):
            questions.append({
                "hand_id": hand_id,
                "field": "board.turn",
                "severity": "blocking",
                "question": f"Hand {hand_id}: There's turn action but no turn card. What was the turn?",
                "input_type": "card"
            })

        if "river" in streets_with_actions and not board.get("river"):
            questions.append({
                "hand_id": hand_id,
                "field": "board.river",
                "severity": "blocking",
                "question": f"Hand {hand_id}: There's river action but no river card. What was the river?",
                "input_type": "card"
            })

        # Check for bet/raise without amounts
        for street_block in action_seq:
            for action in street_block.get("actions", []):
                if action["action"] in ("bet", "raise") and not action.get("amount"):
                    questions.append({
                        "hand_id": hand_id,
                        "field": f"{street_block['street']}.action.amount",
                        "severity": "warning",
                        "question": f"Hand {hand_id}, {street_block['street']}: Seat {action['seat']} {action['action']}s but no amount specified. What was the amount?",
                        "input_type": "amount"
                    })

        # Low confidence
        if hand.get("parse_confidence", 1.0) < 0.7:
            questions.append({
                "hand_id": hand_id,
                "field": "general",
                "severity": "warning",
                "question": f"Hand {hand_id}: Low parse confidence ({hand.get('parse_confidence', '?')}). Please review this hand.",
                "input_type": "confirm"
            })

    return questions

# ---- Interactive Q&A ----

def run_interactive_qa(session_data):
    """Run interactive Q&A to resolve ambiguities."""
    questions = detect_ambiguities(session_data)

    if not questions:
        print("\nNo ambiguities detected. Session looks clean!")
        return session_data

    blocking = [q for q in questions if q["severity"] == "blocking"]
    warnings = [q for q in questions if q["severity"] == "warning"]

    print(f"\nFound {len(blocking)} blocking issues and {len(warnings)} warnings.")

    if blocking:
        print("\n--- Blocking Issues (must resolve) ---")
        for q in blocking:
            print(f"\n  {q['question']}")
            answer = input("  Your answer (or 'skip'): ").strip()
            if answer.lower() == "skip":
                continue
            apply_answer(session_data, q, answer)

    if warnings:
        print("\n--- Warnings (optional) ---")
        for q in warnings:
            print(f"\n  {q['question']}")
            answer = input("  Your answer (or 'skip'): ").strip()
            if answer.lower() == "skip":
                continue
            apply_answer(session_data, q, answer)

    return session_data

def apply_answer(session_data, question, answer):
    """Apply a user's answer to resolve an ambiguity."""
    hand_id = question["hand_id"]
    hand = next((h for h in session_data["hands"] if h["hand_id"] == hand_id), None)
    if not hand:
        return

    field = question["field"]

    if field == "hero_cards":
        cards = re.findall(r'[AKQJT2-9][shdc]', answer, re.IGNORECASE)
        if len(cards) >= 2:
            hand["hero_cards"] = [c[0].upper() + c[1].lower() for c in cards[:2]]

    elif field == "board.flop":
        cards = re.findall(r'[AKQJT2-9][shdc]', answer, re.IGNORECASE)
        if len(cards) >= 3:
            if "board" not in hand:
                hand["board"] = {}
            hand["board"]["flop"] = [c[0].upper() + c[1].lower() for c in cards[:3]]

    elif field == "board.turn":
        cards = re.findall(r'[AKQJT2-9][shdc]', answer, re.IGNORECASE)
        if cards:
            if "board" not in hand:
                hand["board"] = {}
            hand["board"]["turn"] = cards[0][0].upper() + cards[0][1].lower()

    elif field == "board.river":
        cards = re.findall(r'[AKQJT2-9][shdc]', answer, re.IGNORECASE)
        if cards:
            if "board" not in hand:
                hand["board"] = {}
            hand["board"]["river"] = cards[0][0].upper() + cards[0][1].lower()

    elif "action.amount" in field:
        try:
            amount = int(re.search(r'\d+', answer).group())
            # Find and update the action (simplified — would need more precise targeting)
            hand.setdefault("_resolved", []).append({"field": field, "value": amount})
        except (ValueError, AttributeError):
            pass

# ---- Summary ----

def print_summary(session_data):
    """Print a summary of the parsed session."""
    hands = session_data.get("hands", [])
    print(f"\n{'='*60}")
    print(f"Session: {session_data.get('session_name', 'Unknown')}")
    print(f"Blinds: ${session_data['blinds']['small']}/${session_data['blinds']['big']}")
    print(f"Hands: {len(hands)}")

    players = session_data.get("players", {})
    if players:
        print(f"\nPlayers:")
        for seat, info in sorted(players.items(), key=lambda x: int(x[0])):
            hero = " (HERO)" if info.get("is_hero") else ""
            desc = f" - {info['description']}" if info.get("description") else ""
            print(f"  Seat {seat}: {info.get('name', 'Unknown')}{hero}{desc}")

    print(f"\nHands:")
    for hand in hands:
        hid = hand.get("hand_id", "?")
        cards = " ".join(hand.get("hero_cards", ["??", "??"]))
        streets = [s["street"] for s in hand.get("action_sequence", [])]
        last_street = streets[-1] if streets else "?"
        result = hand.get("result", {})
        winner = result.get("winner_seat", "?")
        pot = result.get("pot", "?")
        conf = hand.get("parse_confidence", "?")
        warnings = hand.get("warnings", [])
        warn_str = f" [{len(warnings)} warnings]" if warnings else ""
        status = hand.get("status", "?")
        star = " *" if hand.get("coach_flags", {}).get("starred") else ""
        print(f"  #{hid}: {cards} | to {last_street} | pot {pot} | winner seat {winner} | conf {conf}{warn_str}{star}")

    print(f"{'='*60}")

# ---- Main ----

def main():
    parser = argparse.ArgumentParser(description="Parse poker session notes into structured JSON")
    parser.add_argument("input", help="Input file (.txt, .docx, or .json)")
    parser.add_argument("-o", "--output", default="session.json", help="Output JSON file (default: session.json)")
    parser.add_argument("--blinds", help="Blind structure, e.g. '2/5'")
    parser.add_argument("--hero-seat", type=int, help="Hero's seat number (1-9)")
    parser.add_argument("--name", help="Session name")
    parser.add_argument("--model", default="claude-sonnet-4-6", help="Claude model to use")
    parser.add_argument("--no-qa", action="store_true", help="Skip interactive Q&A")
    parser.add_argument("--summary", action="store_true", help="Print summary only (for .json input)")

    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"ERROR: File not found: {args.input}")
        sys.exit(1)

    # If input is already JSON, just load and optionally QA
    if args.input.endswith(".json"):
        with open(args.input, "r") as f:
            session_data = json.load(f)
        if args.summary:
            print_summary(session_data)
            return
        if not args.no_qa:
            session_data = run_interactive_qa(session_data)
        print_summary(session_data)
        with open(args.output, "w") as f:
            json.dump(session_data, f, indent=2)
        print(f"\nSaved to {args.output}")
        return

    # Extract text
    print(f"Reading {args.input}...")
    text = extract_text(args.input)
    if text is None:
        print("ERROR: Could not extract text from file.")
        sys.exit(1)

    print(f"  Extracted {len(text)} characters")

    # Parse with Claude
    print(f"Parsing with Claude ({args.model})...")
    session_data = parse_with_claude(
        text,
        blinds=args.blinds,
        hero_seat=args.hero_seat,
        session_name=args.name,
        model=args.model
    )

    # Interactive Q&A
    if not args.no_qa:
        session_data = run_interactive_qa(session_data)

    # Summary
    print_summary(session_data)

    # Save
    with open(args.output, "w") as f:
        json.dump(session_data, f, indent=2)
    print(f"\nSaved to {args.output}")
    print(f"Load this file in Session Replayer to begin coaching playback.")

if __name__ == "__main__":
    main()
