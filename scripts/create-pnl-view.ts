#!/usr/bin/env npx tsx
/**
 * CREATE PNL MATERIALIZED VIEW
 *
 * This script creates a materialized view that joins trades to resolutions
 * and calculates realized P&L.
 *
 * Runtime: ~3 minutes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function createPnLView() {
  console.log('\n📊 Creating trades_with_pnl materialized view...\n');

  try {
    // Drop if exists
    console.log('1️⃣ Dropping existing view if it exists...');
    await client.command({
      query: 'DROP TABLE IF EXISTS trades_with_pnl',
    });
    console.log('   ✅ Dropped\n');

    // Create the view
    console.log('2️⃣ Creating new trades_with_pnl view...');
    console.log('   This will take ~2-3 minutes...\n');

    const startTime = Date.now();

    await client.command({
      query: `
        CREATE MATERIALIZED VIEW trades_with_pnl
        ENGINE = ReplacingMergeTree()
        ORDER BY (wallet_address, block_time)
        PARTITION BY toYYYYMM(block_time)
        AS
        SELECT
          -- All trade fields
          t.tx_hash,
          t.block_time,
          t.wallet_address,
          t.condition_id_norm,
          t.market_id,
          t.outcome_index,
          t.direction,
          t.shares,
          t.price,
          t.usd_value,

          -- Resolution data
          r.winning_outcome,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          r.resolved_at,

          -- P&L calculation
          multiIf(
            r.winning_index IS NULL, NULL,
            t.direction = 'BUY', t.shares * (arrayElement(r.payout_numerators, t.outcome_index + 1) / r.payout_denominator) - t.usd_value,
            t.direction = 'SELL', t.usd_value - t.shares * (arrayElement(r.payout_numerators, t.outcome_index + 1) / r.payout_denominator),
            NULL
          ) as realized_pnl_usd,

          now() as updated_at

        FROM trades_canonical t
        LEFT JOIN market_resolutions_final r
          ON t.condition_id_norm = r.condition_id_norm
      `,
    });

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`   ✅ Created in ${elapsed} minutes\n`);

    // Verify
    console.log('3️⃣ Verifying data...');
    const stats = await client.query({
      query: `
        SELECT
          count() as total_rows,
          countIf(resolved_at IS NOT NULL) as resolved_trades,
          countIf(realized_pnl_usd IS NOT NULL) as trades_with_pnl,
          sum(realized_pnl_usd) as total_pnl,
          countIf(realized_pnl_usd > 0) as winning_trades,
          countIf(realized_pnl_usd < 0) as losing_trades
        FROM trades_with_pnl
      `,
      format: 'JSONEachRow',
    });
    const data: any = await stats.json();
    const row = data[0];

    console.log(`   Total rows: ${parseInt(row.total_rows).toLocaleString()}`);
    console.log(`   Resolved trades: ${parseInt(row.resolved_trades).toLocaleString()}`);
    console.log(`   Trades with P&L: ${parseInt(row.trades_with_pnl).toLocaleString()}`);
    console.log(`   Total P&L: $${parseFloat(row.total_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Winning trades: ${parseInt(row.winning_trades).toLocaleString()}`);
    console.log(`   Losing trades: ${parseInt(row.losing_trades).toLocaleString()}\n`);

    // Sample
    console.log('4️⃣ Sample P&L data:');
    const sample = await client.query({
      query: `
        SELECT
          wallet_address,
          direction,
          shares,
          price,
          usd_value,
          winning_outcome,
          realized_pnl_usd
        FROM trades_with_pnl
        WHERE realized_pnl_usd IS NOT NULL
        ORDER BY abs(realized_pnl_usd) DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const sampleData = await sample.json();
    sampleData.forEach((row: any, i: number) => {
      console.log(`   ${i + 1}. ${row.wallet_address.substring(0, 10)}...`);
      console.log(`      ${row.direction} ${row.shares} shares @ $${row.price}`);
      console.log(`      Winner: ${row.winning_outcome}`);
      console.log(`      P&L: $${parseFloat(row.realized_pnl_usd).toFixed(2)}`);
    });

    console.log('\n✅ SUCCESS! trades_with_pnl view is ready.\n');
    console.log('Next step: Run `npx tsx scripts/test-pnl-queries.ts`\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

createPnLView().catch(console.error);
