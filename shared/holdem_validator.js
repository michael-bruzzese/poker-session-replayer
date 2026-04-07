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

    // ---- Showdown Winner Validation ----
    // If hand went to showdown and we know the cards for the declared winner AND at least
    // one other player, verify the declared winner actually has the best hand.
    const result = hand.result || {};
    if (result.showdown && result.winner_seat && board.flop && board.flop.length === 3) {
      const fullBoard = [...(board.flop || [])];
      if (board.turn) fullBoard.push(board.turn);
      if (board.river) fullBoard.push(board.river);

      if (fullBoard.length === 5) {
        // Gather all known hands: hero + villains
        const knownHands = {};
        if (heroCards.length === 2 && heroCards.every(c => isValidCard(c))) {
          knownHands[hand.hero_seat] = heroCards;
        }
        for (const [seat, cards] of Object.entries(villainCards)) {
          if (Array.isArray(cards) && cards.length === 2 && cards.every(c => isValidCard(c))) {
            knownHands[parseInt(seat)] = cards;
          }
        }

        // Only validate if we know the winner's hand AND at least one opponent's hand
        const winnerSeat = result.winner_seat;
        if (knownHands[winnerSeat] && Object.keys(knownHands).length >= 2) {
          const winnerRank = evaluateHoldemHand(knownHands[winnerSeat], fullBoard);
          let actualBestSeat = winnerSeat;
          let actualBestRank = winnerRank;

          for (const [seat, holeCards] of Object.entries(knownHands)) {
            const s = parseInt(seat);
            if (s === winnerSeat) continue;
            const rank = evaluateHoldemHand(holeCards, fullBoard);
            if (compareHandRanks(rank, actualBestRank) > 0) {
              actualBestSeat = s;
              actualBestRank = rank;
            }
          }

          if (actualBestSeat !== winnerSeat) {
            const winnerDesc = describeHandRank(winnerRank);
            const actualDesc = describeHandRank(actualBestRank);
            errors.push({
              severity: "error",
              field: "result.winner_seat",
              message: `Declared winner seat ${winnerSeat} (${winnerDesc}) loses to seat ${actualBestSeat} (${actualDesc})`,
              question: `Hand ${hid}: The result says seat ${winnerSeat} wins, but seat ${actualBestSeat} has a better hand (${actualDesc} vs ${winnerDesc}). Which seat actually won?`
            });
          }
        }
      }
    }

    return errors;
  }

  // ---- Action Order Helpers ----

  /**
   * Build the expected action order (array of seat numbers) for a given street.
   * Preflop: starts UTG (seat after BB), wraps clockwise, BB acts last.
   * Postflop: starts SB (seat after BTN), wraps clockwise, BTN acts last.
   * Only includes seats in `activeSeats` (not folded, not all-in).
   */
  function buildExpectedOrder(buttonSeat, seatCount, street, activeSeats) {
    // Find SB and BB seats (clockwise from button)
    const sbSeat = ((buttonSeat - 1 + 1) % seatCount) + 1; // seat after button
    const bbSeat = ((buttonSeat - 1 + 2) % seatCount) + 1; // seat after SB

    let startSeat;
    if (street === "preflop") {
      // UTG = seat after BB
      startSeat = ((bbSeat - 1 + 1) % seatCount) + 1;
    } else {
      // Postflop: start at SB (first seat after button)
      startSeat = sbSeat;
    }

    const order = [];
    for (let i = 0; i < seatCount; i++) {
      const seat = ((startSeat - 1 + i) % seatCount) + 1;
      if (activeSeats.has(seat)) order.push(seat);
    }
    return order;
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

    // ---- Full action order validation ----
    // Build the set of active seats (those that have at least one action this hand)
    // and validate that actions follow the correct clockwise order.
    if (hand.button_seat && actions.length > 1) {
      // Collect seats that participate in this street's action from the actions themselves
      const streetSeats = new Set(actions.map(a => a.seat).filter(s => s >= 1 && s <= seatCount));

      // For streets after preflop, we need to know who folded on earlier streets
      const priorFolded = new Set();
      const priorAllIn = new Set();
      if (street !== "preflop") {
        for (const priorBlock of (hand.action_sequence || [])) {
          if (priorBlock.street === street) break;
          for (const act of (priorBlock.actions || [])) {
            if (act.action === "fold") priorFolded.add(act.seat);
            if (act.action === "all-in") priorAllIn.add(act.seat);
          }
        }
      }

      // Active seats = participants minus prior folds/all-ins
      const activeSeats = new Set([...streetSeats].filter(s => !priorFolded.has(s) && !priorAllIn.has(s)));

      if (activeSeats.size > 1) {
        const expectedOrder = buildExpectedOrder(hand.button_seat, seatCount, street, activeSeats);

        // Walk through actions and check the first occurrence of each seat matches the expected order
        const firstActionOrder = [];
        const seenInOrder = new Set();
        for (const action of actions) {
          if (!seenInOrder.has(action.seat) && activeSeats.has(action.seat)) {
            firstActionOrder.push(action.seat);
            seenInOrder.add(action.seat);
          }
        }

        // Compare first-action order against expected order
        // (only compare seats that appear in both lists)
        const expectedFiltered = expectedOrder.filter(s => seenInOrder.has(s));
        for (let i = 0; i < firstActionOrder.length && i < expectedFiltered.length; i++) {
          if (firstActionOrder[i] !== expectedFiltered[i]) {
            // Find position labels for better error messages
            const actualSeat = firstActionOrder[i];
            const expectedSeat = expectedFiltered[i];
            const actualPos = actions.find(a => a.seat === actualSeat)?.position || `Seat ${actualSeat}`;
            const expectedPos = actions.find(a => a.seat === expectedSeat)?.position || `Seat ${expectedSeat}`;
            const streetLabel = street === "preflop" ? "Preflop" : street.charAt(0).toUpperCase() + street.slice(1);

            errors.push({
              severity: "error",
              field: `${street}.action_order`,
              message: `${streetLabel} action out of order: ${actualPos} (seat ${actualSeat}) acts before ${expectedPos} (seat ${expectedSeat})`,
              question: `Hand ${hid}, ${street}: ${actualPos} acts before ${expectedPos}, but ${expectedPos} should act first. Is the action order correct, or is there a transcription error?`
            });
            break; // one order error per street is enough to flag it
          }
        }
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
          message: `Invalid seat number: ${seat === null || seat === undefined ? "unknown" : seat}`,
          question: seat === null || seat === undefined
            ? `Hand ${hid}, ${street}: A player's seat is unknown (${actions[i].position || "unknown position"} ${actions[i].action}s). Which seat (1-${seatCount})?`
            : `Hand ${hid}, ${street}: Seat ${seat} is invalid. Seats must be 1-${seatCount}.`
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

  // ---- Hand Evaluation (for showdown validation) ----

  const RANK_VALUES = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14 };
  const HAND_CATEGORIES = [
    "high card", "pair", "two pair", "three of a kind",
    "straight", "flush", "full house", "four of a kind", "straight flush"
  ];

  function cardRank(code) { return RANK_VALUES[code[0].toUpperCase()] || 0; }
  function cardSuit(code) { return code[1].toLowerCase(); }

  /**
   * Evaluate the best 5-card hand from 2 hole cards + 5 board cards.
   * Returns { category: 0-8, kickers: [sorted values] } for comparison.
   */
  function evaluateHoldemHand(holeCards, board) {
    const all7 = [...holeCards, ...board];
    let best = null;
    // Check all C(7,5) = 21 combinations
    for (let i = 0; i < 7; i++) {
      for (let j = i + 1; j < 7; j++) {
        // Exclude cards i and j (pick the other 5)
        const hand5 = all7.filter((_, idx) => idx !== i && idx !== j);
        const rank = evaluate5(hand5);
        if (!best || compareHandRanks(rank, best) > 0) {
          best = rank;
        }
      }
    }
    return best;
  }

  function evaluate5(cards) {
    const ranks = cards.map(c => cardRank(c)).sort((a, b) => b - a);
    const suits = cards.map(c => cardSuit(c));
    const isFlush = suits.every(s => s === suits[0]);

    // Check straight (including A-2-3-4-5 wheel)
    let isStraight = false;
    let straightHigh = 0;
    if (ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5) {
      isStraight = true;
      straightHigh = ranks[0];
    }
    // Wheel: A-5-4-3-2
    if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
      isStraight = true;
      straightHigh = 5; // 5-high straight
    }

    // Count rank frequencies
    const freq = {};
    for (const r of ranks) freq[r] = (freq[r] || 0) + 1;
    const groups = Object.entries(freq).map(([r, c]) => ({ rank: parseInt(r), count: c }));
    groups.sort((a, b) => b.count - a.count || b.rank - a.rank);

    if (isFlush && isStraight) return { category: 8, kickers: [straightHigh] };
    if (groups[0].count === 4) return { category: 7, kickers: [groups[0].rank, groups[1].rank] };
    if (groups[0].count === 3 && groups[1].count === 2) return { category: 6, kickers: [groups[0].rank, groups[1].rank] };
    if (isFlush) return { category: 5, kickers: ranks };
    if (isStraight) return { category: 4, kickers: [straightHigh] };
    if (groups[0].count === 3) return { category: 3, kickers: [groups[0].rank, ...groups.slice(1).map(g => g.rank)] };
    if (groups[0].count === 2 && groups[1].count === 2) {
      const pairs = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
      return { category: 2, kickers: [...pairs, groups[2].rank] };
    }
    if (groups[0].count === 2) return { category: 1, kickers: [groups[0].rank, ...groups.slice(1).map(g => g.rank)] };
    return { category: 0, kickers: ranks };
  }

  /**
   * Compare two hand ranks. Returns >0 if a beats b, <0 if b beats a, 0 if tied.
   */
  function compareHandRanks(a, b) {
    if (a.category !== b.category) return a.category - b.category;
    for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
      const ak = a.kickers[i] || 0;
      const bk = b.kickers[i] || 0;
      if (ak !== bk) return ak - bk;
    }
    return 0;
  }

  function describeHandRank(rank) {
    const catName = HAND_CATEGORIES[rank.category] || "unknown";
    const rankName = (v) => {
      const names = { 14: "ace", 13: "king", 12: "queen", 11: "jack", 10: "ten" };
      return names[v] || String(v);
    };
    if (rank.category >= 4) return catName + ", " + rankName(rank.kickers[0]) + " high";
    if (rank.category === 3 || rank.category === 1) return catName + " of " + rankName(rank.kickers[0]) + "s";
    if (rank.category === 2) return "two pair, " + rankName(rank.kickers[0]) + "s and " + rankName(rank.kickers[1]) + "s";
    if (rank.category === 7) return "four " + rankName(rank.kickers[0]) + "s";
    if (rank.category === 6) return rankName(rank.kickers[0]) + "s full of " + rankName(rank.kickers[1]) + "s";
    return catName + ", " + rankName(rank.kickers[0]) + " high";
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

  // ---- Implicit Action Inference ----

  /**
   * Fill in implied checks that the user didn't record.
   * Mutates the hand object in place. Returns a list of inferred actions for logging.
   *
   * Rules:
   * 1. Preflop: if the first voluntary action is from a late position, insert folds for all
   *    earlier positions (excluding SB/BB who act later). Also fills mid-sequence gaps.
   * 2. Postflop: if a street's first action is a bet/raise but there are active players
   *    who should have acted before the bettor (based on button_seat), insert checks for them.
   * 3. Preflop BB option: if action reaches BB with no raise beyond the big blind,
   *    and BB doesn't have an explicit action, insert a check (BB exercises option).
   */

  /** Map a seat number to its position label given the button seat. */
  function _positionLabel(seat, buttonSeat, seatCount) {
    const positions9 = ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"];
    const positions6 = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];
    const positions = seatCount <= 6 ? positions6 : positions9;
    const idx = ((seat - buttonSeat + seatCount) % seatCount);
    return positions[idx] || "S" + seat;
  }

  function inferImpliedActions(hand, seatCount) {
    seatCount = seatCount || 9;
    const inferred = [];
    const buttonSeat = hand.button_seat;
    if (!buttonSeat) return inferred;

    // Track folds and all-ins across streets
    const globalFolded = new Set();
    const globalAllIn = new Set();

    for (const streetBlock of (hand.action_sequence || [])) {
      const street = streetBlock.street;
      let actions = streetBlock.actions || [];
      if (!actions.length) continue;

      if (street !== "preflop") {
        // Determine active seats (not folded, not all-in) at the start of this street
        const activeSeats = new Set();
        // Collect all seats that participate in this hand (appeared in any action)
        for (const sb of (hand.action_sequence || [])) {
          for (const a of (sb.actions || [])) {
            if (a.seat >= 1 && a.seat <= seatCount) activeSeats.add(a.seat);
          }
        }
        // Remove folded and all-in players
        for (const s of globalFolded) activeSeats.delete(s);
        for (const s of globalAllIn) activeSeats.delete(s);

        if (activeSeats.size > 1) {
          // Build expected postflop order
          const sbSeat = ((buttonSeat - 1 + 1) % seatCount) + 1;
          const order = [];
          for (let i = 0; i < seatCount; i++) {
            const seat = ((sbSeat - 1 + i) % seatCount) + 1;
            if (activeSeats.has(seat)) order.push(seat);
          }

          // Find the first recorded action's seat
          const firstActionSeat = actions[0].seat;
          const firstActionIdx = order.indexOf(firstActionSeat);
          const firstAction = (actions[0].action || "").toLowerCase();

          // If the first action is a bet/raise and there are players before this seat,
          // they must have checked
          if (firstActionIdx > 0 && (firstAction === "bet" || firstAction === "raise")) {
            const checksToInsert = [];
            for (let i = 0; i < firstActionIdx; i++) {
              const seat = order[i];
              // Find this seat's position label from any action in the hand
              let position = "?";
              for (const sb of (hand.action_sequence || [])) {
                const found = (sb.actions || []).find(a => a.seat === seat);
                if (found && found.position) { position = found.position; break; }
              }
              checksToInsert.push({
                seat,
                position,
                action: "check",
                _inferred: true
              });
              inferred.push({ street, seat, position, action: "check" });
            }
            // Insert at the beginning
            streetBlock.actions = [...checksToInsert, ...actions];
          }
        }
      }

      // Preflop: infer missing folds for seats that should have acted
      if (street === "preflop") {
        const sbSeat = ((buttonSeat - 1 + 1) % seatCount) + 1;
        const bbSeat2 = ((buttonSeat - 1 + 2) % seatCount) + 1;

        // Build full preflop order (UTG first, BB last) for all possible seats
        const allSeats = new Set();
        for (const sb of (hand.action_sequence || [])) {
          for (const a of (sb.actions || [])) {
            if (a.seat >= 1 && a.seat <= seatCount) allSeats.add(a.seat);
          }
        }
        // Also include hero and stacks seats
        if (hand.hero_seat) allSeats.add(hand.hero_seat);
        for (const s of Object.keys(hand.stacks || {})) {
          const sn = parseInt(s, 10);
          if (sn >= 1 && sn <= seatCount) allSeats.add(sn);
        }

        const preflopOrder = buildExpectedOrder(buttonSeat, seatCount, "preflop", allSeats);
        const explicitSeats = new Set(actions.map(a => a.seat));

        // Find the first voluntary action (not an inferred action)
        const firstVoluntaryIdx = actions.findIndex(a => !a._inferred);
        if (firstVoluntaryIdx >= 0) {
          const firstActionSeat = actions[firstVoluntaryIdx].seat;
          const firstPosIdx = preflopOrder.indexOf(firstActionSeat);

          if (firstPosIdx > 0) {
            // Insert folds for all seats before the first actor that have no explicit action
            const foldsToInsert = [];
            for (let i = 0; i < firstPosIdx; i++) {
              const seat = preflopOrder[i];
              if (seat === sbSeat || seat === bbSeat2) continue; // SB/BB act later
              if (explicitSeats.has(seat)) continue; // already has an action
              if (globalFolded.has(seat)) continue; // already folded in prior logic

              const position = _positionLabel(seat, buttonSeat, seatCount);
              foldsToInsert.push({ seat, position, action: "fold", _inferred: true });
              inferred.push({ street: "preflop", seat, position, action: "fold" });
              globalFolded.add(seat);
            }
            if (foldsToInsert.length > 0) {
              streetBlock.actions = [...foldsToInsert, ...actions];
              // Refresh actions reference
              actions = streetBlock.actions;
            }
          }

          // Second pass: handle mid-sequence gaps (e.g., UTG folds, [missing UTG+1], UTG+2 raises)
          const updatedExplicit = new Set(actions.map(a => a.seat));
          const insertions = []; // {beforeIndex, foldAction}
          for (let oi = 0; oi < preflopOrder.length; oi++) {
            const seat = preflopOrder[oi];
            if (seat === sbSeat || seat === bbSeat2) continue;
            if (updatedExplicit.has(seat)) continue;
            if (globalFolded.has(seat)) continue;
            // Check if any later seat in the order has an action
            const laterActed = preflopOrder.slice(oi + 1).some(ls => updatedExplicit.has(ls) && ls !== sbSeat && ls !== bbSeat2);
            if (laterActed) {
              const position = _positionLabel(seat, buttonSeat, seatCount);
              // Find where to insert: before the first action from a later-order seat
              let insertIdx = actions.length;
              for (let ai = 0; ai < actions.length; ai++) {
                const aiOrderIdx = preflopOrder.indexOf(actions[ai].seat);
                if (aiOrderIdx > oi) { insertIdx = ai; break; }
              }
              insertions.push({
                idx: insertIdx,
                action: { seat, position, action: "fold", _inferred: true }
              });
              inferred.push({ street: "preflop", seat, position, action: "fold" });
              globalFolded.add(seat);
              updatedExplicit.add(seat); // prevent re-processing
            }
          }
          // Apply insertions in reverse order so indices don't shift
          insertions.sort((a, b) => b.idx - a.idx);
          for (const ins of insertions) {
            streetBlock.actions.splice(ins.idx, 0, ins.action);
          }
        }
      }

      // Preflop: check if BB option should be inferred
      if (street === "preflop") {
        const bbSeat = ((buttonSeat - 1 + 2) % seatCount) + 1;
        const bigBlind = (hand.blinds || {}).big || 5;
        // Check if action reaches BB with no raise above BB
        let maxBet = bigBlind;
        let bbActed = false;
        for (const a of actions) {
          if (a.seat === bbSeat) bbActed = true;
          const amt = a.amount || 0;
          if ((a.action === "raise" || a.action === "all-in") && amt > maxBet) maxBet = amt;
        }

        // If everyone limped/folded to BB and BB never explicitly acted,
        // and the hand continues to a flop, BB checked (option)
        if (!bbActed && maxBet <= bigBlind && !globalFolded.has(bbSeat)) {
          const hasPostflop = (hand.action_sequence || []).some(sb => sb.street !== "preflop");
          if (hasPostflop) {
            let bbPosition = "BB";
            const bbAction = actions.find(a => a.seat === bbSeat);
            if (bbAction && bbAction.position) bbPosition = bbAction.position;
            streetBlock.actions.push({
              seat: bbSeat,
              position: bbPosition,
              action: "check",
              _inferred: true
            });
            inferred.push({ street: "preflop", seat: bbSeat, position: bbPosition, action: "check (BB option)" });
          }
        }
      }

      // Update global fold/all-in tracking for subsequent streets
      for (const a of (streetBlock.actions || [])) {
        if (a.action === "fold") globalFolded.add(a.seat);
        if (a.action === "all-in") globalAllIn.add(a.seat);
      }
    }

    return inferred;
  }

  return {
    isValidCard,
    normalizeCard,
    findDuplicateCards,
    validateHand,
    validateStreetActions,
    validateSession,
    evaluateHoldemHand,
    compareHandRanks,
    describeHandRank,
    inferImpliedActions
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = HoldemValidator;
}
if (typeof window !== "undefined") window.HoldemValidator = HoldemValidator;
