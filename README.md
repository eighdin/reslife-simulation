# Ledger & Line — a financial choices simulation

A single-session web activity for teaching basic personal finance. Each
player works through eighteen realistic money decisions (a store-card
discount, a car repair, a 401(k) match, a friend's hot stock tip, a
payday loan offer...) and watches two numbers move: **credit score** and
**net worth**. Several rounds have genuinely uncertain outcomes — the
same choice can pay off or backfire, the way real financial bets do —
and a couple of rounds change shape based on decisions made earlier in
the same playthrough. Many rounds also keep the underlying cost identical
across every option, so the choice is really about *how* you handle a
given expense (cash vs. credit vs. financing), not about spending more or
less. Nobody "loses" — you can end a round deep in debt, and that's the
lesson landing, not a failure state. Everyone's results feed a live,
shared leaderboard so a group can compare notes right after.

No accounts, no login for players — anyone with the link plays. It's built
as plain static files (HTML/CSS/JS, no build step, no server) so it runs
from a folder on your laptop or from any static web host.

## How it's structured

| File | Purpose |
|---|---|
| `index.html` / `js/app.js` | The player experience — intro, eighteen rounds, results. |
| `leaderboard.html` / `js/leaderboard-view.js` | The read-only live leaderboard, meant for a projector or shared screen. |
| `js/game-data.js` | All eighteen scenarios, choices, dollar amounts, and the interest/credit-score/randomness math. Edit this to customize content — nothing else needs to change. |
| `js/firebase-config.js` | Where you paste your own Firebase project keys (see setup below). |
| `js/leaderboard-sync.js` | Thin wrapper that reads/writes the shared leaderboard. Degrades gracefully if Firebase isn't configured. |
| `css/style.css` | All styling for both pages. |

## Running it without any setup

Open `index.html` directly in a browser (double-click it, or drag it into a
tab). The full game works end-to-end — rounds, math, results screen. The
only thing that won't work yet is the **shared** leaderboard: it'll tell you
sync isn't configured. That's expected until you complete the five-minute
setup below.

## Setting up the live leaderboard (~5 minutes, free)

The leaderboard uses **Firebase Realtime Database**, Google's free
real-time data store — it's what lets every player's browser update the
same leaderboard live, with no server of your own to run.

1. Go to <https://console.firebase.google.com>, sign in with any Google
   account, and click **Add project**. Name it anything (e.g.
   `reslife-simulation`). You can decline Google Analytics — not needed.
2. In the project, click the **`</>`** (web app) icon to register a new web
   app. Give it any nickname. You do **not** need Firebase Hosting for this.
3. Firebase shows you a `firebaseConfig` object. Copy its values into
   `js/firebase-config.js` in this project, replacing the placeholders.
4. In the left sidebar, go to **Build → Realtime Database → Create
   Database**. Pick any location. Start in **test mode** for a quick first
   run, or paste the rules below for something a little safer.
5. Save. Open `index.html`, play through, and open `leaderboard.html` in a
   second tab — your result should already be there.

### Recommended database rules

Test mode leaves the database wide open to the internet indefinitely,
which is fine for a one-off trial but not something to leave live. Once
things work, switch to rules that keep it public-read (so the leaderboard
displays) and public-write only into the expected shape, capped in size:

```json
{
  "rules": {
    "sessions": {
      "$session": {
        ".read": true,
        "entries": {
          "$entry": {
            ".write": true,
            ".validate": "newData.hasChildren(['name','credit','netWorth'])"
          }
        }
      }
    }
  }
}
```

Because there's no login, anyone with your Firebase project's public
config could technically write to it — that's an inherent trade-off of a
no-accounts, link-only activity. It's a reasonable one for a short, live,
in-person session; don't reuse the same Firebase project for anything
sensitive.

## Deploying it as a hosted page

Any static host works — here's the easiest free path:

1. Create a new GitHub repository and push this folder's contents to it.
2. In the repo's **Settings → Pages**, set the source to your default
   branch, root folder.
3. GitHub gives you a URL like `https://yourname.github.io/reslife-simulation/`.
   Share `index.html` with players and keep `leaderboard.html` open on the
   projector.

A university web server, Netlify, or Vercel all work the same way — this
is just files, no server-side code to configure.

## Running multiple sessions (different halls, floors, or class periods)

Add `?session=CODE` to both URLs, using the same code for one group:

```
index.html?session=north-hall
leaderboard.html?session=north-hall
```

Each session code gets its own leaderboard, so groups never mix. Leaving
off `?session=` puts everyone in a shared `default` session.

## Facilitation notes

- **Pacing:** eighteen rounds at roughly 70–90 seconds each (read, decide,
  read the feedback) fills about 22 minutes. The in-page timer is a soft
  pace-setter, not a countdown that ends the game — nobody gets cut off
  mid-decision. Trim rounds out of `js/game-data.js` if you need to hit a
  strict 15.
