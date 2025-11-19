import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('Checking date range for wallet fills...\n');

  const query = await clickhouse.query({
    query: `
      SELECT
        count() AS total_trades,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade,
        dateDiff('day', min(timestamp), max(timestamp)) AS days_span,
        countIf(timestamp > now()) AS future_trades
      FROM default.clob_fills
      WHERE lower(proxy_wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const result: any[] = await query.json();
  const r = result[0];

  console.log(`Total trades: ${r.total_trades}`);
  console.log(`First trade: ${r.first_trade}`);
  console.log(`Last trade: ${r.last_trade}`);
  console.log(`Time span: ${r.days_span} days`);
  console.log(`Future trades: ${r.future_trades}\n`);

  if (parseInt(r.future_trades) > 0) {
    console.log('⚠️  WARNING: Some trades have future timestamps!');
    console.log('   This suggests test data or timestamp ingestion issues\n');
  }

  // Check realistic trades (before today)
  console.log('Checking realistic date range (before today)...\n');

  const realisticQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS realistic_trades,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM default.clob_fills
      WHERE lower(proxy_wallet) = lower('${WALLET}')
        AND timestamp <= now()
    `,
    format: 'JSONEachRow'
  });

  const realistic: any[] = await realisticQuery.json();
  const rr = realistic[0];

  console.log(`Realistic trades: ${rr.realistic_trades}`);
  console.log(`First trade: ${rr.first_trade}`);
  console.log(`Last trade: ${rr.last_trade}\n`);

  if (parseInt(rr.realistic_trades) === 0) {
    console.log('❌ ALL trades are in the future - this is test/staging data\n');
  }
}

main().catch(console.error);
