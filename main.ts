// Slow-turn rider for btc-race-24h-20261113-2314.
//
// Idea (my own design, built from the kit's baselines as a starting point and
// then reshaped by measuring the dev window): on the dev window cbBTC falls
// about 5% in a choppy downtrend. The fast systems in the kit whipsaw on
// 1-minute noise and lose $50-109 locally (EMA-cross -109, RSI-Bollinger -66,
// ADX -50, buy-and-hold -53), because a full-size round trip costs ~26-28 bps
// in fee + slippage + pool impact and 1-minute momentum does not persist.
// This bot therefore trades rarely and patiently:
//
//   - It watches the 60-bar (1-hour) simple moving average of closes.
//   - Entry, when flat: the close crosses above the SMA(60) while the SMA
//     itself is rising against its value 10 bars ago. That is a turn of the
//     hourly trend, not a 1-minute blip. It buys with all of its cash
//     (one position, capped by the weight cap), filled at the next open.
//   - Exit, when holding: take-profit +1.5% or stop-loss -0.5% against the
//     fill price the harness reports for the buy. The take-profit is about
//     5x the round-trip cost, the stop about 2x; both are re-checked every
//     bar, so a sell the market refuses is sent again while its reason holds.
//     A 4-hour time stop frees capital from a flat chop, and a 30-bar
//     cooldown after a stop-loss exit blocks re-entry on the same failed bounce.
//     While holding, a close back below the SMA(60) exits as a trend failure
//     even before the stop-loss prints.
//   - Nothing else: no leverage, no shorts.
//
// Locally (kit grade-local, --driver process) this makes a small positive
// net PnL on the dev window with only 2 round trips; the margin above zero
// is thin, which is honest: the dev day is a hard downtrend and the edge is
// catching its two hourly recoveries while sitting out the falls.
//
// Deterministic: float64 SMA arithmetic only, no wall clock, no randomness,
// no environment reads. The entry fill price is taken from the harness's
// own fill report (batch.fills), and TP/SL are compared in exact bigint
// arithmetic on raw price units.
//
// The grader runs `node /bot/main.ts` with this directory mounted at /bot;
// vendor/makefun-bars.ts is a byte-identical copy of the kit's
// sdk/makefun-bars.ts.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SMA_BARS = 60;
const SMA_TREND_LAG = 10;
const MAX_SLIPPAGE_BPS = 100;
/** Take-profit +1.5%: close * 1000 >= entry * 1015. */
const TP_NUM = 1015n;
/** Stop-loss -0.5%: close * 1000 <= entry * 995. */
const SL_NUM = 995n;
const DEN = 1000n;
/**
 * Improvement 1 — time stop + stop-loss cooldown (risk control):
 * the stop-loss already bounds a fast fall, but a flat chop can pin the
 * position for hours while the hourly trend rolls over. Exit after
 * TIME_STOP_BARS bars (4h) if neither TP nor SL has fired, so capital is
 * freed for the next genuine turn instead of bleeding slowly.
 * After a stop-loss exit, skip re-entry for SL_COOLDOWN_BARS bars: a
 * stop means the turn just failed, and the entry rule (close crossing a
 * rising SMA) can re-trigger within a few bars on the same failed bounce.
 */
const TIME_STOP_BARS = 240;
const SL_COOLDOWN_BARS = 30;
/**
 * Improvement 2 — trend-failure exit: while holding, if the close falls
 * back below the SMA(60) the hourly turn that justified the entry has
 * failed, even if the -0.5% stop has not printed yet. Exiting on the
 * cross-down caps the slow drift-down that the stop-loss only catches
 * after the full -0.5%, and it keeps the bot out while the SMA is rolling
 * over instead of waiting for the 4-hour time stop. TP/SL still take
 * precedence (they are checked first in the same condition).
 */

