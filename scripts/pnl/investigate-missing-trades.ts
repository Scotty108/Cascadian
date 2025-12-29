/**
 * Investigate missing trades for high-error wallets
 *
 * Compares our pm_trader_events_v2 data against Polymarket Data API
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = process.argv[2] || '0xd4ef7f53b0f26f578bc49b85cd172715884d5787'; // gudmf

async function main() {
  console.log('='.repeat(70));
  console.log(`INVESTIGATING: ${WALLET}`);
  console.log('='.repeat(70));

  // 1. Check our database for this wallet
  console.log('\n1. OUR DATABASE (pm_trader_events_v2):\n');

  // Get summary of maker trades
  const summaryQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      role,
      side,
      count() as trade_count,
      sum(usdc) as total_usdc,
      sum(tokens) as total_tokens
    FROM deduped
    GROUP BY role, side
    ORDER BY role, side
  `;

  const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const summaryRows = await summaryResult.json() as any[];

  console.log('Trade breakdown by role/side:');
  console.log('Role       | Side  | Count | USDC Total    | Tokens Total');
  console.log('-'.repeat(60));
  for (const row of summaryRows) {
    console.log(`${row.role.padEnd(10)} | ${row.side.padEnd(5)} | ${String(row.trade_count).padEnd(5)} | $${Number(row.total_usdc).toFixed(2).padStart(12)} | ${Number(row.total_tokens).toFixed(2)}`);
  }

  // Get total unique trades
  const countQuery = `
    SELECT
      count(DISTINCT event_id) as unique_events,
      count() as total_rows
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
  `;
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countRows = await countResult.json() as any[];
  console.log(`\nTotal unique events: ${countRows[0].unique_events}`);
  console.log(`Total rows (may have duplicates): ${countRows[0].total_rows}`);

  // 2. Check how many maker trades (V18 uses maker only)
  const makerQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT
      side,
      count() as trade_count,
      sum(usdc) as total_usdc,
      sum(tokens) as total_tokens
    FROM deduped
    GROUP BY side
  `;

  const makerResult = await clickhouse.query({ query: makerQuery, format: 'JSONEachRow' });
  const makerRows = await makerResult.json() as any[];

  console.log('\n2. MAKER-ONLY TRADES (V18 calculation):');
  console.log('Side  | Count | USDC Total');
  console.log('-'.repeat(40));
  let makerBuyUsdc = 0, makerSellUsdc = 0, makerBuyCount = 0, makerSellCount = 0;
  for (const row of makerRows) {
    console.log(`${row.side.padEnd(5)} | ${String(row.trade_count).padEnd(5)} | $${Number(row.total_usdc).toFixed(2)}`);
    if (row.side === 'buy') {
      makerBuyUsdc = Number(row.total_usdc);
      makerBuyCount = row.trade_count;
    } else {
      makerSellUsdc = Number(row.total_usdc);
      makerSellCount = row.trade_count;
    }
  }

  // 3. Fetch from Polymarket Data API
  console.log('\n3. POLYMARKET DATA API:');

  const apiUrl = `https://data-api.polymarket.com/trades?user=${WALLET}&limit=1000`;
  console.log(`Fetching: ${apiUrl}\n`);

  try {
    const response = await fetch(apiUrl);
    const apiTrades = await response.json() as any[];

    console.log(`API returned: ${apiTrades.length} trades`);

    if (apiTrades.length > 0) {
      // Aggregate by side
      let apiBuyUsdc = 0, apiSellUsdc = 0, apiBuyCount = 0, apiSellCount = 0;
      for (const trade of apiTrades) {
        const usdc = Number(trade.price) * Number(trade.size);
        if (trade.side === 'BUY') {
          apiBuyUsdc += usdc;
          apiBuyCount++;
        } else {
          apiSellUsdc += usdc;
          apiSellCount++;
        }
      }

      console.log(`API BUY:  ${apiBuyCount} trades, $${apiBuyUsdc.toFixed(2)}`);
      console.log(`API SELL: ${apiSellCount} trades, $${apiSellUsdc.toFixed(2)}`);
      console.log(`API Total Volume: $${(apiBuyUsdc + apiSellUsdc).toFixed(2)}`);

      // Compare
      console.log('\n4. COMPARISON (DB Maker vs API):');
      console.log('-'.repeat(50));
      console.log(`           | DB Maker      | API           | Diff`);
      console.log(`BUY Count  | ${String(makerBuyCount).padEnd(13)} | ${String(apiBuyCount).padEnd(13)} | ${apiBuyCount - makerBuyCount}`);
      console.log(`BUY USDC   | $${makerBuyUsdc.toFixed(2).padEnd(11)} | $${apiBuyUsdc.toFixed(2).padEnd(11)} | $${(apiBuyUsdc - makerBuyUsdc).toFixed(2)}`);
      console.log(`SELL Count | ${String(makerSellCount).padEnd(13)} | ${String(apiSellCount).padEnd(13)} | ${apiSellCount - makerSellCount}`);
      console.log(`SELL USDC  | $${makerSellUsdc.toFixed(2).padEnd(11)} | $${apiSellUsdc.toFixed(2).padEnd(11)} | $${(apiSellUsdc - makerSellUsdc).toFixed(2)}`);

      // Show first few API trades for debugging
      console.log('\n5. SAMPLE API TRADES:');
      const sample = apiTrades.slice(0, 5);
      for (const t of sample) {
        const usdc = (Number(t.price) * Number(t.size)).toFixed(2);
        console.log(`  ${t.timestamp} | ${t.side.padEnd(4)} | $${usdc.padStart(8)} | ${t.asset_ticker}`);
      }

      // Check if API trades have trade_id we can match
      if (apiTrades[0].id) {
        console.log('\n6. CHECKING MATCHING EVENT IDs:');
        const apiIds = apiTrades.map(t => t.id).slice(0, 10);
        console.log('First 10 API trade IDs:', apiIds);

        // Check if any of these exist in our DB
        const idCheckQuery = `
          SELECT event_id, side, usdc_amount / 1000000.0 as usdc, role
          FROM pm_trader_events_v2
          WHERE event_id IN (${apiIds.map(id => `'${id}'`).join(',')})
            AND is_deleted = 0
        `;
        const idCheckResult = await clickhouse.query({ query: idCheckQuery, format: 'JSONEachRow' });
        const idCheckRows = await idCheckResult.json() as any[];
        console.log(`Found ${idCheckRows.length} of 10 in our DB`);
        for (const row of idCheckRows) {
          console.log(`  ${row.event_id} | ${row.side} | $${Number(row.usdc).toFixed(2)} | ${row.role}`);
        }
      }
    }
  } catch (error) {
    console.log('API fetch error:', error);
  }

  console.log('\n' + '='.repeat(70));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(70));
}

main().catch(console.error);
