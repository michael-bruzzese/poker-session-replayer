// Shared poker table engine — pure game logic, no DOM
// Depends on: PokerConstants, CardUtils
//
// All functions accept state objects as parameters rather than reading globals.
// The consuming app owns the state; this module operates on it.

const PokerEngine = (() => {
  "use strict";

  const C = typeof PokerConstants !== "undefined" ? PokerConstants
    : typeof window !== "undefined" ? window.PokerConstants
    : typeof require !== "undefined" ? require("./constants.js")
    : {};

  // ---- Utility ----

  function clonePlainObject(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeActionName(action) {
    const key = String(action || "").trim().toLowerCase().replace(/\s+/g, "-");
    return key === "allin" ? "all-in" : key;
  }

  // ---- Seat Arithmetic ----

  function seatAtOffset(startSeat, offset, seatCount) {
    const wrapped = startSeat + offset;
    return ((wrapped % seatCount) + seatCount) % seatCount;
  }

  function computePositionsFromButton(buttonSeat, seatCount, positionArray) {
    if (!positionArray) {
      positionArray = seatCount === 9 ? C.TABLE_POSITIONS_9MAX : C.TABLE_POSITIONS_6MAX;
    }
    const seatToPosition = {};
    positionArray.forEach((position, idx) => {
      const seat = seatAtOffset(buttonSeat, idx, seatCount);
      seatToPosition[seat] = position;
    });
    return seatToPosition;
  }

  function findSeatByPosition(players, position) {
    const found = players.find((p) => p.position === position);
    return found ? found.seat : -1;
  }

  function getPlayerBySeat(players, seat) {
    return players.find((p) => p.seat === seat) || null;
  }

  // ---- Player State ----

  function createPlayerState(seat, stackChips, name) {
    return {
      seat,
      name: name || `Seat ${seat + 1}`,
      description: "",
      position: "",
      stackStart: stackChips,
      stack: stackChips,
      committedStreet: 0,
      committedHand: 0,
      status: stackChips > 0 ? "active" : "allin"
    };
  }

  function restorePlayersToStackStart(players) {
    players.forEach((player) => {
      const baseline = Math.max(0, Math.round(Number(player.stackStart) || 0));
      player.stack = baseline;
      player.committedStreet = 0;
      player.committedHand = 0;
      player.status = baseline > 0 ? "active" : "allin";
    });
  }

  // ---- Table State Factory ----

  function createTableState(opts) {
    const o = opts || {};
    return {
      buttonSeat: o.buttonSeat || 0,
      heroSeat: Number.isInteger(o.heroSeat) ? o.heroSeat : 0,
      street: "preflop",
      pot: 0,
      toCall: 0,
      minRaiseTo: 0,
      lastAggressorSeat: -1,
      lastFullRaiseSize: 0,
      actionSeat: -1,
      pendingActionSeats: [],
      headsUpLocked: false,
      pendingHeadsUpAggressorSeat: -1,
      handNumber: o.handNumber || 0,
      betInputTo: 0,
      streetSnapshots: {},
      preflopScript: [],
      preflopScriptName: ""
    };
  }

  // ---- Seat Queries ----

  function seatsStillInHand(players) {
    return players.filter((p) => p.status !== "folded").map((p) => p.seat);
  }

  function firstActiveSeatFrom(startSeat, players, seatCount) {
    for (let offset = 0; offset < seatCount; offset += 1) {
      const seat = seatAtOffset(startSeat, offset, seatCount);
      const player = getPlayerBySeat(players, seat);
      if (player && player.status === "active") return seat;
    }
    return -1;
  }

  function firstActionSeatForStreet(street, players, tableState, seatCount) {
    if (street === "preflop") {
      const bbSeat = findSeatByPosition(players, "BB");
      if (bbSeat < 0) return -1;
      return firstActiveSeatFrom(seatAtOffset(bbSeat, 1, seatCount), players, seatCount);
    }
    return firstActiveSeatFrom(seatAtOffset(tableState.buttonSeat, 1, seatCount), players, seatCount);
  }

  function activeActionSeatsInOrderFrom(startSeat, players, seatCount) {
    const ordered = [];
    for (let offset = 0; offset < seatCount; offset += 1) {
      const seat = seatAtOffset(startSeat, offset, seatCount);
      const player = getPlayerBySeat(players, seat);
      if (player && player.status === "active") ordered.push(seat);
    }
    return ordered;
  }

  // ---- Pending Action Seats ----

  function resetPendingActionSeatsFrom(startSeat, players, tableState, seatCount, excludedSeats) {
    if (!Number.isInteger(startSeat) || startSeat < 0) {
      tableState.pendingActionSeats = [];
      tableState.actionSeat = -1;
      return [];
    }
    const excluded = new Set((excludedSeats || []).filter((s) => Number.isInteger(s) && s >= 0));
    const ordered = activeActionSeatsInOrderFrom(startSeat, players, seatCount).filter((s) => !excluded.has(s));
    tableState.pendingActionSeats = ordered;
    tableState.actionSeat = ordered.length ? ordered[0] : -1;
    return ordered;
  }

  function sanitizePendingActionSeats(players, tableState) {
    const validActive = new Set(
      players.filter((p) => p.status === "active").map((p) => p.seat)
    );
    const deduped = [];
    const seen = new Set();
    tableState.pendingActionSeats.forEach((seat) => {
      if (!validActive.has(seat) || seen.has(seat)) return;
      seen.add(seat);
      deduped.push(seat);
    });
    tableState.pendingActionSeats = deduped;
    if (!deduped.includes(tableState.actionSeat)) {
      tableState.actionSeat = deduped.length ? deduped[0] : -1;
    }
    return deduped;
  }

  function removePendingActionSeat(seat, players, tableState) {
    tableState.pendingActionSeats = tableState.pendingActionSeats.filter((s) => s !== seat);
    sanitizePendingActionSeats(players, tableState);
  }

  function nextPendingActionSeatFrom(currentSeat, players, tableState, seatCount) {
    sanitizePendingActionSeats(players, tableState);
    const pending = tableState.pendingActionSeats;
    if (!pending.length) {
      tableState.actionSeat = -1;
      return -1;
    }
    for (let offset = 1; offset <= seatCount; offset += 1) {
      const seat = seatAtOffset(currentSeat, offset, seatCount);
      if (pending.includes(seat)) {
        tableState.actionSeat = seat;
        return seat;
      }
    }
    tableState.actionSeat = pending[0];
    return pending[0];
  }

  // ---- Pot / Betting Math ----

  function recomputePotAndToCall(players, tableState) {
    let pot = 0;
    let toCall = 0;
    players.forEach((player) => {
      pot += player.committedHand;
      if (player.status !== "folded") {
        toCall = Math.max(toCall, player.committedStreet);
      }
    });
    tableState.pot = pot;
    tableState.toCall = toCall;
  }

  function recomputeMinRaiseTo(tableState, bigBlind) {
    const toCall = tableState.toCall;
    if (toCall <= 0) {
      tableState.minRaiseTo = bigBlind;
      return;
    }
    const raiseSize =
      Number.isFinite(tableState.lastFullRaiseSize) && tableState.lastFullRaiseSize > 0
        ? tableState.lastFullRaiseSize
        : bigBlind;
    tableState.minRaiseTo = toCall + raiseSize;
  }

  function roundToWholeBb(chips, bigBlind) {
    const numeric = Number(chips);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric / bigBlind) * bigBlind;
  }

  // ---- Legal Actions ----

  function getLegalActions(seat, players, tableState) {
    const player = getPlayerBySeat(players, seat);
    if (!player || player.status !== "active") {
      return {
        fold: false, check: false, call: false, bet: false,
        raise: false, allIn: false, toCall: 0, minRaiseTo: 0, maxCommit: 0
      };
    }

    const toCall = Math.max(0, tableState.toCall - player.committedStreet);
    const maxCommit = player.committedStreet + player.stack;
    const canCheck = toCall === 0;
    const canCall = toCall > 0 && player.stack > 0;
    const canBet = toCall === 0 && player.stack > 0;
    const canRaise =
      toCall > 0 &&
      player.stack > toCall &&
      maxCommit >= tableState.minRaiseTo &&
      maxCommit > tableState.toCall;

    return {
      fold: true, check: canCheck, call: canCall, bet: canBet,
      raise: canRaise, allIn: player.stack > 0,
      toCall, minRaiseTo: tableState.minRaiseTo, maxCommit
    };
  }

  // ---- Apply Actions ----

  function applyCommittedChips(player, targetStreetCommit) {
    const safeTarget = Math.max(player.committedStreet, Math.min(targetStreetCommit, player.committedStreet + player.stack));
    const delta = safeTarget - player.committedStreet;
    if (delta <= 0) return 0;
    player.stack -= delta;
    player.committedStreet += delta;
    player.committedHand += delta;
    if (player.stack === 0) player.status = "allin";
    return delta;
  }

  /**
   * Apply a player action to the game state.
   * Returns { success, actionCommit, targetStreetCommit } or { success: false }.
   */
  function applyPlayerAction(seat, action, sizeChips, players, tableState, seatCount, bigBlind, opts) {
    const exactAmount = opts && opts.exactAmount;
    const player = getPlayerBySeat(players, seat);
    if (!player || player.status !== "active") return { success: false };

    const legal = getLegalActions(seat, players, tableState);
    const toCall = legal.toCall;
    const priorToCall = tableState.toCall;
    let actionCommit = 0;
    let targetStreetCommit = player.committedStreet;
    let aggressiveRaiseCreated = false;

    if (action === "fold") {
      player.status = "folded";
    } else if (action === "check") {
      if (!legal.check) return { success: false };
    } else if (action === "call") {
      if (!legal.call) return { success: false };
      targetStreetCommit = player.committedStreet + toCall;
      actionCommit = applyCommittedChips(player, targetStreetCommit);
    } else if (action === "bet") {
      if (!legal.bet) return { success: false };
      const desired = exactAmount ? Math.max(1, Math.round(Number(sizeChips) || 0)) : Math.max(bigBlind, roundToWholeBb(sizeChips, bigBlind));
      targetStreetCommit = Math.min(legal.maxCommit, desired);
      actionCommit = applyCommittedChips(player, targetStreetCommit);
      if (targetStreetCommit > priorToCall) {
        tableState.lastFullRaiseSize = targetStreetCommit - priorToCall;
        tableState.lastAggressorSeat = seat;
        aggressiveRaiseCreated = true;
      }
    } else if (action === "raise") {
      if (!legal.raise) return { success: false };
      const desired = exactAmount ? Math.round(Number(sizeChips) || 0) : roundToWholeBb(sizeChips, bigBlind);
      const minRaiseTo = tableState.minRaiseTo;
      const capped = Math.min(legal.maxCommit, desired);
      if (capped < minRaiseTo && legal.maxCommit > minRaiseTo) return { success: false };
      targetStreetCommit = Math.max(priorToCall, capped);
      if (targetStreetCommit <= priorToCall) return { success: false };
      actionCommit = applyCommittedChips(player, targetStreetCommit);
      const raiseSize = targetStreetCommit - priorToCall;
      if (raiseSize >= tableState.lastFullRaiseSize) {
        tableState.lastFullRaiseSize = raiseSize;
      }
      tableState.lastAggressorSeat = seat;
      aggressiveRaiseCreated = true;
    } else if (action === "all-in") {
      if (!legal.allIn) return { success: false };
      targetStreetCommit = legal.maxCommit;
      if (targetStreetCommit <= player.committedStreet) return { success: false };
      actionCommit = applyCommittedChips(player, targetStreetCommit);
      if (targetStreetCommit > priorToCall) {
        const raiseSize = targetStreetCommit - priorToCall;
        if (raiseSize >= tableState.lastFullRaiseSize) {
          tableState.lastFullRaiseSize = raiseSize;
        }
        tableState.lastAggressorSeat = seat;
        aggressiveRaiseCreated = true;
      }
    } else {
      return { success: false };
    }

    // Update pending action seats
    if (aggressiveRaiseCreated) {
      tableState.pendingHeadsUpAggressorSeat = seat;
      resetPendingActionSeatsFrom(seatAtOffset(seat, 1, seatCount), players, tableState, seatCount, [seat]);
    } else if (action !== "call") {
      tableState.pendingHeadsUpAggressorSeat = -1;
      removePendingActionSeat(seat, players, tableState);
    } else {
      removePendingActionSeat(seat, players, tableState);
    }

    // Heads-up auto-fold on call
    if (
      action === "call" &&
      toCall > 0 &&
      tableState.pendingHeadsUpAggressorSeat >= 0 &&
      seat !== tableState.pendingHeadsUpAggressorSeat
    ) {
      autoFoldRemainingPlayers(players, tableState, seatCount, [tableState.pendingHeadsUpAggressorSeat, seat]);
    }

    recomputePotAndToCall(players, tableState);
    recomputeMinRaiseTo(tableState, bigBlind);
    maybeLockHeadsUp(players, tableState);
    sanitizePendingActionSeats(players, tableState);

    if (tableState.pendingActionSeats.length) {
      nextPendingActionSeatFrom(seat, players, tableState, seatCount);
    } else {
      tableState.actionSeat = -1;
    }

    return {
      success: true,
      actionCommit,
      targetStreetCommit,
      aggressiveRaiseCreated
    };
  }

  // ---- Heads-Up Logic ----

  function maybeLockHeadsUp(players, tableState) {
    const inHand = seatsStillInHand(players);
    tableState.headsUpLocked = inHand.length <= 2;
    return tableState.headsUpLocked;
  }

  function autoFoldRemainingPlayers(players, tableState, seatCount, keepSeats) {
    const keepSet = new Set((keepSeats || []).filter((s) => Number.isInteger(s) && s >= 0));
    players.forEach((player) => {
      if (keepSet.has(player.seat)) return;
      if (player.status === "active") player.status = "folded";
    });
    recomputePotAndToCall(players, tableState);
    sanitizePendingActionSeats(players, tableState);
    maybeLockHeadsUp(players, tableState);
  }

  // ---- Betting Round Queries ----

  function isBettingRoundComplete(players, tableState) {
    if (tableState.actionSeat < 0) return true;
    const pending = tableState.pendingActionSeats;
    if (!pending.length) return true;
    const active = players.filter((p) => p.status === "active");
    return active.length === 0;
  }

  function isHandWonByFold(players) {
    const inHand = players.filter((p) => p.status !== "folded");
    return inHand.length <= 1;
  }

  // ---- Street Management ----

  function beginStreetRound(street, players, tableState, seatCount, bigBlind) {
    tableState.street = street;
    players.forEach((player) => {
      if (player.status !== "folded") player.committedStreet = 0;
    });
    tableState.toCall = 0;
    tableState.minRaiseTo = bigBlind;
    tableState.lastAggressorSeat = -1;
    tableState.lastFullRaiseSize = bigBlind;
    tableState.pendingHeadsUpAggressorSeat = -1;
    tableState.actionSeat = firstActionSeatForStreet(street, players, tableState, seatCount);
    tableState.betInputTo = bigBlind;
    resetPendingActionSeatsFrom(tableState.actionSeat, players, tableState, seatCount);
    recomputePotAndToCall(players, tableState);
    recomputeMinRaiseTo(tableState, bigBlind);
    maybeLockHeadsUp(players, tableState);
  }

  // ---- Blind Posting ----

  function postBlindForSeat(seat, blindAmount, players) {
    const player = getPlayerBySeat(players, seat);
    if (!player || player.status !== "active") return 0;
    const amount = Math.max(0, Math.min(blindAmount, player.stack));
    if (amount === 0) return 0;
    player.stack -= amount;
    player.committedStreet += amount;
    player.committedHand += amount;
    if (player.stack === 0) player.status = "allin";
    return amount;
  }

  function postBlinds(players, tableState, seatCount, smallBlind, bigBlind) {
    const sbSeat = findSeatByPosition(players, "SB");
    const bbSeat = findSeatByPosition(players, "BB");
    if (sbSeat < 0 || bbSeat < 0) return;

    postBlindForSeat(sbSeat, smallBlind, players);
    postBlindForSeat(bbSeat, bigBlind, players);
    recomputePotAndToCall(players, tableState);

    tableState.minRaiseTo = tableState.toCall + bigBlind;
    tableState.lastAggressorSeat = bbSeat;
    tableState.lastFullRaiseSize = bigBlind;
    tableState.actionSeat = seatAtOffset(bbSeat, 1, seatCount);
    tableState.pendingActionSeats = [];
    tableState.betInputTo = tableState.minRaiseTo;
  }

  // ---- Snapshots ----

  function captureStreetSnapshot(street, boardBase, players, tableState) {
    tableState.streetSnapshots[street] = {
      stage: street,
      boardBase: (boardBase || []).slice(),
      players: clonePlainObject(players),
      tableState: clonePlainObject({
        ...tableState,
        streetSnapshots: {}
      })
    };
  }

  function restoreStreetSnapshot(street, tableState) {
    const snapshot = tableState.streetSnapshots[street];
    if (!snapshot) return null;
    return {
      players: clonePlainObject(snapshot.players),
      tableState: {
        ...clonePlainObject(snapshot.tableState),
        streetSnapshots: tableState.streetSnapshots
      },
      stage: snapshot.stage,
      board: snapshot.boardBase.slice()
    };
  }

  // ---- Initialize a Hand ----

  /**
   * Set up players and table state for a new hand.
   * @param {Object} opts
   * @param {number} opts.seatCount - 6 or 9
   * @param {number} opts.buttonSeat
   * @param {number} opts.heroSeat
   * @param {Object} opts.stacks - { seatNumber: chipCount }
   * @param {number} opts.smallBlind
   * @param {number} opts.bigBlind
   * @param {Object} opts.playerNames - { seatNumber: { name, description } }
   * @param {string[]} [opts.positionArray] - override position labels
   * @returns {{ players: Array, tableState: Object }}
   */
  function initializeHand(opts) {
    const sc = opts.seatCount || 9;
    const posArray = opts.positionArray || (sc === 9 ? C.TABLE_POSITIONS_9MAX : C.TABLE_POSITIONS_6MAX);
    const seatToPosition = computePositionsFromButton(opts.buttonSeat, sc, posArray);

    const players = [];
    for (let seat = 0; seat < sc; seat += 1) {
      const stackChips = (opts.stacks && opts.stacks[seat + 1]) || (opts.stacks && opts.stacks[seat]) || opts.defaultStack || 1000;
      const info = (opts.playerNames && (opts.playerNames[seat + 1] || opts.playerNames[seat])) || {};
      const player = createPlayerState(seat, stackChips, info.name);
      player.description = info.description || "";
      player.position = seatToPosition[seat] || "";
      players.push(player);
    }

    const tableState = createTableState({
      buttonSeat: opts.buttonSeat,
      heroSeat: Number.isInteger(opts.heroSeat) ? opts.heroSeat : 0,
      handNumber: opts.handNumber || 0
    });

    // Post blinds
    postBlinds(players, tableState, sc, opts.smallBlind || 5, opts.bigBlind || 10);
    resetPendingActionSeatsFrom(tableState.actionSeat, players, tableState, sc);

    return { players, tableState };
  }

  // ---- Public API ----

  return {
    // Utility
    clonePlainObject,
    normalizeActionName,

    // Seat arithmetic
    seatAtOffset,
    computePositionsFromButton,
    findSeatByPosition,
    getPlayerBySeat,

    // Player state
    createPlayerState,
    restorePlayersToStackStart,

    // Table state
    createTableState,

    // Seat queries
    seatsStillInHand,
    firstActiveSeatFrom,
    firstActionSeatForStreet,
    activeActionSeatsInOrderFrom,

    // Pending action seats
    resetPendingActionSeatsFrom,
    sanitizePendingActionSeats,
    removePendingActionSeat,
    nextPendingActionSeatFrom,

    // Pot / betting math
    recomputePotAndToCall,
    recomputeMinRaiseTo,
    roundToWholeBb,

    // Legal actions
    getLegalActions,

    // Apply actions
    applyCommittedChips,
    applyPlayerAction,

    // Heads-up logic
    maybeLockHeadsUp,
    autoFoldRemainingPlayers,

    // Betting round queries
    isBettingRoundComplete,
    isHandWonByFold,

    // Street management
    beginStreetRound,

    // Blind posting
    postBlindForSeat,
    postBlinds,

    // Snapshots
    captureStreetSnapshot,
    restoreStreetSnapshot,

    // Hand initialization
    initializeHand
  };
})();

if (typeof window !== "undefined") window.PokerEngine = PokerEngine;
if (typeof module !== "undefined" && module.exports) module.exports = PokerEngine;
