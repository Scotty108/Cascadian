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
  console.log('WALLET P&L DIAGNOSIS: 0x4ce7...');
  console.log('Expected: +$332,563 | Actual: -$677 | Delta: $333,240');
  console.log('='.repeat(80));

  // 1. Check open positions
  console.log('\n1. TOP OPEN POSITIONS BY QTY:');
  const positionsResult = await client.query({
    query: `
      SELECT
        market_cid,
        outcome,
        qty,
        avg_cost,
        midprice,
        unrealized_pnl_usd,
        price_updated_at
      FROM cascadian_clean.vw_positions_open
      WHERE lower(wallet) = lower('${WALLET}')
      ORDER BY abs(qty * avg_cost) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const positions = await positionsResult.json<any>();

  console.log(`Found ${positions.length} open positions`);
  positions.slice(0, 10).forEach((p: any, i: number) => {
    const cidShort = p.market_cid.slice(0, 16);
    const posValue = p.qty * (p.avg_cost || 0);
    console.log(`\n  ${i+1}. CID: ${cidShort}...`);
    console.log(`     Outcome: ${p.outcome} | Qty: ${p.qty.toFixed(2)} @ $${p.avg_cost?.toFixed(4) || 'N/A'}`);
    console.log(`     Position Value: $${posValue.toFixed(2)} | Midprice: $${p.midprice}`);
    console.log(`     Unrealized P&L: $${p.unrealized_pnl_usd || 0}`);
  });

  // 2. Check resolutions for top 5
  console.log('\n\n2. RESOLUTION CHECK (Top 5 Positions):');

  for (let i = 0; i < Math.min(5, positions.length); i++) {
    const pos = positions[i];
    const cid = pos.market_cid;
    const cidShort = cid.slice(0, 20);

    console.log(`\n  Position ${i+1}: ${cidShort}...`);
    console.log(`    Midprice in view: ${pos.midprice} (from vw_positions_open)`);

    // Check resolution
    const resolutionResult = await client.query({
      query: `
        SELECT condition_id, winning_outcome, resolved_at
        FROM cascadian_clean.market_resolutions_final
        WHERE condition_id = '${cid}'
           OR condition_id = lower(replaceAll('${cid}', '0x', ''))
           OR concat('0x', condition_id) = lower('${cid}')
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const resolution = await resolutionResult.json<any>();

    if (resolution.length > 0) {
      const resCidShort = resolution[0].condition_id.slice(0, 16);
      console.log(`    ✓ Resolution: ${resolution[0].winning_outcome} (${resCidShort}...)`);
    } else {
      console.log(`    ✗ NO RESOLUTION FOUND`);
    }
  }

  // 3. Check condition_id normalization
  console.log('\n\n3. CONDITION_ID NORMALIZATION CHECK:');

  console.log('\n  A) Trades table format (should have 0x prefix):');
  const tradesFormatResult = await client.query({
    query: `
      SELECT DISTINCT condition_id, length(condition_id) as len
      FROM cascadian_clean.fact_trades
      WHERE wallet = '${WALLET}'
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const tradesFormat = await tradesFormatResult.json<any>();
  tradesFormat.forEach((t: any) => {
    console.log(`    "${t.condition_id}" (length: ${t.len})`);
  });

  console.log('\n  B) Resolutions table format (might be without 0x):');
  const resFormatResult = await client.query({
    query: `
      SELECT DISTINCT condition_id, length(condition_id) as len
      FROM cascadian_clean.market_resolutions_final
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const resFormat = await resFormatResult.json<any>();
  resFormat.forEach((r: any) => {
    console.log(`    "${r.condition_id}" (length: ${r.len})`);
  });

  console.log('\n  C) Positions table format:');
  const posFormatResult = await client.query({
    query: `
      SELECT DISTINCT market_cid, length(market_cid) as len
      FROM cascadian_clean.vw_positions_open
      WHERE wallet = '${WALLET}'
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const posFormat = await posFormatResult.json<any>();
  posFormat.forEach((p: any) => {
    console.log(`    "${p.market_cid}" (length: ${p.len})`);
  });

  // 4. Calculate TRUE P&L
  console.log('\n\n4. TRUE P&L CALCULATION:');

  // Realized P&L - check if vw_positions_closed exists
  let realizedPnL = 0;
  let closedCount = 0;

  try {
    const realizedResult = await client.query({
      query: `
        SELECT
          count(*) as closed_positions,
          sum(pnl_usd) as realized_pnl
        FROM cascadian_clean.vw_positions_closed
        WHERE lower(wallet) = lower('${WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const realized = await realizedResult.json<any>();
    realizedPnL = realized[0]?.realized_pnl || 0;
    closedCount = realized[0]?.closed_positions || 0;
  } catch (e: any) {
    console.log(`\n  ⚠ vw_positions_closed doesn't exist, checking raw tables...`);

    // Try to get realized P&L from fact_trades with closed positions
    const altRealizedResult = await client.query({
      query: `
        SELECT
          count(DISTINCT market_cid, outcome) as closed_positions,
          sum(CASE
            WHEN direction = 'SELL' THEN qty * avg_price
            WHEN direction = 'BUY' THEN -qty * avg_price
          END) as realized_pnl
        FROM cascadian_clean.fact_trades
        WHERE lower(wallet) = lower('${WALLET}')
          AND market_cid IN (
            SELECT DISTINCT market_cid
            FROM cascadian_clean.market_resolutions_final
          )
        GROUP BY wallet
      `,
      format: 'JSONEachRow',
    });
    const altRealized = await altRealizedResult.json<any>();
    realizedPnL = altRealized[0]?.realized_pnl || 0;
    closedCount = altRealized[0]?.closed_positions || 0;
  }

  console.log(`\n  Realized P&L (${closedCount} closed positions):`);
  console.log(`    $${realizedPnL.toLocaleString()}`);

  // Unrealized P&L - sum from vw_positions_open
  const unrealizedResult = await client.query({
    query: `
      SELECT
        count(*) as total_positions,
        countIf(midprice > 0) as positions_with_midprice,
        sum(unrealized_pnl_usd) as unrealized_pnl
      FROM cascadian_clean.vw_positions_open
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const unrealized = await unrealizedResult.json<any>();
  const unrealizedPnL = unrealized[0]?.unrealized_pnl || 0;
  const totalPosCount = unrealized[0]?.total_positions || 0;
  const midpriceCount = unrealized[0]?.positions_with_midprice || 0;

  console.log(`\n  Unrealized P&L (${totalPosCount} total, ${midpriceCount} with midprices):`);
  console.log(`    $${unrealizedPnL.toLocaleString()}`);

  // Check what our current calculation shows
  console.log('\n\n5. CURRENT SYSTEM CALCULATION:');
  const currentResult = await client.query({
    query: `
      SELECT total_pnl, realized_pnl, unrealized_pnl
      FROM cascadian_clean.vw_wallet_pnl
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const current = await currentResult.json<any>();

  if (current.length > 0) {
    console.log(`  Total P&L: $${current[0].total_pnl}`);
    console.log(`  Realized: $${current[0].realized_pnl}`);
    console.log(`  Unrealized: $${current[0].unrealized_pnl}`);
  } else {
    console.log('  ✗ NO ENTRY IN vw_wallet_pnl');
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY:');
  console.log('='.repeat(80));
  const trueTotal = realizedPnL + unrealizedPnL;
  console.log(`Expected from Polymarket: $332,563`);
  console.log(`Our current calculation: $${current[0]?.total_pnl || -677}`);
  console.log(`\nRecalculated breakdown:`);
  console.log(`  Realized P&L:         $${realizedPnL.toLocaleString()}`);
  console.log(`  Unrealized P&L:       $${unrealizedPnL.toLocaleString()}`);
  console.log(`  --------------------------------`);
  console.log(`  TOTAL:                 $${trueTotal.toLocaleString()}`);
  console.log(`\nDiscrepancy: $${(332563 - trueTotal).toLocaleString()}`);

  // Final diagnosis
  console.log('\n\n' + '='.repeat(80));
  console.log('ROOT CAUSE DIAGNOSIS:');
  console.log('='.repeat(80));

  if (Math.abs(trueTotal - current[0]?.total_pnl) < 100) {
    console.log('✓ Our calculation matches expected value within $100');
  } else if (midpriceCount === 0) {
    console.log('⚠ ISSUE: No midprices found for open positions');
    console.log('   This means unrealized P&L cannot be calculated');
  } else if (Math.abs(unrealizedPnL) < 1000 && Math.abs(332563 - unrealizedPnL) > 300000) {
    console.log('⚠ ISSUE: Unrealized P&L is near zero, expected ~$332K');
    console.log('   Likely causes:');
    console.log('   1. Midprices are stale or zero');
    console.log('   2. Position quantities are incorrect');
    console.log('   3. Average cost calculation is wrong');
  } else {
    console.log('⚠ ISSUE: Unknown discrepancy');
    console.log(`   Expected: $332,563`);
    console.log(`   Got: $${trueTotal.toLocaleString()}`);
    console.log(`   Gap: $${(332563 - trueTotal).toLocaleString()}`);
  }

  await client.close();
}

main().catch(console.error);
