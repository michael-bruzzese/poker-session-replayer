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

  // ---- Fuzzy Matching (Levenshtein distance) ----

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b[i - 1] === a[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Fuzzy lookup: find the best match in a dictionary when exact match fails.
   * Only matches if the edit distance is <= maxDist AND the token is long enough
   * (short tokens like "f", "x", "c" must match exactly to avoid false positives).
   * Returns { key, value, distance } or null if no close match found.
   */
  // Words that look like poker terms but are NOT actions — skip fuzzy matching
  const FUZZY_IGNORE = new Set([
    "stacks", "stack", "chips", "hands", "hand", "board", "cards", "card",
    "seats", "seat", "table", "blinds", "blind", "antes", "ante",
    "dealer", "player", "players", "hero", "villain", "flop", "turn",
    "river", "preflop", "showdown", "pot", "pots", "wins", "loses",
    "with", "from", "into", "over", "about", "around", "through",
    "folds", "checks", "calls", "bets", "raises" // these are exact matches, not fuzzy
  ]);

  function fuzzyLookup(token, dict, maxDist) {
    if (!maxDist) maxDist = 2;
    // Don't fuzzy-match tokens shorter than 4 chars — too ambiguous
    if (token.length < 4) return null;
    // Skip known non-action words
    if (FUZZY_IGNORE.has(token)) return null;
    let best = null;
    for (const key of Object.keys(dict)) {
      if (key.length < 4) continue; // skip short keys too
      // Require first character to match — most typos don't change the first letter
      if (token[0] !== key[0]) continue;
      const dist = levenshtein(token, key);
      // Only allow distance 1 for all words — distance 2 causes too many false positives
      if (dist === 1 && (!best || dist < best.distance)) {
        best = { key, value: dict[key], distance: dist };
      }
    }
    return best;
  }

  // ---- Default patterns ----

  const DEFAULT_PATTERNS = {
    actions: {
      // Single-char (universal shorthand)
      "f": "fold", "x": "check", "c": "call", "b": "bet", "r": "raise",
      "ch": "check", "ck": "check", "chk": "check",
      // Standard words + conjugations
      "fold": "fold", "folds": "fold", "folded": "fold", "folding": "fold",
      "muck": "fold", "mucked": "fold", "mucks": "fold", "mucking": "fold",
      "pass": "fold", "passes": "fold", "passed": "fold",
      "give up": "fold", "gave up": "fold", "gives up": "fold",
      "let it go": "fold", "lets it go": "fold", "tossed": "fold",
      "check": "check", "checks": "check", "checked": "check", "checking": "check",
      "tap": "check", "taps": "check", "tapped": "check", "knocks": "check", "knocked": "check",
      "call": "call", "calls": "call", "called": "call", "calling": "call",
      "flat": "call", "flats": "call", "flatted": "call", "flatting": "call",
      "smooth call": "call", "smooth-call": "call", "overcall": "call", "overcalls": "call",
      "cold call": "call", "cold-call": "call", "cold calls": "call",
      "peel": "call", "peels": "call", "peeled": "call", "peeling": "call",
      "snap call": "call", "snap-call": "call", "snaps off": "call",
      "bet": "bet", "bets": "bet", "betting": "bet",
      "lead": "bet", "leads": "bet", "led": "bet", "leading": "bet",
      "donk": "bet", "donks": "bet", "donked": "bet", "donk bet": "bet", "donk-bet": "bet",
      "probe": "bet", "probes": "bet", "probed": "bet", "probe bet": "bet",
      "stab": "bet", "stabs": "bet", "stabbed": "bet",
      "fire": "bet", "fires": "bet", "fired": "bet", "fires a": "bet",
      "barrel": "bet", "barrels": "bet", "barreled": "bet", "barrelled": "bet",
      "2barrel": "bet", "2nd barrel": "bet", "double barrel": "bet", "double-barrel": "bet",
      "3barrel": "bet", "3rd barrel": "bet", "triple barrel": "bet", "triple-barrel": "bet",
      "raise": "raise", "raises": "raise", "raised": "raise", "raising": "raise",
      "bump": "raise", "bumps": "raise", "bumped": "raise",
      "pop": "raise", "pops": "raise", "popped": "raise",
      "open": "raise", "opens": "raise", "opened": "raise", "opening": "raise",
      "iso": "raise", "isolate": "raise", "isolates": "raise", "isolated": "raise",
      "squeeze": "raise", "squeezes": "raise", "squeezed": "raise",
      "reraise": "raise", "re-raise": "raise", "re-raises": "raise", "reraised": "raise",
      "limp": "call", "limps": "call", "limped": "call", "limping": "call",
      "complete": "call", "completes": "call", "completed": "call",
      // N-bet patterns (3bet, 4bet, 5bet)
      "3b": "raise", "3bet": "raise", "3bets": "raise", "3-bet": "raise", "3-bets": "raise",
      "three-bet": "raise", "three-bets": "raise", "threebet": "raise", "3betted": "raise",
      "4b": "raise", "4bet": "raise", "4bets": "raise", "4-bet": "raise", "4-bets": "raise",
      "four-bet": "raise", "four-bets": "raise", "fourbet": "raise",
      "5b": "raise", "5bet": "raise", "5-bet": "raise", "five-bet": "raise",
      // Continuation bet
      "cbet": "bet", "c-bet": "bet", "c-bets": "bet", "cbets": "bet", "cbetting": "bet",
      "cb": "bet", "continuation bet": "bet", "continuation": "bet",
      // All-in
      "ai": "all-in", "allin": "all-in", "all-in": "all-in", "all in": "all-in",
      "jam": "all-in", "jams": "all-in", "jammed": "all-in", "jamming": "all-in",
      "shove": "all-in", "shoves": "all-in", "shoved": "all-in", "shoving": "all-in",
      "ship": "all-in", "ships": "all-in", "shipped": "all-in", "shipping": "all-in",
      "rip": "all-in", "rips": "all-in", "ripped": "all-in", "rip it": "all-in",
      "push": "all-in", "pushes": "all-in", "pushed": "all-in",
      "move in": "all-in", "moves in": "all-in", "moved in": "all-in",
      "puts it in": "all-in", "put it in": "all-in",
      "goes all in": "all-in", "went all in": "all-in",
      "gets it in": "all-in", "got it in": "all-in",
      // Raise first in / specific plays
      "rfi": "raise", "raise first in": "raise",
      "cc": "call", "cold-call": "call", "cold-calls": "call",
      // Snap / tank prefixes
      "snap call": "call", "snap-call": "call", "snap calls": "call",
      "snap fold": "fold", "snap-fold": "fold", "snap folds": "fold",
      "snap shove": "all-in", "snap-shove": "all-in", "snap jams": "all-in",
      "tanks and calls": "call", "tank calls": "call", "tank-calls": "call",
      "tanks and folds": "fold", "tank folds": "fold", "tank-folds": "fold",
      "tanks and shoves": "all-in",
      "hero call": "call", "hero-call": "call", "hero calls": "call",
      "look up": "call", "looks up": "call", "looked up": "call",
      "bluff catch": "call", "bluff catches": "call", "bluff-catch": "call"
    },
    // Compound actions: expand into 2 actions
    compoundActions: {
      "xr": ["check", "raise"], "cr": ["check", "raise"], "x/r": ["check", "raise"],
      "check-raise": ["check", "raise"], "checkraise": ["check", "raise"],
      "check-raises": ["check", "raise"], "check-raised": ["check", "raise"],
      "check raise": ["check", "raise"], "check raises": ["check", "raise"],
      "xc": ["check", "call"], "x/c": ["check", "call"],
      "check-call": ["check", "call"], "checkcall": ["check", "call"],
      "check-calls": ["check", "call"], "check-called": ["check", "call"],
      "check call": ["check", "call"], "check calls": ["check", "call"],
      "xf": ["check", "fold"], "x/f": ["check", "fold"],
      "check-fold": ["check", "fold"], "checkfold": ["check", "fold"],
      "check-folds": ["check", "fold"], "check-folded": ["check", "fold"],
      "check fold": ["check", "fold"], "check folds": ["check", "fold"],
      "limp-call": ["call", "call"], "limp call": ["call", "call"],
      "limp-fold": ["call", "fold"], "limp fold": ["call", "fold"],
      "limp-raise": ["call", "raise"], "limp-reraise": ["call", "raise"],
      "b/f": ["bet", "fold"], "bet-fold": ["bet", "fold"], "bet/fold": ["bet", "fold"],
      "b/c": ["bet", "call"], "bet-call": ["bet", "call"], "bet/call": ["bet", "call"],
      "b/3b": ["bet", "raise"], "bet-3bet": ["bet", "raise"]
    },
    positions: {
      // Standard abbreviations
      "utg": "UTG", "utg1": "UTG+1", "utg+1": "UTG+1", "utg-1": "UTG+1",
      "utg2": "UTG+2", "utg+2": "UTG+2", "utg-2": "UTG+2",
      "utg3": "UTG+2", // sometimes used interchangeably
      "under the gun": "UTG", "under-the-gun": "UTG", "underthegun": "UTG",
      "lj": "LJ", "lo": "LJ", "lojack": "LJ", "lowjack": "LJ", "lo-jack": "LJ",
      "hj": "HJ", "hijack": "HJ", "hi-jack": "HJ", "high-jack": "HJ",
      "co": "CO", "cutoff": "CO", "cut-off": "CO", "cut off": "CO", "cut": "CO",
      "btn": "BTN", "bu": "BTN", "button": "BTN", "otb": "BTN", "dealer": "BTN", "d": "BTN",
      "sb": "SB", "small blind": "SB", "small": "SB", "smallblind": "SB",
      "bb": "BB", "big blind": "BB", "big": "BB", "bigblind": "BB",
      "straddle": "STRADDLE", "str": "STRADDLE",
      // Generic position groups
      "ep": "UTG", "ep1": "UTG", "ep2": "UTG+1", "ep3": "UTG+2",
      "early position": "UTG", "early": "UTG",
      "mp": "LJ", "mp1": "LJ", "mp2": "HJ", "mp3": "HJ",
      "middle position": "LJ", "middle": "LJ",
      "lp": "CO", "late position": "CO", "late": "CO",
      "ip": "BTN", "in position": "BTN",
      "oop": "BB", "out of position": "BB",
      // Seat numbers as positions
      "seat1": "1", "seat2": "2", "seat3": "3", "seat4": "4", "seat5": "5",
      "seat6": "6", "seat7": "7", "seat8": "8", "seat9": "9",
      "s1": "1", "s2": "2", "s3": "3", "s4": "4", "s5": "5",
      "s6": "6", "s7": "7", "s8": "8", "s9": "9"
    },
    // Hero references — words that mean "me/hero"
    heroAliases: new Set([
      "i", "me", "my", "hero", "we", "our", "myself", "i'm", "im",
      "i've", "ive", "i'd", "id", "mine", "we're"
    ]),
    // Villain references — generic opponent
    villainAliases: {
      "v": "villain", "v1": "villain", "v2": "villain",
      "villain": "villain", "villian": "villain", "villan": "villain",
      "opp": "villain", "opponent": "villain", "oppo": "villain",
      "he": "villain", "she": "villain", "they": "villain",
      "him": "villain", "her": "villain", "them": "villain",
      "guy": "villain", "dude": "villain", "player": "villain",
      "other guy": "villain", "other player": "villain",
      "raiser": "villain", "opener": "villain", "pfr": "villain",
      "caller": "villain", "limper": "villain",
      "aggressor": "villain", "bettor": "villain",
      "reg": "villain", "fish": "villain", "nit": "villain",
      "whale": "villain", "rec": "villain", "recreational": "villain",
      "lag": "villain", "tag": "villain", "maniac": "villain",
      "old man": "villain", "omc": "villain", "young kid": "villain"
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
    // Hand nickname shortcuts — rank pairs, no suits assigned (suits added at parse time)
    handNames: {
      // Pocket pairs
      "pocket aces": ["A", "A"], "aces": ["A", "A"], "rockets": ["A", "A"],
      "bullets": ["A", "A"], "american airlines": ["A", "A"], "aa": ["A", "A"],
      "pocket kings": ["K", "K"], "kings": ["K", "K"], "cowboys": ["K", "K"],
      "king kong": ["K", "K"], "kk": ["K", "K"],
      "pocket queens": ["Q", "Q"], "queens": ["Q", "Q"], "ladies": ["Q", "Q"],
      "bitches": ["Q", "Q"], "qq": ["Q", "Q"],
      "pocket jacks": ["J", "J"], "jacks": ["J", "J"], "hooks": ["J", "J"],
      "fishhooks": ["J", "J"], "jj": ["J", "J"],
      "pocket tens": ["T", "T"], "tens": ["T", "T"], "dimes": ["T", "T"], "tt": ["T", "T"],
      "pocket nines": ["9", "9"], "nines": ["9", "9"], "99": ["9", "9"],
      "pocket eights": ["8", "8"], "eights": ["8", "8"], "snowmen": ["8", "8"], "88": ["8", "8"],
      "pocket sevens": ["7", "7"], "sevens": ["7", "7"], "77": ["7", "7"],
      "pocket sixes": ["6", "6"], "sixes": ["6", "6"], "66": ["6", "6"],
      "pocket fives": ["5", "5"], "fives": ["5", "5"], "55": ["5", "5"],
      "pocket fours": ["4", "4"], "fours": ["4", "4"], "44": ["4", "4"],
      "pocket threes": ["3", "3"], "threes": ["3", "3"], "33": ["3", "3"],
      "pocket twos": ["2", "2"], "twos": ["2", "2"], "ducks": ["2", "2"],
      "deuces": ["2", "2"], "22": ["2", "2"],
      // Named hands
      "big slick": ["A", "K"], "ak": ["A", "K"], "anna kournikova": ["A", "K"],
      "ace king": ["A", "K"],
      "big chick": ["A", "Q"], "aq": ["A", "Q"], "ace queen": ["A", "Q"],
      "little slick": ["A", "Q"],
      "ace jack": ["A", "J"], "aj": ["A", "J"], "blackjack": ["A", "J"],
      "ace ten": ["A", "T"], "at": ["A", "T"],
      "king queen": ["K", "Q"], "kq": ["K", "Q"], "marriage": ["K", "Q"],
      "king jack": ["K", "J"], "kj": ["K", "J"],
      "king ten": ["K", "T"], "kt": ["K", "T"],
      "queen jack": ["Q", "J"], "qj": ["Q", "J"],
      "queen ten": ["Q", "T"], "qt": ["Q", "T"],
      "jack ten": ["J", "T"], "jt": ["J", "T"],
      "ten nine": ["T", "9"], "t9": ["T", "9"],
      "nine eight": ["9", "8"], "98": ["9", "8"],
      "eight seven": ["8", "7"], "87": ["8", "7"],
      "seven six": ["7", "6"], "76": ["7", "6"],
      "six five": ["6", "5"], "65": ["6", "5"],
      "five four": ["5", "4"], "54": ["5", "4"]
    },
    // Board texture descriptors (for natural language parsing)
    boardTextures: {
      "rainbow": { suits: 3 },     // 3 different suits on flop
      "two-tone": { suits: 2 },    // 2 suits on flop (flush draw possible)
      "monotone": { suits: 1 },    // all one suit on flop
      "dry": { connected: false },  // few draws available
      "wet": { connected: true },   // many draws available
      "paired": { paired: true },   // board has a pair
      "double paired": { doublePaired: true },
      "trips board": { trips: true }
    },
    // Amount descriptors (for natural language amounts)
    amountDescriptors: {
      "half pot": "0.5pot", "half-pot": "0.5pot",
      "two thirds": "0.66pot", "two-thirds": "0.66pot", "2/3": "0.66pot", "2/3 pot": "0.66pot",
      "three quarters": "0.75pot", "three-quarters": "0.75pot", "3/4": "0.75pot", "3/4 pot": "0.75pot",
      "full pot": "1pot", "pot": "1pot", "pot size": "1pot", "pot-size": "1pot",
      "overbet": "1.5pot", "over-bet": "1.5pot",
      "min bet": "minbet", "minimum": "minbet", "min raise": "minraise", "min-raise": "minraise",
      "small bet": "0.33pot", "third pot": "0.33pot", "1/3 pot": "0.33pot", "1/3": "0.33pot"
    },
    // Result descriptors
    resultDescriptors: {
      "wins": "win", "won": "win", "takes it": "win", "takes it down": "win", "scoops": "win",
      "splits": "split", "chop": "split", "chopped": "split",
      "loses": "lose", "lost": "lose", "busted": "lose",
      "shows": "showdown", "showed": "showdown", "flips": "showdown", "tables": "showdown",
      "mucks": "no_show", "doesn't show": "no_show"
    },
    streetMarkers: {
      "pre": "preflop", "preflop": "preflop", "pf": "preflop", "pre-flop": "preflop",
      "flop": "flop", "fl": "flop", "the flop": "flop", "flop comes": "flop",
      "flop is": "flop", "flop was": "flop",
      "turn": "turn", "tn": "turn", "tr": "turn", "the turn": "turn",
      "turn is": "turn", "turn was": "turn", "turn comes": "turn",
      "river": "river", "rv": "river", "ri": "river", "the river": "river",
      "river is": "river", "river was": "river", "river comes": "river",
      // Abbreviated street markers (forum style)
      "otf": "flop", "on the flop": "flop",
      "ott": "turn", "on the turn": "turn",
      "otr": "river", "on the river": "river",
      // PokerStars format markers
      "*** hole cards ***": "preflop", "*** flop ***": "flop",
      "*** turn ***": "turn", "*** river ***": "river",
      "*** summary ***": "showdown", "*** show down ***": "showdown",
      "hole cards": "preflop"
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

    // Persist any typos learned via fuzzy matching into the profile for next time
    if (profile._learnedTypos && Object.keys(profile._learnedTypos).length > 0) {
      const profiles = loadProfiles();
      const stored = profiles[profileName || "default"] || {};
      if (!stored.actions) stored.actions = {};
      for (const [typo, canonical] of Object.entries(profile._learnedTypos)) {
        stored.actions[typo] = canonical;
      }
      profiles[profileName || "default"] = stored;
      saveProfiles(profiles);
    }

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
        parsed_with_profile: profileName || "default",
        fuzzy_corrections: profile._learnedTypos || {}
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

    // Standard card codes first: Ah, Ks, Td, 9c — these take priority over hand names
    const codeRegex = /\b([AKQJT2-9])([shdc])\b/gi;
    let m;
    const codedCards = [];
    while ((m = codeRegex.exec(text)) !== null) {
      codedCards.push(m[1].toUpperCase() + m[2].toLowerCase());
    }

    // "10" as rank: 10h, 10s, 10d, 10c
    const tenRegex = /\b10([shdc])\b/gi;
    while ((m = tenRegex.exec(text)) !== null) {
      codedCards.push("T" + m[1].toLowerCase());
    }

    // Unicode suit symbols: A♥, K♠, Q♦, J♣ (and outline variants ♡♤♢♧)
    const unicodeRegex = /([AKQJT2-9])([♥♡♦♢♣♧♠♤])/g;
    const unicodeSuitMap = { "♥": "h", "♡": "h", "♦": "d", "♢": "d", "♣": "c", "♧": "c", "♠": "s", "♤": "s" };
    while ((m = unicodeRegex.exec(text)) !== null) {
      const suit = unicodeSuitMap[m[2]];
      if (suit) codedCards.push(m[1].toUpperCase() + suit);
    }

    // Bracket notation from PokerStars: [Ah Kd] or [Ah Kd 7c]
    const bracketRegex = /\[([AKQJT2-9][shdc](?:\s+[AKQJT2-9][shdc])*)\]/gi;
    while ((m = bracketRegex.exec(text)) !== null) {
      const bracketCards = m[1].match(/[AKQJT2-9][shdc]/gi) || [];
      bracketCards.forEach(c => codedCards.push(c[0].toUpperCase() + c[1].toLowerCase()));
    }

    // No-separator concatenated cards: AhKd7c (groups of 2: rank+suit)
    const concatRegex = /(?:^|[^a-zA-Z])([AKQJT2-9][shdc])([AKQJT2-9][shdc])([AKQJT2-9][shdc])?([AKQJT2-9][shdc])?([AKQJT2-9][shdc])?(?:[^a-zA-Z]|$)/gi;
    while ((m = concatRegex.exec(text)) !== null) {
      for (let ci = 1; ci <= 5; ci++) {
        if (m[ci]) codedCards.push(m[ci][0].toUpperCase() + m[ci][1].toLowerCase());
      }
    }

    // PokerStars "Dealt to Hero [Ah Kd]" pattern
    const dealtRegex = /dealt\s+to\s+\w+\s+\[([^\]]+)\]/gi;
    while ((m = dealtRegex.exec(text)) !== null) {
      const dealtCards = m[1].match(/[AKQJT2-9][shdc]/gi) || [];
      dealtCards.forEach(c => codedCards.push(c[0].toUpperCase() + c[1].toLowerCase()));
    }

    // Natural language cards: "ace of spades", "king hearts", "ten of diamonds"
    const nlCardRegex = /\b(ace|king|queen|jack|ten|nine|eight|seven|six|five|four|three|two|deuce)\s+(?:of\s+)?(spades?|hearts?|diamonds?|clubs?)\b/gi;
    while ((m = nlCardRegex.exec(text)) !== null) {
      const rank = ranks[m[1].toLowerCase()];
      const suit = suits[m[2].toLowerCase()];
      if (rank && suit) codedCards.push(rank + suit);
    }

    result.all = codedCards;

    // Assign hero cards: prefer explicit card codes, then ranked hand, then hand names
    if (codedCards.length >= 2) {
      result.hero = codedCards.slice(0, 2);
    }

    // Fallback: "AKs" / "AKo" / "JTs" style notation (rank+rank+suited/offsuit)
    if (!result.hero.length) {
      const rankedHandRegex = /\b([AKQJT2-9])([AKQJT2-9])([so])\b/gi;
      let rankedMatch;
      while ((rankedMatch = rankedHandRegex.exec(text)) !== null) {
        const r1 = rankedMatch[1].toUpperCase();
        const r2 = rankedMatch[2].toUpperCase();
        const isSuited = rankedMatch[3].toLowerCase() === "s";
        result.hero = isSuited ? [r1 + "s", r2 + "s"] : [r1 + "h", r2 + "d"];
        break;
      }
    }

    // Fallback: hand name shortcuts ("pocket aces", "big slick")
    if (!result.hero.length) {
      for (const [name, rankPair] of Object.entries(handNames)) {
        const nameRegex = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
        if (nameRegex.test(lower)) {
          const suited = lower.includes("suited") || lower.includes("suit");
          if (rankPair[0] === rankPair[1]) {
            result.hero = [rankPair[0] + "s", rankPair[1] + "h"];
          } else if (suited) {
            result.hero = [rankPair[0] + "s", rankPair[1] + "s"];
          } else {
            result.hero = [rankPair[0] + "h", rankPair[1] + "d"];
          }
          break;
        }
      }
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

        // Fuzzy fallback: if token looks like a typo of a known action, use it
        // and learn the typo for next time so it becomes an exact match.
        const fuzzyAction = fuzzyLookup(token, actions);
        if (fuzzyAction) {
          // Persist the typo → canonical mapping into the actions dict for this parse
          actions[token] = fuzzyAction.value;
          // Also queue it for profile learning (stored at end of parse)
          if (!profile._learnedTypos) profile._learnedTypos = {};
          profile._learnedTypos[token] = fuzzyAction.value;

          const actor = findActorBefore(tokens, i, positions, heroAliases, villainAliases, playerTracker);
          const entry = { seat: actor.seat, position: actor.position, action: fuzzyAction.value, _fuzzy: token };
          const amount = extractAmountFromTokens(tokens, i, bb);
          if (amount > 0 && fuzzyAction.value !== "fold" && fuzzyAction.value !== "check") {
            entry.amount = amount;
          }
          streetActions[currentStreet].push(entry);
          i++;
          continue;
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
          lineLower.match(new RegExp("^" + marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b"))) {
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
    for (let j = actionIdx + 1; j < Math.min(tokens.length, actionIdx + 6); j++) {
      const word = tokens[j].toLowerCase();

      // Skip filler words
      if (["to", "for", "it", "of", "the", "a", "about", "around", "like",
           "makes", "puts", "in", "up", "roughly", "approximately"].includes(word)) continue;

      // Dollar sign prefix: $25, $100
      if (word.startsWith("$")) {
        const num = parseInt(word.substring(1));
        if (num > 0) return num;
      }

      // "Xbb" / "X bb" format: 3bb, 100bb
      const bbMatch = word.match(/^(\d+\.?\d*)bb$/i);
      if (bbMatch) return Math.round(parseFloat(bbMatch[1]) * bb);

      // "Xx" multiplier format: 3x, 4x (preflop = multiply BB)
      const xMatch = word.match(/^(\d+\.?\d*)x$/i);
      if (xMatch) return Math.round(parseFloat(xMatch[1]) * bb);

      // Percentage of pot: "50%", "33%", "75%"
      const pctMatch = word.match(/^(\d+)%$/);
      if (pctMatch) {
        // Can't calculate without pot size, return as-is (approximate)
        return parseInt(pctMatch[1]);
      }

      // Fraction notation: "1/3", "2/3", "3/4"
      const fracMatch = word.match(/^(\d+)\/(\d+)$/);
      if (fracMatch && parseInt(fracMatch[2]) > 0) {
        // Approximate — without pot context just return a marker
        return Math.round((parseInt(fracMatch[1]) / parseInt(fracMatch[2])) * 100);
      }

      // Plain number
      const num = parseInt(word);
      if (num > 0) return num;

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
    alignByCardOverlap,
    levenshtein,
    fuzzyLookup
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ShorthandLearner;
if (typeof window !== "undefined") window.ShorthandLearner = ShorthandLearner;
