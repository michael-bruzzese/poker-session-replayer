// Card utility functions shared across poker apps
// Depends on: PokerConstants

const CardUtils = (() => {
  "use strict";

  const C = typeof PokerConstants !== "undefined" ? PokerConstants
    : typeof window !== "undefined" ? window.PokerConstants
    : typeof require !== "undefined" ? require("./constants.js")
    : {};

  function formatCard(code) {
    if (!code || code.length < 2) return "??";
    // Blank/unknown card support
    if (code[0].toUpperCase() === "X") {
      if (code[1].toLowerCase() === "x") return "??";
      return "?" + code[1].toLowerCase(); // ?h, ?s, ?d, ?c
    }
    return `${code[0].toUpperCase()}${code[1].toLowerCase()}`;
  }

  function isBlankCard(code) {
    return code && code.length === 2 && code[0].toUpperCase() === "X";
  }

  function cardPrettyName(code) {
    if (!code || code.length < 2) return "that card";
    const rank = code[0].toUpperCase();
    const suit = code[1].toLowerCase();
    return `${C.RANK_NAME[rank] || rank} of ${C.SUIT_NAME[suit] || suit}`;
  }

  function cardImageCandidates(code) {
    // Blank cards → use card back
    if (code && code[0].toUpperCase() === "X") return backImageCandidates();
    const rank = code[0].toUpperCase();
    const suit = code[1].toLowerCase();
    const rankVariants = [rank, rank.toLowerCase()];
    const suitVariants = [suit, suit.toUpperCase()];
    if (rank === "T") rankVariants.push("10");

    const out = [];
    for (const prefix of C.CARD_PREFIXES) {
      for (const r of rankVariants) {
        for (const s of suitVariants) {
          out.push(`${prefix}${r}${s}.png`);
          out.push(`${prefix}${r}_${s}.png`);
        }
      }
      const rankWord = C.RANK_WORD[rank];
      const suitWord = C.SUIT_WORD[suit];
      if (rankWord && suitWord) {
        out.push(`${prefix}${rankWord}_of_${suitWord}.png`);
        out.push(`${prefix}${rankWord}_of_${suitWord}2.png`);
      }
    }
    return [...new Set(out)];
  }

  function backImageCandidates() {
    const names = ["back.png", "card_back.png", "cardback.png", "red_back.png", "blue_back.png", "backside.png"];
    const out = [];
    for (const prefix of C.CARD_PREFIXES) {
      for (const n of names) {
        out.push(`${prefix}${n}`);
      }
    }
    return out;
  }

  function buildGeneratedBackDataUri() {
    const width = 140;
    const height = 200;
    const cell = 20;
    let grid = "";
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        const isOrange = ((x / cell) + (y / cell)) % 2 === 0;
        const fill = isOrange ? "#c85f00" : "#ffffff";
        grid += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`;
      }
    }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>` +
      grid +
      `<rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="#000000" stroke-width="4"/>` +
      `</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function buildFullDeck() {
    const deck = [];
    for (const rank of C.RANKS) {
      for (const suit of C.SUITS) {
        deck.push(`${rank}${suit}`);
      }
    }
    return deck;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function rankValue(rank) {
    return C.RANKS.indexOf(rank.toUpperCase()) + 2;
  }

  function attachImageWithFallback(img, fallbackEl, candidates) {
    let idx = 0;
    function tryNext() {
      if (idx >= candidates.length) {
        img.style.display = "none";
        fallbackEl.style.display = "flex";
        return;
      }
      img.src = candidates[idx];
      idx += 1;
    }
    img.addEventListener("load", () => {
      img.style.display = "";
      fallbackEl.style.display = "none";
    });
    img.addEventListener("error", tryNext);
    tryNext();
  }

  return {
    formatCard,
    isBlankCard,
    cardPrettyName,
    cardImageCandidates,
    backImageCandidates,
    buildGeneratedBackDataUri,
    buildFullDeck,
    shuffle,
    rankValue,
    attachImageWithFallback
  };
})();

if (typeof window !== "undefined") window.CardUtils = CardUtils;
if (typeof module !== "undefined" && module.exports) module.exports = CardUtils;
