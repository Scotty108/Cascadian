/**
 * Test rounding hypothesis from Goldsky
 *
 * John said: "The UI is showing a rounded version of the price in cents,
 * the subgraph data has sub-cent accuracy, so if you use the full value,
 * or round it, when multiplying that by large numbers it definitely causes
 * a significant difference."
 *
 * Let's test if rounding prices to cents improves accuracy.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = process.argv[2] || '0x1faa3465ce8b04a761e3a3e3ec8f2b4c8f9e7d6a'; // Bl4cksparrow

interface PositionAgg {
  condition_id: string;
  outcome_index: number;
  buy_tokens: number;
  sell_tokens: number;
  buy_usdc: number;
  sell_usdc: number;
  // New: track individual trade prices for rounding analysis
  avg_buy_price: number;
  avg_sell_price: number;
  trade_count: number;
}

async function loadPositionsWithPrices(wallet: string): Promise<PositionAgg[]> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      sum(CASE WHEN d.side = 'buy' THEN abs(d.tokens) ELSE 0 END) as buy_tokens,
      sum(CASE WHEN d.side = 'sell' THEN abs(d.tokens) ELSE 0 END) as sell_tokens,
      sum(CASE WHEN d.side = 'buy' THEN abs(d.usdc) ELSE 0 END) as buy_usdc,
      sum(CASE WHEN d.side = 'sell' THEN abs(d.usdc) ELSE 0 END) as sell_usdc,
      -- Calculate average prices
      CASE WHEN sum(CASE WHEN d.side = 'buy' THEN abs(d.tokens) ELSE 0 END) > 0
        THEN sum(CASE WHEN d.side = 'buy' THEN abs(d.usdc) ELSE 0 END) /
             sum(CASE WHEN d.side = 'buy' THEN abs(d.tokens) ELSE 0 END)
        ELSE 0 END as avg_buy_price,
      CASE WHEN sum(CASE WHEN d.side = 'sell' THEN abs(d.tokens) ELSE 0 END) > 0
        THEN sum(CASE WHEN d.side = 'sell' THEN abs(d.usdc) ELSE 0 END) /
             sum(CASE WHEN d.side = 'sell' THEN abs(d.tokens) ELSE 0 END)
        ELSE 0 END as avg_sell_price,
      count() as trade_count
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    buy_tokens: Number(r.buy_tokens),
    sell_tokens: Number(r.sell_tokens),
    buy_usdc: Number(r.buy_usdc),
    sell_usdc: Number(r.sell_usdc),
    avg_buy_price: Number(r.avg_buy_price),
    avg_sell_price: Number(r.avg_sell_price),
    trade_count: Number(r.trade_count),
  }));
}

async function loadResolutions(): Promise<Map<string, number[]>> {
  const query = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const map = new Map<string, number[]>();
  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    map.set(r.condition_id.toLowerCase(), payouts);
  }
  return map;
}

// Round to cents (2 decimal places)
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main() {
  const wallet = process.argv[2] || '0x1faa3465ce8b04a761e3a3e3ec8f2b4c8f9e7d6a';
  console.log('='.repeat(80));
  console.log(`ROUNDING HYPOTHESIS TEST: ${wallet}`);
  console.log('='.repeat(80));

  const positions = await loadPositionsWithPrices(wallet);
  const resolutions = await loadResolutions();

  let pnl_exact = 0;
  let pnl_rounded = 0;
  let pnl_rounded_per_trade = 0;

  console.log('\nPosition-level analysis:');
  console.log('Condition ID               | Outcome | Trades | Buy$     | Sell$    | Res | Exact PnL  | Rounded PnL | Diff');
  console.log('-'.repeat(110));

  for (const pos of positions) {
    const resolution = resolutions.get(pos.condition_id);
    const isResolved = resolution && resolution.length > pos.outcome_index;
    const resPrice = isResolved ? resolution![pos.outcome_index] : 0.5;

    // Cash flow = sell - buy
    const cashFlow = pos.sell_usdc - pos.buy_usdc;
    const finalShares = pos.buy_tokens - pos.sell_tokens;

    // Method 1: Exact calculation (current V18)
    const pnl1 = isResolved ? cashFlow + (finalShares * resPrice) : 0;

    // Method 2: Round final PnL to cents
    const pnl2 = roundToCents(isResolved ? cashFlow + (finalShares * resPrice) : 0);

    // Method 3: Round intermediate values (more aggressive)
    const roundedCashFlow = roundToCents(pos.sell_usdc) - roundToCents(pos.buy_usdc);
    const pnl3 = roundToCents(isResolved ? roundedCashFlow + (roundToCents(finalShares) * resPrice) : 0);

    pnl_exact += pnl1;
    pnl_rounded += pnl2;
    pnl_rounded_per_trade += pnl3;

    if (Math.abs(pnl1) > 1 || Math.abs(pnl1 - pnl2) > 0.01) {
      const condId = pos.condition_id.substring(0, 24) + '...';
      const diff = pnl2 - pnl1;
      console.log(
        `${condId} | ${String(pos.outcome_index).padEnd(7)} | ${String(pos.trade_count).padEnd(6)} | ` +
        `$${pos.buy_usdc.toFixed(2).padStart(6)} | $${pos.sell_usdc.toFixed(2).padStart(6)} | ` +
        `${resPrice.toFixed(1)} | $${pnl1.toFixed(4).padStart(9)} | $${pnl2.toFixed(4).padStart(10)} | ` +
        `${diff >= 0 ? '+' : ''}${diff.toFixed(4)}`
      );
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Exact PnL:              $${pnl_exact.toFixed(6)}`);
  console.log(`Rounded final PnL:      $${pnl_rounded.toFixed(6)}`);
  console.log(`Rounded per-trade PnL:  $${pnl_rounded_per_trade.toFixed(6)}`);
  console.log('');
  console.log(`Diff (rounded final):     $${(pnl_rounded - pnl_exact).toFixed(6)}`);
  console.log(`Diff (rounded per-trade): $${(pnl_rounded_per_trade - pnl_exact).toFixed(6)}`);

  // Check if rounding helps for this wallet
  console.log('\n' + '-'.repeat(80));
  console.log('RECOMMENDATION:');
  if (Math.abs(pnl_rounded - pnl_exact) < 0.01) {
    console.log('Rounding has minimal effect for this wallet.');
    console.log('Error likely comes from other sources (data gaps, resolution mapping).');
  } else {
    console.log(`Rounding changes PnL by $${(pnl_rounded - pnl_exact).toFixed(4)}`);
    console.log('Consider implementing rounding in V18 for better UI parity.');
  }
}

main().catch(console.error);
