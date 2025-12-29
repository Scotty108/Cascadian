/**
 * Quick status check for DUEL metrics tables
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('Checking DUEL metrics status...\n');

  // Check history table
  const historyCount = await clickhouse.query({
    query: 'SELECT count() as cnt, count(DISTINCT wallet_address) as wallets FROM wallet_duel_metrics_history',
    format: 'JSONEachRow',
  });
  const hc = (await historyCount.json())[0] as any;
  console.log('History table rows:', hc.cnt, '| Unique wallets:', hc.wallets);

  // Check latest view
  const viewCount = await clickhouse.query({
    query: 'SELECT count() as cnt FROM wallet_duel_metrics_latest_v2',
    format: 'JSONEachRow',
  });
  const vc = (await viewCount.json())[0] as any;
  console.log('Latest view rows:', vc.cnt);

  // Check rankable counts
  const rankableCount = await clickhouse.query({
    query: `
      SELECT
        is_rankable,
        count() as cnt
      FROM wallet_duel_metrics_latest_v2
      GROUP BY is_rankable
    `,
    format: 'JSONEachRow',
  });
  const rc = (await rankableCount.json()) as any[];
  console.log('\nRankable breakdown:');
  for (const r of rc) {
    console.log('  is_rankable =', r.is_rankable, ':', r.cnt, 'wallets');
  }

  // Sample a few wallets to see data
  const sample = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        round(realized_economic, 2) as realized_economic,
        round(omega_180d, 2) as omega_180d,
        decided_markets_180d,
        is_rankable,
        rankability_tier
      FROM wallet_duel_metrics_latest_v2
      WHERE is_rankable = 1
      ORDER BY realized_economic DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const rows = (await sample.json()) as any[];
  console.log('\nTop 5 rankable wallets:');
  for (const r of rows) {
    console.log(
      ' ',
      r.wallet_address.slice(0, 10) + '...',
      'PnL: $' + r.realized_economic,
      'Omega:',
      r.omega_180d,
      'Mkts:',
      r.decided_markets_180d,
      'Tier:',
      r.rankability_tier
    );
  }

  await clickhouse.close();
}

main().catch(console.error);
