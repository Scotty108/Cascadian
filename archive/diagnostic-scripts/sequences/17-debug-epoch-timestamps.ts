/**
 * 17: DEBUG EPOCH TIMESTAMPS
 *
 * Investigate why all resolved_at show as 1970-01-01 (epoch)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('17: DEBUG EPOCH TIMESTAMPS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Checking resolution_timestamps table...\n');

  const query1 = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        resolved_at,
        toUnixTimestamp(resolved_at) AS unix_ts,
        payout_numerators_from_chain,
        winning_index_from_chain
      FROM resolution_timestamps
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples1: any[] = await query1.json();

  console.log('resolution_timestamps samples:\n');
  console.table(samples1.map(s => ({
    condition: s.condition_id_norm.substring(0, 20) + '...',
    resolved_at: s.resolved_at,
    unix_ts: s.unix_ts,
    winning_idx: s.winning_index_from_chain
  })));

  console.log('\n📊 Checking market_resolutions_norm view...\n');

  const query2 = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        resolved_at,
        toUnixTimestamp(resolved_at) AS unix_ts,
        winning_index,
        length(payout_numerators) AS payout_len
      FROM market_resolutions_norm
      WHERE condition_id_norm IN (
        SELECT condition_id_norm FROM resolution_timestamps LIMIT 5
      )
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples2: any[] = await query2.json();

  console.log('market_resolutions_norm samples:\n');
  console.table(samples2.map(s => ({
    condition: s.condition_id_norm.substring(0, 20) + '...',
    resolved_at: s.resolved_at,
    unix_ts: s.unix_ts,
    winning_idx: s.winning_index,
    payout_len: s.payout_len
  })));

  console.log('\n📊 Checking resolutions_external_ingest source...\n');

  const query3 = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        resolved_at,
        toUnixTimestamp(resolved_at) AS unix_ts,
        winning_index,
        length(payout_numerators) AS payout_len
      FROM resolutions_external_ingest
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples3: any[] = await query3.json();

  console.log('resolutions_external_ingest samples:\n');
  console.table(samples3.map(s => ({
    condition: s.condition_id.substring(0, 20) + '...',
    resolved_at: s.resolved_at,
    unix_ts: s.unix_ts,
    winning_idx: s.winning_index,
    payout_len: s.payout_len
  })));

  console.log('\n✅ DEBUG COMPLETE\n');
}

main().catch(console.error);
