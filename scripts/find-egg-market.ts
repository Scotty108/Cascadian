#!/usr/bin/env npx tsx
/**
 * Task 2a: Find egg market condition ID for the test wallet
 * Look up market metadata to identify which CID corresponds to egg market
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 2A: FINDING EGG MARKET FOR WALLET');
  console.log('═'.repeat(100) + '\n');

  try {
    // Query 1: Get all top positions and their market titles (if available)
    console.log('1️⃣  Looking for markets this wallet traded...\n');

    const query = `
      WITH wallet_positions AS (
        SELECT
          lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
          t.outcome_index,
          SUM(if(t.trade_direction = 'BUY', t.shares, -t.shares)) as net_shares,
          SUM(t.cashflow_usdc) as total_cashflow,
          COUNT(*) as trade_count,
          res.payout_numerators,
          res.payout_denominator,
          res.winning_index
        FROM default.trades_raw t
        LEFT JOIN default.market_resolutions_final res
          ON lower(replaceAll(t.condition_id, '0x', '')) = res.condition_id_norm
        WHERE lower(t.wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        GROUP BY lower(replaceAll(t.condition_id, '0x', '')), t.outcome_index, res.payout_numerators, res.payout_denominator, res.winning_index
      )
      SELECT DISTINCT
        condition_id_norm,
        count() as outcome_count,
        sum(trade_count) as total_trades
      FROM wallet_positions
      GROUP BY condition_id_norm
      ORDER BY outcome_count DESC
      LIMIT 20
    `;

    const result = await ch.query({
      query,
      format: 'JSONEachRow'
    });
    const cids = await result.json<any[]>();

    console.log(`   Found ${cids.length} distinct markets\n`);
    for (const c of cids) {
      console.log(`   CID: ${c.condition_id_norm} | Outcomes: ${c.outcome_count} | Total trades: ${c.total_trades}`);
    }

    // Query 2: Check if we have market metadata (dim_markets or gamma_markets)
    console.log('\n2️⃣  Checking for market metadata tables...\n');

    const metadataQuery = `
      SELECT name FROM system.tables
      WHERE database = 'default' AND (name LIKE '%market%' OR name LIKE '%gamma%')
    `;
    const metaResult = await ch.query({
      query: metadataQuery,
      format: 'JSONEachRow'
    });
    const tables = await metaResult.json<any[]>();

    if (tables.length > 0) {
      console.log(`   Found metadata tables: ${tables.map((t: any) => t.name).join(', ')}\n`);

      // Try to find egg market
      for (const table of tables) {
        console.log(`3️⃣  Searching ${table.name} for "egg" market...\n`);
        const eggQuery = `
          SELECT *
          FROM default.${table.name}
          WHERE LOWER(title) LIKE '%egg%' OR LOWER(slug) LIKE '%egg%'
          LIMIT 5
        `;

        try {
          const eggResult = await ch.query({
            query: eggQuery,
            format: 'JSONEachRow'
          });
          const eggs = await eggResult.json<any[]>();

          if (eggs.length > 0) {
            console.log(`   ✅ Found ${eggs.length} egg markets in ${table.name}:\n`);
            for (const egg of eggs) {
              console.log(`      Title: ${egg.title || egg.slug || 'N/A'}`);
              console.log(`      Condition ID: ${egg.condition_id || egg.condition_id_norm || 'N/A'}\n`);
            }
          }
        } catch (e: any) {
          // Table might not have these columns, continue
        }
      }
    } else {
      console.log('   ❌ No market metadata tables found\n');
      console.log('   Next: Will need to query Gamma API to resolve market titles\n');
    }

    console.log('═'.repeat(100));
    console.log('RESULT: Ready for Task 2b - Gamma API resolution');
    console.log('═'.repeat(100));

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

main().catch(console.error);
