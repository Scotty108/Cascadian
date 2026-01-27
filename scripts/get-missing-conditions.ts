import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('Querying for missing conditions...');

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT r.condition_id
      FROM pm_condition_resolutions r
      WHERE r.is_deleted = 0
        AND r.payout_numerators != ''
        AND toYYYYMM(r.resolved_at) = 202601
        AND EXISTS (
          SELECT 1 FROM pm_canonical_fills_v4 f
          WHERE f.condition_id = r.condition_id AND f.source = 'clob'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pm_trade_fifo_roi_v3 fifo
          WHERE fifo.condition_id = r.condition_id
        )
      ORDER BY r.resolved_at
    `,
    format: 'JSONEachRow'
  });

  const rows = (await result.json()) as { condition_id: string }[];
  const conditionIds = rows.map(r => r.condition_id);

  fs.writeFileSync('/tmp/missing-conditions-jan2026.json', JSON.stringify(conditionIds, null, 2));
  console.log(`✓ Saved ${conditionIds.length} missing conditions to /tmp/missing-conditions-jan2026.json`);
}

main();
