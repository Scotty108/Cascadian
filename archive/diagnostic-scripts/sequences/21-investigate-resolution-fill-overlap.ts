/**
 * 21: INVESTIGATE RESOLUTION-FILL OVERLAP
 *
 * Find which valid condition_ids actually have fills
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('21: INVESTIGATE RESOLUTION-FILL OVERLAP');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Count valid resolutions by condition...\n');

  const query1 = await clickhouse.query({
    query: `
      SELECT count() AS total_valid_resolutions
      FROM market_resolutions_norm
      WHERE winning_index IS NOT NULL
        AND resolved_at IS NOT NULL
        AND resolved_at != '1970-01-01 00:00:00'
        AND length(payout_numerators) > 0
    `,
    format: 'JSONEachRow'
  });

  const result1: any = (await query1.json())[0];
  console.log(`  Valid resolutions: ${parseInt(result1.total_valid_resolutions).toLocaleString()}\n`);

  console.log('📊 Step 2: Check overlap with fills via token map...\n');

  const query2 = await clickhouse.query({
    query: `
      SELECT
        count() AS fills_with_valid_resolutions,
        countDistinct(cm.condition_id_norm) AS unique_conditions,
        min(cf.timestamp) AS earliest_fill,
        max(cf.timestamp) AS latest_fill
      FROM clob_fills cf
      INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
      INNER JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
      WHERE r.winning_index IS NOT NULL
        AND r.resolved_at IS NOT NULL
        AND r.resolved_at != '1970-01-01 00:00:00'
        AND length(r.payout_numerators) > 0
    `,
    format: 'JSONEachRow'
  });

  const result2: any = (await query2.json())[0];

  console.log(`  Fills with valid resolutions: ${parseInt(result2.fills_with_valid_resolutions).toLocaleString()}`);
  console.log(`  Unique conditions: ${parseInt(result2.unique_conditions).toLocaleString()}`);
  console.log(`  Fill date range: ${result2.earliest_fill} to ${result2.latest_fill}\n`);

  console.log('📊 Step 3: Sample some fills with valid resolution data...\n');

  const query3 = await clickhouse.query({
    query: `
      SELECT
        cf.timestamp,
        cf.asset_id,
        cm.condition_id_norm,
        cm.outcome_index,
        r.winning_index,
        r.resolved_at,
        length(r.payout_numerators) AS payout_len
      FROM clob_fills cf
      INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
      INNER JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
      WHERE r.winning_index IS NOT NULL
        AND r.resolved_at IS NOT NULL
        AND r.resolved_at != '1970-01-01 00:00:00'
        AND length(r.payout_numerators) > 0
      ORDER BY cf.timestamp DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await query3.json();

  console.table(samples.map(s => ({
    fill_time: s.timestamp,
    condition: s.condition_id_norm.substring(0, 20) + '...',
    outcome: s.outcome_index,
    winning: s.winning_index,
    resolved: s.resolved_at,
    payout_len: s.payout_len
  })));

  console.log('\n✅ OVERLAP INVESTIGATION COMPLETE\n');
}

main().catch(console.error);
