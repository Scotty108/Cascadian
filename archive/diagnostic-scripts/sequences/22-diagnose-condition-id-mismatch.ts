/**
 * 22: DIAGNOSE CONDITION_ID MISMATCH
 *
 * Compare condition_ids from resolutions vs traded assets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('22: DIAGNOSE CONDITION_ID MISMATCH');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Sample condition_ids from market_resolutions_norm...\n');

  const query1 = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        length(payout_numerators) AS payout_len,
        resolved_at
      FROM market_resolutions_norm
      WHERE winning_index IS NOT NULL
        AND resolved_at IS NOT NULL
        AND resolved_at != '1970-01-01 00:00:00'
        AND length(payout_numerators) > 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const resSamples: any[] = await query1.json();

  console.log('Resolutions sample:');
  console.table(resSamples.map(s => ({
    condition_id: s.condition_id_norm,
    len: s.condition_id_norm.length,
    winning_idx: s.winning_index,
    payout_len: s.payout_len,
    resolved: s.resolved_at
  })));

  console.log('\n📊 Sample condition_ids from traded assets (via token map)...\n');

  const query2 = await clickhouse.query({
    query: `
      SELECT DISTINCT
        cm.condition_id_norm,
        cm.outcome_index,
        count() AS fill_count
      FROM clob_fills cf
      INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
      WHERE cf.timestamp >= '2025-01-01'
      GROUP BY cm.condition_id_norm, cm.outcome_index
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const tradedSamples: any[] = await query2.json();

  console.log('Traded assets sample:');
  console.table(tradedSamples.map(s => ({
    condition_id: s.condition_id_norm,
    len: s.condition_id_norm.length,
    outcome: s.outcome_index,
    fills: s.fill_count
  })));

  console.log('\n📊 Check if any traded condition_ids exist in resolutions...\n');

  const tradedCondIds = tradedSamples.map(s => `'${s.condition_id_norm}'`).join(',');

  const query3 = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        resolved_at
      FROM market_resolutions_norm
      WHERE condition_id_norm IN (${tradedCondIds})
    `,
    format: 'JSONEachRow'
  });

  const matches: any[] = await query3.json();

  console.log(`  Found ${matches.length} matches\n`);

  if (matches.length > 0) {
    console.table(matches);
  }

  console.log('\n✅ DIAGNOSTIC COMPLETE\n');
}

main().catch(console.error);
