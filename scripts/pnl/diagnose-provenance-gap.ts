/**
 * Diagnose provenance gaps for specific wallets
 *
 * Purpose: Understand why wallets with low open exposure and low external sells
 * still have large gaps between engine PnL and UI PnL.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const wallets = [
  { addr: '0x006cc834cc092684f1b56626e23bedb3835c16ea', name: '0x006cc', uiPnl: 999000 },
  { addr: '0x00d6c6da9eca7de02033abdac5d841357652b2e0', name: '@someguy27', uiPnl: 62000 },
];

async function diagnoseWallet(
  client: any,
  wallet: string,
  name: string,
  uiPnl: number
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DIAGNOSING: ${name} (${wallet.slice(0, 10)}...)`);
  console.log(`UI PnL: $${(uiPnl / 1000).toFixed(0)}k`);
  console.log(`${'='.repeat(60)}\n`);

  // 1. Role distribution (maker vs taker)
  const roleResult = await client.query({
    query: `
      SELECT
        role,
        count() as trade_count,
        sum(usdc_amount) / 1e6 as total_usdc,
        sum(token_amount) / 1e6 as total_tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = {wallet: String} AND is_deleted = 0
      GROUP BY role
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  const roles = (await roleResult.json()) as any[];
  console.log('1. ROLE DISTRIBUTION:');
  for (const r of roles) {
    console.log(
      `   ${r.role}: ${r.trade_count} trades, $${Number(r.total_usdc).toFixed(0)} USDC`
    );
  }

  // Calculate maker vs taker ratio
  const makerTrades = roles.find((r) => r.role === 'maker')?.trade_count || 0;
  const takerTrades = roles.find((r) => r.role === 'taker')?.trade_count || 0;
  const takerRatio = takerTrades / (makerTrades + takerTrades);
  console.log(`   TAKER RATIO: ${(takerRatio * 100).toFixed(1)}%`);

  // 2. Side distribution by role
  const sideRoleResult = await client.query({
    query: `
      SELECT
        role,
        side,
        count() as cnt,
        sum(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = {wallet: String} AND is_deleted = 0
      GROUP BY role, side
      ORDER BY role, side
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  console.log('\n2. ROLE + SIDE BREAKDOWN:');
  for (const r of (await sideRoleResult.json()) as any[]) {
    console.log(`   ${r.role} ${r.side}: ${r.cnt} trades, $${Number(r.usdc).toFixed(0)}`);
  }

  // 3. Cash flow comparison: MAKER ONLY vs ALL
  const makerCashResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = {wallet: String} AND is_deleted = 0 AND role = 'maker'
        GROUP BY event_id
      )
      SELECT
        sum(case when side = 'sell' then usdc_amount else 0 end) / 1e6 as sells,
        sum(case when side = 'buy' then usdc_amount else 0 end) / 1e6 as buys,
        sum(case when side = 'sell' then usdc_amount else -usdc_amount end) / 1e6 as cash_flow
      FROM deduped
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  const makerCash = ((await makerCashResult.json()) as any[])[0];

  const allCashResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = {wallet: String} AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        sum(case when side = 'sell' then usdc_amount else 0 end) / 1e6 as sells,
        sum(case when side = 'buy' then usdc_amount else 0 end) / 1e6 as buys,
        sum(case when side = 'sell' then usdc_amount else -usdc_amount end) / 1e6 as cash_flow
      FROM deduped
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  const allCash = ((await allCashResult.json()) as any[])[0];

  console.log('\n3. CASH FLOW COMPARISON:');
  console.log(
    `   MAKER ONLY: sells=$${Number(makerCash.sells).toFixed(0)}, buys=$${Number(makerCash.buys).toFixed(0)}, flow=$${Number(makerCash.cash_flow).toFixed(0)}`
  );
  console.log(
    `   ALL TRADES: sells=$${Number(allCash.sells).toFixed(0)}, buys=$${Number(allCash.buys).toFixed(0)}, flow=$${Number(allCash.cash_flow).toFixed(0)}`
  );
  const takerCashDelta = Number(allCash.cash_flow) - Number(makerCash.cash_flow);
  console.log(`   TAKER DELTA: $${takerCashDelta.toFixed(0)}`);

  // 4. Position count comparison
  const makerPosResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(token_id) as token_id, any(side) as side, any(token_amount) as token_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = {wallet: String} AND is_deleted = 0 AND role = 'maker'
        GROUP BY event_id
      )
      SELECT
        countIf(net > 1) as long_pos,
        countIf(net < -1) as short_pos,
        countIf(net >= -1 AND net <= 1) as flat_pos
      FROM (
        SELECT token_id, sum(case when side = 'buy' then token_amount else -token_amount end) / 1e6 as net
        FROM deduped
        GROUP BY token_id
      )
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  const makerPos = ((await makerPosResult.json()) as any[])[0];

  const allPosResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(token_id) as token_id, any(side) as side, any(token_amount) as token_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = {wallet: String} AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        countIf(net > 1) as long_pos,
        countIf(net < -1) as short_pos,
        countIf(net >= -1 AND net <= 1) as flat_pos
      FROM (
        SELECT token_id, sum(case when side = 'buy' then token_amount else -token_amount end) / 1e6 as net
        FROM deduped
        GROUP BY token_id
      )
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  const allPos = ((await allPosResult.json()) as any[])[0];

  console.log('\n4. POSITION COUNTS:');
  console.log(
    `   MAKER ONLY: long=${makerPos.long_pos}, short=${makerPos.short_pos}, flat=${makerPos.flat_pos}`
  );
  console.log(
    `   ALL TRADES: long=${allPos.long_pos}, short=${allPos.short_pos}, flat=${allPos.flat_pos}`
  );

  // 5. Engine cache values
  const cacheResult = await client.query({
    query: `
      SELECT
        engine_pnl,
        realized_pnl,
        unrealized_pnl,
        trade_count,
        external_sells,
        external_sells_ratio,
        open_exposure_ratio
      FROM pm_wallet_engine_pnl_cache FINAL
      WHERE wallet = {wallet: String}
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  const cacheRows = (await cacheResult.json()) as any[];
  const cache = cacheRows[0];

  if (cache) {
    console.log('\n5. ENGINE CACHE VALUES:');
    console.log(`   engine_pnl: $${Number(cache.engine_pnl).toFixed(0)}`);
    console.log(`   realized_pnl: $${Number(cache.realized_pnl).toFixed(0)}`);
    console.log(`   unrealized_pnl: $${Number(cache.unrealized_pnl).toFixed(0)}`);
    console.log(`   trade_count: ${cache.trade_count}`);
    console.log(
      `   external_sells_ratio: ${(Number(cache.external_sells_ratio) * 100).toFixed(2)}%`
    );
    console.log(
      `   open_exposure_ratio: ${(Number(cache.open_exposure_ratio) * 100).toFixed(2)}%`
    );
  }

  // 6. GAP ANALYSIS
  const enginePnl = cache ? Number(cache.engine_pnl) : 0;
  const gap = uiPnl - enginePnl;

  console.log('\n6. GAP ANALYSIS:');
  console.log(`   UI PnL: $${uiPnl.toFixed(0)}`);
  console.log(`   Engine PnL: $${enginePnl.toFixed(0)}`);
  console.log(`   GAP: $${gap.toFixed(0)} (${((gap / uiPnl) * 100).toFixed(1)}% of UI)`);
  console.log(`   Taker cash delta: $${takerCashDelta.toFixed(0)}`);

  const gapExplainedByTaker = Math.abs(takerCashDelta - gap) / gap;
  if (gapExplainedByTaker < 0.3) {
    console.log(`   GAP EXPLAINED BY TAKER ACTIVITY: YES (${((1 - gapExplainedByTaker) * 100).toFixed(0)}% match)`);
  } else if (takerCashDelta > 0 && takerCashDelta < gap) {
    console.log(`   GAP PARTIALLY EXPLAINED: Taker contributes $${takerCashDelta.toFixed(0)} of $${gap.toFixed(0)} gap`);
  } else {
    console.log(`   GAP NOT EXPLAINED BY TAKER: Need to investigate other sources`);
  }

  // 7. Check for taker-specific patterns
  if (takerRatio > 0.1) {
    console.log('\n7. TAKER ACTIVITY BREAKDOWN:');

    const takerPnlResult = await client.query({
      query: `
        WITH deduped AS (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount) as usdc_amount,
            any(token_amount) as token_amount
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = {wallet: String} AND is_deleted = 0 AND role = 'taker'
          GROUP BY event_id
        )
        SELECT
          count(DISTINCT token_id) as unique_tokens,
          sum(case when side = 'buy' then usdc_amount else 0 end) / 1e6 as taker_buys,
          sum(case when side = 'sell' then usdc_amount else 0 end) / 1e6 as taker_sells,
          sum(case when side = 'sell' then usdc_amount else -usdc_amount end) / 1e6 as taker_cash_flow
        FROM deduped
      `,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });
    const takerPnl = ((await takerPnlResult.json()) as any[])[0];

    console.log(`   Taker unique tokens: ${takerPnl.unique_tokens}`);
    console.log(`   Taker buys: $${Number(takerPnl.taker_buys).toFixed(0)}`);
    console.log(`   Taker sells: $${Number(takerPnl.taker_sells).toFixed(0)}`);
    console.log(`   Taker cash flow: $${Number(takerPnl.taker_cash_flow).toFixed(0)}`);
  }

  return { takerRatio, gap, takerCashDelta };
}

async function main() {
  const client = getClickHouseClient();

  for (const w of wallets) {
    await diagnoseWallet(client, w.addr, w.name, w.uiPnl);
  }

  console.log('\n' + '='.repeat(60));
  console.log('DIAGNOSIS COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
