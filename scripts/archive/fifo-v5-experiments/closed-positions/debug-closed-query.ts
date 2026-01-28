#!/usr/bin/env tsx
/**
 * Debug Closed Positions Query
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('🔬 Debugging Closed Positions Query\n');

  try {
    // Test 1: Find FuelHydrantBoss positions
    console.log('Test 1: FuelHydrantBoss position summary');
    const test1 = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          outcome_index,
          count() as fills,
          sum(tokens_delta) as net_tokens,
          sum(usdc_delta) as net_cash_flow
        FROM pm_canonical_fills_v4_deduped
        WHERE wallet = '0x94a4f1e3eb49a66a20372d98af9988be73bb55c4'
          AND source = 'clob'
        GROUP BY condition_id, outcome_index
        HAVING abs(net_tokens) < 0.01
        ORDER BY abs(net_cash_flow) DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    const rows1 = await test1.json() as any[];
    console.log(`  Found ${rows1.length} closed positions`);
    if (rows1.length > 0) {
      console.log(`  Top 3:`);
      rows1.slice(0, 3).forEach((r, i) => {
        console.log(`    ${i+1}. ${r.condition_id.slice(0, 10)}... oi=${r.outcome_index} fills=${r.fills} cash=$${r.net_cash_flow.toFixed(0)}`);
      });
    }
    console.log();

    // Test 2: Check if any have resolutions
    console.log('Test 2: Check resolution status');
    const test2 = await clickhouse.query({
      query: `
        SELECT
          count() as total,
          countIf(r.payout_numerators IS NULL) as unresolved,
          countIf(r.payout_numerators IS NOT NULL) as resolved
        FROM (
          SELECT condition_id
          FROM pm_canonical_fills_v4_deduped
          WHERE wallet = '0x94a4f1e3eb49a66a20372d98af9988be73bb55c4'
            AND source = 'clob'
          GROUP BY condition_id
          HAVING abs(sum(tokens_delta)) < 0.01
        ) f
        LEFT JOIN pm_condition_resolutions r
          ON f.condition_id = r.condition_id AND r.is_deleted = 0
      `,
      format: 'JSONEachRow',
    });
    const rows2 = await test2.json() as any[];
    console.log(`  Total closed positions: ${rows2[0].total}`);
    console.log(`  Unresolved: ${rows2[0].unresolved}`);
    console.log(`  Resolved: ${rows2[0].resolved}`);
    console.log();

    // Test 3: Try the full query logic
    console.log('Test 3: Full query logic (just count)');
    const test3 = await clickhouse.query({
      query: `
        SELECT count() as total
        FROM (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            sum(tokens_delta) as net_tokens,
            if(any(r.payout_numerators) IS NULL, 1, 0) as market_open
          FROM pm_canonical_fills_v4_deduped f
          LEFT JOIN pm_condition_resolutions r
            ON f.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE f.source = 'clob'
          GROUP BY wallet, condition_id, outcome_index
          HAVING abs(net_tokens) < 0.01
            AND market_open = 1
        )
      `,
      format: 'JSONEachRow',
    });
    const rows3 = await test3.json() as any[];
    console.log(`  Total closed unresolved positions: ${rows3[0].total}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

main().catch(console.error);
