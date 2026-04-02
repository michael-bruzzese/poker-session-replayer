// Hold'em Rules Validator
// Validates hand data and action sequences against Texas Hold'em rules.
// Returns arrays of violations — each violation has a severity and a suggested question for clarification.
//
// Depends on: PokerConstants

const HoldemValidator = (() => {
  "use strict";

  const VALID_RANKS = new Set("23456789TJQKA".split(""));
  const VALID_SUITS = new Set("shdc".split(""));
  const VALID_ACTIONS = new Set(["fold", "check", "call", "bet", "raise", "all-in"]);
  const STREET_ORDER = ["preflop", "flop", "turn", "river"];
  const POSITIONS_9MAX = new Set(["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"]);

  // ---- Card Validation ----

  function isValidCard(code) {
    if (!code || typeof code !== "string" || code.length !== 2) return false;
    return VALID_RANKS.has(code[0].toUpperCase()) && VALID_SUITS.has(code[1].toLowerCase());
  }

  function normalizeCard(code) {
    if (!code || code.length < 2) return null;
    return code[0].toUpperCase() + code[1].toLowerCase();
  }

  function findDuplicateCards(cards) {
    const seen = new Set();
    const dupes = [];
    for (const card of cards) {
      const norm = normalizeCard(card);
      if (!norm) continue;
      if (seen.has(norm)) dupes.push(norm);
      seen.add(norm);
    }
    return dupes;
  }

  // ---- Hand Record Validation ----

  /**
   * Validate a single hand record against Hold'em rules.
   * @param {Object} hand - A hand record from the session JSON
   * @param {number} seatCount - Number of seats (default 9)
   * @returns {Array<{severity: string, field: string, message: string, question: string}>}
   */
  function validateHand(hand, seatCount) {
    seatCount = seatCount || 9;
    const errors = [];
    const hid = hand.hand_id || "?";

    // ---- Basic Structure ----

    if (!hand.hero_seat || hand.hero_seat < 1 || hand.hero_seat > seatCount) {
      errors.push({
        severity: "error",
        field: "hero_seat",
        message: `Hero seat must be 1-${seatCount}`,
        question: `Hand ${hid}: What seat is hero in? (1-${seatCount})`
      });
    }

    if (!hand.button_seat || hand.button_seat < 1 || hand.button_seat > seatCount) {
      errors.push({
        severity: "error",
        field: "button_seat",
        message: `Button seat must be 1-${seatCount}`,
        question: `Hand ${hid}: What seat has the dealer button? (1-${seatCount})`
      });
    }

    // ---- Hero Cards ----

    const heroCards = hand.hero_cards || [];
    if (heroCards.length !== 2) {
      errors.push({
        severity: "error",
        field: "hero_cards",
        message: "Hero must have exactly 2 hole cards",
        question: `Hand ${hid}: Hero needs exactly 2 hole cards. What were they?`
      });
    }
    heroCards.forEach((card, i) => {
      if (!isValidCard(card)) {
        errors.push({
          severity: "error",
          field: `hero_cards[${i}]`,
          message: `Invalid card: "${card}". Must be rank (2-9, T, J, Q, K, A) + suit (s, h, d, c)`,
          question: `Hand ${hid}: "${card}" isn't a valid card. Format: Ah, Ks, Td, 9c. What was hero's card?`
        });
      }
    });

    // ---- Board Cards ----

    const board = hand.board || {};
    const allBoardCards = [];

    if (board.flop) {
      if (!Array.isArray(board.flop) || board.flop.length !== 3) {
        errors.push({
          severity: "error",
          field: "board.flop",
          message: "Flop must be exactly 3 cards",
          question: `Hand ${hid}: Flop needs exactly 3 cards. What were they?`
        });
      } else {
        board.flop.forEach((card, i) => {
          if (!isValidCard(card)) {
            errors.push({
              severity: "error",
              field: `board.flop[${i}]`,
              message: `Invalid flop card: "${card}"`,
              question: `Hand ${hid}: "${card}" on the flop isn't valid. What was the card?`
            });
          }
          allBoardCards.push(card);
        });
      }
    }

    if (board.turn) {
      if (!isValidCard(board.turn)) {
        errors.push({
          severity: "error",
          field: "board.turn",
          message: `Invalid turn card: "${board.turn}"`,
          question: `Hand ${hid}: "${board.turn}" isn't a valid turn card. What was it?`
        });
      }
      if (!board.flop || board.flop.length !== 3) {
        errors.push({
          severity: "error",
          field: "board.turn",
          message: "Turn card present but flop is missing or incomplete",
          question: `Hand ${hid}: There's a turn card but no complete flop. What was the flop?`
        });
      }
      allBoardCards.push(board.turn);
    }

    if (board.river) {
      if (!isValidCard(board.river)) {
        errors.push({
          severity: "error",
          field: "board.river",
          message: `Invalid river card: "${board.river}"`,
          question: `Hand ${hid}: "${board.river}" isn't a valid river card. What was it?`
        });
      }
      if (!board.turn) {
        errors.push({
          severity: "error",
          field: "board.river",
          message: "River card present but turn is missing",
          question: `Hand ${hid}: There's a river card but no turn. What was the turn?`
        });
      }
      allBoardCards.push(board.river);
    }

    // ---- Duplicate Card Check (the big one) ----

    const allKnownCards = [...heroCards];
    allKnownCards.push(...allBoardCards);

    // Villain known cards
    const villainCards = hand.known_villain_cards || {};
    for (const [seat, cards] of Object.entries(villainCards)) {
      if (!Array.isArray(cards)) continue;
      if (cards.length !== 0 && cards.length !== 2) {
        errors.push({
          severity: "error",
          field: `known_villain_cards.${seat}`,
          message: `Seat ${seat} must have 0 or 2 hole cards, not ${cards.length}`,
          question: `Hand ${hid}: Seat ${seat} has ${cards.length} card(s). Players get exactly 2 — what were both cards?`
        });
      }
      cards.forEach((card) => {
        if (!isValidCard(card)) {
          errors.push({
            severity: "error",
            field: `known_villain_cards.${seat}`,
            message: `Invalid villain card: "${card}" for seat ${seat}`,
            question: `Hand ${hid}: "${card}" for seat ${seat} isn't valid. What was the card?`
          });
        }
        allKnownCards.push(card);
      });
    }

    const dupes = findDuplicateCards(allKnownCards);
    dupes.forEach((card) => {
      errors.push({
        severity: "error",
        field: "cards",
        message: `Duplicate card: ${card} appears more than once`,
        question: `Hand ${hid}: The ${cardName(card)} appears more than once (hero cards, board, or villain cards). Which is correct?`
      });
    });

    // ---- Action Sequence Validation ----

    const actionSeq = hand.action_sequence || [];
    if (!actionSeq.length) {
      errors.push({
        severity: "warning",
        field: "action_sequence",
        message: "No action sequence",
        question: `Hand ${hid}: No actions recorded. What happened in this hand?`
      });
    }

    // Validate street order
    let lastStreetIdx = -1;
    for (const streetBlock of actionSeq) {
      const streetIdx = STREET_ORDER.indexOf(streetBlock.street);
      if (streetIdx < 0) {
        errors.push({
          severity: "error",
          field: "action_sequence.street",
          message: `Invalid street: "${streetBlock.street}"`,
          question: `Hand ${hid}: "${streetBlock.street}" isn't a valid street. Streets are: preflop, flop, turn, river.`
        });
        continue;
      }
      if (streetIdx <= lastStreetIdx) {
        errors.push({
          severity: "error",
          field: "action_sequence.street",
          message: `Street "${streetBlock.street}" appears out of order or is repeated`,
          question: `Hand ${hid}: The ${streetBlock.street} appears after a later street. Is the action sequence correct?`
        });
      }
      lastStreetIdx = streetIdx;

      // Board must exist for post-flop streets
      if (streetBlock.street === "flop" && (!board.flop || board.flop.length !== 3)) {
        errors.push({
          severity: "error",
          field: "board.flop",
          message: "Flop actions exist but no flop cards",
          question: `Hand ${hid}: There's action on the flop but no flop cards. What was the flop?`
        });
      }
      if (streetBlock.street === "turn" && !board.turn) {
        errors.push({
          severity: "error",
          field: "board.turn",
          message: "Turn actions exist but no turn card",
          question: `Hand ${hid}: There's action on the turn but no turn card. What was the turn?`
        });
      }
      if (streetBlock.street === "river" && !board.river) {
        errors.push({
          severity: "error",
          field: "board.river",
          message: "River actions exist but no river card",
          question: `Hand ${hid}: There's action on the river but no river card. What was the river?`
        });
      }

      // Validate individual actions
      const streetErrors = validateStreetActions(streetBlock, hand, seatCount);
      errors.push(...streetErrors);
    }

    // ---- Blinds ----

    const blinds = hand.blinds || {};
    if (blinds.small && blinds.big && blinds.small >= blinds.big) {
      errors.push({
        severity: "error",
        field: "blinds",
        message: `Small blind (${blinds.small}) must be less than big blind (${blinds.big})`,
        question: `Hand ${hid}: Small blind ${blinds.small} is >= big blind ${blinds.big}. What are the correct blinds?`
      });
    }

    return errors;
  }

  // ---- Street Action Validation ----

  function validateStreetActions(streetBlock, hand, seatCount) {
    const errors = [];
    const hid = hand.hand_id || "?";
    const street = streetBlock.street;
    const actions = streetBlock.actions || [];

    if (!actions.length) return errors;

    const foldedSeats = new Set();
    const allInSeats = new Set();
    let currentBet = 0; // highest commitment this street
    let lastRaiser = -1;
    const seatCommitted = {}; // track each seat's street commitment
    const seatsActed = new Set();
    const bigBlind = (hand.blinds || {}).big || 10;

    // ---- Preflop action order validation ----
    // First actor preflop should be UTG (seat after BB), not SB or BB
    if (street === "preflop" && actions.length > 0) {
      const firstActor = actions[0];
      if (firstActor.position === "BB") {
        errors.push({
          severity: "error",
          field: `${street}.actions[0]`,
          message: `BB acts first preflop — UTG should act first`,
          question: `Hand ${hid}, preflop: The big blind is listed as acting first. Preflop action starts with UTG (under the gun), not BB. Is the action order correct?`
        });
      } else if (firstActor.position === "SB") {
        errors.push({
          severity: "error",
          field: `${street}.actions[0]`,
          message: `SB acts first preflop — UTG should act first`,
          question: `Hand ${hid}, preflop: The small blind is listed as acting first. Preflop action starts with UTG, then continues clockwise to the blinds. Is the action order correct?`
        });
      }
    }

    // ---- Postflop action order validation ----
    // First actor postflop should be earliest position still in hand (SB first, then BB, etc.)
    if (street !== "preflop" && actions.length > 0) {
      const firstActor = actions[0];
      const btnSeat = hand.button_seat;
      // The first actor should NOT be the button (last to act postflop) unless heads-up IP
      if (firstActor.position === "BTN" && actions.length > 1) {
        errors.push({
          severity: "warning",
          field: `${street}.actions[0]`,
          message: `Button acts first on ${street} — typically the earliest position acts first postflop`,
          question: `Hand ${hid}, ${street}: The button is listed as acting first. Usually the earliest position (SB/BB/UTG etc.) acts first after the flop. Is this correct?`
        });
      }
    }

    // Track preflop blind commitments
    if (street === "preflop") {
      currentBet = bigBlind;
    }

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const seat = action.seat;
      const act = action.action;
      const amount = action.amount || 0;

      // Valid action type
      if (!VALID_ACTIONS.has(act)) {
        errors.push({
          severity: "error",
          field: `${street}.actions[${i}]`,
          message: `Invalid action: "${act}"`,
          question: `Hand ${hid}, ${street}: "${act}" isn't a valid action. Valid: fold, check, call, bet, raise, all-in.`
        });
        continue;
      }

      // Seat range
      if (!seat || seat < 1 || seat > seatCount) {
        errors.push({
          severity: "error",
          field: `${street}.actions[${i}].seat`,
          message: `Invalid seat number: ${seat}`,
          question: `Hand ${hid}, ${street}: Seat ${seat} is invalid. Seats are 1-${seatCount}.`
        });
        continue;
      }

      // Can't act if folded
      if (foldedSeats.has(seat)) {
        errors.push({
          severity: "error",
          field: `${street}.actions[${i}]`,
          message: `Seat ${seat} already folded but is acting again`,
          question: `Hand ${hid}, ${street}: Seat ${seat} folded earlier but acts again. Is the action sequence correct?`
        });
        continue;
      }

      // Can't act if all-in (except we might record their status)
      if (allInSeats.has(seat) && act !== "fold") {
        errors.push({
          severity: "warning",
          field: `${street}.actions[${i}]`,
          message: `Seat ${seat} is all-in but acts again on the same street`,
          question: `Hand ${hid}, ${street}: Seat ${seat} went all-in but acts again. Is this correct?`
        });
      }

      // Action-specific validation
      const committed = seatCommitted[seat] || 0;

      if (act === "check") {
        // Can only check if no bet to face (or if BB preflop with no raise)
        if (currentBet > 0 && committed < currentBet) {
          // Exception: BB can check if no raise preflop
          const isBBOption = street === "preflop" && committed >= bigBlind && currentBet <= bigBlind;
          if (!isBBOption) {
            errors.push({
              severity: "error",
              field: `${street}.actions[${i}]`,
              message: `Seat ${seat} checks but there's a bet of ${currentBet} to call`,
              question: `Hand ${hid}, ${street}: Seat ${seat} checks but faces a bet of ${currentBet}. Did they call, fold, or raise?`
            });
          }
        }
      }

      if (act === "call") {
        if (currentBet <= 0 && street !== "preflop") {
          errors.push({
            severity: "warning",
            field: `${street}.actions[${i}]`,
            message: `Seat ${seat} calls but there's nothing to call`,
            question: `Hand ${hid}, ${street}: Seat ${seat} calls but no one bet. Did they check or bet?`
          });
        }
      }

      if (act === "bet") {
        if (currentBet > 0) {
          errors.push({
            severity: "error",
            field: `${street}.actions[${i}]`,
            message: `Seat ${seat} bets but there's already a bet of ${currentBet}. Should be "raise"`,
            question: `Hand ${hid}, ${street}: Seat ${seat} bets but there's already a bet. Did you mean raise to ${amount}?`
          });
        }
        if (amount > 0 && amount < bigBlind && street !== "preflop") {
          errors.push({
            severity: "warning",
            field: `${street}.actions[${i}]`,
            message: `Bet of ${amount} is below the big blind (${bigBlind})`,
            question: `Hand ${hid}, ${street}: Bet of ${amount} is below the minimum (${bigBlind}). What was the actual bet?`
          });
        }
        if (amount > 0) {
          currentBet = amount;
          seatCommitted[seat] = amount;
          lastRaiser = seat;
        }
      }

      if (act === "raise") {
        if (currentBet <= 0 && street !== "preflop") {
          errors.push({
            severity: "warning",
            field: `${street}.actions[${i}]`,
            message: `Seat ${seat} raises but there's no bet to raise. Should be "bet"`,
            question: `Hand ${hid}, ${street}: Seat ${seat} raises but no one bet first. Did you mean bet ${amount}?`
          });
        }
        if (amount > 0 && amount <= currentBet) {
          errors.push({
            severity: "error",
            field: `${street}.actions[${i}]`,
            message: `Raise to ${amount} is not more than the current bet of ${currentBet}`,
            question: `Hand ${hid}, ${street}: Raise to ${amount} isn't more than the current bet of ${currentBet}. What was the raise amount?`
          });
        }
        // Minimum raise check
        const minRaise = currentBet * 2;
        if (amount > 0 && amount < minRaise && amount !== committed + (hand.stacks || {})[seat]) {
          // Only warn — could be an all-in that's below min raise
          errors.push({
            severity: "warning",
            field: `${street}.actions[${i}]`,
            message: `Raise to ${amount} may be below minimum raise (${minRaise})`,
            question: `Hand ${hid}, ${street}: Raise to ${amount} — min raise is typically ${minRaise}. Was this an all-in or is the amount correct?`
          });
        }
        if (amount > 0) {
          currentBet = amount;
          seatCommitted[seat] = amount;
          lastRaiser = seat;
        }
      }

      if (act === "fold") {
        foldedSeats.add(seat);
      }

      if (act === "all-in") {
        allInSeats.add(seat);
        if (amount > 0) {
          if (amount > currentBet) currentBet = amount;
          seatCommitted[seat] = amount;
        }
      }

      if (act === "call" && amount > 0) {
        seatCommitted[seat] = amount;
      }

      seatsActed.add(seat);
    }

    // After processing all actions: check that the hand didn't continue with only 1 player
    // (all others folded)
    const activePlayers = seatCount - foldedSeats.size;
    if (activePlayers < 1) {
      errors.push({
        severity: "error",
        field: `${street}.actions`,
        message: "All players folded — at least one player must remain",
        question: `Hand ${hid}, ${street}: Everyone folded. At least one player must win. Who won?`
      });
    }

    return errors;
  }

  // ---- Session Validation ----

  /**
   * Validate an entire session.
   * @param {Object} sessionData
   * @returns {Array<{hand_id, severity, field, message, question}>}
   */
  function validateSession(sessionData) {
    const allErrors = [];
    const seatCount = 9;

    // Session-level checks
    const blinds = sessionData.blinds || {};
    if (!blinds.small || !blinds.big) {
      allErrors.push({
        hand_id: null,
        severity: "warning",
        field: "blinds",
        message: "Session blinds not specified",
        question: "What are the blind levels for this session? (e.g., 2/5)"
      });
    }

    // Validate each hand
    for (const hand of (sessionData.hands || [])) {
      const handErrors = validateHand(hand, seatCount);
      handErrors.forEach((err) => {
        allErrors.push({
          hand_id: hand.hand_id || "?",
          ...err
        });
      });
    }

    return allErrors;
  }

  // ---- Helper ----

  function cardName(code) {
    if (!code || code.length < 2) return code;
    const rankNames = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten" };
    const suitNames = { s: "Spades", h: "Hearts", d: "Diamonds", c: "Clubs" };
    const rank = code[0].toUpperCase();
    const suit = code[1].toLowerCase();
    return `${rankNames[rank] || rank} of ${suitNames[suit] || suit}`;
  }

  return {
    isValidCard,
    normalizeCard,
    findDuplicateCards,
    validateHand,
    validateStreetActions,
    validateSession
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = HoldemValidator;
}
if (typeof window !== "undefined") window.HoldemValidator = HoldemValidator;
