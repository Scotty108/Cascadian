import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

config({ path: '.env.local' });

async function checkTimeRanges() {
  console.log('=== TIME RANGE ANALYSIS ===\n');

  // Check trades_raw time range
  console.log('1. trades_raw time range:');
  const trades = await clickhouse.query({
    query: `
      SELECT
        min(tx_timestamp) as first_trade,
        max(tx_timestamp) as last_trade,
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id IS NULL OR condition_id = '' THEN 1 ELSE 0 END) as missing_condition_ids
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  });
  const tradesData = await trades.json();
  console.log(tradesData[0]);
  console.log('');

  // Check erc20_transfers_decoded time range
  console.log('2. erc20_transfers_decoded time range:');
  const decoded = await clickhouse.query({
    query: `
      SELECT
        min(block_time) as first_transfer,
        max(block_time) as last_transfer,
        COUNT(*) as total_transfers
      FROM erc20_transfers_decoded
    `,
    format: 'JSONEachRow'
  });
  const decodedData = await decoded.json();
  console.log(decodedData[0]);
  console.log('');

  // Check if there's overlap
  console.log('3. Checking for overlap...');
  const tradesFirst = new Date(tradesData[0].first_trade);
  const tradesLast = new Date(tradesData[0].last_trade);
  const decodedFirst = new Date(decodedData[0].first_transfer);
  const decodedLast = new Date(decodedData[0].last_transfer);

  console.log(`Trades range: ${tradesFirst.toISOString()} to ${tradesLast.toISOString()}`);
  console.log(`Decoded range: ${decodedFirst.toISOString()} to ${decodedLast.toISOString()}`);

  const overlap = decodedFirst <= tradesLast && decodedLast >= tradesFirst;
  console.log(`Overlap exists: ${overlap}`);
  console.log('');

  // Check wallet address format
  console.log('4. Sample wallet addresses from each table:');
  const tradeWallets = await clickhouse.query({
    query: `SELECT wallet_address FROM trades_raw LIMIT 3`,
    format: 'JSONEachRow'
  });
  const tradeWalletsData = await tradeWallets.json();
  console.log('trades_raw wallets:', tradeWalletsData);

  const decodedWallets = await clickhouse.query({
    query: `SELECT DISTINCT from_address FROM erc20_transfers_decoded LIMIT 3`,
    format: 'JSONEachRow'
  });
  const decodedWalletsData = await decodedWallets.json();
  console.log('erc20_transfers_decoded addresses:', decodedWalletsData);
}

checkTimeRanges().catch(console.error);
