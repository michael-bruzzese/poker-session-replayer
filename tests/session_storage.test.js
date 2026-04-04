import { describe, it, expect, beforeEach } from "vitest";

// Mock localStorage
const _store = Object.create(null);
const localStorageMock = {
  getItem: (key) => (key in _store) ? _store[key] : null,
  setItem: (key, value) => { _store[key] = String(value); },
  removeItem: (key) => { delete _store[key]; },
  clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
  get length() { return Object.keys(_store).length; },
  key: (i) => Object.keys(_store)[i] || null,
};
globalThis.localStorage = localStorageMock;

const SessionStorage = require("../shared/session_storage.js");
const SS = SessionStorage;

function makeSession(name, handCount) {
  return {
    session_name: name,
    blinds: { small: 2, big: 5 },
    players: { "1": { name: "Hero", is_hero: true } },
    hands: Array.from({ length: handCount || 3 }, (_, i) => ({
      hand_id: i + 1,
      hand_label: `Hand ${i + 1}`,
      hero_seat: 1,
      button_seat: 1,
      stacks: { 1: 500 },
      hero_cards: ["As", "Kd"],
      board: {},
      action_sequence: [{ street: "preflop", actions: [{ seat: 1, action: "fold" }] }],
      result: {}
    }))
  };
}

// ============================================================
// Session CRUD
// ============================================================

describe("Session Storage — CRUD", () => {
  beforeEach(() => localStorageMock.clear());

  it("saves and loads a session", () => {
    const session = makeSession("Test Session");
    const result = SS.saveSession(session);
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();

    const loaded = SS.loadSession(result.id);
    expect(loaded).not.toBeNull();
    expect(loaded.session_name).toBe("Test Session");
    expect(loaded.hands).toHaveLength(3);
    expect(loaded._storageVersion).toBe(SS.CURRENT_VERSION);
  });

  it("saves multiple sessions and lists them", () => {
    SS.saveSession(makeSession("Session A"));
    SS.saveSession(makeSession("Session B"));
    SS.saveSession(makeSession("Session C"));

    const list = SS.listSessions();
    expect(list).toHaveLength(3);
    expect(list.map(e => e.name)).toContain("Session A");
    expect(list.map(e => e.name)).toContain("Session B");
    expect(list.map(e => e.name)).toContain("Session C");
  });

  it("lists sessions with correct metadata", () => {
    const result = SS.saveSession(makeSession("My Session", 5));
    const list = SS.listSessions();
    const entry = list.find(e => e.id === result.id);
    expect(entry.name).toBe("My Session");
    expect(entry.handCount).toBe(5);
    expect(entry.sizeBytes).toBeGreaterThan(0);
    expect(entry.date).toBeGreaterThan(0);
    expect(entry.favorited).toBe(false);
  });

  it("deletes a session", () => {
    const r1 = SS.saveSession(makeSession("Keep"));
    const r2 = SS.saveSession(makeSession("Delete Me"));
    expect(SS.listSessions()).toHaveLength(2);

    SS.deleteSession(r2.id);
    expect(SS.listSessions()).toHaveLength(1);
    expect(SS.listSessions()[0].name).toBe("Keep");
    expect(SS.loadSession(r2.id)).toBeNull();
  });

  it("renames a session", () => {
    const r = SS.saveSession(makeSession("Old Name"));
    SS.renameSession(r.id, "New Name");

    const loaded = SS.loadSession(r.id);
    expect(loaded.session_name).toBe("New Name");

    const list = SS.listSessions();
    expect(list[0].name).toBe("New Name");
  });

  it("updates existing session on re-save (same _id)", () => {
    const session = makeSession("Original", 3);
    const r1 = SS.saveSession(session);

    session._id = r1.id;
    session.hands.push({ hand_id: 4, hand_label: "Hand 4", hero_seat: 1, button_seat: 1, stacks: {}, hero_cards: [], board: {}, action_sequence: [], result: {} });
    const r2 = SS.saveSession(session);

    expect(r2.id).toBe(r1.id);
    expect(SS.listSessions()).toHaveLength(1);
    expect(SS.loadSession(r1.id).hands).toHaveLength(4);
  });
});

// ============================================================
// Favorites and Sorting
// ============================================================

describe("Session Storage — Favorites", () => {
  beforeEach(() => localStorageMock.clear());

  it("toggles favorite on and off", () => {
    const r = SS.saveSession(makeSession("Fav Test"));
    expect(SS.listSessions()[0].favorited).toBe(false);

    SS.toggleFavorite(r.id);
    expect(SS.listSessions()[0].favorited).toBe(true);

    SS.toggleFavorite(r.id);
    expect(SS.listSessions()[0].favorited).toBe(false);
  });

  it("favorited sessions sort to top", () => {
    const r1 = SS.saveSession(makeSession("Older"));
    const r2 = SS.saveSession(makeSession("Newer"));
    SS.toggleFavorite(r1.id);

    const list = SS.listSessions();
    expect(list[0].name).toBe("Older"); // favorited, sorts first
    expect(list[1].name).toBe("Newer");
  });
});

// ============================================================
// Expiry
// ============================================================

