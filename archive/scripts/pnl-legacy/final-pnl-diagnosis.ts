import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('='.repeat(80));
  console.log('FINAL P&L DIAGNOSIS');
  console.log('='.repeat(80));

  // Get ALL positions with their view midprices
  const posResult = await client.query({
    query: `
      SELECT market_cid, outcome, qty, avg_cost, midprice as view_midprice
      FROM cascadian_clean.vw_positions_open
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const positions = await posResult.json<any>();

  console.log(`\nWallet has ${positions.length} positions. Checking each one...\n`);

  let positionsWithMidprices = 0;
  let totalUnrealizedPnL = 0;
  let totalViewUnrealizedPnL = 0;

  for (const pos of positions) {
    // Check actual midprice from table
    const midResult = await client.query({
      query: `
        SELECT midprice
        FROM cascadian_clean.midprices_latest
        WHERE market_cid = '${pos.market_cid}' AND outcome = ${pos.outcome}
      `,
      format: 'JSONEachRow',
    });
    const midData = await midResult.json<any>();

    const actualMidprice = midData.length > 0 ? midData[0].midprice : 0;
    const viewMidprice = pos.view_midprice;
    const unrealizedPnL = pos.qty * (actualMidprice - (pos.avg_cost || 0));
    const viewUnrealizedPnL = pos.qty * (viewMidprice - (pos.avg_cost || 0));

    totalUnrealizedPnL += unrealizedPnL;
    totalViewUnrealizedPnL += viewUnrealizedPnL;

    if (actualMidprice > 0) {
      positionsWithMidprices++;
      const cidShort = pos.market_cid.slice(0, 16);
      console.log(`${cidShort}... outcome=${pos.outcome}`);
      console.log(`  Qty: ${pos.qty.toFixed(2)} @ avg_cost=$${pos.avg_cost?.toFixed(4) || 'N/A'}`);
      console.log(`  View midprice: $${viewMidprice}`);
      console.log(`  Actual midprice: $${actualMidprice}`);
      console.log(`  Unrealized P&L: $${unrealizedPnL.toFixed(2)}`);

      if (Math.abs(viewMidprice - actualMidprice) > 0.01) {
        console.log(`  ⚠ MISMATCH! View shows $${viewMidprice} but table has $${actualMidprice}`);
      }
      console.log();
    }
  }

  console.log('='.repeat(80));
  console.log('SUMMARY:');
  console.log('='.repeat(80));
  console.log(`Total positions: ${positions.length}`);
  console.log(`Positions with midprices: ${positionsWithMidprices}`);
  console.log(`Positions without midprices: ${positions.length - positionsWithMidprices}`);
  console.log();
  console.log(`View's unrealized P&L: $${totalViewUnrealizedPnL.toFixed(2)}`);
  console.log(`Recalculated unrealized P&L: $${totalUnrealizedPnL.toFixed(2)}`);
  console.log(`Expected from Polymarket: $332,563`);
  console.log(`Gap: $${(332563 - totalUnrealizedPnL).toFixed(2)}`);
  console.log();

  console.log('='.repeat(80));
  console.log('ROOT CAUSE:');
  console.log('='.repeat(80));

  if (positionsWithMidprices === 0) {
    console.log('✗ NO MIDPRICES FOUND for any of this wallet\'s positions');
    console.log('  The midprices_latest table is missing data for these markets');
  } else if (positionsWithMidprices < positions.length) {
    console.log(`⚠ PARTIAL COVERAGE: Only ${positionsWithMidprices}/${positions.length} positions have midprices`);
    console.log(`  Missing midprices account for: $${(332563 - totalUnrealizedPnL).toFixed(2)}`);
  }

  if (Math.abs(totalViewUnrealizedPnL - totalUnrealizedPnL) > 1) {
    console.log('⚠ VIEW CALCULATION ERROR: View shows different P&L than actual midprices');
  }

  await client.close();
}

main().catch(console.error);
