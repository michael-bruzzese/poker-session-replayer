// Shorthand Learner
// Learns a user's poker shorthand notation by comparing raw notes with parsed session JSON.
// Stores learned patterns in localStorage for future local parsing without LLM.
//
// Workflow:
// 1. User uploads raw shorthand notes + the correctly parsed JSON for the same session
// 2. System aligns hands and extracts notation patterns
// 3. Patterns stored as a "shorthand profile" in localStorage
// 4. Future raw shorthand uploads get parsed locally using the profile

const ShorthandLearner = (() => {
  "use strict";

  const STORAGE_KEY = "sessionReplayerShorthandProfiles";

  // ---- Default patterns (common poker shorthand) ----

  const DEFAULT_PATTERNS = {
    actions: {
      "f": "fold", "x": "check", "c": "call", "b": "bet",
      "r": "raise", "ai": "all-in", "jam": "all-in", "shove": "all-in",
      "limp": "call", "open": "raise", "3b": "raise", "3bet": "raise",
      "4b": "raise", "4bet": "raise", "cbet": "bet", "cb": "bet",
      "xr": "check-raise", "cr": "check-raise", "xc": "check-call",
      "xf": "check-fold"
    },
    positions: {
      "utg": "UTG", "utg1": "UTG+1", "utg+1": "UTG+1",
      "utg2": "UTG+2", "utg+2": "UTG+2",
      "lj": "LJ", "lo": "LJ", "lojack": "LJ",
      "hj": "HJ", "hijack": "HJ",
      "co": "CO", "cutoff": "CO", "cut": "CO",
      "btn": "BTN", "bu": "BTN", "button": "BTN", "otb": "BTN",
      "sb": "SB", "small": "SB",
      "bb": "BB", "big": "BB",
      "ep": "UTG", "ep1": "UTG", "ep2": "UTG+1", "ep3": "UTG+2",
      "mp": "LJ", "mp1": "LJ", "mp2": "HJ",
      "lp": "CO", "ip": "BTN"
    },
    ranks: {
      "a": "A", "ace": "A", "k": "K", "king": "K",
      "q": "Q", "queen": "Q", "j": "J", "jack": "J",
      "t": "T", "ten": "T", "10": "T",
      "9": "9", "8": "8", "7": "7", "6": "6",
      "5": "5", "4": "4", "3": "3", "2": "2"
    },
    suits: {
      "s": "s", "spade": "s", "spades": "s",
      "h": "h", "heart": "h", "hearts": "h",
      "d": "d", "diamond": "d", "diamonds": "d",
      "c": "c", "club": "c", "clubs": "c"
    },
    handDelimiters: [
      /hand\s*#?\s*\d+/i,
      /next\s+hand/i,
      /new\s+hand/i,
      /---+/,
      /\n\s*\n/
    ],
    streetMarkers: {
      "pre": "preflop", "preflop": "preflop", "pf": "preflop",
      "flop": "flop", "fl": "flop",
      "turn": "turn", "tn": "turn", "tr": "turn",
      "river": "river", "rv": "river", "ri": "river"
    },
    // User-specific patterns learned from alignment
    custom: {}
  };

  // ---- Profile Management ----

  function loadProfiles() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveProfiles(profiles) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch (e) { /* ignore */ }
  }

  function getProfile(name) {
    const profiles = loadProfiles();
    if (profiles[name]) {
      // Merge with defaults
      return mergePatterns(DEFAULT_PATTERNS, profiles[name]);
    }
    return { ...DEFAULT_PATTERNS };
  }

  function saveProfile(name, patterns) {
    const profiles = loadProfiles();
    profiles[name] = patterns;
    saveProfiles(profiles);
  }

  function listProfiles() {
    return Object.keys(loadProfiles());
  }

  function deleteProfile(name) {
    const profiles = loadProfiles();
    delete profiles[name];
    saveProfiles(profiles);
  }

  function mergePatterns(base, override) {
    const merged = {};
    for (const key of Object.keys(base)) {
      if (typeof base[key] === "object" && !Array.isArray(base[key])) {
        merged[key] = { ...base[key], ...(override[key] || {}) };
      } else if (Array.isArray(base[key])) {
        merged[key] = [...base[key], ...(override[key] || [])];
      } else {
        merged[key] = override[key] !== undefined ? override[key] : base[key];
      }
    }
    // Include any keys in override not in base
    for (const key of Object.keys(override)) {
      if (!(key in merged)) merged[key] = override[key];
    }
    return merged;
  }

  // ---- Learning: Align raw text with parsed JSON ----

  /**
   * Learn a user's shorthand by comparing raw notes with parsed session.
   * @param {string} rawText - The user's raw shorthand notes
   * @param {Object} parsedSession - The correctly parsed session JSON
   * @param {string} profileName - Name for this shorthand profile
   * @returns {Object} - Learned patterns and statistics
   */
  function learnFromAlignment(rawText, parsedSession, profileName) {
    const hands = parsedSession.hands || [];
    const learned = { actions: {}, positions: {}, cards: {}, custom: {} };
    let matchCount = 0;

    // Split raw text into hand chunks
    const rawChunks = splitIntoHandChunks(rawText);

    // Try to align each chunk with a parsed hand
    const alignments = [];
    for (let i = 0; i < Math.min(rawChunks.length, hands.length); i++) {
      const chunk = rawChunks[i];
      const hand = hands[i];
      const alignment = alignHandChunk(chunk, hand);
      alignments.push(alignment);
      matchCount += alignment.matches;

      // Extract learned patterns from this alignment
      for (const [shorthand, canonical] of alignment.actionMappings) {
        const key = shorthand.toLowerCase().trim();
        if (key && canonical && key !== canonical) {
          learned.actions[key] = canonical;
        }
      }
      for (const [shorthand, canonical] of alignment.positionMappings) {
        const key = shorthand.toLowerCase().trim();
        if (key && canonical && key !== canonical.toLowerCase()) {
          learned.positions[key] = canonical;
        }
      }
      for (const [shorthand, canonical] of alignment.cardMappings) {
        const key = shorthand.toLowerCase().trim();
        if (key && canonical) {
          learned.cards[key] = canonical;
        }
      }
    }

    // Save profile
    const profile = {
      actions: { ...DEFAULT_PATTERNS.actions, ...learned.actions },
      positions: { ...DEFAULT_PATTERNS.positions, ...learned.positions },
      custom: learned.custom,
      learnedAt: new Date().toISOString(),
      handsAligned: alignments.length,
      matchCount
    };

    saveProfile(profileName || "default", profile);

    return {
      profileName: profileName || "default",
      handsAligned: alignments.length,
      totalHands: hands.length,
      rawChunks: rawChunks.length,
      matchCount,
      learnedActions: Object.keys(learned.actions).length,
      learnedPositions: Object.keys(learned.positions).length,
      patterns: profile
    };
  }

  // ---- Split raw text into hand-sized chunks ----

  function splitIntoHandChunks(text) {
    // Try multiple delimiter patterns
    const delimiters = [
      /(?=hand\s*#?\s*\d+)/gi,
      /(?=next\s+hand)/gi,
      /(?=new\s+hand)/gi,
      /\n\s*\n/
    ];

    for (const delim of delimiters) {
      const chunks = text.split(delim).map(s => s.trim()).filter(s => s.length > 5);
      if (chunks.length > 1) return chunks;
    }

    // Fallback: treat whole text as one chunk
    return [text.trim()];
  }

  // ---- Align a single chunk with a parsed hand ----

  function alignHandChunk(chunk, hand) {
    const result = {
      matches: 0,
      actionMappings: [],
      positionMappings: [],
      cardMappings: []
    };

    const chunkLower = chunk.toLowerCase();

    // Try to find hero cards mentioned in the chunk
    if (hand.hero_cards && hand.hero_cards.length === 2) {
      for (const card of hand.hero_cards) {
        const rank = card[0];
        const suit = card[1];
        // Look for various representations of this card
        const patterns = cardSearchPatterns(rank, suit);
        for (const pat of patterns) {
          if (chunkLower.includes(pat.toLowerCase())) {
            result.cardMappings.push([pat, card]);
            result.matches++;
            break;
          }
        }
      }
    }

    // Try to find board cards
    const board = hand.board || {};
    const allBoard = [...(board.flop || []), board.turn, board.river].filter(Boolean);
    for (const card of allBoard) {
      const rank = card[0];
      const suit = card[1];
      const patterns = cardSearchPatterns(rank, suit);
      for (const pat of patterns) {
        if (chunkLower.includes(pat.toLowerCase())) {
          result.cardMappings.push([pat, card]);
          result.matches++;
          break;
        }
      }
    }

    // Try to find action words
    const allActions = (hand.action_sequence || []).flatMap(s => s.actions || []);
    const actionWords = extractWords(chunk);

    for (const action of allActions) {
      const canonical = action.action;
      // Look for words in the chunk that might map to this action
      for (const word of actionWords) {
        const wordLower = word.toLowerCase();
        if (wordLower === canonical) continue; // exact match, nothing to learn
        // Check if this word could be a shorthand for the action
        if (isLikelyActionShorthand(wordLower, canonical)) {
          result.actionMappings.push([wordLower, canonical]);
          result.matches++;
        }
      }

      // Check position mappings
      if (action.position) {
        for (const word of actionWords) {
          const wordLower = word.toLowerCase();
          if (isLikelyPositionShorthand(wordLower, action.position)) {
            result.positionMappings.push([wordLower, action.position]);
            result.matches++;
          }
        }
      }
    }

    return result;
  }

  function cardSearchPatterns(rank, suit) {
    const rankNames = { A: ["a", "ace"], K: ["k", "king"], Q: ["q", "queen"],
      J: ["j", "jack"], T: ["t", "ten", "10"] };
    const suitNames = { s: ["s", "spade", "spades"], h: ["h", "heart", "hearts"],
      d: ["d", "diamond", "diamonds"], c: ["c", "club", "clubs"] };

    const ranks = rankNames[rank] || [rank.toLowerCase()];
    const suits = suitNames[suit] || [suit.toLowerCase()];
    const patterns = [];

    for (const r of ranks) {
      for (const s of suits) {
        patterns.push(r + s);
        patterns.push(r + " of " + s);
        patterns.push(r + " " + s);
      }
    }
    return patterns;
  }

  function extractWords(text) {
    return text.match(/[a-zA-Z0-9+]+/g) || [];
  }

  function isLikelyActionShorthand(word, canonical) {
    // Check if word starts with first letter(s) of the action
    if (word.length < 1 || word.length > 8) return false;
    const c = canonical.toLowerCase();
    if (word === c) return false;
    // Common shorthand patterns
    if (c === "fold" && (word === "f" || word === "muck")) return true;
    if (c === "check" && (word === "x" || word === "chk")) return true;
    if (c === "call" && (word === "c" || word === "flat")) return true;
    if (c === "bet" && (word === "b" || word === "lead")) return true;
    if (c === "raise" && (word === "r" || word === "bump" || word === "pop" || word.startsWith("3b") || word.startsWith("4b"))) return true;
    if (c === "all-in" && (word === "ai" || word === "jam" || word === "shove" || word === "ship")) return true;
    return false;
  }

  function isLikelyPositionShorthand(word, position) {
    const pos = position.toLowerCase();
    if (word === pos) return false;
    const map = DEFAULT_PATTERNS.positions;
    return map[word] === position;
  }

  // ---- Local Parsing Using Profile ----

  /**
   * Parse raw shorthand text using a learned profile.
   * Returns partially structured hands (best effort, may need review).
   * @param {string} rawText
   * @param {string} profileName
   * @param {Object} opts - { blinds, heroSeat }
   * @returns {Object} - Session-like object with parsed hands
   */
  function parseWithProfile(rawText, profileName, opts) {
    const profile = getProfile(profileName || "default");
    const chunks = splitIntoHandChunks(rawText);
    const hands = [];
    const o = opts || {};

    chunks.forEach((chunk, idx) => {
      const hand = parseHandChunk(chunk, profile, idx + 1, o);
      if (hand) hands.push(hand);
    });

    return {
      version: 2,
      app: "session-replayer",
      session_name: o.sessionName || "Shorthand Parsed Session",
      blinds: o.blinds || { small: 2, big: 5 },
      players: {},
      hand_count: hands.length,
      hands,
      flags: {
        has_unresolved_ambiguities: hands.some(h => h.warnings && h.warnings.length),
        confirmed_by_user: false,
        parsed_with_profile: profileName || "default"
      }
    };
  }

  function parseHandChunk(chunk, profile, handNum, opts) {
    const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    const hand = {
      hand_id: handNum,
      hand_label: `Hand ${handNum}`,
      status: "needs_review",
      hero_seat: opts.heroSeat || 1,
      button_seat: 1,
      blinds: opts.blinds || { small: 2, big: 5 },
      stacks: {},
      hero_cards: [],
      known_villain_cards: {},
      board: {},
      action_sequence: [],
      result: {},
      warnings: [],
      parse_confidence: 0.5
    };

    // Extract cards (look for 2-char card codes)
    const cardRegex = /\b([AKQJT2-9][shdc])\b/gi;
    const allCards = [];
    let m;
    while ((m = cardRegex.exec(chunk)) !== null) {
      allCards.push(m[1][0].toUpperCase() + m[1][1].toLowerCase());
    }

    // First two cards are likely hero's
    if (allCards.length >= 2) {
      hand.hero_cards = allCards.slice(0, 2);
    } else {
      hand.warnings.push("Could not find hero cards");
    }

    // Next 3 cards = flop, next = turn, next = river
    if (allCards.length >= 5) {
      hand.board.flop = allCards.slice(2, 5);
    }
    if (allCards.length >= 6) {
      hand.board.turn = allCards[5];
    }
    if (allCards.length >= 7) {
      hand.board.river = allCards[6];
    }

    // Try to extract actions using profile
    const actionPatterns = { ...DEFAULT_PATTERNS.actions, ...(profile.actions || {}) };
    const posPatterns = { ...DEFAULT_PATTERNS.positions, ...(profile.positions || {}) };

    // Look for action sequences: "position action amount"
    const actionLineRegex = /\b(\w+)\s+(f|x|c|b|r|fold|check|call|bet|raise|ai|all-?in|jam|shove|limp|open|3bet?|4bet?|cbet?|cb|xr|xc|xf|cr)\s*(\d*)\b/gi;
    const streetActions = { preflop: [], flop: [], turn: [], river: [] };
    let currentStreet = "preflop";

    // Check for street markers
    const streetPatterns = { ...DEFAULT_PATTERNS.streetMarkers, ...(profile.streetMarkers || {}) };

    for (const line of lines) {
      const lineLower = line.toLowerCase();

      // Check for street marker
      for (const [marker, street] of Object.entries(streetPatterns)) {
        if (lineLower.startsWith(marker + ":") || lineLower.startsWith(marker + " ") || lineLower === marker) {
          currentStreet = street;
          break;
        }
      }

      // Extract actions from this line
      let actionMatch;
      const lineActionRegex = /\b(\w+)\s+(f|x|c|b|r|fold|check|call|bet|raise|ai|all-?in|jam|shove|limp|open)\s*(\d*)\b/gi;
      while ((actionMatch = lineActionRegex.exec(line)) !== null) {
        const posWord = actionMatch[1].toLowerCase();
        const actWord = actionMatch[2].toLowerCase();
        const amount = actionMatch[3] ? parseInt(actionMatch[3]) : undefined;

        const position = posPatterns[posWord] || posWord.toUpperCase();
        const action = actionPatterns[actWord] || actWord;

        const entry = { seat: 0, position, action };
        if (amount) entry.amount = amount;
        streetActions[currentStreet].push(entry);
      }
    }

    // Build action sequence
    for (const [street, actions] of Object.entries(streetActions)) {
      if (actions.length > 0) {
        hand.action_sequence.push({ street, actions });
      }
    }

    if (!hand.action_sequence.length) {
      hand.warnings.push("Could not extract any actions");
    }

    return hand;
  }

  // ---- Public API ----

  return {
    DEFAULT_PATTERNS,
    loadProfiles,
    getProfile,
    saveProfile,
    listProfiles,
    deleteProfile,
    learnFromAlignment,
    splitIntoHandChunks,
    parseWithProfile
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ShorthandLearner;
if (typeof window !== "undefined") window.ShorthandLearner = ShorthandLearner;
