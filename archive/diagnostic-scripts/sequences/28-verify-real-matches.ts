/**
 * 28: VERIFY REAL MATCHES
 *
 * Actually show the matched rows to verify the join is working
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('28: VERIFY REAL MATCHES');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Testing if the join actually matches condition_ids...\n');

  const query = await clickhouse.query({
    query: `
      SELECT
        t.condition_id_norm AS traded_cid,
        mr.condition_id_norm AS resolution_cid,
        mr.winning_index,
        mr.resolved_at,
        t.condition_id_norm = mr.condition_id_norm AS exact_match
      FROM (
        SELECT DISTINCT cm.condition_id_norm
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
        WHERE cf.timestamp >= '2025-01-01'
        LIMIT 10
      ) AS t
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = t.condition_id_norm
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const matches: any[] = await query.json();

  console.log(`Found ${matches.length} results\n`);

  console.table(matches.map(m => ({
    traded_cid: m.traded_cid ? m.traded_cid.substring(0, 20) + '...' : 'null',
    resolution_cid: m.resolution_cid ? m.resolution_cid.substring(0, 20) + '...' : 'null',
    exact_match: m.exact_match,
    winning_index: m.winning_index,
    resolved_at: m.resolved_at
  })));

  const exactMatches = matches.filter(m => m.exact_match === 1).length;
  console.log(`\nExact matches: ${exactMatches}/${matches.length}`);

  if (exactMatches > 0) {
    console.log('\n🎉 CONFIRMED: Real matches exist!\n');
  } else {
    console.log('\n❌ FALSE POSITIVE: No real matches (LEFT JOIN returned non-matching rows)\n');
  }

  console.log('\n✅ VERIFICATION COMPLETE\n');
}

main().catch(console.error);
