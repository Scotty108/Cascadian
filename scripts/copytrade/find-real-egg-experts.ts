/**
 * Find REAL egg market experts (human-scale traders, not bots)
 *
 * Criteria:
 * - 50 - 10,000 trades (human scale)
 * - 30-80% taker (not pure market maker, not bot)
 * - Directional bias (buy% not ~50%)
 * - Active on egg markets
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const XCNSTRATEGY = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('=== FINDING REAL EGG MARKET EXPERTS ===');
  console.log('');
  console.log('Criteria for "real human trader":');
  console.log('- 50 - 10,000 total trades (human scale)');
  console.log('- 30-80% taker ratio (not pure maker or bot)');
  console.log('- Buy% away from 50% (has directional conviction)');
  console.log('- Active on egg markets');
  console.log('');

  // Find wallets with egg market activity at human scale
  const query = `
    WITH
    -- Get egg market token IDs
    egg_tokens AS (
      SELECT DISTINCT token_id_dec
      FROM pm_token_to_condition_map_v5
      WHERE lower(question) LIKE '%dozen eggs%'
         OR lower(question) LIKE '%price of eggs%'
         OR lower(question) LIKE '%egg price%'
    ),
    -- Find wallets trading eggs
    egg_traders AS (
      SELECT
        trader_wallet,
        count() as egg_trades,
        sum(usdc_amount) / 1000000.0 as egg_volume,
        countIf(lower(side) = 'buy') as egg_buys,
        countIf(role = 'taker') as egg_takers
      FROM pm_trader_events_v2
      WHERE toString(token_id) IN (SELECT token_id_dec FROM egg_tokens)
        AND is_deleted = 0
      GROUP BY trader_wallet
      HAVING egg_trades >= 20 AND egg_trades <= 50000  -- Human scale
    ),
    -- Get overall wallet stats
    wallet_totals AS (
      SELECT
        trader_wallet,
        count() as total_trades,
        sum(usdc_amount) / 1000000.0 as total_volume,
        countIf(lower(side) = 'buy') as total_buys,
        countIf(role = 'taker') as total_takers
      FROM pm_trader_events_v2
      WHERE trader_wallet IN (SELECT trader_wallet FROM egg_traders)
        AND is_deleted = 0
      GROUP BY trader_wallet
      HAVING total_trades >= 50 AND total_trades <= 20000  -- Human scale overall
    )
    SELECT
      e.trader_wallet,
      w.total_trades,
      w.total_volume,
      w.total_takers * 100.0 / w.total_trades as taker_pct,
      w.total_buys * 100.0 / w.total_trades as buy_pct,
      e.egg_trades,
      e.egg_volume,
      e.egg_trades * 100.0 / w.total_trades as egg_focus_pct,
      abs(w.total_buys * 100.0 / w.total_trades - 50) as directional_bias
    FROM egg_traders e
    JOIN wallet_totals w ON e.trader_wallet = w.trader_wallet
    WHERE w.total_takers * 100.0 / w.total_trades BETWEEN 30 AND 90  -- Not pure maker or bot
      AND abs(w.total_buys * 100.0 / w.total_trades - 50) > 5  -- Has conviction
    ORDER BY e.egg_volume DESC
    LIMIT 30
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  console.log(`Found ${rows.length} potential real egg experts\n`);
  console.log('Wallet                                     | Trades | Taker% | Buy%  | Egg Vol   | Egg Focus | Bias');
  console.log('-------------------------------------------|--------|--------|-------|-----------|-----------|------');

  for (const r of rows) {
    const isXcn = r.trader_wallet.toLowerCase() === XCNSTRATEGY.toLowerCase();
    const label = isXcn ? ' ← @xcnstrategy' : '';
    console.log(
      `${r.trader_wallet} | ${Math.round(r.total_trades).toLocaleString().padStart(6)} | ${r.taker_pct.toFixed(0).padStart(5)}% | ${r.buy_pct.toFixed(0).padStart(4)}% | $${Math.round(r.egg_volume).toLocaleString().padStart(8)} | ${r.egg_focus_pct.toFixed(0).padStart(8)}% | ${r.directional_bias.toFixed(0).padStart(4)}%${label}`
    );
  }

  console.log('\n=== TOP CANDIDATES (Similar to @xcnstrategy pattern) ===\n');

  // Find wallets most similar to @xcnstrategy
  const xcnRow = rows.find(r => r.trader_wallet.toLowerCase() === XCNSTRATEGY.toLowerCase());
  if (xcnRow) {
    console.log('@xcnstrategy reference pattern:');
    console.log(`  Trades: ${Math.round(xcnRow.total_trades)} | Taker: ${xcnRow.taker_pct.toFixed(0)}% | Buy: ${xcnRow.buy_pct.toFixed(0)}% | Egg focus: ${xcnRow.egg_focus_pct.toFixed(0)}%`);
    console.log('');
  }

  // Recommend wallets with high egg focus and clear conviction
  const topCandidates = rows.filter(r =>
    !r.trader_wallet.toLowerCase().includes(XCNSTRATEGY.toLowerCase()) &&
    r.egg_focus_pct > 10 && // Significant egg focus
    r.directional_bias > 10 && // Clear conviction
    r.egg_volume > 5000 // Meaningful volume
  ).slice(0, 10);

  console.log('Recommended wallets to investigate:\n');
  for (const c of topCandidates) {
    console.log(`✅ ${c.trader_wallet}`);
    console.log(`   https://polymarket.com/profile/${c.trader_wallet}`);
    console.log(`   Egg: $${Math.round(c.egg_volume).toLocaleString()} (${c.egg_focus_pct.toFixed(0)}% of trades) | Bias: ${c.directional_bias.toFixed(0)}% | Taker: ${c.taker_pct.toFixed(0)}%`);
    console.log('');
  }
}

main().catch(console.error);