describe("Session Storage — Expiry", () => {
  beforeEach(() => localStorageMock.clear());

  it("expires unfavorited sessions older than threshold", () => {
    const session = makeSession("Old Session");
    const r = SS.saveSession(session);

    // Manually backdate the lastAccessedAt
    const manifest = JSON.parse(localStorage.getItem(SS.SESSION_MANIFEST_KEY));
    manifest[0].lastAccessedAt = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
    localStorage.setItem(SS.SESSION_MANIFEST_KEY, JSON.stringify(manifest));

    const result = SS.expireOldSessions(90);
    expect(result.expired).toBe(1);
    expect(SS.listSessions()).toHaveLength(0);
  });

  it("does NOT expire favorited sessions", () => {
    const r = SS.saveSession(makeSession("Favorited Old"));
    SS.toggleFavorite(r.id);

    // Backdate
    const manifest = JSON.parse(localStorage.getItem(SS.SESSION_MANIFEST_KEY));
    manifest[0].lastAccessedAt = Date.now() - 100 * 24 * 60 * 60 * 1000;
    localStorage.setItem(SS.SESSION_MANIFEST_KEY, JSON.stringify(manifest));

    const result = SS.expireOldSessions(90);
    expect(result.expired).toBe(0);
    expect(SS.listSessions()).toHaveLength(1);
  });

  it("does NOT expire recent sessions", () => {
    SS.saveSession(makeSession("Recent"));
    const result = SS.expireOldSessions(90);
    expect(result.expired).toBe(0);
    expect(SS.listSessions()).toHaveLength(1);
  });
});

// ============================================================
// Migration
// ============================================================

