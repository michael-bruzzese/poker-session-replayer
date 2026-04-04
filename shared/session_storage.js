// Session Storage — localStorage-backed session library with versioning and folders
// No DOM dependencies. Pure data management.

const SessionStorage = (() => {
  "use strict";

  const CURRENT_VERSION = 1;
  const SESSION_MANIFEST_KEY = "sr_session_manifest";
  const FOLDER_MANIFEST_KEY = "sr_folder_manifest";
  const SESSION_PREFIX = "sr_session_";
  const FOLDER_PREFIX = "sr_folder_";
  const MAX_STORAGE_BYTES = 4.5 * 1024 * 1024; // warn at 4.5MB (localStorage limit ~5-10MB)

  // ---- UUID ----

  function generateId() {
    // Simple unique ID — timestamp + random suffix
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---- Manifest Management ----

  function readManifest(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeManifest(key, manifest) {
    localStorage.setItem(key, JSON.stringify(manifest));
  }

  // ---- Session CRUD ----

  function saveSession(session) {
    if (!session || !session.hands) return { success: false, error: "Invalid session data" };

    const manifest = readManifest(SESSION_MANIFEST_KEY);
    const now = Date.now();

    // Check if this session already exists in the library
    let id = session._id;
    let existingIdx = -1;
    if (id) {
      existingIdx = manifest.findIndex(e => e.id === id);
    }

    if (!id) {
      id = generateId();
      session._id = id;
    }

    // Add storage metadata
    session._storageVersion = CURRENT_VERSION;
    session._savedAt = session._savedAt || now;
    session._lastAccessedAt = now;

    // Serialize and check size
    const serialized = JSON.stringify(session);
    const sizeBytes = serialized.length;

    // Check total storage
    const totalUsage = getStorageUsage();
    const existingSize = existingIdx >= 0 ? (manifest[existingIdx].sizeBytes || 0) : 0;
    if (totalUsage - existingSize + sizeBytes > MAX_STORAGE_BYTES) {
      return { success: false, error: "Storage full. Delete old sessions to make room." };
    }

    // Save session data
    try {
      localStorage.setItem(SESSION_PREFIX + id, serialized);
    } catch (e) {
      return { success: false, error: "Failed to save: " + e.message };
    }

    // Update manifest
    const entry = {
      id,
      name: session.session_name || session.name || "Unnamed Session",
      date: session._savedAt,
      lastAccessedAt: now,
      handCount: (session.hands || []).length,
      sizeBytes,
      favorited: existingIdx >= 0 ? (manifest[existingIdx].favorited || false) : false
    };

    if (existingIdx >= 0) {
      manifest[existingIdx] = { ...manifest[existingIdx], ...entry };
    } else {
      manifest.push(entry);
    }

    writeManifest(SESSION_MANIFEST_KEY, manifest);
    return { success: true, id, sizeBytes };
  }

  function loadSession(id) {
    try {
      const raw = localStorage.getItem(SESSION_PREFIX + id);
      if (!raw) return null;
      const session = JSON.parse(raw);
      const migrated = migrateSession(session);

      // Update last accessed time
      migrated._lastAccessedAt = Date.now();
      localStorage.setItem(SESSION_PREFIX + id, JSON.stringify(migrated));

      // Update manifest
      const manifest = readManifest(SESSION_MANIFEST_KEY);
      const idx = manifest.findIndex(e => e.id === id);
      if (idx >= 0) {
        manifest[idx].lastAccessedAt = migrated._lastAccessedAt;
        writeManifest(SESSION_MANIFEST_KEY, manifest);
      }

      return migrated;
    } catch (_) {
      return null;
    }
  }

  function deleteSession(id) {
    localStorage.removeItem(SESSION_PREFIX + id);
    const manifest = readManifest(SESSION_MANIFEST_KEY);
    const filtered = manifest.filter(e => e.id !== id);
    writeManifest(SESSION_MANIFEST_KEY, filtered);
    return { success: true };
  }

  function renameSession(id, newName) {
    const session = loadSession(id);
    if (!session) return { success: false, error: "Session not found" };
    session.session_name = newName;
    session.name = newName;
    localStorage.setItem(SESSION_PREFIX + id, JSON.stringify(session));

    const manifest = readManifest(SESSION_MANIFEST_KEY);
    const idx = manifest.findIndex(e => e.id === id);
    if (idx >= 0) {
      manifest[idx].name = newName;
      writeManifest(SESSION_MANIFEST_KEY, manifest);
    }
    return { success: true };
  }

  function toggleFavorite(id) {
    const manifest = readManifest(SESSION_MANIFEST_KEY);
    const idx = manifest.findIndex(e => e.id === id);
    if (idx < 0) return { success: false, error: "Session not found" };
    manifest[idx].favorited = !manifest[idx].favorited;
    writeManifest(SESSION_MANIFEST_KEY, manifest);
    return { success: true, favorited: manifest[idx].favorited };
  }

  function listSessions() {
    const manifest = readManifest(SESSION_MANIFEST_KEY);
    // Sort: favorited first, then by most recently accessed
    return manifest.slice().sort((a, b) => {
      if (a.favorited && !b.favorited) return -1;
      if (!a.favorited && b.favorited) return 1;
      return (b.lastAccessedAt || 0) - (a.lastAccessedAt || 0);
    });
  }

  // ---- Expiry ----

  function expireOldSessions(maxAgeDays) {
    const manifest = readManifest(SESSION_MANIFEST_KEY);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const keep = [];
    const expired = [];

    for (const entry of manifest) {
      if (entry.favorited || (entry.lastAccessedAt || entry.date || 0) > cutoff) {
        keep.push(entry);
      } else {
        localStorage.removeItem(SESSION_PREFIX + entry.id);
        expired.push(entry.id);
      }
    }

    if (expired.length > 0) {
      writeManifest(SESSION_MANIFEST_KEY, keep);
    }
    return { expired: expired.length, kept: keep.length };
  }

  // ---- Migration ----

  function migrateSession(data) {
    if (!data) return data;
    const version = data._storageVersion || 0;

    // v0 → v1: add description field, ensure _id
    if (version < 1) {
      if (!data.description) data.description = "";
      if (!data._id) data._id = generateId();
      data._storageVersion = 1;
    }

    // Future migrations go here:
    // if (version < 2) { ... data._storageVersion = 2; }

    return data;
  }

  // ---- Storage Usage ----

  function getStorageUsage() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("sr_") || key === "sessionReplayerLastSession")) {
        total += (localStorage.getItem(key) || "").length;
      }
    }
    return total;
  }

  function getStorageInfo() {
    const usage = getStorageUsage();
    return {
      usedBytes: usage,
      maxBytes: MAX_STORAGE_BYTES,
      percentUsed: Math.round(usage / MAX_STORAGE_BYTES * 100),
      sessionsCount: readManifest(SESSION_MANIFEST_KEY).length,
      foldersCount: readManifest(FOLDER_MANIFEST_KEY).length
    };
  }

  // ---- Manifest Repair ----

  function repairManifest() {
    // Scan localStorage for session keys not in manifest
    const manifest = readManifest(SESSION_MANIFEST_KEY);
    const knownIds = new Set(manifest.map(e => e.id));
    const orphans = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SESSION_PREFIX)) {
        const id = key.slice(SESSION_PREFIX.length);
        if (!knownIds.has(id)) {
          // Orphan session — try to read and add to manifest
          try {
            const data = JSON.parse(localStorage.getItem(key));
            manifest.push({
              id,
              name: data.session_name || data.name || "Recovered Session",
              date: data._savedAt || Date.now(),
              lastAccessedAt: data._lastAccessedAt || Date.now(),
              handCount: (data.hands || []).length,
              sizeBytes: (localStorage.getItem(key) || "").length,
              favorited: false
            });
            orphans.push(id);
          } catch (_) {
            // Corrupted — remove it
            localStorage.removeItem(key);
          }
        }
      }
    }

    // Remove manifest entries with no data
    const validManifest = manifest.filter(e => {
      return localStorage.getItem(SESSION_PREFIX + e.id) !== null;
    });

    writeManifest(SESSION_MANIFEST_KEY, validManifest);
    return { repaired: orphans.length, removed: manifest.length - validManifest.length };
  }

  // ---- Folder CRUD ----

  function createFolder(name) {
    const id = generateId();
    const folder = {
      _id: id,
      _type: "folder",
      session_name: name,
      name: name,
      created: Date.now(),
      blinds: { small: 2, big: 5 },
      players: {},
      hands: []
    };

    localStorage.setItem(FOLDER_PREFIX + id, JSON.stringify(folder));

    const manifest = readManifest(FOLDER_MANIFEST_KEY);
    manifest.push({
      id,
      name,
      created: folder.created,
      handCount: 0
    });
    writeManifest(FOLDER_MANIFEST_KEY, manifest);

    return { success: true, id };
  }

  function deleteFolder(id) {
    localStorage.removeItem(FOLDER_PREFIX + id);
    const manifest = readManifest(FOLDER_MANIFEST_KEY);
    writeManifest(FOLDER_MANIFEST_KEY, manifest.filter(e => e.id !== id));
    return { success: true };
  }

  function renameFolder(id, newName) {
    try {
      const raw = localStorage.getItem(FOLDER_PREFIX + id);
      if (!raw) return { success: false, error: "Folder not found" };
      const folder = JSON.parse(raw);
      folder.name = newName;
      folder.session_name = newName;
      localStorage.setItem(FOLDER_PREFIX + id, JSON.stringify(folder));

      const manifest = readManifest(FOLDER_MANIFEST_KEY);
      const idx = manifest.findIndex(e => e.id === id);
      if (idx >= 0) {
        manifest[idx].name = newName;
        writeManifest(FOLDER_MANIFEST_KEY, manifest);
      }
      return { success: true };
    } catch (_) {
      return { success: false, error: "Failed to rename folder" };
    }
  }

  function listFolders() {
    return readManifest(FOLDER_MANIFEST_KEY);
  }

  function loadFolder(id) {
    try {
      const raw = localStorage.getItem(FOLDER_PREFIX + id);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function addHandToFolder(folderId, hand, sourceSessionName) {
    const folder = loadFolder(folderId);
    if (!folder) return { success: false, error: "Folder not found" };

    // Check for duplicate (same hand_id from same source)
    const isDupe = folder.hands.some(
      h => h.hand_id === hand.hand_id && h._sourceSession === sourceSessionName
    );
    if (isDupe) return { success: false, error: "Hand already in folder" };

    // Deep copy the hand
    const copy = JSON.parse(JSON.stringify(hand));
    copy._sourceSession = sourceSessionName;
    copy._addedAt = Date.now();

    folder.hands.push(copy);
    localStorage.setItem(FOLDER_PREFIX + folderId, JSON.stringify(folder));

    // Update manifest hand count
    const manifest = readManifest(FOLDER_MANIFEST_KEY);
    const idx = manifest.findIndex(e => e.id === folderId);
    if (idx >= 0) {
      manifest[idx].handCount = folder.hands.length;
      writeManifest(FOLDER_MANIFEST_KEY, manifest);
    }

    return { success: true, handCount: folder.hands.length };
  }

  function removeHandFromFolder(folderId, handIndex) {
    const folder = loadFolder(folderId);
    if (!folder) return { success: false, error: "Folder not found" };
    if (handIndex < 0 || handIndex >= folder.hands.length) return { success: false, error: "Invalid hand index" };

    folder.hands.splice(handIndex, 1);
    localStorage.setItem(FOLDER_PREFIX + folderId, JSON.stringify(folder));

    const manifest = readManifest(FOLDER_MANIFEST_KEY);
    const idx = manifest.findIndex(e => e.id === folderId);
    if (idx >= 0) {
      manifest[idx].handCount = folder.hands.length;
      writeManifest(FOLDER_MANIFEST_KEY, manifest);
    }

    return { success: true, handCount: folder.hands.length };
  }

  // ---- Export ----

  function exportSession(id) {
    const raw = localStorage.getItem(SESSION_PREFIX + id);
    if (!raw) return null;
    // Strip internal storage metadata for clean export
    const session = JSON.parse(raw);
    delete session._id;
    delete session._storageVersion;
    delete session._savedAt;
    delete session._lastAccessedAt;
    return JSON.stringify(session, null, 2);
  }

  // ---- Legacy Migration ----

  function migrateLegacyAutoSave() {
    // Migrate old sessionReplayerLastSession key to the new library
    const legacyKey = "sessionReplayerLastSession";
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return { migrated: false };

    try {
      const data = JSON.parse(raw);
      if (data && data.hands && data.hands.length > 0) {
        const result = saveSession(data);
        if (result.success) {
          localStorage.removeItem(legacyKey);
          return { migrated: true, id: result.id };
        }
      }
    } catch (_) {
      // Corrupted legacy data — just remove it
      localStorage.removeItem(legacyKey);
    }
    return { migrated: false };
  }

  // ---- Public API ----

  return {
    // Session CRUD
    saveSession,
    loadSession,
    deleteSession,
    renameSession,
    toggleFavorite,
    listSessions,

    // Expiry
    expireOldSessions,

    // Migration
    migrateSession,
    migrateLegacyAutoSave,

    // Storage info
    getStorageUsage,
    getStorageInfo,
    repairManifest,

    // Export
    exportSession,

    // Folder CRUD
    createFolder,
    deleteFolder,
    renameFolder,
    listFolders,
    loadFolder,
    addHandToFolder,
    removeHandFromFolder,

    // Constants (for testing)
    CURRENT_VERSION,
    SESSION_MANIFEST_KEY,
    FOLDER_MANIFEST_KEY,
    SESSION_PREFIX,
    FOLDER_PREFIX
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SessionStorage;
} else if (typeof window !== "undefined") {
  window.SessionStorage = SessionStorage;
}
