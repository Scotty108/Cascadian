import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = process.argv[2] || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  console.log(`Finding ERC1155 transfers without matching CLOB fills for ${wallet}\n`);

  const query = `
    WITH erc AS (
      SELECT
        lower(f.to_address) AS wallet,
        ctm.condition_id_norm,
        count() AS transfer_count,
        max(f.block_time) AS latest_transfer
      FROM pm_erc1155_flats f
      INNER JOIN ctf_token_map ctm ON f.token_id = ctm.token_id
      WHERE lower(f.to_address) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm
    ),
    clob AS (
      SELECT
        lower(proxy_wallet) AS wallet,
        lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
        count() AS fill_count,
        max(timestamp) AS latest_fill
      FROM clob_fills
      WHERE lower(proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm
    )
    SELECT
      erc.condition_id_norm,
      erc.transfer_count,
      erc.latest_transfer,
      clob.fill_count,
      clob.latest_fill
    FROM erc
    LEFT JOIN clob USING (wallet, condition_id_norm)
    WHERE clob.fill_count IS NULL
    ORDER BY erc.latest_transfer DESC
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await res.json();
  console.table(rows.map((r: any) => ({
    condition_id: r.condition_id_norm?.substring(0, 12) + '...',
    transfers: r.transfer_count,
    last_transfer: r.latest_transfer
  })));
  console.log(`\nMissing markets: ${rows.length}`);
}

main().catch(console.error);
