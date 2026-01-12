import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLETS = {
  spot_6: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0',
  spot_3: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4',
  spot_9: '0x61341f266a614cc511d2f606542b0774688998b0',
};

interface ComparisonResult {
  source: string;
  tx_count: number;
  total_usdc: number;
  earliest_trade: string;
  latest_trade: string;
}

async function compareWallet(walletName: string, walletAddress: string) {
  console.log('\n================================================================================');
  console.log(walletName.toUpperCase() + ' (' + walletAddress + ')');
  console.log('================================================================================');

  const v2Query = `
    SELECT
      'v2' as source,
      COUNT(DISTINCT event_id) as tx_count,
      SUM(usdc_amount) / 1000000.0 as total_usdc,
      MIN(trade_time) as earliest_trade,
      MAX(trade_time) as latest_trade
    FROM (
      SELECT event_id, any(usdc_amount) as usdc_amount, any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${walletAddress}'
        AND is_deleted = 0
      GROUP BY event_id
    )
  `;

  const v3Query = `
    SELECT
      'v3' as source,
      COUNT(*) as tx_count,
      SUM(usdc_amount) / 1000000.0 as total_usdc,
      MIN(trade_time) as earliest_trade,
      MAX(trade_time) as latest_trade
    FROM (
      SELECT
        any(usdc_amount) as usdc_amount,
        any(trade_time) as trade_time
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${walletAddress}'
      GROUP BY substring(event_id, 1, 66), token_id, side
    )
  `;

  const v2Result = await clickhouse.query({ query: v2Query, format: 'JSONEachRow' });
  const v3Result = await clickhouse.query({ query: v3Query, format: 'JSONEachRow' });

  const v2Data = (await v2Result.json()) as ComparisonResult[];
  const v3Data = (await v3Result.json()) as ComparisonResult[];

  const v2 = v2Data[0];
  const v3 = v3Data[0];

  console.log('\nV2 (deduplicated by event_id):');
  console.log('  Transactions: ' + v2.tx_count);
  console.log('  Total USDC:   $' + v2.total_usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log('  Date Range:   ' + v2.earliest_trade + ' to ' + v2.latest_trade);

  console.log('\nV3 (deduplicated by event_id + token_id + side):');
  console.log('  Transactions: ' + v3.tx_count);
  console.log('  Total USDC:   $' + v3.total_usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log('  Date Range:   ' + v3.earliest_trade + ' to ' + v3.latest_trade);

  const txDiff = v2.tx_count - v3.tx_count;
  const usdcDiff = v2.total_usdc - v3.total_usdc;
  const txPctDiff = ((txDiff / v2.tx_count) * 100).toFixed(1);
  const usdcPctDiff = ((usdcDiff / v2.total_usdc) * 100).toFixed(1);

  console.log('\nDifference:');
  console.log('  Missing Transactions: ' + txDiff + ' (' + txPctDiff + '% of v2)');
  console.log('  Missing USDC:         $' + usdcDiff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' (' + usdcPctDiff + '% of v2)');

  if (Math.abs(txDiff) > 0) {
    console.log('\n  DATA GAP DETECTED: v3 is missing ' + txDiff + ' transactions');
  } else {
    console.log('\n  No data gap - counts match after deduplication');
  }

  return {
    wallet: walletName,
    v2_tx: v2.tx_count,
    v3_tx: v3.tx_count,
    v2_usdc: v2.total_usdc,
    v3_usdc: v3.total_usdc,
    tx_diff: txDiff,
    usdc_diff: usdcDiff,
  };
}

async function main() {
  console.log('Investigating v2 vs v3 Data Gap for Failing Wallets');
  console.log('Using proper deduplication patterns:');
  console.log('  - v2: GROUP BY event_id');
  console.log('  - v3: GROUP BY substring(event_id, 1, 66), token_id, side');

  const results = [];

  for (const [name, address] of Object.entries(WALLETS)) {
    const result = await compareWallet(name, address);
    results.push(result);
  }

  console.log('\n================================================================================');
  console.log('SUMMARY');
  console.log('================================================================================');

  console.table(
    results.map((r) => ({
      Wallet: r.wallet,
      'V2 TX': r.v2_tx,
      'V3 TX': r.v3_tx,
      'Missing TX': r.tx_diff,
      'Missing TX %': ((r.tx_diff / r.v2_tx) * 100).toFixed(1) + '%',
      'V2 USDC': '$' + r.v2_usdc.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      'V3 USDC': '$' + r.v3_usdc.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      'Missing USDC': '$' + r.usdc_diff.toLocaleString('en-US', { maximumFractionDigits: 0 }),
    }))
  );

  const totalV2Tx = results.reduce((sum, r) => sum + r.v2_tx, 0);
  const totalV3Tx = results.reduce((sum, r) => sum + r.v3_tx, 0);
  const totalMissingTx = results.reduce((sum, r) => sum + r.tx_diff, 0);
  const totalV2Usdc = results.reduce((sum, r) => sum + r.v2_usdc, 0);
  const totalV3Usdc = results.reduce((sum, r) => sum + r.v3_usdc, 0);
  const totalMissingUsdc = results.reduce((sum, r) => sum + r.usdc_diff, 0);

  console.log('\nTOTALS ACROSS 3 WALLETS:');
  console.log('  V2 Total:     ' + totalV2Tx + ' tx, $' + totalV2Usdc.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  console.log('  V3 Total:     ' + totalV3Tx + ' tx, $' + totalV3Usdc.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  console.log('  Missing:      ' + totalMissingTx + ' tx (' + ((totalMissingTx / totalV2Tx) * 100).toFixed(1) + '%), $' + totalMissingUsdc.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' (' + ((totalMissingUsdc / totalV2Usdc) * 100).toFixed(1) + '%)');

  if (totalMissingTx > 0) {
    console.log('\n================================================================================');
    console.log('CONCLUSION: REAL DATA GAP EXISTS');
    console.log('================================================================================');
    console.log('v3 is missing real trades compared to properly deduplicated v2 data.');
    console.log('This is NOT just a deduplication difference.');
    console.log('\nNext steps:');
    console.log('1. Investigate which specific trades are missing (time ranges, token_ids)');
    console.log('2. Check if v3 backfill was incomplete');
    console.log('3. Verify v3 deduplication logic is correct');
  } else {
    console.log('\n================================================================================');
    console.log('CONCLUSION: NO REAL DATA GAP');
    console.log('================================================================================');
    console.log('The difference was due to deduplication patterns, not missing data.');
  }
}

main().catch(console.error);
