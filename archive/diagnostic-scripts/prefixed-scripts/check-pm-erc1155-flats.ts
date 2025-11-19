import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('Checking pm_erc1155_flats schema:\n');

  const schema = await clickhouse.query({
    query: `DESCRIBE pm_erc1155_flats`,
    format: 'JSONEachRow'
  });

  const cols: any[] = await schema.json();
  cols.forEach(c => console.log(`  ${c.name.padEnd(30)} ${c.type}`));

  console.log('\n\nSample burns for wallet:\n');

  const sample = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_erc1155_flats
      WHERE lower(from_address) = lower('${WALLET}')
        AND lower(to_address) = '0x0000000000000000000000000000000000000000'
      ORDER BY block_time DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const rows: any[] = await sample.json();
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
