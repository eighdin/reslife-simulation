/*
 * game-data.js
 * ------------
 * All of the content and financial math for the simulation lives here.
 * Nothing in this file talks to the DOM or to Firebase — it's pure data
 * and pure functions, so it's the one file a facilitator can safely edit
 * to change scenarios, dollar amounts, or the credit-score math without
 * touching app.js.
 *
 * Several rounds have genuinely uncertain outcomes — a Math.random() roll
 * inside the choice's effect() decides what actually happens, the same
 * way real financial decisions carry real uncertainty. Two rounds
 * (apartment-incident, portfolio-checkin) even change shape based on
 * choices made earlier in the same playthrough (state.hasInsurance,
 * state.invest). Because of this, `round.text` and `round.choices` may
 * each be either a plain value or a function(state) that computes one.
 *
 * Loaded as a plain (non-module) script — everything hangs off `window.Game`.
 */
(function (global) {
  "use strict";

  // ---- Starting position -------------------------------------------------
  // A thin credit file, a little cash, no investments, no debt yet.
  var STARTING_STATE = {
    cash: 700,
    ccDebt: 0,
    loanDebt: 0,
    invest: 0,
    credit: 620
  };

  // ---- Automatic interest / growth applied between rounds ----------------
  // Debt interest is certain — real APRs don't roll dice. Investment
  // returns are not: every tick after the scripted dip applies a random
  // swing (mildly positive on average, same as real markets over time,
  // but any single stretch can go either way).
  //
  // Both compound once every TWO rounds, not every round — these rates
  // are the per-round rate; applyTick() below squares the debt rates
  // ((1+r)^2 - 1) so a tick correctly compounds two rounds' worth at
  // once, rather than just doubling it.
  var TICK_EVERY_N_ROUNDS = 2;
  var CC_APR_PER_ROUND = 0.022;     // ~26% APR, compressed for pacing
  var LOAN_RATE_PER_ROUND = 0.005;  // ~6% APR, compressed for pacing
  var INVEST_SWING_MIN = -0.04;
  var INVEST_SWING_MAX = 0.07;
  var MARKET_DIP_BEFORE_ROUND = 10;  // 0-indexed round id; a scripted correction, right before "windfall" (must land on a tick round)
  var MARKET_DIP_FACTOR = -0.11;

  function creditBand(score) {
    if (score >= 800) return "Exceptional";
    if (score >= 740) return "Very Good";
    if (score >= 670) return "Good";
    if (score >= 580) return "Fair";
    return "Poor";
  }

  function netWorth(s) {
    return s.cash + s.invest - s.ccDebt - s.loanDebt;
  }

  function clampCredit(score) {
    return Math.max(300, Math.min(850, Math.round(score)));
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function fmt(n) {
    var sign = n < 0 ? "-$" : "$";
    return sign + Math.abs(Math.round(n)).toLocaleString();
  }

  // A checking account can't actually go negative — it overdrafts, and
  // that overdraft is a form of debt, not a lower cash number. Call this
  // right after applying a choice's deltas: if cash dipped below zero,
  // the shortfall gets swept onto the credit card balance (where it will
  // start accruing interest on the very next tick, same as any other
  // balance) and cash is floored at zero. Returns the shortfall amount
  // moved (0 if none), so callers can mention it in the feedback.
  function settleCash(state) {
    if (state.cash < 0) {
      var shortfall = round2(-state.cash);
      state.cash = 0;
      state.ccDebt = round2(state.ccDebt + shortfall);
      return shortfall;
    }
    return 0;
  }

  // Applies the automatic tick BEFORE round `nextIndex` is shown.
  // Returns { state, messages: [...] } — messages describe what happened,
  // for a short "since last round" banner. Interest and investment growth
  // only actually compound once every TICK_EVERY_N_ROUNDS rounds; on the
  // rounds in between, this is a no-op (empty messages, unchanged state).
  function applyTick(state, nextIndex) {
    var s = Object.assign({}, state);
    var messages = [];

    if (nextIndex <= 0 || nextIndex % TICK_EVERY_N_ROUNDS !== 0) {
      return { state: s, messages: messages };
    }

    if (s.ccDebt > 0) {
      var ccRate = Math.pow(1 + CC_APR_PER_ROUND, TICK_EVERY_N_ROUNDS) - 1;
      var ccInterest = round2(s.ccDebt * ccRate);
      s.ccDebt = round2(s.ccDebt + ccInterest);
      messages.push({
        dir: "down",
        text: "Your credit card balance grew by " + fmt(ccInterest) + " in interest — two rounds' worth, compounded, at about 26% APR."
      });
    }
    if (s.loanDebt > 0) {
      var loanRate = Math.pow(1 + LOAN_RATE_PER_ROUND, TICK_EVERY_N_ROUNDS) - 1;
      var loanInterest = round2(s.loanDebt * loanRate);
      s.loanDebt = round2(s.loanDebt + loanInterest);
      messages.push({
        dir: "down",
        text: "Your student loan accrued " + fmt(loanInterest) + " in interest — two rounds' worth, compounded, at about 6% APR."
      });
    }
    if (s.invest > 0) {
      var isDip = nextIndex === MARKET_DIP_BEFORE_ROUND;
      var rate = isDip ? MARKET_DIP_FACTOR : randRange(INVEST_SWING_MIN, INVEST_SWING_MAX);
      var change = round2(s.invest * rate);
      s.invest = round2(Math.max(0, s.invest + change));
      if (isDip) {
        messages.push({
          dir: "down",
          text: "Markets took a real hit — your investments dropped " + fmt(Math.abs(change)) + ". Long-term investors who don't panic-sell typically ride corrections like this out."
        });
      } else {
        messages.push({
          dir: change >= 0 ? "up" : "down",
          text: change >= 0
            ? "Your investments grew by " + fmt(change) + "."
            : "Your investments dipped " + fmt(Math.abs(change)) + " — a normal, if unwelcome, stretch in the market."
        });
      }
    }
    return { state: s, messages: messages };
  }

  // ---- The rounds ------------------------------------------------------
  // Each choice has an effect(state) function returning
  // { cash, ccDebt, loanDebt, invest, credit, note } — all deltas except
  // `note`, which is the feedback shown after picking. Some effects roll
  // randomness internally; a couple mutate flags directly onto `state`
  // (e.g. state.hasInsurance) so later rounds can react to them.
  var ROUNDS = [
    {
      id: "move-in",
      tag: "Move-In Budget",
      title: "The store-card discount",
      text: "You just moved in and need $150 worth of basics — sheets, a lamp, some kitchen stuff. At checkout, the cashier offers 20% off today's purchase if you open the store's credit card on the spot (26.99% APR, no annual fee). Same $150 worth of stuff either way — the only question is how you pay for it.",
      choices: [
        {
          label: "Open the card, take the 20% off ($120), and pay it off in full next statement.",
          effect: function () {
            if (Math.random() < 0.75) {
              return {
                cash: -120,
                credit: 9,
                note: "You got the 20% discount and paid it off before interest applied — a new account handled cleanly is one of the few genuinely 'free' ways to nudge a thin credit file forward."
              };
            }
            return {
              cash: -60,
              ccDebt: 60,
              credit: 2,
              note: "The discount was real, but the month didn't go quite as planned — only half the balance got paid off, and the rest is now sitting on a card charging almost 27%. Even a good plan can slip when cash gets tight."
            };
          }
        },
        {
          label: "Open the card, take the 20% off ($120), but only pay the $15 minimum this month — cash is tight.",
          effect: function () {
            return {
              cash: -15,
              ccDebt: 105,
              credit: 4,
              note: "You get the discount today and keep more cash on hand right now. The trade is $105 that starts compounding at nearly 27% APR until it's paid down."
            };
          }
        },
        {
          label: "Skip the card. Pay full price, $150, on debit.",
          effect: function () {
            return {
              cash: -150,
              note: "No risk, no interest, and no discount — you paid $30 more than the card price for the same stuff. A file with zero accounts on it isn't 'safe' forever, either: eventually an apartment, a phone plan, or a loan will want to see some history."
            };
          }
        }
      ]
    },
    {
      id: "emergency",
      tag: "Emergency Fund",
      title: "The car won't start",
      text: "The mechanic says it's a $450 repair, or you can nurse it along and hope it holds — you need the car for work either way.",
      choices: [
        {
          label: "Pay cash from checking for the full repair.",
          effect: function () {
            return {
              cash: -450,
              note: "A cash cushion exists for exactly this — one payment, no debt, no gamble. The cost is real, but it's the only known quantity in this round."
            };
          }
        },
        {
          label: "Put it on a credit card and pay it off in full next paycheck.",
          effect: function () {
            return {
              cash: -450,
              credit: 2,
              note: "Using credit for a genuine emergency is reasonable, as long as 'next paycheck' actually arrives before interest applies. The card just moved the deadline, not the cost."
            };
          }
        },
        {
          label: "Skip the full repair — pay $80 for a patch job and hope it holds a while longer.",
          effect: function () {
            if (Math.random() < 0.55) {
              return {
                cash: -80,
                note: "The patch held — you kept $370 in your pocket this round. It won't hold forever, but this time the gamble paid off."
              };
            }
            return {
              cash: -600,
              note: "The patch didn't hold. A few days later you're back at the shop, now also paying for a tow — deferring the fix ended up costing more than fixing it right the first time would have."
            };
          }
        }
      ]
    },
    {
      id: "subscriptions",
      tag: "Subscriptions",
      title: "The recurring-charges audit",
      text: "Scrolling through your bank statement, you spot three streaming services, a gym app, and a food-delivery membership: $58 a month total. You barely open two of them.",
      choices: [
        {
          label: "Cancel the two you don't use, keep the rest.",
          effect: function () {
            return {
              cash: 25,
              note: "Small recurring charges are easy to ignore but add up fast — $25/month back is $300 a year, for a five-minute audit."
            };
          }
        },
        {
          label: "Keep everything — it's not that much money.",
          effect: function () {
            return {
              cash: 0,
              note: "This is the choice most people actually make, and it's not irrational — decision fatigue is real. Just know what it's costing if it stays untouched: about $700 a year."
            };
          }
        },
        {
          label: "Cancel everything and go without for now.",
          effect: function () {
            return {
              cash: 45,
              note: "The most aggressive cut frees up the most cash — just make sure the trade-off (less convenience, less entertainment) is one you're actually fine with, or you'll just resubscribe next month anyway."
            };
          }
        }
      ]
    },
    {
      id: "everyday-purchase",
      tag: "Everyday Spending",
      title: "Splitting a $60 grocery run",
      text: "Your cart comes to $60. It's the same $60 either way — just a few different ways to actually pay for it.",
      choices: [
        {
          label: "Pay with debit, straight from checking.",
          effect: function () {
            return {
              cash: -60,
              note: "No interest, no risk, and no credit impact either way — the simplest option here is also a completely neutral one."
            };
          }
        },
        {
          label: "Put it on your credit card and pay the statement in full when it's due.",
          effect: function () {
            return {
              cash: -60,
              credit: 2,
              note: "Same $60 out the door, but routed through a card you pay off — a small, steady way to build payment history without ever paying interest on it."
            };
          }
        },
        {
          label: "Split it into four payments with a buy-now-pay-later app.",
          effect: function () {
            if (Math.random() < 0.25) {
              return {
                cash: -75,
                credit: -8,
                note: "One of the four payments got missed — plenty of BNPL apps report that to your credit file and tack on a fee. What looked like a fee-free way to spread out $60 turned into $75 and a ding on your score."
              };
            }
            return {
              cash: -60,
              note: "All four payments went through on schedule — no fees, no interest, same $60 as paying outright, just spread over a few weeks. It works fine, right up until a payment gets missed."
            };
          }
        }
      ]
    },
    {
      id: "retirement-match",
      tag: "Retirement Match",
      title: "Free money, with a catch",
      text: function (state) {
        var base = "Your job offers a 401(k) with a 100% match up to 3% of your paycheck — about $60 a month out of your check, matched dollar-for-dollar by your employer.";
        if (state.ccDebt > 0) {
          return base + " You're also carrying a credit card balance that's accruing interest every single round.";
        }
        return base;
      },
      choices: [
        {
          label: "Contribute enough to get the full match.",
          effect: function (state) {
            if (state.ccDebt > 0) {
              return {
                cash: -60,
                invest: 120,
                note: "That $120 is an instant 100% return — better than any guaranteed way to pay down debt exists. But that $60 also wasn't available to chip away at your card balance this round. Reasonable people, and reasonable financial planners, disagree on which should come first."
              };
            }
            return {
              cash: -60,
              invest: 120,
              note: "This is about as close to free money as investing gets — a 100% match is an instant 100% return before the market even moves. Skipping it is like turning down part of your own paycheck."
            };
          }
        },
        {
          label: "Contribute half the match.",
          effect: function () {
            return {
              cash: -30,
              invest: 60,
              note: "A middle path — some of the match, some cash kept free for whatever else is pulling at your budget this month."
            };
          }
        },
        {
          label: "Skip it — put that $60 toward your credit card balance instead (or just keep it, if you're debt-free).",
          effect: function (state) {
            if (state.ccDebt > 0) {
              return {
                ccDebt: -60,
                note: "You slowed the debt that's compounding against you — and gave up guaranteed free money to do it. There's a real case for paying down anything above ~20% APR before investing at all. This isn't a slam dunk either way."
              };
            }
            return {
              cash: 60,
              note: "With no debt pulling at you, this one's harder to justify — you passed on a guaranteed 100% return to keep $60 sitting in checking."
            };
          }
        }
      ]
    },
    {
      id: "big-purchase",
      tag: "Big Purchase",
      title: "The dead laptop",
      text: "Your laptop died and you need this exact $950 model for school or work — it's the one your program requires. A store offers '0% financing for 12 months' on it — but if it isn't fully paid off by month 12, many plans charge interest on the entire original amount, retroactively.",
      choices: [
        {
          label: "Save up for a few weeks and pay the full $950 in cash.",
          effect: function () {
            return {
              cash: -950,
              note: "A cash purchase carries zero risk of a surprise interest bill — the only cost is the few weeks you had to wait before you could afford it outright."
            };
          }
        },
        {
          label: "Take the 0% financing and set a reminder to pay it off before month 12.",
          effect: function () {
            return {
              cash: -950,
              note: "Deferred-interest plans work out fine only if you're disciplined about the deadline — miss it by even a day and many plans bill interest on the full original balance, not just what's left."
            };
          }
        },
        {
          label: "Take the financing and just pay the minimum each month — figure it out later.",
          effect: function () {
            if (Math.random() < 0.3) {
              return {
                cash: -950,
                note: "You cut it closer than planned, but the full balance got paid off right before the deadline hit. It worked out — this time. Deferred-interest plans depend entirely on follow-through, and follow-through isn't guaranteed."
              };
            }
            return {
              ccDebt: 950,
              credit: -6,
              note: "This is the exact scenario deferred-interest promotions are built to catch. 'Figure it out later' plus a hard deadline is a common way people end up owing far more than the sticker price."
            };
          }
        }
      ]
    },
    {
      id: "payment-history",
      tag: "Payment History",
      title: "Rent week is tight",
      text: "Rent and your phone bill are both due this week, and after paying rent you're $85 short.",
      choices: [
        {
          label: "Pay the phone bill a few days late — it probably won't matter.",
          effect: function () {
            return {
              credit: -30,
              note: "Payment history is the single biggest factor in your credit score. Even one bill reported 30+ days late can knock your score down significantly, and it can stay on your report for years."
            };
          }
        },
        {
          label: "Set up autopay for the minimum, and cover the rest with a credit card.",
          effect: function () {
            return {
              ccDebt: 85,
              credit: 12,
              note: "Autopay is one of the simplest ways to protect your score — a bill paid automatically can never become a late bill. A little predictable debt beats an unpredictable hit to your payment history."
            };
          }
        },
        {
          label: "Take an $85 cash advance from a payday lender to cover it.",
          effect: function () {
            return {
              cash: -14,
              note: "You avoided the late payment, but payday loans routinely carry fees equivalent to 300%+ APR. For an $85 shortfall, that's an expensive way to buy a few days — even a credit card would have been far cheaper."
            };
          }
        }
      ]
    },
    {
      id: "debt-payoff-strategy",
      tag: "Debt Strategy",
      title: "Where does the extra $200 go?",
      text: function (state) {
        if (state.ccDebt > 0 && state.loanDebt > 0) {
          return "You've got $200 free this month, and two balances competing for it: a credit card at a much higher interest rate, and a student loan at a lower one.";
        }
        if (state.ccDebt > 0) {
          return "You've got $200 free this month, and a credit card balance sitting there accruing interest.";
        }
        if (state.loanDebt > 0) {
          return "You've got $200 free this month, and a student loan balance sitting there accruing interest.";
        }
        return "You've got $200 free this month and, for now, no debt at all to put it toward.";
      },
      choices: function (state) {
        if (state.ccDebt > 0 && state.loanDebt > 0) {
          return [
            {
              label: "Put it all on the credit card — the higher rate.",
              effect: function (s) {
                var pay = Math.min(s.ccDebt, 200);
                return { ccDebt: -pay, cash: 200 - pay, note: "Mathematically, this is almost always the strongest move — paying down the highest-rate debt first saves the most money over time, even though the loan balance doesn't move at all this round." };
              }
            },
            {
              label: "Put it all on the student loan — get a balance fully gone sooner.",
              effect: function (s) {
                var pay = Math.min(s.loanDebt, 200);
                return { loanDebt: -pay, cash: 200 - pay, note: "You'll pay more total interest doing it this way, but knocking out a balance faster (or clearing it entirely) is a real motivational win — plenty of people accept paying a bit more for the sake of momentum, on purpose." };
              }
            },
            {
              label: "Split it evenly between both.",
              effect: function (s) {
                var pay1 = Math.min(s.ccDebt, 100), pay2 = Math.min(s.loanDebt, 100);
                return { ccDebt: -pay1, loanDebt: -pay2, cash: 200 - pay1 - pay2, note: "A hedge — neither balance drops as fast as it could on its own, but you're not betting everything on one strategy either." };
              }
            }
          ];
        }
        if (state.ccDebt > 0) {
          return [
            {
              label: "Put the full $200 toward the credit card balance.",
              effect: function (s) {
                var pay = Math.min(s.ccDebt, 200);
                return { ccDebt: -pay, cash: 200 - pay, note: "With only one high-interest balance in play, this is about as close to a clear call as this game gets — money that would otherwise pay roughly 26% interest is money well spent." };
              }
            },
            {
              label: "Keep the $200 in cash instead.",
              effect: function () {
                return { cash: 200, note: "The card keeps compounding either way. Keeping the cash only makes sense if you need it on hand for something more urgent than the interest you're paying." };
              }
            }
          ];
        }
        if (state.loanDebt > 0) {
          return [
            {
              label: "Put the full $200 toward the student loan balance.",
              effect: function (s) {
                var pay = Math.min(s.loanDebt, 200);
                return { loanDebt: -pay, cash: 200 - pay, note: "Student loan rates usually sit well below what long-run market returns tend to average — so paying it down early isn't the automatic call a credit card payoff would be." };
              }
            },
            {
              label: "Invest the $200 instead.",
              effect: function () {
                return { cash: -200, invest: 210, note: "With a relatively low-rate loan in the picture, investing this instead is a defensible bet — trading a guaranteed small return (avoided interest) for a probably-larger, less certain one." };
              }
            }
          ];
        }
        return [
          {
            label: "Put it in savings.",
            effect: function () {
              return { cash: 200, note: "With no debt in the picture, this is just about building a cushion — not wrong, just not doing much beyond sitting there." };
            }
          },
          {
            label: "Invest it.",
            effect: function () {
              return { cash: -200, invest: 210, note: "With nothing else competing for it, letting this money start compounding is a reasonable default." };
            }
          }
        ];
      }
    },
    {
      id: "side-hustle",
      tag: "Side Income",
      title: "The reselling hustle",
      text: "A friend wants you to go in on a weekend reselling side hustle — sneakers bought low, flipped high online. Buying in costs money up front, with no guarantee it comes back.",
      choices: [
        {
          label: "Go all in — $150 for a full share of the inventory.",
          effect: function () {
            var roll = Math.random();
            if (roll < 0.45) {
              return { cash: 350, note: "The flips sold fast, and this one paid off well beyond the buy-in. Side hustles like this can genuinely work — the upside just isn't guaranteed, and the hours you put in aren't in these numbers." };
            }
            if (roll < 0.8) {
              return { cash: -30, note: "You made some of your money back, but after fees, shipping, and time, it was barely worth it — a common outcome for side hustles that promise more than they deliver." };
            }
            return { cash: -150, note: "The inventory didn't move. Sneakers sitting in a closet aren't cash — not every side hustle works out, and this one didn't." };
          }
        },
        {
          label: "Go in for a smaller share — $60.",
          effect: function () {
            var roll = Math.random();
            if (roll < 0.45) {
              return { cash: 120, note: "A smaller stake, a smaller — but real — payoff. Sizing a risky bet to what you can actually afford to lose is its own kind of financial skill." };
            }
            if (roll < 0.8) {
              return { cash: -10, note: "Close to break-even. Not a disaster, not a win — which is honestly how most side hustles actually shake out." };
            }
            return { cash: -60, note: "It didn't work out, but keeping your stake small meant it didn't hurt much either. That's the whole argument for not going all-in on something unproven." };
          }
        },
        {
          label: "Pass — keep your money and your weekend.",
          effect: function () {
            return { cash: 0, note: "No risk, no reward, and a free weekend. Most side hustle pitches sound better than they perform — passing is a perfectly reasonable read, even on the ones that would have paid off." };
          }
        }
      ]
    },
    {
      id: "investing-approach",
      tag: "Investing Approach",
      title: "Where to put $500",
      text: "You've saved up $500 you won't need for a few years. Where does it go?",
      choices: [
        {
          label: "A high-yield savings account — guaranteed, low return.",
          effect: function () {
            return { cash: -500, invest: 520, note: "Guaranteed and boring: $500 becomes $520, with zero chance of loss and not much chance of real growth either. For money you can't afford to see shrink, that trade is often exactly right." };
          }
        },
        {
          label: "A diversified index fund — moderate average return, moves with the market.",
          effect: function () {
            var result;
            if (Math.random() < 0.7) {
              result = 500 * (1 + randRange(0.05, 0.15));
              return { cash: -500, invest: round2(result), note: "A solid year — this is roughly what a diversified fund has historically returned more often than not. It isn't every year, though, which is the whole reason it isn't guaranteed." };
            }
            result = 500 * (1 + randRange(-0.12, -0.02));
            return { cash: -500, invest: round2(result), note: "A down year. Diversified funds still lose value sometimes — the case for them isn't that they never drop, it's that broad, long-term exposure tends to recover and grow over time." };
          }
        },
        {
          label: "A single trending stock (or crypto) a friend won't stop talking about — high risk, high reward.",
          effect: function () {
            var roll = Math.random();
            if (roll < 0.35) {
              var big = 500 * (1 + randRange(0.4, 1.2));
              return { cash: -500, invest: round2(big), note: "It paid off — big. Concentrated bets like this can pay off spectacularly. They can also go to zero. This round, it didn't." };
            }
            if (roll < 0.7) {
              var mod = 500 * (1 + randRange(-0.3, -0.05));
              return { cash: -500, invest: round2(mod), note: "A meaningful loss. Putting everything into one asset means one asset's bad month is your whole portfolio's bad month — there's no diversification cushioning the drop." };
            }
            return { cash: -500, invest: 0, note: "It went to zero. This is the actual, non-hypothetical risk of a concentrated bet on one speculative asset — not likely on any single try, but not rare enough to ignore either." };
          }
        }
      ]
    },
    {
      id: "windfall",
      tag: "Windfall",
      title: "An unexpected $1,000",
      text: "A graduation gift lands in your account: $1,000, no strings attached.",
      choices: [
        {
          label: "Put it toward your highest-interest debt — or invest it if you're debt-free.",
          effect: function (state) {
            if (state.ccDebt > 0) {
              var pay = Math.min(state.ccDebt, 1000);
              return {
                ccDebt: -pay,
                cash: 1000 - pay,
                note: "Paying down high-interest debt with a windfall is, in almost every case, the mathematically strongest use of unexpected money — avoiding 26% interest is a guaranteed 'return' that beats what the market delivers most years."
              };
            }
            return {
              invest: 1000,
              note: "With no high-interest debt hanging over you, investing the windfall gives it years to compound instead of sitting as cash slowly losing value to inflation."
            };
          }
        },
        {
          label: "Split it — half toward savings or debt, half toward something fun.",
          effect: function (state) {
            if (state.ccDebt > 0) {
              var pay = Math.min(state.ccDebt, 500);
              return {
                ccDebt: -pay,
                cash: 500 - pay + 500,
                note: "A balanced move — you knock down some debt (or build savings) while still enjoying part of the windfall today."
              };
            }
            return {
              invest: 500,
              cash: 500,
              note: "A balanced move — half keeps compounding for your future, half you get to enjoy right now."
            };
          }
        },
        {
          label: "Put $200 on a hot stock tip from a friend, spend the rest.",
          effect: function () {
            var roll = Math.random();
            var gamble = roll < 0.4 ? 200 * (1 + randRange(0.3, 1.0)) : 200 * (1 + randRange(-0.7, -0.1));
            return {
              invest: round2(Math.max(0, gamble)),
              cash: 300,
              note: gamble > 200
                ? "The tip actually paid off — enjoy it, but a friend's hot tip working out once isn't a strategy, it's a coin flip that landed well."
                : "The tip didn't pan out. 'My friend heard about this stock' is one of the least reliable ways money changes hands, and this round is a small, low-stakes reminder why."
            };
          }
        }
      ]
    },
    {
      id: "health-copay",
      tag: "Health & Risk",
      title: "The appointment you've been putting off",
      text: "You've had a nagging issue for weeks. An urgent care visit costs $120 with your insurance's copay — the same $120 whether you pay debit or credit.",
      choices: [
        {
          label: "Go now and pay the $120 copay on debit.",
          effect: function () {
            return { cash: -120, note: "Paying to catch something early is exactly what a copay is for — a small, known cost instead of an unknown, possibly much bigger one." };
          }
        },
        {
          label: "Go now, but put the $120 copay on a credit card you'll pay off.",
          effect: function () {
            return { cash: -120, credit: 2, note: "Same visit, same cost, just moved onto a card you're paying off — the timing of your cash flow changed, not the actual cost." };
          }
        },
        {
          label: "Skip it for now to save the $120 — it's probably nothing.",
          effect: function () {
            if (Math.random() < 0.55) {
              return { cash: 0, note: "It cleared up on its own. Skipping it cost nothing this time — which is exactly the outcome that makes people comfortable skipping the next one, too." };
            }
            return { cash: -650, note: "It didn't clear up — it got worse, and turned into a $650 emergency room visit instead of a $120 copay. Deferred care is one of the more common ways a small, known cost turns into a large, unknown one." };
          }
        }
      ]
    },
    {
      id: "insurance",
      tag: "Insurance",
      title: "Renters insurance",
      text: "Renters insurance for your apartment costs $15 a month and covers theft, fire, and water damage to your belongings. It's optional — your landlord doesn't require it.",
      choices: [
        {
          label: "Get it — $15/month is easy to plan for.",
          effect: function (state) {
            state.hasInsurance = true;
            return {
              cash: -15,
              note: "Insurance is a trade: a small, certain cost now for protection against a large, unpredictable one later. For a bit more than a coffee subscription, you're covered if something rare but expensive happens."
            };
          }
        },
        {
          label: "Skip it — you don't own much worth protecting.",
          effect: function (state) {
            state.hasInsurance = false;
            return {
              cash: 15,
              note: "This can work out fine — until it doesn't. Skipping insurance is a bet that nothing bad happens; when something does, the cost is rarely small, and it lands all at once, right when you can least afford it."
            };
          }
        }
      ]
    },
    {
      id: "apartment-incident",
      tag: "Risk & Insurance",
      title: "When something actually happens",
      text: function (state) {
        if (state.hasInsurance) {
          return "A pipe bursts in the unit above yours, ruining your laptop and a chunk of your stuff. Because you've been paying for renters insurance, you're able to file a claim.";
        }
        return "A pipe bursts in the unit above yours, ruining your laptop and a chunk of your stuff. You never got renters insurance, so this one's entirely on you.";
      },
      choices: function (state) {
        if (state.hasInsurance) {
          return [
            {
              label: "Pay the $100 deductible and replace everything through the claim.",
              effect: function () {
                return { cash: -100, note: "This is the entire point of paying for insurance every month — one small, predictable cost absorbs what would otherwise be a $1,300+ disaster." };
              }
            },
            {
              label: "Skip filing — a claim might raise your future premium — and just replace the essentials yourself.",
              effect: function () {
                return { cash: -400, note: "Insurance existed to cover this, but filing claims can sometimes nudge future premiums up. Some people choose to eat a moderate loss rather than file — there's a real argument on both sides." };
              }
            }
          ];
        }
        return [
          {
            label: "Replace everything now — you need the laptop for school or work.",
            effect: function () {
              return { cash: -1300, note: "This is the exact scenario insurance exists for. $15 a month would have turned this four-figure hit into a $100 deductible." };
            }
          },
          {
            label: "Replace only the laptop for now, patch by with what's left of your other stuff.",
            effect: function () {
              return { cash: -750, note: "You're triaging a loss that a small monthly premium could have mostly prevented. Not every skipped precaution catches up with you — this time, it did." };
            }
          }
        ];
      }
    },
    {
      id: "cosigning",
      tag: "Helping Others",
      title: "Your cousin needs a cosigner",
      text: "Your cousin wants to buy a used car and needs a cosigner for a $2,400 loan. If they miss payments, you're legally on the hook for the balance — and it hits your credit too.",
      choices: [
        {
          label: "Cosign the loan.",
          effect: function () {
            if (Math.random() < 0.7) {
              return { credit: 4, note: "Your cousin paid it down responsibly — a small positive mark, and a favor that didn't cost you anything but the risk you carried the entire time." };
            }
            var owed = round2(2400 * randRange(0.4, 1));
            return { ccDebt: owed, credit: -45, note: "Your cousin fell behind, and as cosigner, their missed payments became your problem — both " + fmt(owed) + " of the balance and a real hit to your own credit. Cosigning is a genuine favor, but it's a loan in your name too, whether or not you're the one driving the car." };
          }
        },
        {
          label: "Offer to help them find a lower rate or another cosigner, but don't sign yourself.",
          effect: function () {
            return { note: "You kept your own credit and finances insulated from someone else's loan — a boundary that costs an awkward conversation, and nothing else." };
          }
        }
      ]
    },
    {
      id: "utilization",
      tag: "Credit Utilization",
      title: "The $1,000 limit",
      text: "Your credit card has a $1,000 limit. You need a $650 textbook-and-supplies bundle for the semester.",
      choices: [
        {
          label: "Put the full $650 on the card at once — 65% of your limit.",
          effect: function () {
            return {
              ccDebt: 650,
              credit: -14,
              note: "Utilization — how much of your limit you're using — is the second-biggest factor in your score, right after payment history. Going above roughly 30% of your limit can drop your score even if you never miss a payment."
            };
          }
        },
        {
          label: "Split it into two $325 purchases, paying down between statements.",
          effect: function () {
            return {
              ccDebt: 170,
              credit: -3,
              note: "Spreading a purchase so your reported balance stays lower keeps your utilization ratio healthier, even though you're borrowing the same total amount overall."
            };
          }
        },
        {
          label: "Ask for a credit limit increase first, then make the purchase.",
          effect: function () {
            return {
              ccDebt: 650,
              credit: -2,
              note: "A higher limit means the same $650 charge is a smaller share of what's available — same spending, healthier-looking utilization. The increase request itself can trigger a small inquiry ding of its own, which is why this isn't a completely free move."
            };
          }
        },
        {
          label: "Put $325 on this card and open a second card for the rest.",
          effect: function () {
            return {
              ccDebt: 325,
              credit: -10,
              note: "A new account brings a hard inquiry and shortens your average account age, both of which cost a few points right away — but it also means neither card is anywhere near maxed. Whether that trade is worth it usually depends on whether you actually needed more available credit long-term."
            };
          }
        }
      ]
    },
    {
      id: "raise",
      tag: "Lifestyle Inflation",
      title: "A $350/month raise",
      text: "You get a raise — an extra $350 a month. What you do with it in the next few seconds is a pretty good preview of what you'll do with every raise for the rest of your life. Economists call spending every raise 'lifestyle inflation.'",
      choices: [
        {
          label: "Bank the entire raise — your lifestyle stays exactly the same.",
          effect: function () {
            return {
              invest: 350,
              note: "This is how people build real wealth on an ordinary salary — not by earning more, but by not increasing spending every time income rises."
            };
          }
        },
        {
          label: "Split it — some to savings, some to upgrading your life a bit.",
          effect: function () {
            return {
              invest: 175,
              cash: 100,
              note: "A balanced approach — you get to enjoy part of the raise now while still increasing what you're building for later."
            };
          }
        },
        {
          label: "Spend the whole raise — new gear, upgraded lifestyle.",
          effect: function () {
            return {
              cash: 75,
              note: "There's nothing wrong with enjoying more income — the risk is that spending expands to fill every raise, so your savings rate never actually improves no matter how much you go on to earn."
            };
          }
        }
      ]
    },
    {
      id: "portfolio-checkin",
      tag: "Final Decision",
      title: "One last call",
      text: function (state) {
        if (state.invest > 50) {
          return "It's been a volatile few months and your portfolio disagrees with itself day to day. Right now it's worth " + fmt(state.invest) + ".";
        }
        return "Looking back over the last few months — is there anything, even a small recurring amount, you'd commit to setting aside starting today?";
      },
      choices: function (state) {
        if (state.invest > 50) {
          return [
            {
              label: "Cash it all out now — lock in where you're at, no more risk.",
              effect: function (s) {
                return { cash: s.invest, invest: -s.invest, note: "You locked in your number. No more upside from here, but also no more risk — for some people, that certainty is worth more than a maybe-bigger figure later." };
              }
            },
            {
              label: "Leave it invested and let it ride.",
              effect: function (s) {
                var change = round2(s.invest * randRange(-0.15, 0.20));
                return {
                  invest: change,
                  note: change >= 0
                    ? "It swung up — staying invested through the noise paid off this time, which is the case for time in the market over timing it, without pretending every stretch ends this well."
                    : "It swung down. Staying invested doesn't mean staying immune to drops — it means betting that time smooths them out, which isn't guaranteed on any single stretch, this one included."
                };
              }
            }
          ];
        }
        return [
          {
            label: "Commit to auto-transferring $25 a month into savings starting today.",
            effect: function () {
              return { cash: -25, invest: 25, note: "It's a small number now. The habit is the point — the people who end up with real savings almost always started with an amount that felt too small to matter." };
            }
          },
          {
            label: "Not right now — maybe once things settle down.",
            effect: function () {
              return { note: "A perfectly common answer — and worth noticing that 'once things settle down' tends to arrive less often than planned. Nothing was lost tonight, but nothing started either." };
            }
          }
        ];
      }
    }
  ];

  function buildTakeaway(state) {
    var lines = [];
    if (state.ccDebt > 500) {
      lines.push("You're carrying significant high-interest debt. In real life, paying that down would be priority #1 — every round it sits there, it grows.");
    } else if (state.ccDebt > 0) {
      lines.push("You're carrying a small credit card balance — clearing it soon would stop interest from chipping away at you.");
    } else {
      lines.push("You finished with no credit card debt — every dollar you kept was a dollar not paying someone else interest.");
    }
    if (state.invest > 300) {
      lines.push("You built up real investments along the way, for better or worse depending on how the dice fell — either way, that's money that was working for you instead of just sitting still.");
    } else if (state.invest > 0) {
      lines.push("You started investing something, even if the amount stayed modest — starting is the part most people put off.");
    } else {
      lines.push("You didn't invest anything this round — even small, early amounts have decades to compound in real life.");
    }
    if (state.credit >= 740) {
      lines.push("Paying on time and keeping balances low — exactly what you practiced here — is how excellent real-world credit gets built.");
    } else if (state.credit >= 670) {
      lines.push("Solid credit habits overall, with a little room to improve utilization or payment timing.");
    } else {
      lines.push("A few rough patches hit your score hard — usually a missed payment, a maxed-out card, or a loan that went bad on someone else's behalf. Those matter more than almost anything else.");
    }
    return lines.join(" ");
  }

  global.Game = {
    STARTING_STATE: STARTING_STATE,
    ROUNDS: ROUNDS,
    applyTick: applyTick,
    creditBand: creditBand,
    netWorth: netWorth,
    clampCredit: clampCredit,
    round2: round2,
    settleCash: settleCash,
    buildTakeaway: buildTakeaway,
    MARKET_DIP_BEFORE_ROUND: MARKET_DIP_BEFORE_ROUND
  };
})(window);
