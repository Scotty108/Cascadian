/**
 * Debug role + side sign conventions
 *
 * Expected for wallet-perspective deltas:
 *   BUY: usdc_delta negative (paying), token_delta positive (receiving)
 *   SELL: usdc_delta positive (receiving), token_delta negative (giving)
 *
 * Run with: npx tsx scripts/pnl/debug-role-signs.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const TEST_WALLET = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'; // Theo4

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   DEBUG ROLE + SIDE SIGN CONVENTIONS                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Wallet: Theo4 (${TEST_WALLET.slice(0, 10)}...)\n`);

  // Analyze by (role, side)
  const q = `
    WITH deduped AS (
      SELECT
        event_id,
        any(role) as role,
        any(side) as side,
        any(usdc_amount) / 1000000 as usdc_raw,
        any(token_amount) / 1000000 as token_raw
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${TEST_WALLET}' AND is_deleted = 0
      GROUP BY event_id
    ),
    with_delta AS (
      SELECT
        role,
        side,
        usdc_raw,
        token_raw,
        -- Current V6 formula
        if(side = 'buy', -usdc_raw, usdc_raw) as usdc_delta,
        if(side = 'buy', token_raw, -token_raw) as token_delta,
        -- Implied price
        if(token_raw > 0, usdc_raw / token_raw, 0) as implied_price
      FROM deduped
    )
    SELECT
      role,
      side,
      count() as trades,
      sum(usdc_delta) as total_usdc_delta,
      sum(token_delta) as total_token_delta,
      avg(usdc_delta) as avg_usdc_delta,
      avg(token_delta) as avg_token_delta,
      -- Sign distribution
      countIf(usdc_delta > 0) * 100.0 / count() as pct_usdc_positive,
      countIf(token_delta > 0) * 100.0 / count() as pct_token_positive,
      -- Implied price stats
      avg(implied_price) as avg_price,
      min(implied_price) as min_price,
      max(implied_price) as max_price,
      countIf(implied_price > 1.05) * 100.0 / count() as pct_price_above_105
    FROM with_delta
    GROUP BY role, side
    ORDER BY role, side
  `;

  const r = await client.query({ query: q, format: 'JSONEachRow' });
  const rows = await r.json();

  console.log('=== SIGN ANALYSIS BY (ROLE, SIDE) ===\n');
  console.log('Expected for wallet-perspective:');
  console.log('  BUY: usdc_delta < 0 (paying), token_delta > 0 (receiving)');
  console.log('  SELL: usdc_delta > 0 (receiving), token_delta < 0 (giving)\n');

  for (const row of rows) {
    console.log(`\n${row.role} + ${row.side}:`);
    console.log(`  Trades: ${row.trades}`);
    console.log(`  Total USDC delta: $${Number(row.total_usdc_delta).toLocaleString()}`);
    console.log(`  Total Token delta: ${Number(row.total_token_delta).toLocaleString()}`);
    console.log(`  Avg USDC delta: $${Number(row.avg_usdc_delta).toFixed(2)}`);
    console.log(`  Avg Token delta: ${Number(row.avg_token_delta).toFixed(2)}`);
    console.log(`  % USDC positive: ${Number(row.pct_usdc_positive).toFixed(1)}%`);
    console.log(`  % Token positive: ${Number(row.pct_token_positive).toFixed(1)}%`);
    console.log(`  Implied price: avg=${Number(row.avg_price).toFixed(3)}, min=${Number(row.min_price).toFixed(3)}, max=${Number(row.max_price).toFixed(3)}`);
    console.log(`  % Price > 1.05: ${Number(row.pct_price_above_105).toFixed(1)}%`);

    // Flag issues
    if (row.side === 'buy') {
      if (Number(row.pct_usdc_positive) > 10) {
        console.log(`  ⚠️ WARNING: BUY should have usdc_delta < 0, but ${Number(row.pct_usdc_positive).toFixed(1)}% are positive!`);
      }
      if (Number(row.pct_token_positive) < 90) {
        console.log(`  ⚠️ WARNING: BUY should have token_delta > 0, but only ${Number(row.pct_token_positive).toFixed(1)}% are positive!`);
      }
    } else if (row.side === 'sell') {
      if (Number(row.pct_usdc_positive) < 90) {
        console.log(`  ⚠️ WARNING: SELL should have usdc_delta > 0, but only ${Number(row.pct_usdc_positive).toFixed(1)}% are positive!`);
      }
      if (Number(row.pct_token_positive) > 10) {
        console.log(`  ⚠️ WARNING: SELL should have token_delta < 0, but ${Number(row.pct_token_positive).toFixed(1)}% are positive!`);
      }
    }
  }

  console.log('\n\n=== DIAGNOSIS ===\n');
  console.log('If maker signs look correct but taker signs are wrong:');
  console.log('  → Taker "side" field is from counterparty perspective');
  console.log('  → Solution: INVERT the sign transformation for taker rows');
  console.log('  → For taker: usdc_delta = if(side = "buy", usdc, -usdc)');
  console.log('  →            token_delta = if(side = "buy", -token, token)');
}

main().catch(console.error);
