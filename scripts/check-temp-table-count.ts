import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function check() {
  const result = await clickhouse.query({
    query: 'SELECT count() as cnt FROM tmp_v3_orphans_oct2024',
    format: 'JSONEachRow'
  });
  const data = await result.json();
  console.log('tmp_v3_orphans_oct2024 row count:', data[0].cnt);
}

check()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
