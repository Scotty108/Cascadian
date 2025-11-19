#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TEST_WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

(async () => {
  console.log('\n📊 Calculating actual overlap between tables...\n');

  // Global overlap: fact_trades vs api_markets_staging
  const globalOverlap = await ch.query({
    query: `
      WITH trades_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid
        FROM default.fact_trades_clean
      ),
      api_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM default.api_markets_staging
      )
      SELECT
        (SELECT COUNT(*) FROM trades_markets) as total_traded_markets,
        (SELECT COUNT(*) FROM api_markets) as total_api_markets,
        COUNT(*) as overlap_count
      FROM trades_markets tm
      INNER JOIN api_markets am ON tm.cid = am.cid
    `,
    format: 'JSONEachRow',
  });

  const global = await globalOverlap.json();
  const totalTraded = parseInt(global[0].total_traded_markets);
  const totalApi = parseInt(global[0].total_api_markets);
  const overlap = parseInt(global[0].overlap_count);
  const overlapPct = (overlap / totalTraded * 100).toFixed(1);

  console.log('Global (all wallets):');
  console.log(`  Traded markets: ${totalTraded.toLocaleString()}`);
  console.log(`  API markets: ${totalApi.toLocaleString()}`);
  console.log(`  Overlap: ${overlap.toLocaleString()} (${overlapPct}%)`);
  console.log(`  Missing from API: ${(totalTraded - overlap).toLocaleString()} (${(100 - parseFloat(overlapPct)).toFixed(1)}%)`);

  // Wallet-specific overlap
  const walletOverlap = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      ),
      api_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM default.api_markets_staging
      )
      SELECT
        (SELECT COUNT(*) FROM wallet_markets) as wallet_traded_markets,
        COUNT(*) as wallet_overlap
      FROM wallet_markets wm
      INNER JOIN api_markets am ON wm.cid = am.cid
    `,
    format: 'JSONEachRow',
  });

  const wallet = await walletOverlap.json();
  const walletTraded = parseInt(wallet[0].wallet_traded_markets);
  const walletOverlapCount = parseInt(wallet[0].wallet_overlap);
  const walletOverlapPct = (walletOverlapCount / walletTraded * 100).toFixed(1);

  console.log(`\nWallet ${TEST_WALLET.substring(0, 10)}...:`);
  console.log(`  Traded markets: ${walletTraded.toLocaleString()}`);
  console.log(`  In API: ${walletOverlapCount.toLocaleString()} (${walletOverlapPct}%)`);
  console.log(`  Missing from API: ${(walletTraded - walletOverlapCount).toLocaleString()} (${(100 - parseFloat(walletOverlapPct)).toFixed(1)}%)`);

  // Now check resolution overlap
  const resolutionOverlap = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      ),
      api_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM default.api_markets_staging
      ),
      resolved_markets AS (
        SELECT DISTINCT condition_id_norm as cid
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
        UNION ALL
        SELECT DISTINCT condition_id as cid
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
      SELECT
        COUNT(DISTINCT wm.cid) as wallet_in_api,
        COUNT(DISTINCT rm.cid) as wallet_with_resolutions
      FROM wallet_markets wm
      INNER JOIN api_markets am ON wm.cid = am.cid
      LEFT JOIN resolved_markets rm ON wm.cid = rm.cid
    `,
    format: 'JSONEachRow',
  });

  const res = await resolutionOverlap.json();
  const inApi = parseInt(res[0].wallet_in_api);
  const withRes = parseInt(res[0].wallet_with_resolutions);
  const resPct = inApi > 0 ? (withRes / inApi * 100).toFixed(1) : '0.0';

  console.log(`\n  Of the ${inApi.toLocaleString()} markets in API:`);
  console.log(`    Have resolutions: ${withRes.toLocaleString()} (${resPct}%)`);
  console.log(`    Still open: ${(inApi - withRes).toLocaleString()} (${(100 - parseFloat(resPct)).toFixed(1)}%)`);

  await ch.close();
})();