describe("Session Storage — Migration", () => {
  beforeEach(() => localStorageMock.clear());

  it("migrates v0 session to v1 (adds description and _id)", () => {
    const v0 = { session_name: "Old Format", hands: [] };
    const migrated = SS.migrateSession(v0);
    expect(migrated._storageVersion).toBe(1);
    expect(migrated.description).toBe("");
    expect(migrated._id).toBeDefined();
  });

  it("does not re-migrate a v1 session", () => {
    const v1 = { _storageVersion: 1, _id: "existing", description: "Already set", hands: [] };
    const migrated = SS.migrateSession(v1);
    expect(migrated._id).toBe("existing");
    expect(migrated.description).toBe("Already set");
  });

  it("migrates legacy auto-save key to library", () => {
    const legacy = makeSession("Legacy Session");
    localStorage.setItem("sessionReplayerLastSession", JSON.stringify(legacy));

    const result = SS.migrateLegacyAutoSave();
    expect(result.migrated).toBe(true);
    expect(localStorage.getItem("sessionReplayerLastSession")).toBeNull();
    expect(SS.listSessions()).toHaveLength(1);
    expect(SS.listSessions()[0].name).toBe("Legacy Session");
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe("Session Storage — Edge Cases", () => {
  beforeEach(() => localStorageMock.clear());

  it("handles corrupted manifest gracefully", () => {
    localStorage.setItem(SS.SESSION_MANIFEST_KEY, "NOT VALID JSON{{{");
    const list = SS.listSessions();
    expect(list).toEqual([]); // graceful empty, not crash
  });

  it("repair recovers orphan sessions", () => {
    // Manually create a session without manifest entry
    const orphan = makeSession("Orphan");
    orphan._id = "orphan123";
    // Only these two keys should exist after beforeEach clear
    localStorage.setItem(SS.SESSION_PREFIX + "orphan123", JSON.stringify(orphan));
    localStorage.setItem(SS.SESSION_MANIFEST_KEY, JSON.stringify([]));

    const result = SS.repairManifest();
    expect(result.repaired).toBeGreaterThanOrEqual(1);

    const sessions = SS.listSessions();
    const orphanEntry = sessions.find(s => s.id === "orphan123");
    expect(orphanEntry).toBeDefined();
    expect(orphanEntry.name).toBe("Orphan");
  });

  it("repair removes stale manifest entries", () => {
    // Manifest points to a session that doesn't exist
    localStorage.setItem(SS.SESSION_MANIFEST_KEY, JSON.stringify([
      { id: "gone", name: "Ghost", date: 0, handCount: 0, sizeBytes: 0 }
    ]));

    const result = SS.repairManifest();
    expect(result.removed).toBeGreaterThanOrEqual(1);

    // The ghost entry should be gone
    const sessions = SS.listSessions();
    expect(sessions.find(s => s.id === "gone")).toBeUndefined();
  });

  it("returns error for invalid session data", () => {
    const result = SS.saveSession(null);
    expect(result.success).toBe(false);
  });

  it("saves sessions with same name as separate entries", () => {
    SS.saveSession(makeSession("Same Name"));
    SS.saveSession(makeSession("Same Name"));
    expect(SS.listSessions()).toHaveLength(2);
  });
});

// ============================================================
// Folder CRUD
// ============================================================

describe("Session Storage — Folders", () => {
  beforeEach(() => localStorageMock.clear());

  it("creates and lists a folder", () => {
    const r = SS.createFolder("3-Bet Pots");
    expect(r.success).toBe(true);

    const folders = SS.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("3-Bet Pots");
    expect(folders[0].handCount).toBe(0);
  });

  it("adds a hand to a folder (deep copy)", () => {
    const fr = SS.createFolder("Test Folder");
    const hand = makeSession("Source").hands[0];
    hand.hero_cards = ["Ah", "Kd"];

    const result = SS.addHandToFolder(fr.id, hand, "Source Session");
    expect(result.success).toBe(true);
    expect(result.handCount).toBe(1);

    const folder = SS.loadFolder(fr.id);
    expect(folder.hands).toHaveLength(1);
    expect(folder.hands[0].hero_cards).toEqual(["Ah", "Kd"]);
    expect(folder.hands[0]._sourceSession).toBe("Source Session");

    // Verify deep copy — mutating original doesn't affect folder
    hand.hero_cards[0] = "MUTATED";
    const reloaded = SS.loadFolder(fr.id);
    expect(reloaded.hands[0].hero_cards[0]).toBe("Ah"); // unchanged
  });

  it("adds hands from different sessions to same folder", () => {
    const fr = SS.createFolder("Mixed");
    const hand1 = makeSession("Session A").hands[0];
    hand1.hand_id = 1;
    const hand2 = makeSession("Session B").hands[0];
    hand2.hand_id = 1;

    SS.addHandToFolder(fr.id, hand1, "Session A");
    SS.addHandToFolder(fr.id, hand2, "Session B");

    const folder = SS.loadFolder(fr.id);
    expect(folder.hands).toHaveLength(2);
  });

  it("rejects duplicate hand in same folder from same source", () => {
    const fr = SS.createFolder("Dupes");
    const hand = makeSession("Source").hands[0];

    SS.addHandToFolder(fr.id, hand, "Source");
    const r = SS.addHandToFolder(fr.id, hand, "Source");
    expect(r.success).toBe(false);
    expect(r.error).toContain("already in folder");
  });

  it("loads folder as playable session shape", () => {
    const fr = SS.createFolder("Playable");
    const hand = makeSession("Source").hands[0];
    SS.addHandToFolder(fr.id, hand, "Source");

    const folder = SS.loadFolder(fr.id);
    // Should have session-like shape
    expect(folder.session_name).toBe("Playable");
    expect(folder.hands).toHaveLength(1);
    expect(folder.blinds).toBeDefined();
  });

  it("removes hand from folder", () => {
    const fr = SS.createFolder("Remove Test");
    const hands = makeSession("Source", 3).hands;
    SS.addHandToFolder(fr.id, hands[0], "Source");
    SS.addHandToFolder(fr.id, hands[1], "Source");
    SS.addHandToFolder(fr.id, hands[2], "Source");

    SS.removeHandFromFolder(fr.id, 1); // remove middle hand
    const folder = SS.loadFolder(fr.id);
    expect(folder.hands).toHaveLength(2);
  });

  it("deletes folder — original session unaffected", () => {
    const sr = SS.saveSession(makeSession("Original"));
    const fr = SS.createFolder("Temp");
    const session = SS.loadSession(sr.id);
    SS.addHandToFolder(fr.id, session.hands[0], "Original");

    SS.deleteFolder(fr.id);
    expect(SS.listFolders()).toHaveLength(0);

    // Original session still intact
    const original = SS.loadSession(sr.id);
    expect(original.hands).toHaveLength(3);
  });

  it("renames a folder", () => {
    const fr = SS.createFolder("Old Name");
    SS.renameFolder(fr.id, "New Name");

    const folders = SS.listFolders();
    expect(folders[0].name).toBe("New Name");

    const folder = SS.loadFolder(fr.id);
    expect(folder.session_name).toBe("New Name");
  });
});

// ============================================================
// Export
// ============================================================

describe("Session Storage — Export", () => {
  beforeEach(() => localStorageMock.clear());

  it("exports session as clean JSON without internal metadata", () => {
    const r = SS.saveSession(makeSession("Export Test"));
    const exported = SS.exportSession(r.id);
    expect(exported).toBeDefined();

    const parsed = JSON.parse(exported);
    expect(parsed.session_name).toBe("Export Test");
    expect(parsed._id).toBeUndefined();
    expect(parsed._storageVersion).toBeUndefined();
    expect(parsed._savedAt).toBeUndefined();
    expect(parsed._lastAccessedAt).toBeUndefined();
  });

  it("returns null for nonexistent session", () => {
    expect(SS.exportSession("nonexistent")).toBeNull();
  });
});

// ============================================================
// Storage Info
// ============================================================

describe("Session Storage — Storage Info", () => {
  beforeEach(() => localStorageMock.clear());

  it("reports storage usage", () => {
    SS.saveSession(makeSession("Session 1"));
    SS.saveSession(makeSession("Session 2"));

    const info = SS.getStorageInfo();
    expect(info.usedBytes).toBeGreaterThan(0);
    expect(info.sessionsCount).toBe(2);
    expect(info.percentUsed).toBeGreaterThanOrEqual(0);
    expect(info.percentUsed).toBeLessThan(100);
  });
});
