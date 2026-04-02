// Shorthand Learner v2
// Learns a user's poker shorthand notation by comparing raw notes with parsed session JSON.
// Stores learned patterns in localStorage for future local parsing without LLM.
//
// Key improvements over v1:
// - Smart hand alignment by card overlap, not just index
// - Flexible natural language parsing ("UTG opens 15, I 3b to 45, he flats")
// - Compound actions (check-raise, limp-call)
// - Player nickname tracking ("the fish", "old guy")
// - Amount extraction from context ("raises to 45", "bets half pot", "makes it 120")
// - Correction feedback loop

const ShorthandLearner = (() => {
  "use strict";

  const STORAGE_KEY = "sessionReplayerShorthandProfiles";

  // ---- Default patterns ----

  const DEFAULT_PATTERNS = {
    actions: {
      // Single-char
      "f": "fold", "x": "check", "c": "call", "b": "bet", "r": "raise",
      // Short words
      "fold": "fold", "folds": "fold", "folded": "fold", "muck": "fold", "mucked": "fold",
      "check": "check", "checks": "check", "checked": "check", "chk": "check",
      "call": "call", "calls": "call", "called": "call", "flat": "call", "flats": "call", "flatted": "call",
      "bet": "bet", "bets": "bet", "lead": "bet", "leads": "bet", "led": "bet",
      "donk": "bet", "donks": "bet", "donked": "bet",
      "raise": "raise", "raises": "raise", "raised": "raise", "bump": "raise", "bumps": "raise",
      "pop": "raise", "pops": "raise", "popped": "raise",
      "open": "raise", "opens": "raise", "opened": "raise",
      "limp": "call", "limps": "call", "limped": "call",
      // Multi-word / compound
      "3b": "raise", "3bet": "raise", "3bets": "raise", "3-bet": "raise", "3-bets": "raise",
      "three-bet": "raise", "three-bets": "raise", "threebet": "raise",
      "4b": "raise", "4bet": "raise", "4bets": "raise", "4-bet": "raise", "4-bets": "raise",
      "four-bet": "raise", "four-bets": "raise",
      "cbet": "bet", "c-bet": "bet", "c-bets": "bet", "cbets": "bet",
      "cb": "bet", "continuation": "bet",
      "ai": "all-in", "allin": "all-in", "all-in": "all-in",
      "jam": "all-in", "jams": "all-in", "jammed": "all-in",
      "shove": "all-in", "shoves": "all-in", "shoved": "all-in",
      "ship": "all-in", "ships": "all-in", "shipped": "all-in",
      "rip": "all-in", "rips": "all-in", "ripped": "all-in"
    },
    // Compound actions: these expand into 2 actions
    compoundActions: {
      "xr": ["check", "raise"], "cr": ["check", "raise"],
      "check-raise": ["check", "raise"], "checkraise": ["check", "raise"],
      "check-raises": ["check", "raise"], "check-raised": ["check", "raise"],
      "xc": ["check", "call"], "check-call": ["check", "call"],
      "check-calls": ["check", "call"], "check-called": ["check", "call"],
      "xf": ["check", "fold"], "check-fold": ["check", "fold"],
      "check-folds": ["check", "fold"], "check-folded": ["check", "fold"],
      "limp-call": ["call", "call"], "limp-fold": ["call", "fold"],
      "limp-raise": ["call", "raise"], "limp-reraise": ["call", "raise"]
    },
    positions: {
      "utg": "UTG", "utg1": "UTG+1", "utg+1": "UTG+1", "under the gun": "UTG",
      "utg2": "UTG+2", "utg+2": "UTG+2", "under-the-gun": "UTG",
      "lj": "LJ", "lo": "LJ", "lojack": "LJ", "lowjack": "LJ",
      "hj": "HJ", "hijack": "HJ", "hi-jack": "HJ",
      "co": "CO", "cutoff": "CO", "cut-off": "CO", "cut": "CO",
      "btn": "BTN", "bu": "BTN", "button": "BTN", "otb": "BTN", "dealer": "BTN",
      "sb": "SB", "small blind": "SB", "small": "SB",
      "bb": "BB", "big blind": "BB", "big": "BB",
      "ep": "UTG", "ep1": "UTG", "ep2": "UTG+1", "ep3": "UTG+2",
      "early position": "UTG", "early": "UTG",
      "mp": "LJ", "mp1": "LJ", "mp2": "HJ", "middle position": "LJ", "middle": "LJ",
      "lp": "CO", "late position": "CO", "late": "CO",
      "ip": "BTN", "oop": "BB"
    },
    // Hero references — words that mean "me/hero"
    heroAliases: new Set([
      "i", "me", "my", "hero", "we", "our", "myself", "i'm", "im"
    ]),
    // Villain references — generic opponent
    villainAliases: {
      "v": "villain", "villain": "villain", "villian": "villain",
      "opp": "villain", "opponent": "villain",
      "he": "villain", "she": "villain", "they": "villain",
      "him": "villain", "her": "villain", "them": "villain",
      "guy": "villain", "dude": "villain", "player": "villain"
    },
    ranks: {
      "a": "A", "ace": "A", "aces": "A", "k": "K", "king": "K", "kings": "K",
      "q": "Q", "queen": "Q", "queens": "Q", "j": "J", "jack": "J", "jacks": "J",
      "t": "T", "ten": "T", "tens": "T", "10": "T",
      "9": "9", "nines": "9", "nine": "9", "8": "8", "eights": "8", "eight": "8",
      "7": "7", "sevens": "7", "seven": "7", "6": "6", "sixes": "6", "six": "6",
      "5": "5", "fives": "5", "five": "5", "4": "4", "fours": "4", "four": "4",
      "3": "3", "threes": "3", "three": "3", "2": "2", "twos": "2", "two": "2", "deuces": "2", "deuce": "2"
    },
    suits: {
      "s": "s", "spade": "s", "spades": "s", "♠": "s",
      "h": "h", "heart": "h", "hearts": "h", "♥": "h",
      "d": "d", "diamond": "d", "diamonds": "d", "♦": "d",
      "c": "c", "club": "c", "clubs": "c", "♣": "c"
    },
    // Hand name shortcuts
    handNames: {
      "pocket aces": ["A", "A"], "aces": ["A", "A"], "rockets": ["A", "A"], "bullets": ["A", "A"],
      "pocket kings": ["K", "K"], "kings": ["K", "K"], "cowboys": ["K", "K"],
      "pocket queens": ["Q", "Q"], "queens": ["Q", "Q"], "ladies": ["Q", "Q"],
      "pocket jacks": ["J", "J"], "jacks": ["J", "J"], "hooks": ["J", "J"], "fishhooks": ["J", "J"],
      "pocket tens": ["T", "T"], "tens": ["T", "T"], "dimes": ["T", "T"],
      "big slick": ["A", "K"], "ak": ["A", "K"], "anna kournikova": ["A", "K"],
      "big chick": ["A", "Q"], "aq": ["A", "Q"],
      "ace jack": ["A", "J"], "aj": ["A", "J"], "blackjack": ["A", "J"],
      "king queen": ["K", "Q"], "kq": ["K", "Q"],
      "pocket nines": ["9", "9"], "nines": ["9", "9"],
      "pocket eights": ["8", "8"], "eights": ["8", "8"], "snowmen": ["8", "8"],
      "pocket sevens": ["7", "7"], "sevens": ["7", "7"],
      "pocket sixes": ["6", "6"], "sixes": ["6", "6"],
      "pocket fives": ["5", "5"], "fives": ["5", "5"],
      "pocket fours": ["4", "4"], "fours": ["4", "4"],
      "pocket threes": ["3", "3"], "threes": ["3", "3"],
      "pocket twos": ["2", "2"], "twos": ["2", "2"], "ducks": ["2", "2"], "deuces": ["2", "2"]
    },
    streetMarkers: {
      "pre": "preflop", "preflop": "preflop", "pf": "preflop", "pre-flop": "preflop",
      "flop": "flop", "fl": "flop", "the flop": "flop", "flop comes": "flop",
      "flop is": "flop", "flop was": "flop",
      "turn": "turn", "tn": "turn", "tr": "turn", "the turn": "turn",
      "turn is": "turn", "turn was": "turn", "turn comes": "turn",
      "river": "river", "rv": "river", "ri": "river", "the river": "river",
      "river is": "river", "river was": "river", "river comes": "river"
    },
    // Learned player nicknames: { "the fish": 3, "old guy": 7 }
    playerNicknames: {},
    // User corrections from review
    corrections: {}
  };

  // ---- Amount Extraction ----

  /**
   * Extract a bet/raise amount from text near an action word.
   * Handles: "raises to 45", "bets 30", "makes it 120", "opens for 15",
   *          "puts in 50", "r45", "b30", "3b to 90"
   */
  function extractAmount(text, actionIdx) {
    // Look in a window around the action word
    const window = text.substring(Math.max(0, actionIdx - 10), actionIdx + 60);

    // Pattern: number immediately after action letter/word ("r45", "b30")
    const immediateNum = window.match(/[rbcx]\s*(\d+)/i);
    if (immediateNum) return parseInt(immediateNum[1]);

    // Pattern: "to X", "for X", "makes it X", "puts in X", "it X"
    const toAmount = window.match(/(?:to|for|it|in)\s+\$?(\d+)/i);
    if (toAmount) return parseInt(toAmount[1]);

    // Pattern: just a number following the action
    const trailingNum = window.match(/(?:raise|bet|call|open|3bet?|4bet?)\w*\s+\$?(\d+)/i);
    if (trailingNum) return parseInt(trailingNum[1]);

    // Pattern: "$X" or "X dollars"
    const dollarAmount = window.match(/\$(\d+)/);
    if (dollarAmount) return parseInt(dollarAmount[1]);

    return 0;
  }

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
      return mergePatterns(DEFAULT_PATTERNS, profiles[name]);
    }
    return JSON.parse(JSON.stringify(DEFAULT_PATTERNS));
  }

  function saveProfile(name, patterns) {
    const profiles = loadProfiles();
    profiles[name] = patterns;
    saveProfiles(profiles);
  }

  function listProfiles() { return Object.keys(loadProfiles()); }

  function deleteProfile(name) {
    const profiles = loadProfiles();
    delete profiles[name];
    saveProfiles(profiles);
  }

  function mergePatterns(base, override) {
    const merged = {};
    for (const key of Object.keys(base)) {
      if (key === "heroAliases") {
        merged[key] = new Set([...(base[key] || []), ...(override[key] || [])]);
      } else if (typeof base[key] === "object" && !Array.isArray(base[key]) && !(base[key] instanceof Set)) {
        merged[key] = { ...base[key], ...(override[key] || {}) };
      } else if (Array.isArray(base[key])) {
        merged[key] = [...base[key], ...(override[key] || [])];
      } else {
        merged[key] = override[key] !== undefined ? override[key] : base[key];
      }
    }
    for (const key of Object.keys(override)) {
      if (!(key in merged)) merged[key] = override[key];
    }
    return merged;
  }

  // ---- Smart Hand Alignment ----

  /**
   * Align raw text chunks to parsed hands by card overlap (not just index).
   * Returns an array of { chunkIdx, handIdx, score } sorted by best match.
   */
  function alignByCardOverlap(rawChunks, parsedHands) {
    const alignments = [];

    for (let ci = 0; ci < rawChunks.length; ci++) {
      const chunkCards = extractAllCards(rawChunks[ci]);
      let bestHandIdx = -1;
      let bestScore = 0;

      for (let hi = 0; hi < parsedHands.length; hi++) {
        const hand = parsedHands[hi];
        const handCards = new Set([
          ...(hand.hero_cards || []).map(c => c.toUpperCase()),
          ...((hand.board || {}).flop || []).map(c => c.toUpperCase()),
          (hand.board || {}).turn ? (hand.board.turn).toUpperCase() : "",
          (hand.board || {}).river ? (hand.board.river).toUpperCase() : ""
        ].filter(Boolean));

        let score = 0;
        for (const card of chunkCards) {
          if (handCards.has(card.toUpperCase())) score++;
        }

        // Bonus for index proximity (slight preference for sequential matching)
        if (ci === hi) score += 0.5;
        if (Math.abs(ci - hi) <= 2) score += 0.2;

        if (score > bestScore) {
          bestScore = score;
          bestHandIdx = hi;
        }
      }

      alignments.push({ chunkIdx: ci, handIdx: bestHandIdx, score: bestScore });
    }

    return alignments;
  }

  function extractAllCards(text) {
    const cards = [];
    // Standard 2-char codes: Ah, Ks, Td, 9c
    const codeRegex = /\b([AKQJT2-9][shdc])\b/gi;
    let m;
    while ((m = codeRegex.exec(text)) !== null) {
      cards.push(m[1][0].toUpperCase() + m[1][1].toLowerCase());
    }
    return cards;
  }

  // ---- Learning ----

  function learnFromAlignment(rawText, parsedSession, profileName) {
    const hands = parsedSession.hands || [];
    const learned = { actions: {}, positions: {}, playerNicknames: {}, corrections: {} };
    let matchCount = 0;

    const rawChunks = splitIntoHandChunks(rawText);
    const alignments = alignByCardOverlap(rawChunks, hands);

    for (const alignment of alignments) {
      if (alignment.handIdx < 0 || alignment.score < 1) continue;
      const chunk = rawChunks[alignment.chunkIdx];
      const hand = hands[alignment.handIdx];
      const result = alignHandChunk(chunk, hand);
      matchCount += result.matches;

      for (const [shorthand, canonical] of result.actionMappings) {
        const key = shorthand.toLowerCase().trim();
        if (key && canonical && key !== canonical) learned.actions[key] = canonical;
      }
      for (const [shorthand, canonical] of result.positionMappings) {
        const key = shorthand.toLowerCase().trim();
        if (key && canonical) learned.positions[key] = canonical;
      }
      for (const [nickname, seat] of result.playerMappings) {
        learned.playerNicknames[nickname.toLowerCase()] = seat;
      }
    }

    const profile = {
      actions: { ...DEFAULT_PATTERNS.actions, ...learned.actions },
      positions: { ...DEFAULT_PATTERNS.positions, ...learned.positions },
      playerNicknames: learned.playerNicknames,
      corrections: learned.corrections,
      learnedAt: new Date().toISOString(),
      handsAligned: alignments.filter(a => a.score >= 1).length,
      matchCount
    };

    saveProfile(profileName || "default", profile);

    return {
      profileName: profileName || "default",
      handsAligned: profile.handsAligned,
      totalHands: hands.length,
      rawChunks: rawChunks.length,
      matchCount,
      learnedActions: Object.keys(learned.actions).length,
      learnedPositions: Object.keys(learned.positions).length,
      learnedNicknames: Object.keys(learned.playerNicknames).length,
      patterns: profile
    };
  }

  // ---- Correction Feedback ----

  /**
   * Learn from user corrections made in the Review screen.
   * @param {string} profileName
   * @param {Object} originalHand - the hand as parsed
   * @param {Object} correctedHand - the hand after user edits
   */
  function learnFromCorrection(profileName, originalHand, correctedHand) {
    const profiles = loadProfiles();
    const profile = profiles[profileName || "default"] || {};
    if (!profile.corrections) profile.corrections = {};

    // Learn card corrections
    if (JSON.stringify(originalHand.hero_cards) !== JSON.stringify(correctedHand.hero_cards)) {
      profile.corrections["hero_cards_" + originalHand.hand_id] = {
        from: originalHand.hero_cards,
        to: correctedHand.hero_cards
      };
    }

    // Learn action corrections
    const origActions = (originalHand.action_sequence || []).flatMap(s => s.actions || []);
    const corrActions = (correctedHand.action_sequence || []).flatMap(s => s.actions || []);
    for (let i = 0; i < Math.min(origActions.length, corrActions.length); i++) {
      if (origActions[i].action !== corrActions[i].action) {
        // User corrected an action — if we can find the source shorthand, learn it
        const oldAct = origActions[i].action;
        const newAct = corrActions[i].action;
        // Store the correction pattern
        if (!profile.actionCorrections) profile.actionCorrections = {};
        profile.actionCorrections[oldAct + "_to_" + newAct] =
          (profile.actionCorrections[oldAct + "_to_" + newAct] || 0) + 1;
      }
    }

    profiles[profileName || "default"] = profile;
    saveProfiles(profiles);
  }

  // ---- Hand Chunk Splitting ----

  function splitIntoHandChunks(text) {
    // Try progressively looser delimiters
    const delimPatterns = [
      /(?=\bhand\s*#?\s*\d+\b)/gi,
      /(?=\bnext\s+hand\b)/gi,
      /(?=\bnew\s+hand\b)/gi,
      /(?=\bhand\s*:)/gi,
      /(?=\bh\d+\b)/gi,  // h1, h2, h3
    ];

    for (const delim of delimPatterns) {
      const chunks = text.split(delim).map(s => s.trim()).filter(s => s.length > 3);
      if (chunks.length > 1) return chunks;
    }

    // Try double-newline
    const nlChunks = text.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 3);
    if (nlChunks.length > 1) return nlChunks;

    // Try single newline if each line looks like a hand (has card codes)
    const lines = text.split("\n").map(s => s.trim()).filter(s => s.length > 3);
    const cardLines = lines.filter(l => /[AKQJT2-9][shdc]/i.test(l));
    if (cardLines.length > 1 && cardLines.length === lines.length) return cardLines;

    return [text.trim()];
  }

  // ---- Align Single Chunk ----

  function alignHandChunk(chunk, hand) {
    const result = {
      matches: 0,
      actionMappings: [],
      positionMappings: [],
      cardMappings: [],
      playerMappings: []
    };

    const chunkLower = chunk.toLowerCase();

    // Card matching
    const allHandCards = [
      ...(hand.hero_cards || []),
      ...((hand.board || {}).flop || []),
      (hand.board || {}).turn,
      (hand.board || {}).river
    ].filter(Boolean);

    for (const card of allHandCards) {
      const pats = cardSearchPatterns(card[0], card[1]);
      for (const pat of pats) {
        if (chunkLower.includes(pat.toLowerCase())) {
          result.cardMappings.push([pat, card]);
          result.matches++;
          break;
        }
      }
    }

    // Action matching
    const allActions = (hand.action_sequence || []).flatMap(s => s.actions || []);
    const words = chunk.match(/[a-zA-Z0-9'_+-]+/g) || [];

    for (const action of allActions) {
      for (const word of words) {
        const w = word.toLowerCase();
        if (w === action.action) continue;
        if (isLikelyActionShorthand(w, action.action)) {
          result.actionMappings.push([w, action.action]);
          result.matches++;
        }
      }
      if (action.position) {
        for (const word of words) {
          const w = word.toLowerCase();
          if (DEFAULT_PATTERNS.positions[w] === action.position) {
            result.positionMappings.push([w, action.position]);
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

  function isLikelyActionShorthand(word, canonical) {
    if (word.length < 1 || word.length > 12) return false;
    if (word === canonical.toLowerCase()) return false;
    return DEFAULT_PATTERNS.actions[word] === canonical ||
           DEFAULT_PATTERNS.compoundActions[word] !== undefined;
  }

  // ---- Flexible Local Parser ----

  function parseWithProfile(rawText, profileName, opts) {
    const profile = getProfile(profileName || "default");
    const chunks = splitIntoHandChunks(rawText);
    const hands = [];
    const o = opts || {};

    // Track player references across hands for consistency
    const playerTracker = {
      heroSeat: o.heroSeat || 1,
      knownPlayers: { ...(profile.playerNicknames || {}) },
      lastVillainSeat: 0
    };

    chunks.forEach((chunk, idx) => {
      const hand = parseHandChunk(chunk, profile, idx + 1, o, playerTracker);
      if (hand) hands.push(hand);
    });

    return {
      version: 2,
      app: "session-replayer",
      session_name: o.sessionName || "Shorthand Parsed Session",
      blinds: o.blinds || { small: 2, big: 5 },
      players: buildPlayerMap(playerTracker, opts),
      hand_count: hands.length,
      hands,
      flags: {
        has_unresolved_ambiguities: hands.some(h => h.warnings && h.warnings.length),
        confirmed_by_user: false,
        parsed_with_profile: profileName || "default"
      }
    };
  }

  function buildPlayerMap(tracker, opts) {
    const players = {};
    players[tracker.heroSeat] = { name: "Hero", description: "Our seat", is_hero: true };
    for (const [nickname, seat] of Object.entries(tracker.knownPlayers)) {
      if (!players[seat]) players[seat] = { name: nickname, description: "" };
    }
    return players;
  }

  function parseHandChunk(chunk, profile, handNum, opts, playerTracker) {
    const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    const bb = (opts.blinds || { big: 5 }).big;
    const hand = {
      hand_id: handNum,
      hand_label: `Hand ${handNum}`,
      status: "needs_review",
      hero_seat: playerTracker.heroSeat,
      button_seat: 1,
      blinds: opts.blinds || { small: 2, big: 5 },
      stacks: {},
      hero_cards: [],
      known_villain_cards: {},
      board: {},
      action_sequence: [],
      result: {},
      warnings: [],
      parse_confidence: 0.3
    };

    const fullText = chunk;
    const fullLower = fullText.toLowerCase();

    // ---- Extract hero position / button ----
    const heroPos = extractHeroPosition(fullLower, profile);
    if (heroPos) {
      hand._heroPosition = heroPos;
      hand.parse_confidence += 0.1;
    }

    // ---- Extract cards ----
    const extractedCards = extractCardsFlexible(fullText, profile);
    if (extractedCards.hero.length >= 2) {
      hand.hero_cards = extractedCards.hero.slice(0, 2);
      hand.parse_confidence += 0.2;
    } else {
      hand.warnings.push("Could not identify hero cards");
    }

    if (extractedCards.flop.length >= 3) hand.board.flop = extractedCards.flop.slice(0, 3);
    if (extractedCards.turn) hand.board.turn = extractedCards.turn;
    if (extractedCards.river) hand.board.river = extractedCards.river;

    // ---- Extract actions ----
    const streetActions = extractActions(fullText, profile, playerTracker, bb);
    for (const [street, actions] of Object.entries(streetActions)) {
      if (actions.length > 0) {
        hand.action_sequence.push({ street, actions });
        hand.parse_confidence += 0.05;
      }
    }

    if (!hand.action_sequence.length) {
      // Check if this is just a preflop fold
      if (fullLower.includes("fold") || /\bf\b/.test(fullLower)) {
        hand.action_sequence.push({
          street: "preflop",
          actions: [{ seat: playerTracker.heroSeat, position: heroPos || "?", action: "fold" }]
        });
        hand.result = { notes: "Hero folds preflop" };
      } else {
        hand.warnings.push("Could not extract any actions");
      }
    }

    hand.parse_confidence = Math.min(1.0, Math.round(hand.parse_confidence * 100) / 100);
    return hand;
  }

  // ---- Flexible Card Extraction ----

  function extractCardsFlexible(text, profile) {
    const result = { hero: [], flop: [], turn: null, river: null, all: [] };
    const ranks = { ...DEFAULT_PATTERNS.ranks, ...(profile.ranks || {}) };
    const suits = { ...DEFAULT_PATTERNS.suits, ...(profile.suits || {}) };
    const handNames = { ...DEFAULT_PATTERNS.handNames, ...(profile.handNames || {}) };
    const lower = text.toLowerCase();

    // Check for hand name shortcuts first ("pocket aces", "big slick", "AK suited")
    for (const [name, rankPair] of Object.entries(handNames)) {
      if (lower.includes(name)) {
        // Assign default suits if needed
        const suited = lower.includes("suited") || lower.includes("suit");
        if (rankPair[0] === rankPair[1]) {
          // Pocket pair — assign different suits
          result.hero = [rankPair[0] + "s", rankPair[1] + "h"];
        } else if (suited) {
          result.hero = [rankPair[0] + "s", rankPair[1] + "s"];
        } else {
          result.hero = [rankPair[0] + "h", rankPair[1] + "d"];
        }
        break;
      }
    }

    // Standard card codes: Ah, Ks, Td, 9c
    const codeRegex = /\b([AKQJT2-9])([shdc])\b/gi;
    let m;
    const codedCards = [];
    while ((m = codeRegex.exec(text)) !== null) {
      codedCards.push(m[1].toUpperCase() + m[2].toLowerCase());
    }

    // Natural language cards: "ace of spades", "king hearts", "ten of diamonds"
    const nlCardRegex = /\b(ace|king|queen|jack|ten|nine|eight|seven|six|five|four|three|two|deuce)\s+(?:of\s+)?(spades?|hearts?|diamonds?|clubs?)\b/gi;
    while ((m = nlCardRegex.exec(text)) !== null) {
      const rank = ranks[m[1].toLowerCase()];
      const suit = suits[m[2].toLowerCase()];
      if (rank && suit) codedCards.push(rank + suit);
    }

    result.all = codedCards;

    // If we didn't get hero cards from hand names, use first 2 coded cards
    if (!result.hero.length && codedCards.length >= 2) {
      result.hero = codedCards.slice(0, 2);
    }

    // Find board cards by street markers
    const flopIdx = lower.search(/\bflop\b/);
    const turnIdx = lower.search(/\bturn\b/);
    const riverIdx = lower.search(/\briver\b/);

    if (flopIdx >= 0) {
      // Cards after "flop" marker
      const afterFlop = text.substring(flopIdx);
      const flopCards = [];
      const flopRegex = /\b([AKQJT2-9][shdc])\b/gi;
      while ((m = flopRegex.exec(afterFlop)) !== null && flopCards.length < 3) {
        flopCards.push(m[1][0].toUpperCase() + m[1][1].toLowerCase());
      }
      if (flopCards.length >= 3) result.flop = flopCards.slice(0, 3);
    }

    if (turnIdx >= 0 && turnIdx > flopIdx) {
      const afterTurn = text.substring(turnIdx);
      const turnMatch = afterTurn.match(/\b([AKQJT2-9][shdc])\b/i);
      if (turnMatch) result.turn = turnMatch[1][0].toUpperCase() + turnMatch[1][1].toLowerCase();
    }

    if (riverIdx >= 0 && riverIdx > turnIdx) {
      const afterRiver = text.substring(riverIdx);
      const riverMatch = afterRiver.match(/\b([AKQJT2-9][shdc])\b/i);
      if (riverMatch) result.river = riverMatch[1][0].toUpperCase() + riverMatch[1][1].toLowerCase();
    }

    // Fallback: if no street markers, assign by position (after hero cards)
    if (!result.flop.length && codedCards.length >= 5) {
      const boardStart = result.hero.length ? 2 : 0;
      result.flop = codedCards.slice(boardStart, boardStart + 3);
      if (codedCards.length > boardStart + 3) result.turn = codedCards[boardStart + 3];
      if (codedCards.length > boardStart + 4) result.river = codedCards[boardStart + 4];
    }

    return result;
  }

  // ---- Flexible Action Extraction ----

  function extractActions(text, profile, playerTracker, bb) {
    const actions = { ...DEFAULT_PATTERNS.actions, ...(profile.actions || {}) };
    const compounds = { ...DEFAULT_PATTERNS.compoundActions, ...(profile.compoundActions || {}) };
    const positions = { ...DEFAULT_PATTERNS.positions, ...(profile.positions || {}) };
    const heroAliases = DEFAULT_PATTERNS.heroAliases;
    const villainAliases = { ...DEFAULT_PATTERNS.villainAliases, ...(profile.villainAliases || {}) };

    const streetActions = { preflop: [], flop: [], turn: [], river: [] };
    let currentStreet = "preflop";

    // Process line by line
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      const lineLower = line.toLowerCase();

      // Detect street changes
      const newStreet = detectStreet(lineLower, profile);
      if (newStreet) currentStreet = newStreet;

      // Tokenize and scan for action patterns
      // Strategy: scan left-to-right, looking for [actor] [action] [amount?] sequences
      const tokens = tokenize(line);

      let i = 0;
      while (i < tokens.length) {
        const token = tokens[i].toLowerCase();
        const raw = tokens[i];

        // Check if this token is an action word
        let actionName = actions[token];
        let compoundParts = compounds[token];

        if (compoundParts) {
          // Compound action: e.g., "check-raise" → check then raise
          const actor = findActorBefore(tokens, i, positions, heroAliases, villainAliases, playerTracker);
          const amount = extractAmountFromTokens(tokens, i, bb);

          streetActions[currentStreet].push({
            seat: actor.seat,
            position: actor.position,
            action: compoundParts[0]
          });
          const secondAction = { seat: actor.seat, position: actor.position, action: compoundParts[1] };
          if (amount > 0) secondAction.amount = amount;
          streetActions[currentStreet].push(secondAction);
          i++;
          continue;
        }

        if (actionName) {
          const actor = findActorBefore(tokens, i, positions, heroAliases, villainAliases, playerTracker);
          const entry = { seat: actor.seat, position: actor.position, action: actionName };
          const amount = extractAmountFromTokens(tokens, i, bb);
          if (amount > 0 && actionName !== "fold" && actionName !== "check") {
            entry.amount = amount;
          }
          streetActions[currentStreet].push(entry);
          i++;
          continue;
        }

        // Check for action with amount fused: "r45", "b30"
        const fusedMatch = token.match(/^([rbcfx])(\d+)$/);
        if (fusedMatch) {
          const fusedAction = actions[fusedMatch[1]];
          if (fusedAction) {
            const actor = findActorBefore(tokens, i, positions, heroAliases, villainAliases, playerTracker);
            const entry = { seat: actor.seat, position: actor.position, action: fusedAction };
            if (fusedAction !== "fold" && fusedAction !== "check") {
              entry.amount = parseInt(fusedMatch[2]);
            }
            streetActions[currentStreet].push(entry);
            i++;
            continue;
          }
        }

        // Check for "folds around" / "folds to"
        if (token === "folds" && i + 1 < tokens.length) {
          const next = tokens[i + 1].toLowerCase();
          if (next === "around" || next === "through") {
            // Multiple folds — we can't know exactly who, add a note
            streetActions[currentStreet].push({
              seat: 0, position: "?", action: "fold", _note: "multiple folds"
            });
            i += 2;
            continue;
          }
        }

        i++;
      }
    }

    return streetActions;
  }

  function tokenize(line) {
    // Split on spaces, commas, semicolons, periods — preserve words and numbers
    return line.match(/[a-zA-Z0-9'$+_-]+/g) || [];
  }

  function detectStreet(lineLower, profile) {
    const markers = { ...DEFAULT_PATTERNS.streetMarkers, ...(profile.streetMarkers || {}) };
    for (const [marker, street] of Object.entries(markers)) {
      // Check if line starts with or contains the marker prominently
      if (lineLower.startsWith(marker + ":") ||
          lineLower.startsWith(marker + " ") ||
          lineLower === marker ||
          lineLower.startsWith("the " + marker) ||
          lineLower.match(new RegExp("^" + marker + "\\b"))) {
        return street;
      }
    }
    // Check mid-line markers: "flop comes Qs9h2d"
    if (/\bflop\s+(comes?|is|was)\b/i.test(lineLower)) return "flop";
    if (/\bturn\s+(comes?|is|was)\b/i.test(lineLower)) return "turn";
    if (/\briver\s+(comes?|is|was)\b/i.test(lineLower)) return "river";
    return null;
  }

  function findActorBefore(tokens, actionIdx, positions, heroAliases, villainAliases, tracker) {
    // Look backwards from the action word for an actor reference
    for (let j = actionIdx - 1; j >= Math.max(0, actionIdx - 4); j--) {
      const word = tokens[j].toLowerCase();

      // Hero?
      if (heroAliases.has(word)) {
        return { seat: tracker.heroSeat, position: "Hero" };
      }

      // Known position?
      if (positions[word]) {
        return { seat: 0, position: positions[word] };
      }

      // Known player nickname?
      if (tracker.knownPlayers[word]) {
        return { seat: tracker.knownPlayers[word], position: word };
      }

      // Generic villain?
      if (villainAliases[word]) {
        return { seat: 0, position: "Villain" };
      }
    }

    // No actor found — default to unknown
    return { seat: 0, position: "?" };
  }

  function extractAmountFromTokens(tokens, actionIdx, bb) {
    // Look forward from the action word for a number
    for (let j = actionIdx + 1; j < Math.min(tokens.length, actionIdx + 5); j++) {
      const word = tokens[j].toLowerCase();

      // Skip filler words
      if (["to", "for", "it", "of", "the", "a", "makes", "puts", "in"].includes(word)) continue;

      // Dollar sign prefix
      if (word.startsWith("$")) {
        const num = parseInt(word.substring(1));
        if (num > 0) return num;
      }

      // Plain number
      const num = parseInt(word);
      if (num > 0) return num;

      // "Xbb" format
      const bbMatch = word.match(/^(\d+)bb$/i);
      if (bbMatch) return parseInt(bbMatch[1]) * bb;

      // If we hit another action word, stop looking
      if (DEFAULT_PATTERNS.actions[word]) break;
    }
    return 0;
  }

  // ---- Hero Position Extraction ----

  function extractHeroPosition(textLower, profile) {
    const positions = { ...DEFAULT_PATTERNS.positions, ...(profile.positions || {}) };
    const heroAliases = DEFAULT_PATTERNS.heroAliases;

    // "I'm on the button", "hero is in the cutoff", "I have the BTN"
    for (const alias of heroAliases) {
      for (const [word, pos] of Object.entries(positions)) {
        const patterns = [
          new RegExp(`\\b${alias}\\b.*\\b${word}\\b`, "i"),
          new RegExp(`\\b${word}\\b.*\\b${alias}\\b`, "i")
        ];
        for (const pat of patterns) {
          if (pat.test(textLower)) return pos;
        }
      }
    }
    return null;
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
    learnFromCorrection,
    splitIntoHandChunks,
    parseWithProfile,
    extractAllCards,
    extractCardsFlexible,
    extractAmount,
    alignByCardOverlap
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ShorthandLearner;
if (typeof window !== "undefined") window.ShorthandLearner = ShorthandLearner;
