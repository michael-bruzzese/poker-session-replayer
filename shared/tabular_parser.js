// Tabular Session Parser
// Deterministic parser for structured poker session notes in tabular format.
// No LLM required — parses the exact shorthand notation used in live session logging.
//
// Expected row format (tab or multi-space delimited):
//   hand#  type  heroPosition  heroCards  stack  actionText
//
// Action shorthand:
//   f = fold, x = check, c = call, b N = bet N, r N = raise N
//   jam/jam N = all-in, H = hero
//   "f to X" = folds around to position X
//   "all f" = everyone folds
//
// Board lines within action text:
//   Flop (pot): card card card --- actions
//   Turn (pot): card --- actions
//   River (pot): card --- actions
//
// Result notation:
//   "X wins card card" = showdown winner
//   "X mucks" = loser mucked
//   "X loses card card" = showdown loser shown
//   "X chops pot card card" = split pot
//   "blinds chopped" = walk / chop
//
// Depends on: PokerConstants (for TABLE_POSITIONS_9MAX)

const TabularParser = (() => {
  "use strict";

  // 9-max positions in table order (from button)
  const POSITIONS_9MAX = ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"];

  // Map user position labels to canonical names
  const POS_ALIASES = {
    "EP1": "UTG", "EP2": "UTG+1", "EP3": "UTG+2",
    "EP": "UTG",
    "LJ": "LJ", "HJ": "HJ", "CO": "CO",
    "BTN": "BTN", "BU": "BTN", "BUTTON": "BTN", "D": "BTN",
    "SB": "SB", "BB": "BB",
    "UTG": "UTG", "UTG+1": "UTG+1", "UTG+2": "UTG+2",
    "UTG1": "UTG+1", "UTG2": "UTG+2",
    "MP": "LJ", "MP1": "LJ", "MP2": "HJ",
    "STRADDLE": "UTG" // straddle is UTG position
  };

  // Card regex: matches Ah, Ks, Td, 9c etc.
  const CARD_RE = /[AKQJT2-9][shdc]/gi;

  // ---- Detection ----

  /**
   * Detect if text looks like tabular session format.
   * Returns true if multiple lines match the pattern: number \t type \t position \t cards ...
   */
  function isTabularFormat(text) {
    if (!text || typeof text !== "string") return false;
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    let matchCount = 0;
    for (const line of lines) {
      // Match: starts with a number, then has a known hand type or "Fold"
      if (/^\d+\s+(?:Fold|SRP|3BP|Limp|Limped|Walk|Straddle)/i.test(line)) {
        matchCount++;
      }
    }
    // Need at least 3 matching lines to be confident
    return matchCount >= 3;
  }

  // ---- Position / Seat Mapping ----

  /**
   * Build a position-to-seat map given the button seat (1-based).
   * POSITIONS_9MAX[0] = BTN, [1] = SB, [2] = BB, etc.
   */
  function buildPositionSeatMap(buttonSeat) {
    const map = {};
    for (let i = 0; i < 9; i++) {
      const seat = ((buttonSeat - 1 + i) % 9) + 1;
      map[POSITIONS_9MAX[i]] = seat;
    }
    return map;
  }

  /**
   * Normalize a position string to canonical form.
   */
  function normalizePosition(pos) {
    if (!pos) return null;
    const upper = pos.toUpperCase().trim();
    // Strip parenthetical notes like "(Louis, F)" or "(Fish)" or "(TR)"
    const clean = upper.replace(/\s*\(.*?\)\s*/g, "").trim();
    return POS_ALIASES[clean] || clean;
  }

  // ---- Row Parsing ----

  /**
   * Split a row into its component fields.
   * Fields are separated by tabs or 4+ spaces.
   */
  function splitRow(line) {
    // Try tab-separated first
    let parts = line.split("\t").map(s => s.trim());
    if (parts.length >= 4) return parts;

    // The format from the sample appears to use varied whitespace.
    // hand#  type  position  cards  stack  actionText
    // The action text is the last field, often quoted.
    // Let's use a regex approach.
    const match = line.match(
      /^(\d+)\s+((?:Fold|SRP\s+\w+(?:\s+\([^)]*\))?|3BP\s+\w+(?:\s+\([^)]*\))?|Limp(?:ed)?\s+Pot(?:\s+\([^)]*\))?|Limped\s+Pot|Walk|Straddle\s+Pot)[^\t]*?)\s+([A-Z][A-Z0-9+]*)\s+([AKQJT2-9][shdc]\s+[AKQJT2-9][shdc])\s+([$\d,]+|n\/a)\s+(.*)/i
    );
    if (match) {
      return [match[1], match[2].trim(), match[3], match[4], match[5], match[6]];
    }

    // Fallback: split by 3+ whitespace
    parts = line.split(/\s{3,}/).map(s => s.trim());
    if (parts.length >= 4) return parts;

    // Last resort: split by 2+ whitespace but be more careful
    parts = line.split(/\s{2,}/).map(s => s.trim());
    return parts;
  }

  /**
   * Parse hero cards from a string like "7h 3s" or "Ac Jh"
   */
  function parseCards(str) {
    if (!str) return [];
    const matches = str.match(CARD_RE);
    if (!matches) return [];
    return matches.map(c => c[0].toUpperCase() + c[1].toLowerCase());
  }

  /**
   * Parse stack amount from string like "$1,000" or "n/a"
   */
  function parseStack(str) {
    if (!str || str.toLowerCase() === "n/a") return null;
    const cleaned = str.replace(/[$,]/g, "");
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? null : num;
  }

  // ---- Action Text Parsing ----

  /**
   * Resolve a position token to its canonical position name.
   * Handles player names with notes like "LJ (TR)" or "CO (Fish)"
   * Returns { position, playerNote } or null.
   */
  function resolveActor(token) {
    if (!token) return null;
    const trimmed = token.trim();

    // Handle "H" = hero
    if (trimmed === "H") return { position: "HERO", playerNote: null };

    // Handle position with parenthetical note: "LJ (TR)", "CO (Fish)", "BTN (Louis, F)"
    const noteMatch = trimmed.match(/^([A-Z][A-Z0-9+]*)\s*\(([^)]+)\)/i);
    if (noteMatch) {
      const pos = normalizePosition(noteMatch[1]);
      return pos ? { position: pos, playerNote: noteMatch[2].trim() } : null;
    }

    const pos = normalizePosition(trimmed);
    return pos ? { position: pos, playerNote: null } : null;
  }

  /**
   * Parse preflop action text.
   * Handles patterns like:
   *   "EP1 f, H f"
   *   "f to LJ b 20, CO c, BTN c, H r 150, BB f, LJ c, CO f, BTN c"
   *   "EP1 c, EP2 c, CO c, H x"
   *   "Straddle on, EP3 c, CO c, f"
   *   "Action in front, f"
   *   "EP1 b 20, LJ c, H f"
   *   "blinds chopped"
   *   "f to H, f"
   *   "2x limps, f"
   *   "4x limps"
   *   "f"
   */
  function parsePreflopActions(text, heroPosition, positionSeatMap, playerNotes) {
    const actions = [];
    if (!text) return actions;

    const trimmed = text.trim();

    // "blinds chopped" — no action
    if (/blinds\s+chopped/i.test(trimmed)) {
      return []; // special case handled at hand level
    }

    // Split into comma-separated segments
    const segments = trimmed.split(/,\s*/);

    for (const seg of segments) {
      const s = seg.trim();
      if (!s) continue;

      // "Action in front" — skip, it's just context
      if (/^action\s+in\s+front$/i.test(s)) continue;

      // "Straddle on" — skip, it's context
      if (/^straddle\s+on$/i.test(s)) continue;

      // "2x limps" or "3x limps" or "4x limps" — multiple limpers, we don't know who
      if (/^\d+x\s+limps?$/i.test(s)) continue;

      // "f to X" — folds to position X (don't generate explicit folds, just note context)
      const foldToMatch = s.match(/^f\s+to\s+(.+)/i);
      if (foldToMatch) {
        // The remaining part might have an action: "f to LJ b 20" or just "f to H"
        const rest = foldToMatch[1].trim();
        // Try to parse as "POSITION action amount"
        const actResult = parseActionSegment(rest, heroPosition, positionSeatMap, playerNotes);
        if (actResult) {
          actions.push(actResult);
        }
        continue;
      }

      // "all f" — everyone folds
      if (/^all\s+f$/i.test(s)) {
        // This is an "everyone else folds" marker — no specific seats
        continue;
      }

      // Bare "f" — unknown actor folds (context determines who)
      if (s === "f") {
        actions.push({
          position: "_UNKNOWN",
          action: "fold"
        });
        continue;
      }

      // Parse as "POSITION action [amount]"
      const actResult = parseActionSegment(s, heroPosition, positionSeatMap, playerNotes);
      if (actResult) {
        actions.push(actResult);
      }
    }

    return actions;
  }

  /**
   * Parse a single action segment like "EP1 f" or "H r 150" or "LJ (TR) r 75"
   * or "x" or "f" or "b 15"
   */
  function parseActionSegment(seg, heroPosition, positionSeatMap, playerNotes) {
    const s = seg.trim();
    if (!s) return null;

    // Regex: optional position (with optional notes), then action letter, then optional amount
    // Patterns:
    //   "EP1 f"
    //   "H r 150"
    //   "LJ (TR) r 75"
    //   "CO (Fish) c"
    //   "BTN jam 200"
    //   "H jam 625"
    //   "H x"
    //   "x" (no position = hero)
    //   "f" (no position = hero or contextual)
    //   "SB b 80"
    //   "H c"
    //   "BB b 50"

    const actionMatch = s.match(
      /^(?:([A-Z][A-Z0-9+]*(?:\s*\([^)]+\))?|H)\s+)?(f|x|c|b|r|jam|jams|shove|shoves|call|fold|check|bet|raise|all[\s-]?in)(?:\s+(\d+))?$/i
    );

    if (actionMatch) {
      const actorToken = actionMatch[1] || null;
      const actionWord = actionMatch[2].toLowerCase();
      const amount = actionMatch[3] ? parseInt(actionMatch[3], 10) : null;

      let position = heroPosition;
      if (actorToken) {
        const resolved = resolveActor(actorToken);
        if (resolved) {
          position = resolved.position === "HERO" ? heroPosition : resolved.position;
          if (resolved.playerNote && playerNotes) {
            playerNotes[resolved.position] = resolved.playerNote;
          }
        }
      }

      const action = mapAction(actionWord);
      const result = { position, action };
      if (amount !== null) result.amount = amount;
      return result;
    }

    return null;
  }

  /**
   * Map action shorthand to canonical action names.
   */
  function mapAction(word) {
    switch (word) {
      case "f": case "fold": return "fold";
      case "x": case "check": return "check";
      case "c": case "call": return "call";
      case "b": case "bet": return "bet";
      case "r": case "raise": return "raise";
      case "jam": case "jams": case "shove": case "shoves":
      case "all-in": case "all in": case "allin":
        return "all-in";
      default: return word;
    }
  }

  /**
   * Parse a street's action sequence from the --- separated part.
   * Format: "H x, LJ x, BTN jam 200, H c, LJ f"
   *     or: "x, H x, x, x"  (multiple x's = checks around)
   *     or: "H b 15, f,f,f,f"  (hero bets, rest fold)
   *     or: "H x, EP3 b 40, HJ f, SB f, H c"
   */
  function parseStreetActions(text, heroPosition, positionSeatMap, playerNotes) {
    const actions = [];
    if (!text) return actions;

    const segments = text.split(/,\s*/);
    for (const seg of segments) {
      const s = seg.trim();
      if (!s) continue;

      // Bare "f" — fold (position contextual)
      if (s === "f") {
        actions.push({ position: "_UNKNOWN", action: "fold" });
        continue;
      }

      // Bare "x" — check (position contextual)
      if (s === "x") {
        actions.push({ position: "_UNKNOWN", action: "check" });
        continue;
      }

      // Bare "Hc" with no space (typo)
      if (/^Hc$/i.test(s)) {
        actions.push({ position: heroPosition, action: "call" });
        continue;
      }

      const actResult = parseActionSegment(s, heroPosition, positionSeatMap, playerNotes);
      if (actResult) {
        actions.push(actResult);
      }
    }

    return actions;
  }

  /**
   * Parse the full action text for a played hand.
   * Splits into streets at "Flop", "Turn", "River" markers.
   * Returns { preflop, flop, turn, river } action arrays and board cards.
   */
  function parseFullActionText(text, heroPosition, positionSeatMap, playerNotes) {
    if (!text) return { streets: {}, board: {}, result: null };

    // Clean up the text — remove surrounding quotes
    let clean = text.trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) ||
        (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1).trim();
    }
    // Also handle smart quotes
    clean = clean.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    if ((clean.startsWith('"') && clean.endsWith('"'))) {
      clean = clean.slice(1, -1).trim();
    }

    const streets = {};
    const board = {};
    let result = null;

    // Split into lines
    const lines = clean.split("\n").map(l => l.trim()).filter(Boolean);

    let currentStreet = "preflop";
    let preflopParts = [];
    let postflopLines = {};

    for (const line of lines) {
      // Check for street markers
      const flopMatch = line.match(/^Flop\s*\((\d+)\)\s*:\s*(.+?)(?:\s*---\s*(.*))?$/i);
      const turnMatch = line.match(/^Turn\s*\((\d+)\)\s*:\s*(.+?)(?:\s*---\s*(.*))?$/i);
      const riverMatch = line.match(/^River\s*:?\s*\((\d+)\)\s*:\s*(.+?)(?:\s*---\s*(.*))?$/i) ||
                         line.match(/^River\s*\((\d+)\)\s*:\s*(.+?)(?:\s*---\s*(.*))?$/i);

      // Check for result lines
      const resultMatch = line.match(/^(\w+(?:\+\d)?)\s+(wins?|mucks?|loses?|chops?\s+pot)\s*(.*)/i);
      const resultMatch2 = line.match(/^(\w+(?:\+\d)?)\s+mucks?\s*$/i);

      if (flopMatch) {
        currentStreet = "flop";
        const flopCards = parseCards(flopMatch[2]);
        if (flopCards.length >= 3) board.flop = flopCards.slice(0, 3);
        if (flopMatch[3]) {
          postflopLines["flop"] = flopMatch[3];
        }
      } else if (turnMatch) {
        currentStreet = "turn";
        const turnCards = parseCards(turnMatch[2]);
        if (turnCards.length >= 1) board.turn = turnCards[0];
        if (turnMatch[3]) {
          postflopLines["turn"] = turnMatch[3];
        }
      } else if (riverMatch) {
        currentStreet = "river";
        const riverCards = parseCards(riverMatch[2]);
        if (riverCards.length >= 1) board.river = riverCards[0];
        if (riverMatch[3]) {
          postflopLines["river"] = riverMatch[3];
        }
      } else if (resultMatch) {
        const who = normalizePosition(resultMatch[1]) || resultMatch[1];
        const what = resultMatch[2].toLowerCase();
        const extra = resultMatch[3] ? resultMatch[3].trim() : "";
        const extraCards = parseCards(extra);

        result = { position: who };
        if (what.startsWith("win")) {
          result.outcome = "wins";
          if (extraCards.length >= 2) result.cards = extraCards.slice(0, 2);
        } else if (what.startsWith("muck")) {
          result.outcome = "mucks";
        } else if (what.startsWith("lose")) {
          result.outcome = "loses";
          if (extraCards.length >= 2) result.cards = extraCards.slice(0, 2);
        } else if (what.startsWith("chop")) {
          result.outcome = "chops";
          if (extraCards.length >= 2) result.cards = extraCards.slice(0, 2);
        }
      } else if (resultMatch2) {
        const who = normalizePosition(resultMatch2[1]) || resultMatch2[1];
        result = { position: who, outcome: "mucks" };
      } else if (currentStreet === "preflop") {
        // Handle "Pre:" prefix
        const preMatch = line.match(/^Pre\s*:\s*(.*)/i);
        if (preMatch) {
          preflopParts.push(preMatch[1]);
        } else {
          preflopParts.push(line);
        }
      } else {
        // Continuation of a postflop street's action text
        // Could be actions continuing on next line after board was shown
        // e.g. a line with just action text for the current street
        if (postflopLines[currentStreet]) {
          postflopLines[currentStreet] += ", " + line;
        } else {
          postflopLines[currentStreet] = line;
        }
      }
    }

    // Parse preflop
    const preflopText = preflopParts.join(", ");
    streets.preflop = parsePreflopActions(preflopText, heroPosition, positionSeatMap, playerNotes);

    // Parse postflop streets
    for (const street of ["flop", "turn", "river"]) {
      if (postflopLines[street]) {
        streets[street] = parseStreetActions(postflopLines[street], heroPosition, positionSeatMap, playerNotes);
      }
    }

    return { streets, board, result };
  }

  // ---- Main Parse ----

  /**
   * Parse full session text into structured JSON.
   * @param {string} text - Raw tabular session notes
   * @param {Object} opts - { blinds: {small, big}, heroSeat, sessionName, tableSize }
   * @returns {Object} Session data in replayer format
   */
  function parse(text, opts) {
    if (!text || typeof text !== "string") return null;
    const o = opts || {};
    const blinds = o.blinds || { small: 2, big: 5 };
    const tableSize = o.tableSize || 9;
    const sessionName = o.sessionName || "Parsed Session";

    // Split text into individual hand rows
    // Each hand starts with a number at the beginning of a line
    // But action text can span multiple lines (quoted multiline strings)
    const hands = [];
    const rawRows = splitIntoHandRows(text);
    const playerNotes = {}; // position -> note, accumulated across hands

    // Determine hero seat. We need to figure out the button rotation.
    // In the sample, hand 1 hero is EP1 (UTG), hand 2 hero is BB, etc.
    // The position column tells us hero's position each hand.
    // We pick a fixed hero seat and derive the button from hero's position.
    const heroSeat = o.heroSeat || 1;

    for (const row of rawRows) {
      const hand = parseHandRow(row, heroSeat, blinds, tableSize, playerNotes);
      if (hand) hands.push(hand);
    }

    // Build player map from accumulated notes
    const players = {};
    players[String(heroSeat)] = { name: "Hero", description: "Our seat", is_hero: true };

    // Collect all position-seat mappings we've seen
    for (const hand of hands) {
      const posMap = hand._positionSeatMap || {};
      for (const [pos, seat] of Object.entries(posMap)) {
        if (playerNotes[pos] && !players[String(seat)]) {
          const note = playerNotes[pos];
          // Parse player notes like "Louis, F" or "Fish" or "TR" or "Leake, Fish" or "Amir, Fish"
          const parts = note.split(",").map(s => s.trim());
          const name = parts.length > 1 ? parts[0] : "Seat " + seat;
          const desc = parts.length > 1 ? parts.slice(1).join(", ") : parts[0];
          players[String(seat)] = { name, description: desc, is_hero: false };
        }
      }
    }

    // Clean up internal fields
    for (const hand of hands) {
      delete hand._positionSeatMap;
      delete hand._heroPosition;
    }

    return {
      version: 2,
      app: "session-replayer",
      session_name: sessionName,
      blinds,
      players,
      hand_count: hands.length,
      hands,
      flags: {
        has_unresolved_ambiguities: hands.some(h => h.warnings && h.warnings.length > 0),
        confirmed_by_user: false,
        parsed_with: "tabular_parser"
      }
    };
  }

  /**
   * Split text into individual hand rows, handling multiline action text.
   * Each hand starts with a number at line start.
   * Multiline data (within quotes) is merged into a single row.
   */
  function splitIntoHandRows(text) {
    const lines = text.split("\n");
    const rows = [];
    let current = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Does this line start a new hand? (begins with a number followed by whitespace)
      const handStart = /^\d+\s/.test(trimmed);

      if (handStart) {
        if (current !== null) rows.push(current);
        current = trimmed;
      } else if (current !== null) {
        // Continuation of previous hand (multiline action text)
        current += "\n" + trimmed;
      }
    }
    if (current !== null) rows.push(current);

    return rows;
  }

  /**
   * Parse a single hand row into structured hand data.
   */
  function parseHandRow(rowText, heroSeat, blinds, tableSize, playerNotes) {
    // Extract hand number from the start
    const numMatch = rowText.match(/^(\d+)/);
    if (!numMatch) return null;
    const handNum = parseInt(numMatch[1], 10);

    // Remove hand number from front
    let rest = rowText.slice(numMatch[0].length).trim();

    // Extract the fields. The format is:
    // TYPE    POSITION    CARDS    STACK    ACTION_TEXT
    // where ACTION_TEXT may be multiline and quoted

    // Step 1: Extract hand type
    const typeMatch = rest.match(
      /^(Fold|SRP\s+(?:IP|OOP)(?:\s+\([^)]*\))?|3BP\s+(?:IP|OOP)(?:\s+\([^)]*\))?|Limp(?:ed)?\s+Pot(?:\s+\([^)]*\))?|Limped\s+[Pp]ot|Walk)/i
    );
    if (!typeMatch) return null;
    const handType = typeMatch[1].trim();
    rest = rest.slice(typeMatch[0].length).trim();

    // Step 2: Extract hero position
    const posMatch = rest.match(/^([A-Z][A-Z0-9+]*)/i);
    if (!posMatch) return null;
    const heroPositionRaw = posMatch[1];
    const heroPosition = normalizePosition(heroPositionRaw);
    rest = rest.slice(posMatch[0].length).trim();

    // Step 3: Extract hero cards (two cards like "7h 3s")
    const cardsMatch = rest.match(/^([AKQJT2-9][shdc]\s+[AKQJT2-9][shdc])/i);
    let heroCards = [];
    if (cardsMatch) {
      heroCards = parseCards(cardsMatch[1]);
      rest = rest.slice(cardsMatch[0].length).trim();
    }

    // Step 4: Extract stack
    const stackMatch = rest.match(/^([$\d,]+|n\/a)/i);
    let stackSize = null;
    if (stackMatch) {
      stackSize = parseStack(stackMatch[1]);
      rest = rest.slice(stackMatch[0].length).trim();
    }

    // Step 5: Everything remaining is the action text
    const actionText = rest;

    // Determine button seat from hero's position
    // If hero is at seat `heroSeat` and plays position `heroPosition`,
    // we can derive where the button is.
    const buttonSeat = deriveButtonSeat(heroPosition, heroSeat, tableSize);
    const positionSeatMap = buildPositionSeatMap(buttonSeat);

    // Parse actions based on hand type
    const hand = {
      hand_id: handNum,
      hand_label: `Hand ${handNum}`,
      status: "confirmed",
      hero_seat: heroSeat,
      button_seat: buttonSeat,
      blinds: { ...blinds },
      stacks: {},
      hero_cards: heroCards,
      known_villain_cards: {},
      board: {},
      action_sequence: [],
      result: {},
      warnings: [],
      coach_flags: { starred: false, tag: handType },
      parse_confidence: 0.95,
      _positionSeatMap: positionSeatMap,
      _heroPosition: heroPosition
    };

    // Set stack if known
    if (stackSize !== null) {
      hand.stacks[String(heroSeat)] = stackSize;
    }

    // Check for straddle
    if (/straddle/i.test(handType) || /straddle\s+on/i.test(actionText)) {
      hand.blinds.straddle = blinds.big * 2;
    }

    // Check for blinds chopped
    if (/blinds\s+chopped/i.test(actionText)) {
      hand.action_sequence.push({
        street: "preflop",
        actions: [] // no actions — blinds chopped
      });
      hand.result = { notes: "Blinds chopped", showdown: false };
      hand.parse_confidence = 1.0;
      return hand;
    }

    // Parse based on hand type
    if (/^fold$/i.test(handType)) {
      // Simple fold hand
      const preflopActions = parsePreflopActions(actionText, heroPosition, positionSeatMap, playerNotes);

      // Always add hero fold
      const heroFolded = preflopActions.some(a => a.position === heroPosition && a.action === "fold");
      if (!heroFolded) {
        preflopActions.push({ position: heroPosition, action: "fold" });
      }

      hand.action_sequence.push({
        street: "preflop",
        actions: resolveActionsToSeats(preflopActions, positionSeatMap, heroSeat, heroPosition)
      });
      hand.result = { notes: "Hero folds preflop", showdown: false };
      hand.parse_confidence = 1.0;
    } else {
      // Played hand — parse full action text
      const { streets, board, result } = parseFullActionText(actionText, heroPosition, positionSeatMap, playerNotes);

      hand.board = board;

      for (const street of ["preflop", "flop", "turn", "river"]) {
        if (streets[street] && streets[street].length > 0) {
          hand.action_sequence.push({
            street,
            actions: resolveActionsToSeats(streets[street], positionSeatMap, heroSeat, heroPosition)
          });
        }
      }

      // Process result
      if (result) {
        const winnerPos = result.position;
        const winnerSeat = winnerPos === heroPosition ? heroSeat :
          (positionSeatMap[winnerPos] || null);

        if (result.outcome === "wins" || result.outcome === "mucks") {
          // If opponent "wins" or hero's opponent "mucks", determine winner
          if (result.outcome === "wins") {
            hand.result = {
              winner_seat: winnerSeat,
              showdown: true,
              notes: `${winnerPos} wins`
            };
            if (result.cards && result.cards.length >= 2 && winnerSeat) {
              hand.known_villain_cards[String(winnerSeat)] = result.cards.slice(0, 2);
            }
          } else {
            // "mucks" means the opponent lost and mucked
            hand.result = {
              winner_seat: heroSeat, // hero wins if opponent mucks
              showdown: false,
              notes: `${winnerPos} mucks`
            };
          }
        } else if (result.outcome === "loses") {
          // Opponent showed and lost — hero wins
          const loserSeat = positionSeatMap[winnerPos] || null;
          hand.result = {
            winner_seat: heroSeat,
            showdown: true,
            notes: `${winnerPos} loses`
          };
          if (result.cards && result.cards.length >= 2 && loserSeat) {
            hand.known_villain_cards[String(loserSeat)] = result.cards.slice(0, 2);
          }
        } else if (result.outcome === "chops") {
          const chopSeat = positionSeatMap[winnerPos] || null;
          hand.result = {
            showdown: true,
            notes: `Chops pot with ${winnerPos}`
          };
          if (result.cards && result.cards.length >= 2 && chopSeat) {
            hand.known_villain_cards[String(chopSeat)] = result.cards.slice(0, 2);
          }
        }
      } else {
        // No explicit result — determine from action sequence
        // The last person to bet/raise without being called wins, or it goes to showdown
        hand.result = inferResult(hand, positionSeatMap, heroSeat, heroPosition);
      }

      // Set pot if we can calculate it
      if (stackSize !== null && hand.result) {
        hand.result.pot = stackSize; // stack column often represents effective stack, not pot
      }
    }

    return hand;
  }

  /**
   * Derive button seat given hero's position and hero's seat.
   * If hero is in position X and seated at heroSeat,
   * button must be N seats before X in the position order.
   */
  function deriveButtonSeat(heroPosition, heroSeat, tableSize) {
    const posIndex = POSITIONS_9MAX.indexOf(heroPosition);
    if (posIndex < 0) return 1; // fallback

    // posIndex = 0 means hero is BTN (button seat = heroSeat)
    // posIndex = 1 means hero is SB (button seat = heroSeat - 1, wrapping)
    // posIndex = N means button seat = heroSeat - N, wrapping
    const btnSeat = ((heroSeat - 1 - posIndex + tableSize * 10) % tableSize) + 1;
    return btnSeat;
  }

  /**
   * Convert position-based actions to seat-based actions.
   */
  function resolveActionsToSeats(actions, positionSeatMap, heroSeat, heroPosition) {
    return actions.map(a => {
      let seat;
      let position = a.position;

      if (position === heroPosition || position === "HERO") {
        seat = heroSeat;
        position = heroPosition;
      } else if (position === "_UNKNOWN") {
        // Unknown position — can't resolve seat
        seat = 0;
        position = "?";
      } else {
        seat = positionSeatMap[position] || 0;
      }

      const resolved = {
        seat,
        position,
        action: a.action
      };
      if (a.amount !== undefined && a.amount !== null) {
        resolved.amount = a.amount;
      }
      return resolved;
    });
  }

  /**
   * Infer the result of a hand from the action sequence.
   */
  function inferResult(hand, positionSeatMap, heroSeat, heroPosition) {
    // Find the last street with actions
    const lastStreet = hand.action_sequence[hand.action_sequence.length - 1];
    if (!lastStreet || !lastStreet.actions.length) {
      return { notes: "Unknown result", showdown: false };
    }

    // Check if hero folded
    for (const street of hand.action_sequence) {
      for (const action of street.actions) {
        if (action.seat === heroSeat && action.action === "fold") {
          return { notes: "Hero folds", showdown: false };
        }
      }
    }

    // Check if the last action on the last street is a fold (opponent folded to hero)
    const lastAction = lastStreet.actions[lastStreet.actions.length - 1];
    if (lastAction && lastAction.action === "fold" && lastAction.seat !== heroSeat) {
      return { winner_seat: heroSeat, showdown: false, notes: "Hero wins — opponent folds" };
    }

    // Check if all non-hero actions on the final street ended in folds
    const lastStreetNonHeroActions = lastStreet.actions.filter(a => a.seat !== heroSeat && a.seat !== 0);
    const allFolded = lastStreetNonHeroActions.length > 0 &&
      lastStreetNonHeroActions.every(a => a.action === "fold");
    if (allFolded) {
      return { winner_seat: heroSeat, showdown: false, notes: "Hero wins — all opponents fold" };
    }

    // If we reached the river and no one folded, it went to showdown
    const reachedRiver = hand.action_sequence.some(s => s.street === "river");
    if (reachedRiver) {
      // If last action is hero's call or bet/raise that was called, showdown
      return { winner_seat: heroSeat, showdown: true, notes: "Hero wins at showdown" };
    }

    // Otherwise hero likely won without showdown
    return { winner_seat: heroSeat, showdown: false, notes: "Hero wins" };
  }

  // ---- Public API ----

  return {
    parse,
    isTabularFormat,
    // Exposed for testing
    _splitRow: splitRow,
    _parseCards: parseCards,
    _parsePreflopActions: parsePreflopActions,
    _parseFullActionText: parseFullActionText,
    _buildPositionSeatMap: buildPositionSeatMap,
    _deriveButtonSeat: deriveButtonSeat,
    _normalizePosition: normalizePosition,
    _splitIntoHandRows: splitIntoHandRows
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = TabularParser;
} else if (typeof window !== "undefined") {
  window.TabularParser = TabularParser;
}
