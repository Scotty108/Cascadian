import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('Starting ERC1155 resolution coverage query...');
  const query = `
    WITH erc AS (
      SELECT lower(token_id) AS condition_id_norm
      FROM default.erc1155_transfers
      WHERE token_id != ''
      GROUP BY condition_id_norm
    )
    SELECT
      countDistinct(erc.condition_id_norm) AS erc_markets,
      countDistinctIf(erc.condition_id_norm, res.condition_id_norm IS NOT NULL) AS resolved_markets,
      countDistinct(erc.condition_id_norm) - countDistinctIf(erc.condition_id_norm, res.condition_id_norm IS NOT NULL) AS unresolved_markets,
      round(100 * resolved_markets / erc_markets, 2) AS pct_resolved
    FROM erc
    LEFT JOIN default.market_resolutions_final res USING (condition_id_norm)
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await res.json<any[]>();
  console.log('Coverage stats:', data[0]);
}

main().catch(err => {
  console.error('Error running coverage query:', err);
  process.exit(1);
});
