// PokerStars Hand History Exporter
// Converts our internal session format to PokerStars HH text format.
// Output is compatible with Hold'em Manager, PokerTracker, DriveHUD, Hand2Note.

const PokerStarsExporter = (() => {
  "use strict";

  const POSITIONS_9MAX = ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"];

  // ---- Formatting Helpers ----

  function formatDate(timestamp) {
    // PokerStars format: YYYY/MM/DD HH:MM:SS ET
    const d = timestamp ? new Date(timestamp) : new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    const mm = pad(d.getUTCMonth() + 1);
    const dd = pad(d.getUTCDate());
    const hh = pad(d.getUTCHours());
    const mi = pad(d.getUTCMinutes());
    const ss = pad(d.getUTCSeconds());
    return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss} ET`;
  }

  function formatCard(card) {
    // Our format is already PokerStars-compatible (Ah, Ks, Td, etc.)
    return card || "";
  }

  function formatCards(cards) {
    return (cards || []).map(formatCard).join(" ");
  }

  function formatMoney(amount) {
    return "$" + (amount || 0);
  }

  // ---- Seat Mapping ----

  function getPlayerName(session, seat) {
    const players = session.players || {};
    const p = players[String(seat)] || players[seat];
    if (p && p.name) return p.name.replace(/\s+/g, "_");
    return seat === (session._heroSeat || 1) ? "Hero" : `Player${seat}`;
  }

  function buildSeatMap(hand, session) {
    // Returns seats that participate in this hand
    const seatMap = {};
    const stacks = hand.stacks || {};
    const heroSeat = hand.hero_seat || 1;

    for (const [seatKey, stack] of Object.entries(stacks)) {
      const seat = parseInt(seatKey, 10);
      if (!seat || seat < 1 || seat > 9) continue;
      seatMap[seat] = {
        seat,
        name: getPlayerName(session, seat),
        stack: stack,
        isHero: seat === heroSeat
      };
    }
    return seatMap;
  }

  // ---- Generate Single Hand ----

  function formatHand(hand, session, handNumberBase) {
    if (!hand || !hand.action_sequence) return "";

    const lines = [];
    const blinds = hand.blinds || session.blinds || { small: 2, big: 5 };
    const buttonSeat = hand.button_seat || 1;
    const heroSeat = hand.hero_seat || 1;
    const handId = (handNumberBase || 100000000000) + (hand.hand_id || 1);
    const tableName = (session.session_name || "Session").replace(/"/g, "");
    const seatMap = buildSeatMap(hand, session);
    const sbSeat = wrapSeat(buttonSeat + 1);
    const bbSeat = wrapSeat(buttonSeat + 2);

    // Header
    lines.push(`PokerStars Hand #${handId}: Hold'em No Limit (${formatMoney(blinds.small)}/${formatMoney(blinds.big)} USD) - ${formatDate(hand._timestamp)}`);
    lines.push(`Table '${tableName}' 9-max Seat #${buttonSeat} is the button`);

    // Seat listings
    const seatsInOrder = Object.values(seatMap).sort((a, b) => a.seat - b.seat);
    for (const p of seatsInOrder) {
      lines.push(`Seat ${p.seat}: ${p.name} (${formatMoney(p.stack)} in chips)`);
    }

    // Blinds
    if (seatMap[sbSeat]) {
      lines.push(`${seatMap[sbSeat].name}: posts small blind ${formatMoney(blinds.small)}`);
    }
    if (seatMap[bbSeat]) {
      lines.push(`${seatMap[bbSeat].name}: posts big blind ${formatMoney(blinds.big)}`);
    }

    // Hole cards section
    lines.push(`*** HOLE CARDS ***`);
    if (hand.hero_cards && hand.hero_cards.length >= 2 && seatMap[heroSeat]) {
      lines.push(`Dealt to ${seatMap[heroSeat].name} [${formatCards(hand.hero_cards)}]`);
    }

    // Track committed amounts per street for "calls X" calculation
    const committedStreet = {};
    const committedHand = {};
    for (const s of Object.keys(seatMap)) committedHand[s] = 0;

    // Apply blind commitments
    if (seatMap[sbSeat]) { committedStreet[sbSeat] = blinds.small; committedHand[sbSeat] = blinds.small; }
    if (seatMap[bbSeat]) { committedStreet[bbSeat] = blinds.big; committedHand[bbSeat] = blinds.big; }

    let currentBet = blinds.big;

    // Process each street
    for (const streetBlock of hand.action_sequence) {
      const street = streetBlock.street;

      // Street header and board
      if (street === "flop" && hand.board && hand.board.flop) {
        lines.push(`*** FLOP *** [${formatCards(hand.board.flop)}]`);
        // Reset street commitments
        for (const k of Object.keys(committedStreet)) committedStreet[k] = 0;
        currentBet = 0;
      } else if (street === "turn" && hand.board && hand.board.turn) {
        const flop = hand.board.flop || [];
        lines.push(`*** TURN *** [${formatCards(flop)}] [${formatCard(hand.board.turn)}]`);
        for (const k of Object.keys(committedStreet)) committedStreet[k] = 0;
        currentBet = 0;
      } else if (street === "river" && hand.board && hand.board.river) {
        const flop = hand.board.flop || [];
        const turn = hand.board.turn;
        lines.push(`*** RIVER *** [${formatCards(flop)} ${formatCard(turn)}] [${formatCard(hand.board.river)}]`);
        for (const k of Object.keys(committedStreet)) committedStreet[k] = 0;
        currentBet = 0;
      }

      // Actions on this street
      for (const action of (streetBlock.actions || [])) {
        if (!action.seat || !seatMap[action.seat]) continue;
        const player = seatMap[action.seat];
        const act = (action.action || "").toLowerCase();
        const amount = action.amount || 0;

        if (act === "fold") {
          lines.push(`${player.name}: folds`);
        } else if (act === "check") {
          lines.push(`${player.name}: checks`);
        } else if (act === "call") {
          const toAdd = Math.max(0, amount - (committedStreet[action.seat] || 0));
          lines.push(`${player.name}: calls ${formatMoney(toAdd)}`);
          committedStreet[action.seat] = amount;
          committedHand[action.seat] = (committedHand[action.seat] || 0) + toAdd;
        } else if (act === "bet") {
          lines.push(`${player.name}: bets ${formatMoney(amount)}`);
          const prev = committedStreet[action.seat] || 0;
          committedStreet[action.seat] = amount;
          committedHand[action.seat] = (committedHand[action.seat] || 0) + (amount - prev);
          currentBet = amount;
        } else if (act === "raise") {
          const prev = committedStreet[action.seat] || 0;
          const raiseBy = amount - currentBet;
          lines.push(`${player.name}: raises ${formatMoney(raiseBy)} to ${formatMoney(amount)}`);
          committedStreet[action.seat] = amount;
          committedHand[action.seat] = (committedHand[action.seat] || 0) + (amount - prev);
          currentBet = amount;
        } else if (act === "all-in") {
          lines.push(`${player.name}: all-in`);
          const prev = committedStreet[action.seat] || 0;
          committedStreet[action.seat] = amount || prev;
          committedHand[action.seat] = (committedHand[action.seat] || 0) + (amount - prev);
          if (amount > currentBet) currentBet = amount;
        }
      }
    }

    // Summary section
    const totalPot = Object.values(committedHand).reduce((a, b) => a + b, 0);
    const result = hand.result || {};
    lines.push(`*** SUMMARY ***`);
    lines.push(`Total pot ${formatMoney(totalPot)} | Rake $0`);

    // Board line
    const board = hand.board || {};
    const boardCards = [];
    if (board.flop) boardCards.push(...board.flop);
    if (board.turn) boardCards.push(board.turn);
    if (board.river) boardCards.push(board.river);
    if (boardCards.length > 0) {
      lines.push(`Board [${formatCards(boardCards)}]`);
    }

    // Winner
    const winnerSeat = result.winner_seat;
    if (winnerSeat && seatMap[winnerSeat]) {
      const winnerPot = result.pot || totalPot;
      lines.push(`Seat ${winnerSeat}: ${seatMap[winnerSeat].name} collected (${formatMoney(winnerPot)})`);
    }

    return lines.join("\n");
  }

  function wrapSeat(seat) {
    // Wrap 1-9 seat numbers
    return ((seat - 1) % 9) + 1;
  }

  // ---- Public API ----

  function exportSession(session) {
    if (!session || !session.hands || session.hands.length === 0) {
      return "";
    }

    const handNumberBase = Date.now() % 1000000000000;
    const handsText = session.hands.map((hand, i) =>
      formatHand(hand, session, handNumberBase + i * 100)
    ).filter(Boolean);

    // PokerStars separates hands with blank lines
    return handsText.join("\n\n\n");
  }

  return {
    exportSession,
    formatHand,
    formatDate,
    formatCard,
    formatMoney
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = PokerStarsExporter;
} else if (typeof window !== "undefined") {
  window.PokerStarsExporter = PokerStarsExporter;
}
