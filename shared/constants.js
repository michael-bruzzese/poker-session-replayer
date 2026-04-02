// Shared constants for poker engine
// Used by both RTP Drillz and Session Replayer

const PokerConstants = (() => {
  "use strict";

  const RANKS = "23456789TJQKA".split("");
  const SUITS = "shdc".split("");

  const TABLE_POSITIONS_6MAX = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];
  const TABLE_POSITIONS_9MAX = ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"];

  const RANK_WORD = {
    A: "ace", K: "king", Q: "queen", J: "jack", T: "10",
    "9": "9", "8": "8", "7": "7", "6": "6", "5": "5", "4": "4", "3": "3", "2": "2"
  };

  const RANK_NAME = {
    A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten",
    "9": "Nine", "8": "Eight", "7": "Seven", "6": "Six",
    "5": "Five", "4": "Four", "3": "Three", "2": "Two"
  };

  const SUIT_WORD = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
  const SUIT_NAME = { s: "Spades", h: "Hearts", d: "Diamonds", c: "Clubs" };

  const SUIT_SYMBOL = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
  const SUIT_COLOR = { s: "#000", h: "#c00", d: "#c00", c: "#000" };

  const CARD_PREFIXES = [
    "", "cards/", "png-card-1.3/", "PNG-card-1.3/",
    "PNG-cards-1.3/", "deck/", "images/", "img/"
  ];

  return {
    RANKS, SUITS,
    TABLE_POSITIONS_6MAX, TABLE_POSITIONS_9MAX,
    RANK_WORD, RANK_NAME, SUIT_WORD, SUIT_NAME,
    SUIT_SYMBOL, SUIT_COLOR,
    CARD_PREFIXES
  };
})();

if (typeof window !== "undefined") window.PokerConstants = PokerConstants;
if (typeof module !== "undefined" && module.exports) module.exports = PokerConstants;
