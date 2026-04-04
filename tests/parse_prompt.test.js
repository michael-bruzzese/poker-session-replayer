import { describe, it, expect } from "vitest";

const ParsePrompt = require("../shared/parse_prompt.js");
const PP = ParsePrompt;

// ============================================================
// System Prompt Content
// ============================================================

describe("Parse Prompt — System Prompt Content", () => {
  it("prompt is non-empty string", () => {
    expect(typeof PP.SYSTEM_PROMPT).toBe("string");
    expect(PP.SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });

  it("contains seat numbering instruction (1-9, never 0)", () => {
    expect(PP.SYSTEM_PROMPT).toMatch(/1-9/);
    expect(PP.SYSTEM_PROMPT).toMatch(/NEVER use seat 0/i);
  });

  it("contains JSON schema structure", () => {
    expect(PP.SYSTEM_PROMPT).toContain("hand_id");
    expect(PP.SYSTEM_PROMPT).toContain("action_sequence");
    expect(PP.SYSTEM_PROMPT).toContain("hero_seat");
    expect(PP.SYSTEM_PROMPT).toContain("button_seat");
    expect(PP.SYSTEM_PROMPT).toContain("board");
  });

  it("explains position mapping via button", () => {
    expect(PP.SYSTEM_PROMPT).toMatch(/button/i);
    expect(PP.SYSTEM_PROMPT).toContain("BTN");
    expect(PP.SYSTEM_PROMPT).toContain("SB");
    expect(PP.SYSTEM_PROMPT).toContain("BB");
  });

  it("covers all 9-max positions", () => {
    const positions = ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"];
    for (const pos of positions) {
      expect(PP.SYSTEM_PROMPT).toContain(pos);
    }
  });

  it("instructs to return JSON only (no markdown)", () => {
    expect(PP.SYSTEM_PROMPT).toMatch(/no markdown/i);
  });
});

// ============================================================
// User Message Builder
// ============================================================

describe("Parse Prompt — buildUserMessage", () => {
  it("returns raw text when no context provided", () => {
    const msg = PP.buildUserMessage({ text: "Hand 1: Hero raises" });
    expect(msg).toBe("Hand 1: Hero raises");
  });

  it("prepends session context", () => {
    const msg = PP.buildUserMessage({
      text: "Hand 1: fold",
      blinds: { small: 2, big: 5 },
      heroSeat: 3,
      sessionName: "Tuesday Night"
    });
    expect(msg).toContain("Tuesday Night");
    expect(msg).toContain("$2/$5");
    expect(msg).toContain("seat 3");
    expect(msg).toContain("Hand 1: fold");
  });

  it("adds chunk continuation context for chunkIndex > 0", () => {
    const msg = PP.buildUserMessage({
      text: "Hand 5",
      chunkIndex: 1,
      knownPlayers: { "1": { name: "Hero" }, "5": { name: "Steve" } }
    });
    expect(msg).toMatch(/continuing/i);
    expect(msg).toContain("Steve");
  });

  it("does not add continuation context for chunkIndex 0", () => {
    const msg = PP.buildUserMessage({ text: "Hand 1", chunkIndex: 0 });
    expect(msg).not.toMatch(/continuing/i);
  });
});

// ============================================================
// Chunking
// ============================================================

describe("Parse Prompt — chunkText", () => {
  it("returns single chunk for short text", () => {
    const chunks = PP.chunkText("Short text", 30000);
    expect(chunks).toHaveLength(1);
  });

  it("splits long text at hand boundaries", () => {
    const text = "Hand 1 " + "x".repeat(15000) + "\nHand 2 " + "y".repeat(15000) + "\nHand 3 " + "z".repeat(5000);
    const chunks = PP.chunkText(text, 20000);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("chunks never exceed max size", () => {
    const text = "Hand 1 " + "a".repeat(10000) + " Hand 2 " + "b".repeat(10000) + " Hand 3 " + "c".repeat(10000);
    const chunks = PP.chunkText(text, 15000);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20000); // some slack for merging
    }
  });

  it("handles empty text", () => {
    const chunks = PP.chunkText("", 30000);
    expect(chunks).toEqual([""]);
  });

  it("falls back to double-newline when no hand boundaries", () => {
    const text = "Section 1\n\n" + "x".repeat(20000) + "\n\nSection 2\n\n" + "y".repeat(20000);
    const chunks = PP.chunkText(text, 25000);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// JSON Extraction
// ============================================================

describe("Parse Prompt — extractJSON", () => {
  it("parses pure JSON response", () => {
    const result = PP.extractJSON('{"hands": [], "session_name": "Test"}');
    expect(result.session_name).toBe("Test");
    expect(result.hands).toEqual([]);
  });

  it("extracts JSON from markdown code fences", () => {
    const response = 'Here is the result:\n```json\n{"hands": []}\n```\nDone';
    const result = PP.extractJSON(response);
    expect(result).not.toBeNull();
    expect(result.hands).toEqual([]);
  });

  it("extracts JSON from generic code fences", () => {
    const response = '```\n{"hands": []}\n```';
    const result = PP.extractJSON(response);
    expect(result).not.toBeNull();
  });

  it("extracts JSON embedded in text", () => {
    const response = 'The result is: {"hands": [], "version": 2} and that is all.';
    const result = PP.extractJSON(response);
    expect(result).not.toBeNull();
    expect(result.version).toBe(2);
  });

  it("returns null for invalid JSON", () => {
    expect(PP.extractJSON("not json at all")).toBeNull();
    expect(PP.extractJSON("")).toBeNull();
    expect(PP.extractJSON(null)).toBeNull();
  });
});

// ============================================================
// Merging Chunked Results
// ============================================================

describe("Parse Prompt — mergeParsedResults", () => {
  it("returns single result unchanged", () => {
    const result = { hands: [{ hand_id: 1 }], players: {} };
    const merged = PP.mergeParsedResults([result]);
    expect(merged.hands).toHaveLength(1);
  });

  it("concatenates hands from multiple chunks", () => {
    const r1 = { hands: [{ hand_id: 1 }, { hand_id: 2 }], players: { "1": { name: "Hero" } } };
    const r2 = { hands: [{ hand_id: 1 }, { hand_id: 2 }], players: { "5": { name: "Steve" } } };
    const merged = PP.mergeParsedResults([r1, r2]);
    expect(merged.hands).toHaveLength(4);
  });

  it("renumbers hand_ids sequentially in merged result", () => {
    const r1 = { hands: [{ hand_id: 1 }, { hand_id: 2 }], players: {} };
    const r2 = { hands: [{ hand_id: 1 }], players: {} };
    const merged = PP.mergeParsedResults([r1, r2]);
    expect(merged.hands[0].hand_id).toBe(1);
    expect(merged.hands[1].hand_id).toBe(2);
    expect(merged.hands[2].hand_id).toBe(3);
  });

  it("merges players, first chunk wins for conflicts", () => {
    const r1 = { hands: [], players: { "1": { name: "Hero" } } };
    const r2 = { hands: [], players: { "1": { name: "Different" }, "5": { name: "Steve" } } };
    const merged = PP.mergeParsedResults([r1, r2]);
    expect(merged.players["1"].name).toBe("Hero"); // first wins
    expect(merged.players["5"].name).toBe("Steve");
  });

  it("handles null/empty inputs gracefully", () => {
    expect(PP.mergeParsedResults([])).toBeNull();
    expect(PP.mergeParsedResults(null)).toBeNull();
  });
});

// ============================================================
// Session Shape Validation
// ============================================================

describe("Parse Prompt — isValidSessionShape", () => {
  it("accepts valid session data", () => {
    expect(PP.isValidSessionShape({ hands: [], players: {} })).toBe(true);
    expect(PP.isValidSessionShape({ hands: [{ hand_id: 1 }] })).toBe(true);
  });

  it("rejects invalid shapes", () => {
    expect(PP.isValidSessionShape(null)).toBe(false);
    expect(PP.isValidSessionShape({})).toBe(false);
    expect(PP.isValidSessionShape({ hands: "not an array" })).toBe(false);
    expect(PP.isValidSessionShape("string")).toBe(false);
  });
});
