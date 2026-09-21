/*
 * app.js
 * ------
 * Drives index.html: the actual play experience. State machine with three
 * screens (intro -> round -> result), rendered by hand into the DOM
 * (no framework — this is meant to run as plain files, including
 * straight off disk).
 */
(function () {
  "use strict";

  var G = window.Game;
  var LB = window.LeaderboardSync;
  var ROUNDS = G.ROUNDS;
  var TOTAL_ROUNDS = ROUNDS.length;
  var SESSION_TIME_SECONDS = 22 * 60;

  var els = {
    intro: document.getElementById("screen-intro"),
    round: document.getElementById("screen-round"),
    result: document.getElementById("screen-result"),
    nameInput: document.getElementById("player-name"),
    startBtn: document.getElementById("btn-start"),
    sessionDisplay: document.getElementById("session-code-display"),
    timer: document.getElementById("timer"),
    roundCounter: document.getElementById("round-counter"),
    statBar: document.getElementById("stat-bar"),
    debtPanel: document.getElementById("debt-panel"),
    debtRows: document.getElementById("debt-rows"),
    tickBanner: document.getElementById("tick-banner"),
    roundTag: document.getElementById("round-tag"),
    roundTitle: document.getElementById("round-title"),
    roundText: document.getElementById("round-text"),
    choices: document.getElementById("choices"),
    feedbackPanel: document.getElementById("feedback-panel"),
    feedbackNote: document.getElementById("feedback-note"),
    continueBtn: document.getElementById("btn-continue"),
    resultStats: document.getElementById("result-stats"),
    resultTakeaway: document.getElementById("result-takeaway"),
    resultName: document.getElementById("result-name"),
    leaderboardLink: document.getElementById("leaderboard-link"),
    playAgainBtn: document.getElementById("btn-play-again"),
    syncStatus: document.getElementById("sync-status")
  };

  var state = null;
  var roundIndex = 0;
  var roundLocked = false;
  var timerInterval = null;
  var startedAt = null;

  function showScreen(name) {
    els.intro.hidden = name !== "intro";
    els.round.hidden = name !== "round";
    els.result.hidden = name !== "result";
  }

  function money(n) {
    var sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(Math.round(n)).toLocaleString();
  }

  function renderStatBar() {
    var nw = G.netWorth(state);
    var band = G.creditBand(state.credit);
    els.statBar.innerHTML =
      statCell("Cash", money(state.cash)) +
      statCell("Investments", money(state.invest)) +
      statCell("Debt", money(state.ccDebt + state.loanDebt), state.ccDebt + state.loanDebt > 0 ? "neg" : "") +
      statCell("Net Worth", money(nw), nw < 0 ? "neg" : "pos") +
      statCell("Credit Score", state.credit + " · " + band, creditClass(state.credit));
  }

  function creditClass(score) {
    if (score >= 670) return "pos";
    if (score < 580) return "neg";
    return "";
  }

  function statCell(label, value, cls) {
    return '<div class="stat"><span class="stat-label">' + label + '</span>' +
      '<span class="stat-value' + (cls ? " " + cls : "") + '">' + value + "</span></div>";
  }

  // Debt isn't only paid down when a scenario happens to offer it — this
  // panel lets a player put spare cash toward either balance on any
  // round, at any point, for any amount they can actually afford.
  var DEBT_FIELDS = [
    { field: "ccDebt", label: "Credit Card" },
    { field: "loanDebt", label: "Student Loan" }
  ];

  function renderDebtPanel() {
    var owed = DEBT_FIELDS.filter(function (d) { return state[d.field] > 0; });
    if (!owed.length) {
      els.debtPanel.hidden = true;
      els.debtRows.innerHTML = "";
      return;
    }
    els.debtPanel.hidden = false;
    els.debtRows.innerHTML = owed.map(debtRowHtml).join("");
    owed.forEach(function (d) {
      var input = document.getElementById("debt-input-" + d.field);
      var btn = document.getElementById("debt-pay-" + d.field);
      if (btn) btn.addEventListener("click", function () { payDebt(d.field, input); });
      if (input) input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") payDebt(d.field, input);
      });
    });
  }

  function debtRowHtml(d) {
    var balance = state[d.field];
    var maxPay = Math.floor(Math.min(state.cash, balance));
    var disabled = maxPay <= 0;
    return '<div class="debt-row">' +
      '<span class="debt-row-label">' + d.label + '<span class="debt-row-balance tnum">' + money(balance) + "</span></span>" +
      '<span class="debt-row-controls">' +
      '<input type="number" class="debt-input" id="debt-input-' + d.field + '" min="0" max="' + maxPay + '" step="1" value="' + maxPay + '"' + (disabled ? " disabled" : "") + " />" +
      '<button type="button" class="btn-pay" id="debt-pay-' + d.field + '"' + (disabled ? " disabled" : "") + ">Pay</button>" +
      "</span></div>";
  }

  function payDebt(field, input) {
    var balance = state[field];
    var maxPay = Math.min(state.cash, balance);
    var raw = parseFloat(input && input.value);
    var amount = G.round2(Math.max(0, Math.min(isNaN(raw) ? maxPay : raw, maxPay)));
    if (amount <= 0) return;
    state.cash = G.round2(state.cash - amount);
    state[field] = G.round2(balance - amount);
    renderStatBar();
    renderDebtPanel();
    submitProgress();
  }

  function renderTick(messages) {
    if (!messages || !messages.length) {
      els.tickBanner.hidden = true;
      els.tickBanner.innerHTML = "";
      return;
    }
    els.tickBanner.hidden = false;
    els.tickBanner.innerHTML = messages.map(function (m) {
      var glyph = m.dir === "up" ? "▲" : "▼";
      return '<div class="tick-line ' + m.dir + '"><span class="tick-glyph">' + glyph + "</span>" + m.text + "</div>";
    }).join("");
  }

  function renderRound() {
    var round = ROUNDS[roundIndex];
    roundLocked = false;
    var text = typeof round.text === "function" ? round.text(state) : round.text;
    var choices = typeof round.choices === "function" ? round.choices(state) : round.choices;
    els.roundCounter.textContent = "Round " + (roundIndex + 1) + " of " + TOTAL_ROUNDS;
    els.roundTag.textContent = round.tag;
    els.roundTitle.textContent = round.title;
    els.roundText.textContent = text;
    els.choices.innerHTML = "";
    els.feedbackPanel.hidden = true;
    els.choices.hidden = false;

    choices.forEach(function (choice, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";
      btn.innerHTML = '<span class="choice-letter">' + String.fromCharCode(65 + i) + "</span>" +
        '<span class="choice-label">' + choice.label + "</span>";
      btn.addEventListener("click", function () { pickChoice(choice, btn); });
      els.choices.appendChild(btn);
    });

    renderStatBar();
    renderDebtPanel();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pickChoice(choice, btn) {
    if (roundLocked) return;
    roundLocked = true;

    Array.prototype.forEach.call(els.choices.querySelectorAll(".choice"), function (b) {
      b.disabled = true;
      b.classList.toggle("choice-selected", b === btn);
    });

    var effect = choice.effect(state) || {};
    state.cash += effect.cash || 0;
    state.ccDebt = Math.max(0, state.ccDebt + (effect.ccDebt || 0));
    state.loanDebt = Math.max(0, state.loanDebt + (effect.loanDebt || 0));
    state.invest = Math.max(0, state.invest + (effect.invest || 0));
    state.credit = G.clampCredit(state.credit + (effect.credit || 0));

    // A checking account can't actually go negative — any shortfall
    // becomes credit card debt instead, the same way a real overdraft
    // does, and it starts accruing interest on the next tick like any
    // other balance.
    var shortfall = G.settleCash(state);

    els.choices.hidden = true;
    els.feedbackPanel.hidden = false;
    var note = effect.note || "";
    if (shortfall > 0) {
      note += " You didn't have the cash to cover this — " + money(shortfall) + " went on your credit card instead.";
    }
    els.feedbackNote.textContent = note;
    renderStatBar();
    renderDebtPanel();
    submitProgress();
  }

  function submitProgress() {
    if (!LB.isConfigured()) return;
    LB.submitScore({
      playerId: state.playerId,
      name: state.name,
      credit: state.credit,
      netWorth: G.netWorth(state),
      cash: state.cash,
      invest: state.invest,
      ccDebt: state.ccDebt,
      loanDebt: state.loanDebt,
      round: roundIndex + 1
    });
  }

  function goNext() {
    roundIndex += 1;
    var tick = G.applyTick(state, roundIndex);
    state = tick.state;

    if (roundIndex >= TOTAL_ROUNDS) {
      finishGame(tick.messages);
      return;
    }
    renderTick(tick.messages);
    renderRound();
  }

  function finishGame(finalTickMessages) {
    stopTimer();
    var nw = G.netWorth(state);
    var band = G.creditBand(state.credit);
    els.resultName.textContent = state.name;
    els.resultStats.innerHTML =
      resultRow("Cash", money(state.cash)) +
      resultRow("Investments", money(state.invest)) +
      resultRow("Credit Card Debt", money(state.ccDebt)) +
      resultRow("Student Loan Debt", money(state.loanDebt)) +
      resultRow("Net Worth", money(nw), nw < 0 ? "neg" : "pos") +
      resultRow("Credit Score", state.credit + " (" + band + ")", creditClass(state.credit));
    els.resultTakeaway.textContent = G.buildTakeaway(state);

    var sessionCode = LB.getSessionCode();
    els.leaderboardLink.href = "leaderboard.html?session=" + encodeURIComponent(sessionCode);

    if (LB.isConfigured()) {
      submitProgress();
      els.syncStatus.textContent = "Your result is live on the leaderboard.";
      els.syncStatus.hidden = false;
    } else {
      els.syncStatus.textContent = "Leaderboard sync isn't configured for this copy — see README.md.";
      els.syncStatus.hidden = false;
    }

    showScreen("result");
  }

  function resultRow(label, value, cls) {
    return '<div class="result-row"><span>' + label + '</span><span class="' + (cls || "") + '">' + value + "</span></div>";
  }

  function startTimer() {
    startedAt = Date.now();
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = null;
  }

  function updateTimer() {
    var elapsed = Math.floor((Date.now() - startedAt) / 1000);
    var remaining = Math.max(0, SESSION_TIME_SECONDS - elapsed);
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    els.timer.textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    els.timer.classList.toggle("timer-low", remaining <= 60);
  }

  function startGame() {
    var name = (els.nameInput.value || "").trim() || "Anonymous";
    state = Object.assign({}, G.STARTING_STATE, {
      name: name,
      playerId: name + "-" + Math.random().toString(36).slice(2, 8)
    });
    roundIndex = 0;
    renderTick(null);
    renderRound();
    startTimer();
    showScreen("round");
  }

  function playAgain() {
    stopTimer();
    els.nameInput.value = "";
    showScreen("intro");
    els.nameInput.focus();
  }

  els.startBtn.addEventListener("click", startGame);
  els.nameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") startGame();
  });
  els.continueBtn.addEventListener("click", goNext);
  els.playAgainBtn.addEventListener("click", playAgain);

  els.sessionDisplay.textContent = LB.getSessionCode();
  showScreen("intro");
  els.nameInput.focus();
})();
