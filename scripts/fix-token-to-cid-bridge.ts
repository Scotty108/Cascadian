#!/usr/bin/env npx tsx
/**
 * FIX: Build Token ID → Condition ID Bridge
 *
 * ROOT CAUSE: market_resolutions_final is keyed by token_id hex,
 *             fact_trades_clean is keyed by condition_id
 *
 * SOLUTION: Build a mapping table from vw_trades_canonical which has BOTH
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 600000,
});

async function main() {
console.log('═'.repeat(80));
console.log('FIX: TOKEN_ID → CONDITION_ID BRIDGE');
console.log('═'.repeat(80));
console.log();

console.log('Step 1: Build token_to_cid mapping from vw_trades_canonical...');
console.log('─'.repeat(80));

try {
  await client.command({
    query: `
      CREATE OR REPLACE TABLE cascadian_clean.token_to_cid
      ENGINE = AggregatingMergeTree()
      ORDER BY (token_hex, outcome_index) AS
      SELECT
        lower(concat('0x', leftPad(hex(toUInt256(replaceAll(outcome_token, 'token_', ''))),64,'0'))) AS token_hex,
        anyHeavy(
          lower(concat('0x', leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')))
        ) AS cid_hex,
        anyHeavy(toInt32(outcome_index)) AS outcome_index
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND outcome_token LIKE 'token_%'
      GROUP BY token_hex, outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 600,
    }
  });

  console.log('✅ token_to_cid mapping created');
  console.log();

  // Check row count
  const countResult = await client.query({
    query: 'SELECT count() AS c FROM cascadian_clean.token_to_cid',
    format: 'JSONEachRow',
  });
  const count = (await countResult.json<Array<{ c: number }>>())[0].c;
  console.log(`Rows in bridge: ${count.toLocaleString()}`);
  console.log();

  console.log('Step 2: Rewrite resolutions using the bridge...');
  console.log('─'.repeat(80));

  await client.command({
    query: `
      CREATE OR REPLACE TABLE cascadian_clean.resolutions_fixed
      ENGINE = ReplacingMergeTree()
      ORDER BY (cid_hex) AS
      SELECT
        t.cid_hex,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        'rekeyed_from_token' AS source,
        r.resolved_at
      FROM default.market_resolutions_final r
      JOIN cascadian_clean.token_to_cid t
        ON t.token_hex = lower(concat('0x', leftPad(replaceOne(lower(r.condition_id_norm),'0x',''),64,'0')))
      WHERE r.winning_index IS NOT NULL AND r.payout_denominator > 0
    `,
    clickhouse_settings: {
      max_execution_time: 600,
    }
  });

  console.log('✅ resolutions_fixed created');
  console.log();

  // Check row count
  const resCountResult = await client.query({
    query: 'SELECT count() AS c FROM cascadian_clean.resolutions_fixed',
    format: 'JSONEachRow',
  });
  const resCount = (await resCountResult.json<Array<{ c: number }>>())[0].c;
  console.log(`Rows in resolutions_fixed: ${resCount.toLocaleString()}`);
  console.log();

  console.log('Step 3: Test coverage with rekeyed resolutions...');
  console.log('─'.repeat(80));

  const coverageResult = await client.query({
    query: `
      WITH
      fact AS (SELECT DISTINCT cid_hex FROM cascadian_clean.fact_trades_clean),
      res  AS (SELECT DISTINCT cid_hex FROM cascadian_clean.resolutions_fixed)
      SELECT
        (SELECT count() FROM fact) AS traded_cids,
        (SELECT count() FROM res)  AS resolution_cids,
        (SELECT count() FROM fact f WHERE f.cid_hex IN (SELECT cid_hex FROM res)) AS joined,
        round(100.0 * joined / traded_cids, 2) AS coverage_pct
    `,
    format: 'JSONEachRow',
  });

  const c = (await coverageResult.json<Array<{
    traded_cids: number;
    resolution_cids: number;
    joined: number;
    coverage_pct: number;
  }>>())[0];

  console.log();
  console.log('Coverage with rekeyed resolutions:');
  console.log(`  Traded CIDs:      ${c.traded_cids.toLocaleString()}`);
  console.log(`  Resolution CIDs:  ${c.resolution_cids.toLocaleString()}`);
  console.log(`  Matched:          ${c.joined.toLocaleString()}`);
  console.log(`  Coverage:         ${c.coverage_pct}%`);
  console.log();

  if (c.coverage_pct > 90) {
    console.log('✅✅✅ SUCCESS! Coverage jumped to >90%!');
    console.log();
    console.log('The token_id → condition_id mapping was the issue!');
  } else if (c.coverage_pct > 50) {
    console.log('✅ IMPROVED! Coverage is now >50%');
    console.log();
    console.log('May need additional API backfill for remaining markets');
  } else {
    console.log('❌ Still poor coverage');
    console.log();
    console.log('Need to backfill from Polymarket API');
  }

  console.log();
  console.log('═'.repeat(80));
  console.log('NEXT STEPS');
  console.log('═'.repeat(80));
  console.log();
  console.log('1. Create vw_resolutions_all view combining all sources');
  console.log('2. Rebuild PnL views using vw_resolutions_all');
  console.log('3. Re-verify against Polymarket UI wallets');
  console.log('4. Add category/event enrichment');
  console.log();

} catch (error: any) {
  console.error('Error:', error.message);
  process.exit(1);
}

await client.close();
}

main();
