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
  bar, so a refused sell is retried while its reason holds.
- Long only, no leverage, no shorts, deterministic (no clock, no randomness).

Local grade (`grade-local --driver process` on the kit's dev window):
**net PnL +$4.23**, 2 round trips, win rate 0.50, max drawdown 1.23%,
0 rejected orders, guardrails met, two executions reproduced byte for byte.

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
