import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

config({ path: '.env.local' });

async function quickCheck() {
  console.log('=== QUICK PATH B CHECK ===\n');

  // 1. Count missing condition_ids
  console.log('1. Counting missing condition_ids...');
  const missing = await clickhouse.query({
    query: `
      SELECT COUNT(*) as missing_count
      FROM trades_raw
      WHERE condition_id IS NULL OR condition_id = ''
    `,
    format: 'JSONEachRow'
  });
  const missingData = await missing.json();
  console.log('Missing condition_ids:', missingData[0].missing_count);
  console.log('');

  // 2. Count total decoded USDC transfers
  console.log('2. Counting decoded USDC transfers...');
  const usdc = await clickhouse.query({
    query: `SELECT COUNT(*) as usdc_count FROM erc20_transfers_decoded`,
    format: 'JSONEachRow'
  });
  const usdcData = await usdc.json();
  console.log('Total USDC transfers:', usdcData[0].usdc_count);
  console.log('');

  // 3. Sample approach: Take 1000 random missing trades and check proximity
  console.log('3. Sampling 1000 random missing trades for proximity check...');
  const sample = await clickhouse.query({
    query: `
      WITH sample_trades AS (
        SELECT
          wallet_address,
          tx_timestamp,
          transaction_hash
        FROM trades_raw
        WHERE condition_id IS NULL OR condition_id = ''
        ORDER BY rand()
        LIMIT 1000
      )
      SELECT
        COUNT(DISTINCT s.transaction_hash) as trades_with_proximity
      FROM sample_trades s
      JOIN erc20_transfers_decoded u
        ON (u.from_address = s.wallet_address OR u.to_address = s.wallet_address)
      WHERE u.block_time BETWEEN s.tx_timestamp - INTERVAL 180 SECOND AND s.tx_timestamp + INTERVAL 180 SECOND
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json();
  console.log('Sample trades with USDC proximity:', sampleData[0].trades_with_proximity, '/ 1000');
  const coverage = (Number(sampleData[0].trades_with_proximity) / 1000) * 100;
  console.log(`Estimated coverage: ${coverage.toFixed(1)}%`);
  console.log('');

  // 4. Estimate target blocks using smaller sample
  console.log('4. Estimating target block count from 1000-trade sample...');
  const blockEstimate = await clickhouse.query({
    query: `
      WITH sample_trades AS (
        SELECT
          wallet_address,
          tx_timestamp,
          transaction_hash
        FROM trades_raw
        WHERE condition_id IS NULL OR condition_id = ''
        ORDER BY rand()
        LIMIT 1000
      )
      SELECT
        uniqExact(st.block_number) as sample_blocks,
        min(st.block_number) as first_block,
        max(st.block_number) as last_block
      FROM sample_trades s
      JOIN erc20_transfers_decoded u
        ON (u.from_address = s.wallet_address OR u.to_address = s.wallet_address)
      JOIN erc20_transfers_staging st
        ON st.tx_hash = u.tx_hash AND st.log_index = u.log_index
      WHERE u.block_time BETWEEN s.tx_timestamp - INTERVAL 180 SECOND AND s.tx_timestamp + INTERVAL 180 SECOND
    `,
    format: 'JSONEachRow'
  });
  const blockData = await blockEstimate.json();
  console.log('Sample blocks:', blockData[0].sample_blocks);

  // Extrapolate to full dataset
  const totalMissing = Number(missingData[0].missing_count);
  const samplesBlocks = Number(blockData[0].sample_blocks);
  const estimatedTotalBlocks = Math.round((samplesBlocks / 1000) * totalMissing);

  console.log(`Estimated total blocks needed: ${estimatedTotalBlocks.toLocaleString()}`);
  console.log('');

  // Decision
  console.log('=== DECISION ===');
  if (estimatedTotalBlocks < 10_000_000) {
    console.log('✅ PATH B VIABLE: Expected 2-3 hours');
  } else if (estimatedTotalBlocks < 15_000_000) {
    console.log('⚠️  PATH B MARGINAL: Expected 3-5 hours');
  } else if (estimatedTotalBlocks < 20_000_000) {
    console.log('⚠️  PATH B RISKY: Expected 5-7 hours');
  } else {
    console.log('❌ PATH B NOT VIABLE: Too many blocks');
  }
  console.log(`\nEstimated recovery: ${(totalMissing * coverage / 100).toLocaleString()} / ${totalMissing.toLocaleString()} trades`);
}

quickCheck().catch(console.error);
