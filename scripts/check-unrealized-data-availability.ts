import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0x6770bf688b8121331b1c5cfd7723ebd4152545fb';

async function checkUnrealizedData() {
  console.log('Checking what unrealized position data is available');
  console.log('Wallet:', WALLET);
  console.log('Polymarket UI shows: $1,914 total P&L');
  console.log('='.repeat(80), '\n');
  
  // Check if we have market resolution data
  console.log('1. Market resolution coverage:');
  const resolutionCheck = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id_norm) as total_markets_traded,
        COUNT(DISTINCT CASE WHEN resolved = true THEN condition_id_norm END) as resolved_markets,
        COUNT(DISTINCT CASE WHEN resolved = false THEN condition_id_norm END) as unresolved_markets
      FROM (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
        FROM default.trades_raw
        WHERE lower(wallet) = '${WALLET}'
      ) trades
      LEFT JOIN (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as cid_norm,
          true as resolved
        FROM default.market_resolutions
        WHERE winning_outcome_index IS NOT NULL
      ) resolutions
      ON trades.condition_id_norm = resolutions.cid_norm
    `,
    format: 'JSONEachRow',
  });
  const resCoverage = await resolutionCheck.json();
  console.log(JSON.stringify(resCoverage, null, 2), '\n');
  
  // Check what tables have payout/outcome data
  console.log('2. Tables with payout vector data:');
  const payoutCheck = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as rows_with_payout_data,
        COUNT(DISTINCT condition_id_norm) as markets_with_payouts
      FROM default.market_resolutions
      WHERE payout_numerators IS NOT NULL
        AND arrayLength(payout_numerators) > 0
    `,
    format: 'JSONEachRow',
  });
  const payoutData = await payoutCheck.json();
  console.log(JSON.stringify(payoutData, null, 2), '\n');
  
  // Check if we have current outcome_index data for this wallet
  console.log('3. Open positions for wallet (if any):');
  const openPositions = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        SUM(toFloat64(shares)) as net_shares,
        AVG(toFloat64(entry_price)) as avg_entry_price,
        SUM(toFloat64(cashflow_usdc)) as total_cashflow
      FROM default.trade_cashflows_v3
      WHERE lower(wallet) = '${WALLET}'
      GROUP BY condition_id_norm
      HAVING net_shares != 0
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const openPos = await openPositions.json();
  console.log('Open positions with non-zero shares:', openPos.length);
  console.log(JSON.stringify(openPos, null, 2), '\n');
  
  // Check if we have current price data
  console.log('4. Do we have CLOB price data for open positions?');
  const priceCheck = await clickhouse.query({
    query: `
      SELECT COUNT(*) as clob_rows
      FROM default.clob_fills
      WHERE true
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const priceData = await priceCheck.json();
  console.log('CLOB fills available:', priceData[0]?.clob_rows || 0, '\n');
}

checkUnrealizedData().catch(console.error);
