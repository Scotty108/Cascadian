#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

const problemWallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('=== WALLET P&L WITH FIX APPLIED ===\n');
  console.log(`Wallet: ${problemWallet}`);
  console.log(`Polymarket shows: $332,000`);
  console.log(`\nCalculating with fixed joins...\n`);

  const query = `
    WITH positions AS (
      SELECT
        condition_id_norm,
        outcome_index,
        SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE -shares END) as net_shares,
        SUM(CASE WHEN trade_direction = 'BUY' THEN -usd_value ELSE usd_value END) as net_cost
      FROM vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${problemWallet}')
        AND condition_id_norm != ''
      GROUP BY condition_id_norm, outcome_index
      HAVING ABS(net_shares) > 0.01
    ),
    positions_with_data AS (
      SELECT
        p.condition_id_norm,
        p.outcome_index,
        p.net_shares,
        p.net_cost,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        m.midprice,
        CASE
          -- Resolved positions
          WHEN r.winning_index IS NOT NULL THEN
            CASE
              WHEN r.winning_index = p.outcome_index
                THEN toFloat64(p.net_shares - p.net_cost)  -- Winner
                ELSE toFloat64(-p.net_cost)  -- Loser
            END
          -- Unrealized (use midprice if available)
          WHEN m.midprice IS NOT NULL THEN
            toFloat64((p.net_shares * m.midprice) - p.net_cost)
          -- Fallback: assume last trade value
          ELSE
            toFloat64(-p.net_cost)
        END as pnl
      FROM positions p
      LEFT JOIN market_resolutions_final r
        ON replaceAll(p.condition_id_norm, '0x', '') = r.condition_id_norm
      LEFT JOIN cascadian_clean.midprices_latest m
        ON m.market_cid = p.condition_id_norm
        AND m.outcome = p.outcome_index + 1
    )
    SELECT
      COUNT(*) as total_positions,
      SUM(CASE WHEN winning_index IS NOT NULL THEN 1 ELSE 0 END) as resolved_positions,
      SUM(CASE WHEN winning_index IS NULL AND midprice IS NOT NULL THEN 1 ELSE 0 END) as unrealized_with_price,
      SUM(CASE WHEN winning_index IS NULL AND midprice IS NULL THEN 1 ELSE 0 END) as unknown_price,
      round(SUM(pnl), 2) as total_pnl,
      round(SUM(CASE WHEN winning_index IS NOT NULL THEN pnl ELSE 0 END), 2) as realized_pnl,
      round(SUM(CASE WHEN winning_index IS NULL THEN pnl ELSE 0 END), 2) as unrealized_pnl
    FROM positions_with_data
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  const summary = data[0];

  console.log('POSITION BREAKDOWN:');
  console.log(`  Total positions: ${summary.total_positions}`);
  console.log(`  Resolved: ${summary.resolved_positions} (${(summary.resolved_positions / summary.total_positions * 100).toFixed(1)}%)`);
  console.log(`  Unrealized (w/ price): ${summary.unrealized_with_price}`);
  console.log(`  Unknown price: ${summary.unknown_price}`);

  console.log('\nP&L CALCULATION:');
  console.log(`  Realized P&L: $${Number(summary.realized_pnl).toLocaleString()}`);
  console.log(`  Unrealized P&L: $${Number(summary.unrealized_pnl).toLocaleString()}`);
  console.log(`  ─────────────────────────────`);
  console.log(`  TOTAL P&L: $${Number(summary.total_pnl).toLocaleString()}`);

  console.log('\nCOMPARISON:');
  console.log(`  Polymarket: $332,000`);
  console.log(`  Our calc (BEFORE fix): -$677`);
  console.log(`  Our calc (AFTER fix): $${Number(summary.total_pnl).toLocaleString()}`);

  const difference = Number(summary.total_pnl) - 332000;
  const diffPct = (difference / 332000 * 100).toFixed(1);

  console.log(`\n  Difference: $${difference.toLocaleString()} (${diffPct}%)`);

  if (Math.abs(difference) < 50000) {
    console.log('\n✓ CLOSE MATCH! Within reasonable margin.');
  } else {
    console.log('\n⚠ Still significant difference. Possible causes:');
    console.log('  - Missing midprices for unrealized positions');
    console.log('  - Polymarket includes fees/other adjustments');
    console.log('  - Our last_trade_price fallback may be stale');
  }

  // Get top positions to understand the P&L
  console.log('\n\nTOP 10 POSITIONS (by absolute P&L):');
  console.log('─'.repeat(100));

  const detailQuery = `
    WITH positions AS (
      SELECT
        condition_id_norm,
        outcome_index,
        SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE -shares END) as net_shares,
        SUM(CASE WHEN trade_direction = 'BUY' THEN -usd_value ELSE usd_value END) as net_cost
      FROM vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${problemWallet}')
        AND condition_id_norm != ''
      GROUP BY condition_id_norm, outcome_index
      HAVING ABS(net_shares) > 0.01
    ),
    positions_with_data AS (
      SELECT
        substring(p.condition_id_norm, 1, 10) as cid_short,
        p.outcome_index,
        round(p.net_shares, 2) as shares,
        round(p.net_cost, 2) as cost,
        r.winning_index,
        m.midprice,
        CASE
          WHEN r.winning_index IS NOT NULL THEN
            CASE
              WHEN r.winning_index = p.outcome_index THEN toFloat64(p.net_shares - p.net_cost)
              ELSE toFloat64(-p.net_cost)
            END
          WHEN m.midprice IS NOT NULL THEN
            toFloat64((p.net_shares * m.midprice) - p.net_cost)
          ELSE
            toFloat64(-p.net_cost)
        END as pnl,
        CASE
          WHEN r.winning_index IS NOT NULL THEN 'RESOLVED'
          WHEN m.midprice IS NOT NULL THEN 'UNREALIZED'
          ELSE 'NO PRICE'
        END as status
      FROM positions p
      LEFT JOIN market_resolutions_final r
        ON replaceAll(p.condition_id_norm, '0x', '') = r.condition_id_norm
      LEFT JOIN cascadian_clean.midprices_latest m
        ON m.market_cid = p.condition_id_norm
        AND m.outcome = p.outcome_index + 1
    )
    SELECT *
    FROM positions_with_data
    ORDER BY ABS(pnl) DESC
    LIMIT 10
  `;

  const detailResult = await client.query({ query: detailQuery, format: 'JSONEachRow' });
  const positions = await detailResult.json();

  console.log(
    'CID'.padEnd(12),
    'Out'.padStart(4),
    'Shares'.padStart(10),
    'Cost'.padStart(12),
    'P&L'.padStart(12),
    'Status'.padStart(12)
  );
  console.log('─'.repeat(100));

  for (const pos of positions) {
    console.log(
      pos.cid_short.padEnd(12),
      String(pos.outcome_index).padStart(4),
      Number(pos.shares).toFixed(2).padStart(10),
      `$${Number(pos.cost).toLocaleString()}`.padStart(12),
      `$${Number(pos.pnl).toLocaleString()}`.padStart(12),
      pos.status.padStart(12)
    );
  }

  await client.close();
}

main().catch(console.error);
