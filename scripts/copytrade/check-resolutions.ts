/**
 * Check resolution status for calibration's markets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

async function check() {
  const wallet = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

  // Get calibration's conditions from patch table
  const q = `
    WITH tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_dedup_v2_tbl
      WHERE trader_wallet = '${wallet}'
    ),
    mappings AS (
      SELECT DISTINCT condition_id
      FROM pm_token_to_condition_patch
      WHERE token_id_dec IN (SELECT token_id FROM tokens)
    )
    SELECT
      m.condition_id,
      r.outcome_index,
      r.resolved_price,
      r.resolution_time
    FROM mappings m
    LEFT JOIN vw_pm_resolution_prices r ON m.condition_id = r.condition_id
    ORDER BY m.condition_id, r.outcome_index
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as Array<{
    condition_id: string;
    outcome_index: number | null;
    resolved_price: number | null;
    resolution_time: string | null;
  }>;

  const resolved = rows.filter((r) => r.resolved_price !== null && r.resolved_price !== undefined);
  const unresolved = rows.filter((r) => r.resolved_price === null || r.resolved_price === undefined);

  console.log("Resolution status for calibration's 27 conditions:");
  console.log('  Resolved outcomes:', resolved.length);
  console.log('  Unresolved outcomes:', unresolved.length);

  if (resolved.length > 0) {
    console.log('\nSample resolved:');
    for (const r of resolved.slice(0, 5)) {
      console.log(
        `  ${r.condition_id.slice(0, 16)}... outcome ${r.outcome_index}: ${r.resolved_price} @ ${r.resolution_time}`
      );
    }
  }

  if (unresolved.length > 0) {
    console.log('\nUnresolved conditions (sample):');
    for (const r of unresolved.slice(0, 5)) {
      console.log(`  ${r.condition_id.slice(0, 16)}...`);
    }
  }
}

check().catch(console.error);
