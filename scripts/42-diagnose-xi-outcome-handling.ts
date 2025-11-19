import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XI_CID_NORM = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function diagnoseXiOutcomeHandling() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 DIAGNOSTIC: Xi Market Outcome & Direction Handling');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Xi CID: ' + XI_CID_NORM + '\n');

  try {
    // Check 1: Direction & Outcome Distribution
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('CHECK 1: Trade Direction & Outcome Index Distribution');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const distributionQuery = `
      SELECT
        trade_direction,
        outcome_index_v3,
        count(*) AS trades,
        sum(shares) AS total_shares,
        sum(usd_value) AS total_usd_value,
        avg(price) AS avg_price
      FROM vw_xcn_repaired_only
      WHERE cid_norm = '${XI_CID_NORM}'
      GROUP BY trade_direction, outcome_index_v3
      ORDER BY trade_direction, outcome_index_v3
    `;

    const distResult = await clickhouse.query({ query: distributionQuery, format: 'JSONEachRow' });
    const distData = await distResult.json<any[]>();

    console.log('Distribution by Direction & Outcome:\n');
    console.log('Direction | Outcome | Trades    | Total Shares    | Total USD      | Avg Price');
    console.log('----------|---------|-----------|-----------------|----------------|----------');

    distData.forEach(row => {
      const dir = String(row.trade_direction).padEnd(9);
      const outcome = String(row.outcome_index_v3).padEnd(7);
      const trades = Number(row.trades).toLocaleString().padStart(9);
      const shares = Number(row.total_shares).toLocaleString().padStart(15);
      const usd = '$' + Number(row.total_usd_value).toLocaleString().padStart(14);
      const price = Number(row.avg_price).toFixed(4).padStart(10);
      console.log(`${dir} | ${outcome} | ${trades} | ${shares} | ${usd} | ${price}`);
    });
    console.log('');

    // Check 2: Net Position by Outcome
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('CHECK 2: Net Position by Outcome Index');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const positionQuery = `
      SELECT
        outcome_index_v3,
        sumIf(shares, trade_direction='BUY') AS bought,
        sumIf(shares, trade_direction='SELL') AS sold,
        bought - sold AS net_position
      FROM vw_xcn_repaired_only
      WHERE cid_norm = '${XI_CID_NORM}'
      GROUP BY outcome_index_v3
      ORDER BY outcome_index_v3
    `;

    const posResult = await clickhouse.query({ query: positionQuery, format: 'JSONEachRow' });
    const posData = await posResult.json<any[]>();

    console.log('Outcome | Bought        | Sold          | Net Position');
    console.log('--------|---------------|---------------|---------------');

    posData.forEach(row => {
      const outcome = String(row.outcome_index_v3).padEnd(7);
      const bought = Number(row.bought).toLocaleString().padStart(13);
      const sold = Number(row.sold).toLocaleString().padStart(13);
      const net = Number(row.net_position).toLocaleString().padStart(15);
      console.log(`${outcome} | ${bought} | ${sold} | ${net}`);
    });
    console.log('');

    // Check 3: Price Analysis
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('CHECK 3: Price Analysis (Check for Scaling Issues)');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const priceQuery = `
      SELECT
        min(price) AS min_price,
        max(price) AS max_price,
        avg(price) AS avg_price,
        quantile(0.5)(price) AS median_price,
        avg(toFloat64(usd_value) / toFloat64(shares)) AS avg_unit_cost
      FROM vw_xcn_repaired_only
      WHERE cid_norm = '${XI_CID_NORM}'
        AND shares > 0
    `;

    const priceResult = await clickhouse.query({ query: priceQuery, format: 'JSONEachRow' });
    const priceData = await priceResult.json<any[]>();
    const prices = priceData[0];

    console.log(`Min Price:        $${Number(prices.min_price).toFixed(6)}`);
    console.log(`Max Price:        $${Number(prices.max_price).toFixed(6)}`);
    console.log(`Avg Price:        $${Number(prices.avg_price).toFixed(6)}`);
    console.log(`Median Price:     $${Number(prices.median_price).toFixed(6)}`);
    console.log(`Avg Unit Cost:    $${Number(prices.avg_unit_cost).toFixed(6)}\n`);

    // Check 4: Check for resolution data
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('CHECK 4: Resolution Status');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const resolutionQuery = `
      SELECT
        cid_norm,
        winning_outcome,
        payout_vector,
        resolved_at
      FROM gamma_markets_resolutions_v2
      WHERE cid_norm = '${XI_CID_NORM}'
      LIMIT 1
    `;

    const resResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
    const resData = await resResult.json<any[]>();

    if (resData.length === 0) {
      console.log('⚠️  Xi market NOT RESOLVED yet\n');
      console.log('Cannot calculate settlement PnL without resolution data.\n');
    } else {
      const res = resData[0];
      console.log(`✅ Xi market IS RESOLVED\n`);
      console.log(`Winning Outcome: ${res.winning_outcome}`);
      console.log(`Payout Vector:   ${res.payout_vector}`);
      console.log(`Resolved At:     ${res.resolved_at}\n`);
    }

    // Check 5: Sample trades
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('CHECK 5: Sample Trades (First 5 Buys, First 5 Sells)');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const sampleBuysQuery = `
      SELECT
        timestamp,
        trade_direction,
        outcome_index_v3,
        shares,
        price,
        usd_value
      FROM vw_xcn_repaired_only
      WHERE cid_norm = '${XI_CID_NORM}'
        AND trade_direction = 'BUY'
      ORDER BY timestamp
      LIMIT 5
    `;

    const sampleBuysResult = await clickhouse.query({ query: sampleBuysQuery, format: 'JSONEachRow' });
    const sampleBuys = await sampleBuysResult.json<any[]>();

    console.log('First 5 BUY trades:\n');
    sampleBuys.forEach((trade, i) => {
      console.log(`${i+1}. ${trade.timestamp} | Outcome ${trade.outcome_index_v3} | ${Number(trade.shares).toLocaleString()} shares @ $${Number(trade.price).toFixed(4)} = $${Number(trade.usd_value).toLocaleString()}`);
    });
    console.log('');

    const sampleSellsQuery = `
      SELECT
        timestamp,
        trade_direction,
        outcome_index_v3,
        shares,
        price,
        usd_value
      FROM vw_xcn_repaired_only
      WHERE cid_norm = '${XI_CID_NORM}'
        AND trade_direction = 'SELL'
      ORDER BY timestamp
      LIMIT 5
    `;

    const sampleSellsResult = await clickhouse.query({ query: sampleSellsQuery, format: 'JSONEachRow' });
    const sampleSells = await sampleSellsResult.json<any[]>();

    console.log('First 5 SELL trades:\n');
    sampleSells.forEach((trade, i) => {
      console.log(`${i+1}. ${trade.timestamp} | Outcome ${trade.outcome_index_v3} | ${Number(trade.shares).toLocaleString()} shares @ $${Number(trade.price).toFixed(4)} = $${Number(trade.usd_value).toLocaleString()}`);
    });
    console.log('');

    // Summary
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('DIAGNOSTIC SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log('Key Findings:\n');

    // Calculate overall position
    const totalBought = distData
      .filter(r => r.trade_direction === 'BUY')
      .reduce((sum, r) => sum + Number(r.total_shares), 0);

    const totalSold = distData
      .filter(r => r.trade_direction === 'SELL')
      .reduce((sum, r) => sum + Number(r.total_shares), 0);

    const netPosition = totalBought - totalSold;

    console.log(`1. Overall Position: ${netPosition > 0 ? 'LONG' : 'SHORT'} (${netPosition.toLocaleString()} net shares)`);

    // Check if outcome 0 or 1 dominates
    const outcome0Net = posData.find(r => r.outcome_index_v3 === 0)?.net_position || 0;
    const outcome1Net = posData.find(r => r.outcome_index_v3 === 1)?.net_position || 0;

    if (Math.abs(outcome0Net) > Math.abs(outcome1Net)) {
      console.log(`2. Primary exposure: Outcome 0 (${Number(outcome0Net).toLocaleString()} net shares)`);
    } else {
      console.log(`2. Primary exposure: Outcome 1 (${Number(outcome1Net).toLocaleString()} net shares)`);
    }

    // Check price range
    const minP = Number(prices.min_price);
    const maxP = Number(prices.max_price);

    if (minP < 0.01 || maxP > 10) {
      console.log(`3. ⚠️  WARNING: Price range suspicious ($${minP.toFixed(6)} - $${maxP.toFixed(6)})`);
      console.log(`   This might indicate a scaling issue.`);
    } else {
      console.log(`3. ✅ Price range looks normal ($${minP.toFixed(4)} - $${maxP.toFixed(4)})`);
    }

    // Check resolution
    if (resData.length === 0) {
      console.log(`4. ⚠️  Market NOT resolved - cannot calculate settlement PnL`);
    } else {
      console.log(`4. ✅ Market resolved - settlement PnL can be calculated`);
    }

    console.log('');

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
  }
}

diagnoseXiOutcomeHandling().catch(console.error);
