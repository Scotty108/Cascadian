/**
 * 16: FIND OPEN POSITIONS
 *
 * Find positions that don't have resolution data (truly OPEN)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('16: FIND OPEN POSITIONS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Looking for positions without resolution data...\n');

  const query = await clickhouse.query({
    query: `
      WITH cm AS (
        SELECT asset_id, condition_id_norm, outcome_index FROM ctf_token_map_norm
      ),
      positions AS (
        SELECT
          cf.proxy_wallet,
          cf.asset_id,
          cm.condition_id_norm,
          cm.outcome_index,
          r.winning_index,
          r.resolved_at,
          sum(cf.size) AS total_size,
          count() AS fill_count
        FROM clob_fills cf
        INNER JOIN cm ON cm.asset_id = cf.asset_id
        LEFT JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
        WHERE cf.timestamp >= '2025-01-01' AND cf.timestamp < '2025-11-01'
        GROUP BY
          cf.proxy_wallet,
          cf.asset_id,
          cm.condition_id_norm,
          cm.outcome_index,
          r.winning_index,
          r.resolved_at
      )
      SELECT
        count() AS total_positions,
        countIf(winning_index IS NULL) AS positions_without_winning_index,
        countIf(resolved_at IS NULL) AS positions_without_timestamp,
        countIf(winning_index IS NULL OR resolved_at IS NULL) AS truly_open
      FROM positions
    `,
    format: 'JSONEachRow'
  });

  const stats: any = (await query.json())[0];

  console.log('Position Resolution Status:\n');
  console.log(`  Total positions: ${parseInt(stats.total_positions).toLocaleString()}`);
  console.log(`  Without winning_index: ${parseInt(stats.positions_without_winning_index).toLocaleString()}`);
  console.log(`  Without resolved_at: ${parseInt(stats.positions_without_timestamp).toLocaleString()}`);
  console.log(`  Truly open: ${parseInt(stats.truly_open).toLocaleString()}\n`);

  // Sample some open positions
  if (parseInt(stats.truly_open) > 0) {
    const sampleQuery = await clickhouse.query({
      query: `
        WITH cm AS (
          SELECT asset_id, condition_id_norm, outcome_index FROM ctf_token_map_norm
        )
        SELECT
          cf.proxy_wallet,
          cf.asset_id,
          cm.condition_id_norm,
          cm.outcome_index,
          r.winning_index,
          r.resolved_at,
          sum(cf.size) AS total_size
        FROM clob_fills cf
        INNER JOIN cm ON cm.asset_id = cf.asset_id
        LEFT JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
        WHERE cf.timestamp >= '2025-01-01' AND cf.timestamp < '2025-11-01'
          AND (r.winning_index IS NULL OR r.resolved_at IS NULL)
        GROUP BY
          cf.proxy_wallet,
          cf.asset_id,
          cm.condition_id_norm,
          cm.outcome_index,
          r.winning_index,
          r.resolved_at
        ORDER BY total_size DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const samples: any[] = await sampleQuery.json();

    console.log('Sample OPEN positions:\n');
    console.table(samples.map(s => ({
      wallet: s.proxy_wallet.substring(0, 10) + '...',
      condition: s.condition_id_norm ? s.condition_id_norm.substring(0, 15) + '...' : 'null',
      outcome: s.outcome_index,
      winning: s.winning_index,
      resolved: s.resolved_at,
      size: parseFloat(s.total_size).toLocaleString()
    })));
  }

  console.log('\n✅ OPEN POSITION ANALYSIS COMPLETE\n');
}

main().catch(console.error);
