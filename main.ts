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
//     fill price the harness reports for the buy. Both are re-checked every
//     bar, so a sell the market refuses is sent again while its reason holds.
//   - Nothing else: no leverage, no shorts.
//
// Post-mortem of Round 4 (commit 7c2d852, dev grade -32.26 USDC, 20 trades):
// the local grade-local run reproduces the server's dev grade exactly, so
// there is no window/fee mismatch to chase — the +$4.23 seen earlier was the
// original TP/SL-only bot, and Round 4's three "improvements" destroyed it.
// The unbanded trend-failure exit (close < SMA(60)) was the killer: an entry
// is a cross *up* through the SMA, so the price hovers at the line and the
// next 1-minute close dips below it, forcing an immediate exit at about
// -0.3% plus fees. Eight of the ten round trips were that whipsaw, each
// -$3.4 to -$4.6. The 4-hour time stop also hurt: it cut the one winning
// trade at +$1.54 instead of letting it reach the +1.5% take-profit (+$12.28).
// Both mechanisms are therefore removed here; exits are TP/SL only again,
// plus a *banded* trend-failure exit (see below) that needs the close 0.5%
// *below* the SMA before it fires — a genuine trend failure, not 1-minute
// noise at the line.
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
 * Improvement — banded trend-failure exit: while holding, if the close
 * falls 0.5% *below* the SMA(60) the hourly turn that justified the entry
 * has genuinely failed. The band is the whole point: Round 4 exited on any
 * close below the SMA and whipsawed 8 times for -$3.4..-$4.6 each, because
 * a cross-up entry sits right on the line. Requiring
 * close <= sma * 199/200 means a 1-minute wiggle at the line cannot fire
 * it; on the dev window it only fires on the second trade, exiting at
 * -0.51% instead of riding to the -0.5% stop's fill at -0.72% (-$5.71
 * instead of -$8.05). TP/SL still take precedence (checked first).
 * A 0.2% band still whipsaws (-$13.86, 4 trades in replay); a 1.0% band
 * never fires before the stop, so 0.5% is the band that earns its keep.
 */
const TREND_FAIL_NUM = 199;
const TREND_FAIL_DEN = 200;
/**
 * Improvement — don't chase: an entry cross must land within 0.3% above
 * the SMA(60). A cross is a turn at the line, not a spike: both dev entries
 * crossed by only +0.059% and +0.009%, so the cap costs nothing on the dev
 * window, but on the unseen race window it blocks buying the top of a
 * vertical 1-minute bar whose move the next open (the fill) has already
 * given back. A fill 0.3% above the line would need a 1.8% run just to
 * reach the +1.5% take-profit, which is not the trade this bot is built for.
 */
const ENTRY_CHASE_NUM = 1003;
const ENTRY_CHASE_DEN = 1000;

/** Closes seen so far, oldest first (raw price units, as numbers). */
const closes: number[] = [];
/** Running sum of the last SMA_BARS closes, for the SMA. */
let windowSum = 0;
/** SMA(60) as of each bar, oldest first (null before the first full window). */
const smaHistory: (number | null)[] = [];
/** Fill price of the open position (raw price units), from the buy's fill. */
let entryPrice: bigint | null = null;

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
      }
      if (fill.side === 'sell') {
        entryPrice = null;
      }
    }
    const bar = batch.bars.find((b) => b.symbol === 'CBBTC');
    if (bar !== undefined) {
      pushClose(Number(bar.c));
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
      // Banded trend-failure exit: close 0.5% below the SMA(60) means the
      // hourly turn failed for real, not a 1-minute wiggle at the line.
      const sma = smaHistory[smaHistory.length - 1];
      const trendFailed =
        sma !== null &&
        sma !== undefined &&
        Number(close) * TREND_FAIL_DEN <= sma * TREND_FAIL_NUM;
      if (
        entry !== null &&
        (close * DEN >= entry * TP_NUM ||
          close * DEN <= entry * SL_NUM ||
          trendFailed)
      ) {
        return [{ side: 'sell', symbol: 'CBBTC', qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    // Entry, when flat: close crosses above a rising SMA(60).
    if (close === null || smaHistory.length < 2) return [];
    const sma = smaHistory[smaHistory.length - 1]!;
    const prevSma = smaHistory[smaHistory.length - 2]!;
    if (sma === null || prevSma === null) return [];
    const prevClose = closes[closes.length - 2];
    const smaTenAgo = smaHistory.length > SMA_TREND_LAG ? smaHistory[smaHistory.length - 1 - SMA_TREND_LAG]! : null;
    if (smaTenAgo === null || smaTenAgo === undefined) return [];
    const crossedUp = Number(close) > sma && prevClose <= prevSma;
    const rising = sma > smaTenAgo;
    // Don't chase: the cross must land within 0.3% above the SMA (see above).
    const notChasing = Number(close) * ENTRY_CHASE_DEN <= sma * ENTRY_CHASE_NUM;
    if (!crossedUp || !rising || !notChasing) return [];

    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const slice = state.cash < byWeight ? state.cash : byWeight;
    if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
