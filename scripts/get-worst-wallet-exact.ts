#!/usr/bin/env tsx
import * as dotenv from 'dotenv';
import { createClient } from '@clickhouse/client';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000
});

async function getWorstWallet() {
  const query = `
    SELECT
        t.trader_wallet,
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) as final_shares,
        count(*) as trade_count
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
    HAVING final_shares < -1000000000
    ORDER BY final_shares ASC
    LIMIT 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json<any[]>();

  console.log(JSON.stringify(data[0], null, 2));
}

getWorstWallet();
