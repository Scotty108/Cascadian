import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = process.argv[2] || '0x88d15b99d682848e1b2a6618cab081e60be54f91';

async function run() {
  const v2 = await clickhouse.query({
    query: `SELECT countDistinct(event_id) AS v2_events, sum(usdc_amount) AS v2_usdc
            FROM pm_trader_events_v2
            WHERE lower(trader_wallet)=lower('${wallet}') AND is_deleted=0`,
    format: 'JSONEachRow',
  });
  const v2r = (await v2.json()) as any[];

  const d = await clickhouse.query({
    query: `SELECT countDistinct(event_id) AS dedup_events, sum(usdc_amount) AS dedup_usdc
            FROM pm_trader_events_dedup_v2_tbl
            WHERE lower(trader_wallet)=lower('${wallet}')`,
    format: 'JSONEachRow',
  });
  const dr = (await d.json()) as any[];

  console.log({ wallet, v2: v2r[0], dedup: dr[0] });
}

run().catch(console.error);
