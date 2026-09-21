/*
 * leaderboard-sync.js
 * -------------------
 * Thin wrapper around Firebase Realtime Database so the rest of the app
 * never has to think about Firebase directly. If firebase-config.js still
 * has placeholder values, every function here degrades gracefully instead
 * of throwing, so the game itself always works offline / solo.
 *
 * Expects the Firebase "compat" scripts to already be loaded as classic
 * <script> tags before this file:
 *   firebase-app-compat.js
 *   firebase-database-compat.js
 *
 * Entries are stored per "session" so one instructor can reuse this for
 * multiple halls/floors/class periods without leaderboards mixing:
 *   sessions/<code>/entries/<pushId>
 * The session code comes from the URL, e.g. index.html?session=3RD-FLOOR
 * and leaderboard.html?session=3RD-FLOOR — defaults to "default".
 */
(function (global) {
  "use strict";

  function isConfigured() {
    var c = global.FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.apiKey.indexOf("YOUR_") !== 0);
  }

  function getSessionCode() {
    var params = new URLSearchParams(global.location.search);
    var code = (params.get("session") || "default").trim();
    // Keep it filesystem/Firebase-path safe.
    code = code.replace(/[.#$\[\]\/\s]+/g, "-").slice(0, 40);
    return code || "default";
  }

  var app = null;
  var db = null;
  var configured = false;

  if (isConfigured() && global.firebase) {
    try {
      app = global.firebase.initializeApp(global.FIREBASE_CONFIG);
      db = global.firebase.database();
      configured = true;
    } catch (e) {
      console.warn("Firebase failed to initialize — leaderboard sync disabled.", e);
      configured = false;
    }
  }

  function entriesRef() {
    return db.ref("sessions/" + getSessionCode() + "/entries");
  }

  // Writes (or overwrites, if the same name plays twice) one player's
  // current result. Safe to call repeatedly — e.g. after every round —
  // so the leaderboard can update live as people play, not just at the end.
  function submitScore(entry) {
    if (!configured) return Promise.resolve(false);
    var key = (entry.playerId || entry.name || "player").toString()
      .toLowerCase().replace(/[.#$\[\]\/\s]+/g, "-").slice(0, 60) || "player";
    var payload = {
      name: (entry.name || "Anonymous").toString().slice(0, 40),
      credit: Math.round(entry.credit),
      netWorth: Math.round(entry.netWorth),
      cash: Math.round(entry.cash),
      invest: Math.round(entry.invest),
      ccDebt: Math.round(entry.ccDebt),
      loanDebt: Math.round(entry.loanDebt),
      round: entry.round,
      updatedAt: (global.firebase.database.ServerValue && global.firebase.database.ServerValue.TIMESTAMP) || Date.now()
    };
    return entriesRef().child(key).set(payload)
      .then(function () { return true; })
      .catch(function (e) {
        console.warn("Leaderboard submit failed:", e);
        return false;
      });
  }

  // callback(list) fires immediately and on every live change.
  // field is "credit" or "netWorth". Returns an unsubscribe function.
  function subscribeLeaderboard(field, limit, callback) {
    if (!configured) return function () {};
    var query = entriesRef().orderByChild(field).limitToLast(limit || 10);
    var handler = query.on("value", function (snap) {
      var rows = [];
      snap.forEach(function (child) {
        rows.push(child.val());
      });
      rows.reverse(); // Firebase returns ascending; leaderboards read best-first.
      callback(rows);
    }, function (err) {
      console.warn("Leaderboard subscription error:", err);
      callback([]);
    });
    return function () { query.off("value", handler); };
  }

  global.LeaderboardSync = {
    isConfigured: function () { return configured; },
    getSessionCode: getSessionCode,
    submitScore: submitScore,
    subscribeLeaderboard: subscribeLeaderboard
  };
})(window);
