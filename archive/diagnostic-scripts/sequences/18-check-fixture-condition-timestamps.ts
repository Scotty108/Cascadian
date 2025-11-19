/**
 * 18: CHECK FIXTURE CONDITION TIMESTAMPS
 *
 * Check timestamp data for the specific conditions in our fixture
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('18: CHECK FIXTURE CONDITION TIMESTAMPS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Conditions from our fixture
  const conditions = [
    '009903cf9e4d01143d95624788d27871262a508af8d7357e17ee9337b01a34c6',
    '003a88c2b6580c0afb82a5b1e4898b6e1cb02be32d0ba2c5bd3d43a3a142e05e',
    '00166ca99140c884fd8465295373ee57a2f80384332367d8bb4d169def5b7d82'
  ];

  for (const cond of conditions) {
    console.log(`\n📊 Condition: ${cond}\n`);

    // Check market_resolutions_final
    const query1 = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          resolved_at,
          toUnixTimestamp(resolved_at) AS unix_ts,
          length(payout_numerators) AS payout_len
        FROM market_resolutions_final
        WHERE condition_id_norm = '${cond}'
        LIMIT 3
      `,
      format: 'JSONEachRow'
    });

    const results1: any[] = await query1.json();

    if (results1.length > 0) {
      console.log('market_resolutions_final:');
      console.table(results1.map(r => ({
        winning_idx: r.winning_index,
        resolved_at: r.resolved_at,
        unix_ts: r.unix_ts,
        payout_len: r.payout_len
      })));
    } else {
      console.log('market_resolutions_final: NO DATA\n');
    }

    // Check resolution_timestamps
    const query2 = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index_from_chain,
          resolved_at,
          toUnixTimestamp(resolved_at) AS unix_ts
        FROM resolution_timestamps
        WHERE condition_id_norm = '${cond}'
      `,
      format: 'JSONEachRow'
    });

    const results2: any[] = await query2.json();

    if (results2.length > 0) {
      console.log('\nresolution_timestamps:');
      console.table(results2.map(r => ({
        winning_idx: r.winning_index_from_chain,
        resolved_at: r.resolved_at,
        unix_ts: r.unix_ts
      })));
    } else {
      console.log('\nresolution_timestamps: NO DATA\n');
    }
  }

  console.log('\n✅ ANALYSIS COMPLETE\n');
}

main().catch(console.error);
