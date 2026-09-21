/*
 * leaderboard-view.js
 * -------------------
 * Drives leaderboard.html: a read-only, live-updating projector view.
 */
(function () {
  "use strict";

  var LB = window.LeaderboardSync;
  var LIMIT = 12;

  var els = {
    sessionDisplay: document.getElementById("session-code-display"),
    notConfigured: document.getElementById("not-configured"),
    boards: document.getElementById("boards"),
    creditBody: document.getElementById("credit-board-body"),
    netWorthBody: document.getElementById("networth-board-body"),
    creditEmpty: document.getElementById("credit-empty"),
    networthEmpty: document.getElementById("networth-empty")
  };

  function money(n) {
    var sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(Math.round(n)).toLocaleString();
  }

  function medal(rank) {
    if (rank === 0) return "1st";
    if (rank === 1) return "2nd";
    if (rank === 2) return "3rd";
    return String(rank + 1) + "th";
  }

  function renderBoard(tbody, emptyEl, rows, valueField, formatValue) {
    if (!rows.length) {
      tbody.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    tbody.innerHTML = rows.map(function (row, i) {
      return "<tr" + (i < 3 ? ' class="rank-top"' : "") + ">" +
        '<td class="rank-cell">' + medal(i) + "</td>" +
        "<td>" + escapeHtml(row.name || "Anonymous") + "</td>" +
        '<td class="value-cell">' + formatValue(row[valueField]) + "</td>" +
        "</tr>";
    }).join("");
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  els.sessionDisplay.textContent = LB.getSessionCode();

  if (!LB.isConfigured()) {
    els.notConfigured.hidden = false;
    els.boards.hidden = true;
    return;
  }

  LB.subscribeLeaderboard("credit", LIMIT, function (rows) {
    renderBoard(els.creditBody, els.creditEmpty, rows, "credit", function (v) { return String(v); });
  });

  LB.subscribeLeaderboard("netWorth", LIMIT, function (rows) {
    renderBoard(els.netWorthBody, els.networthEmpty, rows, "netWorth", money);
  });
})();
