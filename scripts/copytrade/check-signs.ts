import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const wallet = process.argv[2]?.toLowerCase() || '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  const q = `
    SELECT side,
      min(token_amount) as min_token,
      max(token_amount) as max_token,
      min(usdc_amount) as min_usdc,
      max(usdc_amount) as max_usdc
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${wallet}'
    GROUP BY side
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  console.log(await r.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
