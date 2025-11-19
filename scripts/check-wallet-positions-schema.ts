import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || ''
});

async function checkSchema() {
  const query = `
    SELECT name, type
    FROM system.columns
    WHERE database = 'cascadian_clean'
      AND table = 'vw_wallet_positions'
    ORDER BY position
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const columns = await result.json();

  console.log('vw_wallet_positions columns:');
  columns.forEach((col: any) => console.log(`  ${col.name}: ${col.type}`));

  await client.close();
}

checkSchema().catch(console.error);