- **The "right" answer isn't always obvious, on purpose.** Several rounds
  (Side Income, Investing Approach, Debt Strategy, the windfall's stock
  tip, Cosigning, the Health & Risk copay, the final Portfolio Check-In)
  roll real randomness — the same choice can play out well or badly.
  That's intentional: it mirrors how actual financial risk works, and it
  means two players who made the same call can end up with different
  results. A couple of rounds also react to earlier choices — skipping
  renters insurance early on quietly raises the stakes of an "Apartment
  Incident" round later.
- **Many rounds hold the expense fixed on purpose.** Move-In Budget,
  Everyday Spending, the laptop in Big Purchase, and the Health & Risk
  copay all keep the underlying cost identical across every option — the
  choice is entirely about payment method (cash vs. credit-paid-in-full
  vs. credit-minimum vs. financing), not about buying more or less. That's
  deliberate: it isolates the one variable each of those rounds is
  actually testing.
- **Debt can be paid down on any round, not just when a scenario offers
  it.** Whenever a player is carrying a credit card or student loan
  balance, a "Make an extra payment" panel appears above the scenario,
  pre-filled with the most they can currently afford, editable down from
  there. It's a standing option available every round, independent of
  that round's actual decision — the story-specific debt choices
  (Windfall, Debt Strategy, Retirement Match) are still there on top of it.
- **Interest and investment growth compound every two rounds**, not every
  round — the tick banner only appears on even-numbered round transitions,
  and when it does, the rate applied is the properly compounded two-round
  rate (not just double the one-round rate). Change `TICK_EVERY_N_ROUNDS`
  in `js/game-data.js` to adjust the cadence.
- **Debrief prompt:** after the live leaderboard fills in, ask who has the
  best credit score *and* the best net worth — they're often different
  people. Also worth asking: who made the same choice as someone else in
  a random-outcome round, but ended up with a very different result? That's
  a good entry point into "good decisions can still turn out badly, and
  bad decisions can still get lucky — over many decisions, though, the
  odds catch up with you."
- **Re-running it:** click "Play again" on the results screen, or just
  reload `index.html`. Same name submitted twice overwrites that player's
  leaderboard row rather than duplicating it.

## The eighteen rounds, and what each one teaches

1. **Move-In Budget** — the same $150 purchase, three payment methods:
   card-paid-in-full, card-paid-minimum, or full-price cash. Why "pay it
   in full" is a plan that can still slip.
2. **Emergency Fund** — cash reserves vs. gambling that a problem holds off
   a little longer.
3. **Subscriptions** — small recurring costs compounding over a year.
4. **Everyday Spending** — the same $60 grocery run, three ways to pay,
   including a buy-now-pay-later app with a real (if smaller) failure mode.
5. **Retirement Match** — an employer match as (near) guaranteed return,
   weighed against debt sitting at a high APR.
6. **Big Purchase** — the same $950 required laptop, cash vs. 0% financing
   paid on time vs. 0% financing left to chance — deferred-interest traps
   and the odds of actually following through.
7. **Payment History** — why payment history is the single biggest credit
   factor, autopay as protection, and the real cost of payday loans.
8. **Debt Strategy** — avalanche vs. snowball vs. split, using whatever
   credit card and student loan balances you're actually carrying by this
   point (adapts if you're carrying one, both, or neither).
9. **Side Income** — a real risk/reward side-hustle bet with three sizes of
   stake, each with its own odds.
10. **Investing Approach** — safe-and-low vs. diversified-and-moderate vs.
    concentrated-and-volatile, each simulated with real variance.
11. **Windfall** — paying down high-interest debt vs. investing vs. a
    friend's stock tip vs. spending unexpected money.
12. **Health & Risk** — the same $120 copay, debit vs. credit, vs. skipping
    the visit and gambling it resolves on its own.
13. **Insurance** — trading a small certain cost for protection against a
    large uncertain one. (Sets up round 14.)
14. **Apartment Incident** — a randomized life event that plays out very
    differently depending on the insurance call made in round 13.
15. **Helping Others (Cosigning)** — the asymmetric risk of cosigning a
    loan: modest upside, real downside, decided by chance.
16. **Credit Utilization** — why *how much* of your limit you use matters,
    independent of paying on time, now with a fourth "open a second card"
    middle option.
17. **Lifestyle Inflation** — what happens to a savings rate when every
    raise turns into new spending.
18. **Final Decision (Portfolio Check-In)** — cash out a volatile portfolio
    now, or ride out more uncertainty; if there's nothing invested yet,
    a last, smaller chance to start the habit.

Edit `js/game-data.js` to change wording, dollar amounts, odds, or add
rounds — each round is a self-contained object with a `text`, some
`choices`, and an `effect(state)` function per choice that returns
dollar/credit deltas and the feedback text shown after picking. Both
`text` and `choices` may be a function of the current `state` instead of
a fixed value, which is how the insurance-dependent and portfolio rounds
work — and an effect function can also set an arbitrary flag directly on
`state` (see the Insurance round's `state.hasInsurance`) for a later round
to read.
