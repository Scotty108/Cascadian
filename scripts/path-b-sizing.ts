import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

// Load environment variables
config({ path: '.env.local' });

async function runSizingAnalysis() {
  console.log('=== PATH B FEASIBILITY ANALYSIS ===\n');

  // Query 1: Count recoverable trades with nearby USDC activity
  console.log('Query 1: Trades with USDC proximity (±180s)...');
  const proximity = await clickhouse.query({
    query: `
      SELECT uniqExact(t.transaction_hash) as trades_with_usdc_proximity
      FROM trades_raw t
      JOIN erc20_transfers_decoded u
        ON (u.from_address = t.wallet_address OR u.to_address = t.wallet_address)
      WHERE (t.condition_id IS NULL OR t.condition_id = '')
      AND u.block_time BETWEEN t.tx_timestamp - INTERVAL 180 SECOND AND t.tx_timestamp + INTERVAL 180 SECOND
    `,
    format: 'JSONEachRow'
  });
  const proximityData = await proximity.json();
  console.log('Result:', proximityData[0]);
  console.log('');

  // Query 2: Count unique blocks we need to query
  // Note: We'll need to join staging to get block_number since decoded doesn't have it
  console.log('Query 2: Target block count and range...');
  const blocks = await clickhouse.query({
    query: `
      SELECT
        uniqExact(s.block_number) as target_blocks,
        min(s.block_number) as first_block,
        max(s.block_number) as last_block,
        max(s.block_number) - min(s.block_number) + 1 as total_range
      FROM trades_raw t
      JOIN erc20_transfers_decoded u
        ON (u.from_address = t.wallet_address OR u.to_address = t.wallet_address)
      JOIN erc20_transfers_staging s
        ON s.tx_hash = u.tx_hash AND s.log_index = u.log_index
      WHERE (t.condition_id IS NULL OR t.condition_id = '')
      AND u.block_time BETWEEN t.tx_timestamp - INTERVAL 180 SECOND AND t.tx_timestamp + INTERVAL 180 SECOND
    `,
    format: 'JSONEachRow'
  });
  const blocksData = await blocks.json();
  console.log('Result:', blocksData[0]);
  console.log('');

  // Query 3: Distribution check per wallet
  console.log('Query 3: Distribution per wallet...');
  const distribution = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        uniqExact(wallet_address) as unique_wallets,
        quantile(0.5)(distinct_usdc_blocks) as median_blocks_per_wallet,
        quantile(0.95)(distinct_usdc_blocks) as p95_blocks_per_wallet,
        max(distinct_usdc_blocks) as max_blocks_per_wallet
      FROM (
        SELECT
          t.wallet_address,
          uniqExact(s.block_number) as distinct_usdc_blocks,
          count() as trade_count
        FROM trades_raw t
        JOIN erc20_transfers_decoded u
          ON (u.from_address = t.wallet_address OR u.to_address = t.wallet_address)
        JOIN erc20_transfers_staging s
          ON s.tx_hash = u.tx_hash AND s.log_index = u.log_index
        WHERE (t.condition_id IS NULL OR t.condition_id = '')
        AND u.block_time BETWEEN t.tx_timestamp - INTERVAL 180 SECOND AND t.tx_timestamp + INTERVAL 180 SECOND
        GROUP BY t.wallet_address
      )
    `,
    format: 'JSONEachRow'
  });
  const distData = await distribution.json();
  console.log('Result:', distData[0]);
  console.log('');

  // Summary and decision
  console.log('=== DECISION CRITERIA ===');
  const targetBlocks = Number(blocksData[0].target_blocks);
  const tradesRecoverable = Number(proximityData[0].trades_with_usdc_proximity);
  const totalRange = Number(blocksData[0].total_range);

  console.log(`Target blocks to query: ${targetBlocks.toLocaleString()}`);
  console.log(`Trades recoverable: ${tradesRecoverable.toLocaleString()}`);

  if (targetBlocks < 10_000_000) {
    console.log('\n✅ PATH B VIABLE: Expected 2-3 hours to recover 60-70%');
  } else if (targetBlocks < 15_000_000) {
    console.log('\n⚠️  PATH B MARGINAL: Expected 3-5 hours to recover 60-70%');
  } else if (targetBlocks < 20_000_000) {
    console.log('\n⚠️  PATH B RISKY: Expected 5-7 hours to recover 60-70%');
  } else {
    console.log('\n❌ PATH B NOT VIABLE: Too many blocks, need different strategy');
  }

  console.log(`\nBlock density: ${((targetBlocks / totalRange) * 100).toFixed(2)}%`);
}

runSizingAnalysis().catch(console.error);
