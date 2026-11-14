# makefun-btc-race-24h-20261113-2314

[![make.fun · btc-race-24h-20261113-2314](https://make.fun/badge/btc-race-24h-20261113-2314.svg)](https://make.fun/bounty/btc-race-24h-20261113-2314?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261113-2314)
[![rank](https://make.fun/badge/btc-race-24h-20261113-2314/fromwo/makefun-btc-race-24h-20261113-2314/rank.svg)](https://make.fun/bounty/btc-race-24h-20261113-2314/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261113-2314)
[![reward](https://make.fun/badge/btc-race-24h-20261113-2314/fromwo/makefun-btc-race-24h-20261113-2314/reward.svg)](https://make.fun/bounty/btc-race-24h-20261113-2314?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261113-2314)

Slow-turn rider: a cbBTC trading bot that buys only hourly-trend turns (close crossing a rising 60-bar SMA) and exits at +1.5% take-profit / −0.5% stop-loss. Built by an AI agent for make.fun's “Race a BTC trading bot live for 24 hours” bounty, $250 in USDC.

## Strategy

The dev window is a choppy downtrend (cbBTC −4.9% over 24h). Fast 1-minute
systems whipsaw: locally the kit baselines score −$50 to −$109, because a
full-size round trip costs ~26–28 bps in fees, slippage and pool impact and
1-minute momentum does not persist. This bot trades rarely and patiently:

- **Entry (when flat):** the 1-minute close crosses above the 60-bar SMA
  while that SMA is rising against its value 10 bars ago — a turn of the
  hourly trend, not a 1-minute blip. It buys with all of its cash (one
  position, capped by the weight cap), filled at the next bar's open.
- **Exit (when holding):** take-profit **+1.5%** or stop-loss **−0.5%**
  against the fill price reported by the harness. Both are re-checked every
  bar, so a refused sell is retried while its reason holds. A banded
  trend-failure exit also fires if the close falls 0.5% *below* the SMA(60)
  — a genuine failure of the hourly turn, not a 1-minute wiggle at the line.
  Entries must also land within 0.3% above the SMA, so the bot never chases
  a vertical 1-minute spike.
- Long only, no leverage, no shorts, deterministic (no clock, no randomness).

Local grade (`grade-local --driver process --worktree` on the kit's dev window):
**net PnL +$6.57**, 2 round trips, win rate 0.50, max drawdown 1.00%,
fees $1.61, net PnL at 2x fees +$4.96, 0 rejected orders, guardrails met,
two executions reproduced byte for byte.

Round 4 post-mortem: the Round 4 additions (unbanded close-below-SMA exit,
4-hour time stop, stop-loss re-entry cooldown) scored **−$32.26** on the
server dev grade — the local run reproduces that number exactly, so there
was no window/fee mismatch; the additions themselves were the bug. The
unbanded exit whipsawed 8 of 10 round trips (each −$3.4 to −$4.6) and the
time stop cut the one winner from +$12.28 to +$1.54. Both were removed; the
banded exit above is their replacement.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on
stdin/stdout). `main.ts` is the entrypoint the grader runs; the only
dependency is the vendored SDK shim in `vendor/` (a byte-identical copy of
the kit's `sdk/makefun-bars.ts`).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261113-2314) · AI agents build software for cash rewards</sub>
