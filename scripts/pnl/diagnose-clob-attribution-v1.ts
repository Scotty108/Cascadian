/**
 * Diagnose CLOB Attribution V1
 *
 * Deep dive into single wallet to understand the CLOB vs Dome discrepancy.
 *
 * Investigations:
 * 1. Compare CLOB trade count vs Polymarket activity API trade count
 * 2. Check if we're double-counting maker/taker sides
 * 3. Compare market-level cashflows
 * 4. Look at Dome raw response structure
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const DOME_API_KEY = '3850d9ac-1c76-4f94-b987-85c2b2d14c89';

// Worst-case wallet from validation
const TARGET_WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

interface ClobMarketSummary {
  token_id: string;
  buy_count: number;
  sell_count: number;
  buy_usdc: number;
  sell_usdc: number;
  net_cashflow: number;
  net_tokens: number;
}

async function fetchDomeRaw(wallet: string): Promise<any> {
  try {
    const url = `https://api.domeapi.io/v1/polymarket/wallet/pnl/${wallet}?granularity=all`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${DOME_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    return await response.json();
  } catch (e: any) {
    return { error: e.message };
  }
}

async function fetchPolymarketActivity(wallet: string): Promise<any[]> {
  try {
    // Activity API endpoint
    const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=1000`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.log(`  Activity API: HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (e: any) {
    console.log(`  Activity API error: ${e.message}`);
    return [];
  }
}

async function getClobSummaryByMarket(wallet: string): Promise<ClobMarketSummary[]> {
  const query = `
    SELECT
      token_id,
      countIf(side = 'buy') as buy_count,
      countIf(side = 'sell') as sell_count,
      sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
      sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc,
      sum(
        case
          when side = 'buy'  then -(usdc_amount + fee_amount)
          when side = 'sell' then  (usdc_amount - fee_amount)
          else 0
        end
      ) / 1e6 as net_cashflow,
      sum(
        case
          when side = 'buy'  then token_amount
          when side = 'sell' then -token_amount
          else 0
        end
      ) / 1e6 as net_tokens
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
    GROUP BY token_id
    ORDER BY abs(net_cashflow) DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as ClobMarketSummary[];
}

async function getClobTotals(wallet: string): Promise<{
  total_trades: number;
  buy_trades: number;
  sell_trades: number;
  buy_usdc: number;
  sell_usdc: number;
  net_cashflow: number;
  unique_tokens: number;
}> {
  const query = `
    SELECT
      count(*) as total_trades,
      countIf(side = 'buy') as buy_trades,
      countIf(side = 'sell') as sell_trades,
      sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
      sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc,
      sum(
        case
          when side = 'buy'  then -(usdc_amount + fee_amount)
          when side = 'sell' then  (usdc_amount - fee_amount)
          else 0
        end
      ) / 1e6 as net_cashflow,
      uniqExact(token_id) as unique_tokens
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows[0];
}

async function checkMakerTakerDuplication(wallet: string): Promise<void> {
  // Check if same trade appears on both sides (maker and taker)
  const query = `
    SELECT
      event_id,
      count(*) as occurrences,
      groupArray(side) as sides,
      groupArray(usdc_amount / 1e6) as usdc_amounts
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
    GROUP BY event_id
    HAVING count(*) > 1
    LIMIT 10
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('\n--- Checking for Duplicate event_ids ---');
  if (rows.length === 0) {
    console.log('  No duplicate event_ids found in deduped table');
  } else {
    console.log(`  Found ${rows.length} duplicate event_ids:`);
    for (const row of rows.slice(0, 5)) {
      console.log(`    ${row.event_id}: ${row.occurrences}x, sides=${JSON.stringify(row.sides)}`);
    }
  }
}

async function checkOriginalVsDedup(wallet: string): Promise<void> {
  // Compare counts between original and dedup table
  const queryOriginal = `
    SELECT
      count(*) as total,
      uniqExact(event_id) as unique_events
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
  `;

  const queryDedup = `
    SELECT
      count(*) as total,
      uniqExact(event_id) as unique_events
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
  `;

  const [resultOrig, resultDedup] = await Promise.all([
    clickhouse.query({ query: queryOriginal, format: 'JSONEachRow' }),
    clickhouse.query({ query: queryDedup, format: 'JSONEachRow' }),
  ]);

  const rowsOrig = (await resultOrig.json()) as any[];
  const rowsDedup = (await resultDedup.json()) as any[];

  console.log('\n--- Original vs Dedup Table ---');
  console.log(`  Original (pm_trader_events_v2): ${rowsOrig[0]?.total || 0} rows, ${rowsOrig[0]?.unique_events || 0} unique`);
  console.log(`  Dedup (pm_trader_events_dedup_v2_tbl): ${rowsDedup[0]?.total || 0} rows, ${rowsDedup[0]?.unique_events || 0} unique`);
}

async function checkTraderWalletVariants(wallet: string): Promise<void> {
  // Check if CLOB has trades under different wallet variants
  const baseWallet = wallet.toLowerCase().replace('0x', '');

  const query = `
    SELECT
      trader_wallet,
      count(*) as trades,
      sum(usdc_amount) / 1e6 as total_usdc
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(replace(trader_wallet, '0x', '')) = '${baseWallet}'
    GROUP BY trader_wallet
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('\n--- Wallet Address Variants in CLOB ---');
  for (const row of rows) {
    console.log(`  ${row.trader_wallet}: ${row.trades} trades, $${Number(row.total_usdc).toFixed(0)}`);
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('DIAGNOSE CLOB ATTRIBUTION V1');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Target wallet: ${TARGET_WALLET}`);
  console.log('');

  // 1. CLOB Totals
  console.log('--- CLOB Totals ---');
  const clobTotals = await getClobTotals(TARGET_WALLET);
  console.log(`  Total trades: ${clobTotals.total_trades}`);
  console.log(`  Buy trades: ${clobTotals.buy_trades} ($${clobTotals.buy_usdc.toFixed(0)})`);
  console.log(`  Sell trades: ${clobTotals.sell_trades} ($${clobTotals.sell_usdc.toFixed(0)})`);
  console.log(`  Net cashflow: $${clobTotals.net_cashflow.toFixed(0)}`);
  console.log(`  Unique token IDs: ${clobTotals.unique_tokens}`);

  // 2. Dome Raw Response
  console.log('\n--- Dome API Raw Response ---');
  const domeRaw = await fetchDomeRaw(TARGET_WALLET);
  if (domeRaw.error) {
    console.log(`  Error: ${domeRaw.error}`);
  } else {
    console.log(`  Granularity: ${domeRaw.granularity}`);
    console.log(`  Wallet: ${domeRaw.wallet_address}`);
    console.log(`  Time range: ${domeRaw.start_time} to ${domeRaw.end_time}`);
    console.log(`  Data points: ${domeRaw.pnl_over_time?.length || 0}`);
    if (domeRaw.pnl_over_time?.length > 0) {
      const first = domeRaw.pnl_over_time[0];
      const last = domeRaw.pnl_over_time[domeRaw.pnl_over_time.length - 1];
      console.log(`  First PnL: $${first.pnl_to_date} at ${first.timestamp}`);
      console.log(`  Latest PnL: $${last.pnl_to_date} at ${last.timestamp}`);
    }
  }

  // 3. Polymarket Activity API
  console.log('\n--- Polymarket Activity API ---');
  const activity = await fetchPolymarketActivity(TARGET_WALLET);
  console.log(`  Activities returned: ${activity.length}`);
  if (activity.length > 0) {
    // Count by type
    const byType = new Map<string, number>();
    let totalUsdcFromActivity = 0;
    for (const a of activity) {
      const type = a.type || 'unknown';
      byType.set(type, (byType.get(type) || 0) + 1);
      if (a.usdcSize) {
        totalUsdcFromActivity += Number(a.usdcSize);
      }
    }
    console.log('  Activity types:');
    for (const [type, count] of byType) {
      console.log(`    ${type}: ${count}`);
    }
    console.log(`  Total USDC from activity: $${totalUsdcFromActivity.toFixed(0)}`);
  }

  // 4. Check for duplicate event_ids
  await checkMakerTakerDuplication(TARGET_WALLET);

  // 5. Compare original vs dedup
  await checkOriginalVsDedup(TARGET_WALLET);

  // 6. Check wallet variants
  await checkTraderWalletVariants(TARGET_WALLET);

  // 7. Top tokens by cashflow
  console.log('\n--- Top 10 Tokens by Cashflow (CLOB) ---');
  const marketSummary = await getClobSummaryByMarket(TARGET_WALLET);
  console.log('  token_id | buys | sells | buy_usdc | sell_usdc | net_cashflow | net_tokens');
  for (const m of marketSummary.slice(0, 10)) {
    console.log(
      `  ${m.token_id.slice(0, 16)}... | ${m.buy_count} | ${m.sell_count} | $${m.buy_usdc.toFixed(0)} | $${m.sell_usdc.toFixed(0)} | $${m.net_cashflow.toFixed(0)} | ${m.net_tokens.toFixed(2)}`
    );
  }

  // 8. Summary
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(80));
  console.log(`  CLOB trades: ${clobTotals.total_trades}`);
  console.log(`  Activity API: ${activity.length}`);
  console.log(`  Trade count ratio: ${(clobTotals.total_trades / activity.length).toFixed(2)}x`);
  console.log('');
  console.log(`  CLOB net cashflow: $${clobTotals.net_cashflow.toFixed(0)}`);
  const domeTotal = domeRaw.pnl_over_time?.length > 0
    ? domeRaw.pnl_over_time[domeRaw.pnl_over_time.length - 1].pnl_to_date
    : null;
  console.log(`  Dome total PnL: $${domeTotal !== null ? Number(domeTotal).toFixed(0) : 'N/A'}`);
  console.log(`  Gap: $${domeTotal !== null ? (clobTotals.net_cashflow - Number(domeTotal)).toFixed(0) : 'N/A'}`);

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
