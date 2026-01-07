/**
 * CCR-v1 Leaderboard: Corrected Filter Funnel
 *
 * Starts with TRUE CLOB-only (no ERC1155 transfers)
 * Uses step-by-step queries to avoid timeouts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function correctedFunnel() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: Corrected Filter Funnel');
  console.log('='.repeat(70));
  console.log('');

  const settings = { max_execution_time: 600 };

  // Step 0: Get ERC1155 wallets (to exclude)
  console.log('Step 0: Getting ERC1155 wallets to exclude...');
  const startTime = Date.now();

  // We'll do this incrementally, building up the filtered set

  const funnel: { step: string; count: number; pctPrev: string; pctTotal: string }[] = [];

  // 1. Total CLOB traders
  console.log('\n1. Total wallets with CLOB trades...');
  let t1 = Date.now();
  const r1 = await clickhouse.query({
    query: `SELECT countDistinct(lower(trader_wallet)) as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0`,
    format: 'JSONEachRow',
    clickhouse_settings: settings
  });
  const cnt1 = ((await r1.json()) as any[])[0].cnt;
  console.log(`   → ${cnt1.toLocaleString()} [${((Date.now() - t1)/1000).toFixed(1)}s]`);
  funnel.push({ step: 'All CLOB traders', count: cnt1, pctPrev: '100%', pctTotal: '100%' });

  // 2. TRUE CLOB-only (exclude ERC1155)
  console.log('\n2. TRUE CLOB-only (no ERC1155 transfers)...');
  t1 = Date.now();
  const r2 = await clickhouse.query({
    query: `
      WITH erc1155_wallets AS (
        SELECT DISTINCT lower(from_address) as w FROM pm_erc1155_transfers
        UNION DISTINCT
        SELECT DISTINCT lower(to_address) as w FROM pm_erc1155_transfers
      )
      SELECT countDistinct(lower(trader_wallet)) as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND lower(trader_wallet) NOT IN (SELECT w FROM erc1155_wallets)
    `,
    format: 'JSONEachRow',
    clickhouse_settings: settings
  });
  const cnt2 = ((await r2.json()) as any[])[0].cnt;
  const pct2 = (cnt2 / cnt1 * 100).toFixed(1);
  console.log(`   → ${cnt2.toLocaleString()} (${pct2}% of prev) [${((Date.now() - t1)/1000).toFixed(1)}s]`);
  funnel.push({ step: 'TRUE CLOB-only', count: cnt2, pctPrev: pct2 + '%', pctTotal: pct2 + '%' });

  // 3. Active in last 30 days
  console.log('\n3. + Active in last 30 days...');
  t1 = Date.now();
  const r3 = await clickhouse.query({
    query: `
      WITH erc1155_wallets AS (
        SELECT DISTINCT lower(from_address) as w FROM pm_erc1155_transfers
        UNION DISTINCT
        SELECT DISTINCT lower(to_address) as w FROM pm_erc1155_transfers
      )
      SELECT countDistinct(lower(trader_wallet)) as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND lower(trader_wallet) NOT IN (SELECT w FROM erc1155_wallets)
        AND trade_time >= now() - INTERVAL 30 DAY
    `,
    format: 'JSONEachRow',
    clickhouse_settings: settings
  });
  const cnt3 = ((await r3.json()) as any[])[0].cnt;
  const pct3 = (cnt3 / cnt2 * 100).toFixed(1);
  console.log(`   → ${cnt3.toLocaleString()} (${pct3}% of prev) [${((Date.now() - t1)/1000).toFixed(1)}s]`);
  funnel.push({ step: '+ Active 30 days', count: cnt3, pctPrev: pct3 + '%', pctTotal: (cnt3/cnt1*100).toFixed(1) + '%' });

  // 4. ≥$500 lifetime volume
  console.log('\n4. + ≥$500 lifetime volume...');
  t1 = Date.now();
  const r4 = await clickhouse.query({
    query: `
      WITH erc1155_wallets AS (
        SELECT DISTINCT lower(from_address) as w FROM pm_erc1155_transfers
        UNION DISTINCT
        SELECT DISTINCT lower(to_address) as w FROM pm_erc1155_transfers
      ),
      active_clob AS (
        SELECT DISTINCT lower(trader_wallet) as wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND lower(trader_wallet) NOT IN (SELECT w FROM erc1155_wallets)
          AND trade_time >= now() - INTERVAL 30 DAY
      )
      SELECT count(*) as cnt FROM (
        SELECT lower(trader_wallet) as w
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active_clob)
        GROUP BY lower(trader_wallet)
        HAVING sum(usdc_amount)/1e6 >= 500
      )
    `,
    format: 'JSONEachRow',
    clickhouse_settings: settings
  });
  const cnt4 = ((await r4.json()) as any[])[0].cnt;
  const pct4 = (cnt4 / cnt3 * 100).toFixed(1);
  console.log(`   → ${cnt4.toLocaleString()} (${pct4}% of prev) [${((Date.now() - t1)/1000).toFixed(1)}s]`);
  funnel.push({ step: '+ ≥$500 volume', count: cnt4, pctPrev: pct4 + '%', pctTotal: (cnt4/cnt1*100).toFixed(1) + '%' });

  // 5. ≥20 distinct markets
  console.log('\n5. + ≥20 distinct markets...');
  t1 = Date.now();
  const r5 = await clickhouse.query({
    query: `
      WITH erc1155_wallets AS (
        SELECT DISTINCT lower(from_address) as w FROM pm_erc1155_transfers
        UNION DISTINCT
        SELECT DISTINCT lower(to_address) as w FROM pm_erc1155_transfers
      ),
      active_clob AS (
        SELECT DISTINCT lower(trader_wallet) as wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND lower(trader_wallet) NOT IN (SELECT w FROM erc1155_wallets)
          AND trade_time >= now() - INTERVAL 30 DAY
      ),
      with_volume AS (
        SELECT lower(trader_wallet) as wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active_clob)
        GROUP BY lower(trader_wallet)
        HAVING sum(usdc_amount)/1e6 >= 500
      )
      SELECT count(*) as cnt FROM (
        SELECT lower(t.trader_wallet) as w
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE t.is_deleted = 0 AND lower(t.trader_wallet) IN (SELECT wallet FROM with_volume)
        GROUP BY lower(t.trader_wallet)
        HAVING countDistinct(m.condition_id) >= 20
      )
    `,
    format: 'JSONEachRow',
    clickhouse_settings: settings
  });
  const cnt5 = ((await r5.json()) as any[])[0].cnt;
  const pct5 = (cnt5 / cnt4 * 100).toFixed(1);
  console.log(`   → ${cnt5.toLocaleString()} (${pct5}% of prev) [${((Date.now() - t1)/1000).toFixed(1)}s]`);
  funnel.push({ step: '+ ≥20 markets', count: cnt5, pctPrev: pct5 + '%', pctTotal: (cnt5/cnt1*100).toFixed(1) + '%' });

  // 6. ≤100 trades/day (human speed)
  console.log('\n6. + ≤100 trades/day (human speed)...');
  t1 = Date.now();
  const r6 = await clickhouse.query({
    query: `
      WITH erc1155_wallets AS (
        SELECT DISTINCT lower(from_address) as w FROM pm_erc1155_transfers
        UNION DISTINCT
        SELECT DISTINCT lower(to_address) as w FROM pm_erc1155_transfers
      ),
      active_clob AS (
        SELECT DISTINCT lower(trader_wallet) as wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND lower(trader_wallet) NOT IN (SELECT w FROM erc1155_wallets)
          AND trade_time >= now() - INTERVAL 30 DAY
      ),
      wallet_stats AS (
        SELECT
          lower(trader_wallet) as wallet,
          count(*) as trades,
          sum(usdc_amount)/1e6 as volume,
          dateDiff('day', min(trade_time), max(trade_time)) + 1 as days
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND lower(trader_wallet) IN (SELECT wallet FROM active_clob)
        GROUP BY lower(trader_wallet)
        HAVING volume >= 500
      ),
      with_markets AS (
        SELECT lower(t.trader_wallet) as wallet
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE t.is_deleted = 0 AND lower(t.trader_wallet) IN (SELECT wallet FROM wallet_stats)
        GROUP BY lower(t.trader_wallet)
        HAVING countDistinct(m.condition_id) >= 20
      )
      SELECT count(*) as cnt FROM wallet_stats ws
      WHERE ws.wallet IN (SELECT wallet FROM with_markets)
        AND (ws.trades / ws.days) <= 100
    `,
    format: 'JSONEachRow',
    clickhouse_settings: settings
  });
  const cnt6 = ((await r6.json()) as any[])[0].cnt;
  const pct6 = (cnt6 / cnt5 * 100).toFixed(1);
  console.log(`   → ${cnt6.toLocaleString()} (${pct6}% of prev) [${((Date.now() - t1)/1000).toFixed(1)}s]`);
  funnel.push({ step: '+ ≤100 trades/day', count: cnt6, pctPrev: pct6 + '%', pctTotal: (cnt6/cnt1*100).toFixed(1) + '%' });

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('FUNNEL SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log('Step                          | Wallets      | % of Prev | % of Total');
  console.log('-'.repeat(70));
  for (const f of funnel) {
    console.log(`${f.step.padEnd(30)} | ${f.count.toLocaleString().padStart(12)} | ${f.pctPrev.padStart(9)} | ${f.pctTotal.padStart(10)}`);
  }
  console.log('-'.repeat(70));
  console.log(`\nTotal runtime: ${((Date.now() - startTime)/1000/60).toFixed(1)} minutes`);
  console.log(`\nFinal pool: ${cnt6.toLocaleString()} copy-trade viable wallets`);
}

correctedFunnel().catch(console.error);