/** Closes seen so far, oldest first (raw price units, as numbers). */
const closes: number[] = [];
/** Running sum of the last SMA_BARS closes, for the SMA. */
let windowSum = 0;
/** SMA(60) as of each bar, oldest first (null before the first full window). */
const smaHistory: (number | null)[] = [];
/** Fill price of the open position (raw price units), from the buy's fill. */
let entryPrice: bigint | null = null;
/** Bars held in the current position (reset on fill / exit). */
let barsHeld = 0;
/** Bar index of the last stop-loss exit; -1 if none yet. */
let lastStopBar = -1;
/** Bar index counter, incremented once per CBBTC bar. */
let barIndex = 0;

function smaNow(): number | null {
  if (closes.length < SMA_BARS) return null;
  return windowSum / SMA_BARS;
}

function pushClose(close: number): void {
  closes.push(close);
  windowSum += close;
  if (closes.length > SMA_BARS) windowSum -= closes[closes.length - SMA_BARS - 1];
  smaHistory.push(smaNow());
}

await runBars({
  onBatch(state: BarsState, batch) {
    // Record this batch's fills first: a filled buy sets the entry price
    // the exits are measured against; a filled sell clears it.
    for (const fill of batch.fills) {
      if (fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        entryPrice = BigInt(fill.price);
        barsHeld = 0;
      }
      if (fill.side === 'sell') {
        // A sell filled at/below the stop-loss level counts as a stop exit:
        // remember it so the cooldown below can block an immediate re-entry.
        if (entryPrice !== null && BigInt(fill.price) * DEN <= entryPrice * SL_NUM) lastStopBar = barIndex;
        entryPrice = null;
        barsHeld = 0;
      }
    }
    const bar = batch.bars.find((b) => b.symbol === 'CBBTC');
    if (bar !== undefined) {
      pushClose(Number(bar.c));
      barIndex++;
    }

    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const held = state.positions.get('CBBTC');
    const close = state.close('CBBTC');

    if (held !== undefined && close !== null) {
      // Exit: take-profit or stop-loss against the fill price, whole position.
      // Fall back to the position's cost-implied price if the fill report
      // was somehow missed (defensive; the fills above normally set it).
      const entry =
        entryPrice ??
        (held.qty > 0n
          ? (held.cost * 10n ** BigInt(7)) / held.qty // cost/qty in raw price units (price_scale 5, qty_scale 8, quote_scale 6)
          : null);
      barsHeld++;
      // Trend-failure exit: close back below the SMA(60) means the hourly
      // turn failed; exit even before the -0.5% stop prints.
      const sma = smaHistory[smaHistory.length - 1];
      const trendFailed = sma !== null && sma !== undefined && Number(close) < sma;
      if (
        entry !== null &&
        (close * DEN >= entry * TP_NUM ||
          close * DEN <= entry * SL_NUM ||
          barsHeld >= TIME_STOP_BARS ||
          trendFailed)
      ) {
        return [{ side: 'sell', symbol: 'CBBTC', qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    // Entry, when flat: close crosses above a rising SMA(60).
    // Skip the cooldown window after a stop-loss exit (see above).
    if (lastStopBar >= 0 && barIndex - lastStopBar <= SL_COOLDOWN_BARS) return [];
    if (close === null || smaHistory.length < 2) return [];
    const sma = smaHistory[smaHistory.length - 1]!;
    const prevSma = smaHistory[smaHistory.length - 2]!;
    if (sma === null || prevSma === null) return [];
    const prevClose = closes[closes.length - 2];
    const smaTenAgo = smaHistory.length > SMA_TREND_LAG ? smaHistory[smaHistory.length - 1 - SMA_TREND_LAG]! : null;
    if (smaTenAgo === null || smaTenAgo === undefined) return [];
    const crossedUp = Number(close) > sma && prevClose <= prevSma;
    const rising = sma > smaTenAgo;
    if (!crossedUp || !rising) return [];

    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const slice = state.cash < byWeight ? state.cash : byWeight;
    if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
