import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const wallet = process.argv[2]?.toLowerCase();
if (!wallet) {
  console.error('Usage: npx tsx scripts/copytrade/check-net-positions.ts <wallet>');
  process.exit(1);
}

async function main() {
  const q = `
    SELECT
      countIf(net > 0) as pos_tokens,
      sumIf(net, net > 0) / 1e6 as pos_tokens_sum,
      countIf(net < 0) as neg_tokens,
      sumIf(-net, net < 0) / 1e6 as neg_tokens_sum
    FROM (
      SELECT token_id,
        sumIf(token_amount, side = 'buy') - sumIf(token_amount, side = 'sell') as net
      FROM pm_trader_events_dedup_v2_tbl
      WHERE trader_wallet = '${wallet}'
      GROUP BY token_id
    )
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  console.log(await r.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
