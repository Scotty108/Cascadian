#!/usr/bin/env npx tsx
/**
 * Recreate trades_raw as a VIEW pointing to vw_trades_canonical
 *
 * Background:
 * - trades_raw (159.6M rows) was lost on Nov 8, 2025 during enrichment incident
 * - vw_trades_canonical (157.5M rows) is now our most complete source
 * - Unrealized P&L scripts expect trades_raw table
 *
 * Solution:
 * - Create trades_raw as a VIEW that maps vw_trades_canonical columns
 * - This allows unrealized P&L scripts to work without modification
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 60000
});

async function main() {
  console.log('\n🔧 RECREATING TRADES_RAW FROM VW_TRADES_CANONICAL\n');
  console.log('═'.repeat(80));

  try {
    // Step 1: Check current state
    console.log('\n1️⃣ Checking current state...\n');

    const tradesRawExists = await ch.query({
      query: `SELECT count() as cnt FROM system.tables WHERE database = 'default' AND name = 'trades_raw'`,
      format: 'JSONEachRow'
    });
    const exists = (await tradesRawExists.json())[0].cnt > 0;

    if (exists) {
      console.log('  ⚠️  trades_raw already exists');

      // Check if it's a view or table
      const typeCheck = await ch.query({
        query: `SELECT engine FROM system.tables WHERE database = 'default' AND name = 'trades_raw'`,
        format: 'JSONEachRow'
      });
      const engine = (await typeCheck.json())[0].engine;
      console.log(`  Current type: ${engine}`);

      // If it's not a view, ask to drop it
      if (engine !== 'View') {
        console.log('\n  ❌ trades_raw is a TABLE, not a VIEW');
        console.log('  To proceed, manually drop it first:');
        console.log('    DROP TABLE default.trades_raw;');
        process.exit(1);
      }

      console.log('  Dropping existing view...');
      await ch.query({ query: 'DROP VIEW default.trades_raw' });
      console.log('  ✅ Dropped old view');
    } else {
      console.log('  ℹ️  trades_raw does not exist (expected after Nov 8 incident)');
    }

    // Step 2: Check vw_trades_canonical
    console.log('\n2️⃣ Verifying vw_trades_canonical...\n');

    const canonicalCount = await ch.query({
      query: `SELECT COUNT(*) as count FROM default.vw_trades_canonical`,
      format: 'JSONEachRow'
    });
    const count = (await canonicalCount.json())[0];
    console.log(`  ✅ vw_trades_canonical has ${parseInt(count.count).toLocaleString()} rows`);

    // Step 3: Create trades_raw view
    console.log('\n3️⃣ Creating trades_raw view...\n');

    const createView = `
      CREATE VIEW default.trades_raw AS
      SELECT
        trade_id,
        transaction_hash as tx_hash,
        wallet_address_norm as wallet,
        market_id_norm as market_id,
        condition_id_norm as condition_id,
        timestamp as block_time,

        -- Trade details
        outcome_token as side,
        outcome_index,
        trade_direction,
        direction_confidence,
        shares,
        entry_price,
        usd_value as cashflow_usdc,

        -- P&L placeholder (will be calculated by unrealized P&L scripts)
        NULL as unrealized_pnl_usd,
        NULL as pnl,

        -- Metadata
        created_at,
        trade_key

      FROM default.vw_trades_canonical
      WHERE market_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `;

    await ch.query({ query: createView });
    console.log('  ✅ Created trades_raw view');

    // Step 4: Verify new view
    console.log('\n4️⃣ Verifying new view...\n');

    const newCount = await ch.query({
      query: `SELECT COUNT(*) as count FROM default.trades_raw`,
      format: 'JSONEachRow'
    });
    const newCountData = (await newCount.json())[0];
    console.log(`  ✅ trades_raw now has ${parseInt(newCountData.count).toLocaleString()} rows`);

    // Sample data
    console.log('\n5️⃣ Sample data from new trades_raw view...\n');

    const sample = await ch.query({
      query: `SELECT * FROM default.trades_raw LIMIT 3`,
      format: 'JSONEachRow'
    });
    const samples = await sample.json();

    samples.forEach((row, idx) => {
      console.log(`  Sample ${idx + 1}:`);
      console.log(`    Trade ID: ${row.trade_id}`);
      console.log(`    Wallet: ${row.wallet.substring(0, 10)}...`);
      console.log(`    Market: ${row.market_id.substring(0, 10)}...`);
      console.log(`    Condition: ${row.condition_id.substring(0, 10)}...`);
      console.log(`    Side: ${row.side} | Direction: ${row.trade_direction}`);
      console.log(`    Shares: ${row.shares} | Price: ${row.entry_price} | Cashflow: $${row.cashflow_usdc}`);
      console.log();
    });

    console.log('═'.repeat(80));
    console.log('\n✅ SUCCESS: trades_raw view recreated\n');
    console.log('Next steps:');
    console.log('  1. Run unrealized P&L pipeline:');
    console.log('     npx tsx scripts/unrealized-pnl-step1-add-column.ts');
    console.log('     npx tsx scripts/unrealized-pnl-step2-calculate.ts');
    console.log('     npx tsx scripts/unrealized-pnl-step3-aggregate.ts');
    console.log('  2. Test with wallets:');
    console.log('     npx tsx test-total-pnl-three-wallets.ts\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error('\nFull error:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
