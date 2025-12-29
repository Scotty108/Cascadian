import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  // Load completed wallets
  const checkpoint = JSON.parse(fs.readFileSync('/tmp/batch_scrape_checkpoint.json', 'utf-8'));
  const completedSet = new Set(checkpoint.completed);

  // Simple random sample of active traders
  const q = await ch.query({
    query: `
      SELECT DISTINCT lower(trader_wallet) as wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 60 DAY
      ORDER BY cityHash64(trader_wallet)
      LIMIT 300
    `,
    format: 'JSONEachRow',
  });
  const rows = (await q.json()) as { wallet: string }[];
  const candidates = rows.filter(r => !completedSet.has(r.wallet)).slice(0, 50);

  console.log('NEXT 50 WALLETS TO SCRAPE:');
  console.log('');
  candidates.forEach((w, i) => {
    console.log(`${i + 41}. ${w.wallet}`);
    console.log(`   https://polymarket.com/profile/${w.wallet}`);
  });

  await ch.close();
}

main().catch(console.error);
