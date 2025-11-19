import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  const stats = await ch.query({
    query: `
      SELECT
        count(*) as total,
        countIf(resolved = 1) as resolved_count,
        countIf(resolved = 1 AND winning_index >= 0) as with_winning_index,
        countIf(resolved = 1 AND winning_index >= 0 AND payout_denominator > 0) as with_payout
      FROM cascadian_clean.resolutions_src_api
    `,
    format: 'JSONEachRow',
  });

  const result = (await stats.json())[0];
  console.log('\nresolutions_src_api stats:');
  console.log(JSON.stringify(result, null, 2));

  const withData = await ch.query({
    query: `
      SELECT *
      FROM cascadian_clean.resolutions_src_api
      WHERE resolved = 1 AND winning_index >= 0 AND payout_denominator > 0
      LIMIT 2
    `,
    format: 'JSONEachRow',
  });

  const rows = await withData.json();
  console.log('\nSample resolved markets:');
  console.log(JSON.stringify(rows, null, 2));

  await ch.close();
}

main().catch(console.error);
