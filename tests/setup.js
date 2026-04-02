// Test setup — load shared modules into global scope (simulating browser environment)

// Load in dependency order
require("../shared/constants.js");
require("../shared/card_utils.js");
require("../shared/table_engine.js");
require("../shared/holdem_validator.js");

// Make globals available (these set themselves on `window` but in Node there's no window)
// The modules check for `window` and also check for `module.exports`
// We need to ensure they're accessible

if (typeof globalThis.PokerConstants === "undefined") {
  globalThis.PokerConstants = require("../shared/constants.js");
}
if (typeof globalThis.CardUtils === "undefined") {
  globalThis.CardUtils = require("../shared/card_utils.js");
}
if (typeof globalThis.PokerEngine === "undefined") {
  globalThis.PokerEngine = require("../shared/table_engine.js");
}
if (typeof globalThis.HoldemValidator === "undefined") {
  globalThis.HoldemValidator = require("../shared/holdem_validator.js");
}
