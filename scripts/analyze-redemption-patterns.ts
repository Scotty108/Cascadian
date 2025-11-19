import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function analyzeRedemptions() {
  console.log('=== REDEMPTION-BASED RESOLUTION DETECTION ===\n');

  // Step 1: Understand ERC1155 schema
  console.log('Step 1: Understanding ERC1155 transfers schema...\n');

  const erc1155Schema = `
    SELECT
      name,
      type
    FROM system.columns
    WHERE database = 'default' AND table = 'erc1155_transfers'
    ORDER BY position
  `;

  const erc1155SchemaResult = await client.query({ query: erc1155Schema, format: 'JSONEachRow' });
  const erc1155SchemaData = await erc1155SchemaResult.json();
  console.log('ERC1155 transfers schema:');
  erc1155SchemaData.forEach((c: any) => console.log(`  ${c.name}: ${c.type}`));

  // Step 2: Find burn events (to = 0x000...000)
  console.log('\n\nStep 2: Analyzing ERC1155 burn events (transfers to 0x000...000)...\n');

  const burnAnalysis = `
    SELECT
      COUNT(*) as burn_count,
      COUNT(DISTINCT from_address) as unique_burners,
      COUNT(DISTINCT token_id) as unique_tokens,
      MIN(block_timestamp) as first_burn,
      MAX(block_timestamp) as last_burn,
      SUM(CAST(value AS Float64)) as total_burned
    FROM default.erc1155_transfers
    WHERE lower(to_address) = '0x0000000000000000000000000000000000000000'
    LIMIT 1
  `;

  const burnResult = await client.query({ query: burnAnalysis, format: 'JSONEachRow' });
  const burnData = await burnResult.json();
  console.log('Burn event statistics:');
  console.log(JSON.stringify(burnData[0], null, 2));

  // Step 3: Sample burn events with details
  console.log('\n\nStep 3: Sampling recent burn events...\n');

  const sampleBurns = `
    SELECT
      from_address as wallet,
      to_address as burn_target,
      token_id,
      CAST(value AS Float64) as burned_amount,
      transaction_hash as tx_hash,
      block_timestamp,
      block_number
    FROM default.erc1155_transfers
    WHERE lower(to_address) = '0x0000000000000000000000000000000000000000'
    ORDER BY block_timestamp DESC
    LIMIT 10
  `;

  const burnsResult = await client.query({ query: sampleBurns, format: 'JSONEachRow' });
  const burnsData = await burnsResult.json();
  console.log('Sample burn events:');
  burnsData.forEach((b: any, i: number) => {
    console.log(`\n${i + 1}. Burn Event:`);
    console.log(`   Wallet: ${b.wallet}`);
    console.log(`   Token ID: ${b.token_id}`);
    console.log(`   Amount: ${b.burned_amount}`);
    console.log(`   Tx Hash: ${b.tx_hash}`);
    console.log(`   Timestamp: ${b.block_timestamp}`);
  });

  // Step 4: Check if those tx_hashes have corresponding ERC20 (USDC) transfers
  if (burnsData.length > 0) {
    const txHashes = burnsData.map((b: any) => `'${b.tx_hash}'`).join(',');

    console.log('\n\nStep 4: Checking for ERC20 (USDC) transfers in same transactions...\n');

    const usdcInSameTx = `
      SELECT
        transaction_hash,
        from_address as usdc_from,
        to_address as usdc_to,
        CAST(value AS Float64) / 1e6 as usdc_amount,
        block_timestamp
      FROM default.erc20_transfers
      WHERE transaction_hash IN (${txHashes})
      ORDER BY block_timestamp DESC
    `;

    const usdcResult = await client.query({ query: usdcInSameTx, format: 'JSONEachRow' });
    const usdcData = await usdcResult.json();
    console.log(`Found ${usdcData.length} ERC20 (USDC) transfers in same transactions as burns:`);
    usdcData.forEach((u: any, i: number) => {
      console.log(`\n${i + 1}. USDC Transfer:`);
      console.log(`   From: ${u.usdc_from}`);
      console.log(`   To: ${u.usdc_to}`);
      console.log(`   Amount: ${u.usdc_amount} USDC`);
      console.log(`   Tx: ${u.transaction_hash}`);
    });

    // Step 5: Match burns with USDC transfers by tx_hash
    console.log('\n\nStep 5: Matching burns with redemption payouts...\n');

    burnsData.forEach((burn: any) => {
      const matchingUsdc = usdcData.find((u: any) => u.transaction_hash === burn.tx_hash);
      if (matchingUsdc) {
        console.log(`\nREDEMPTION DETECTED:`);
        console.log(`  Wallet: ${burn.wallet}`);
        console.log(`  Burned ${burn.burned_amount} tokens (ID: ${burn.token_id})`);
        console.log(`  Received ${matchingUsdc.usdc_amount} USDC`);
        console.log(`  Tx: ${burn.tx_hash}`);
      }
    });
  }

  // Step 6: Aggregate redemptions by token_id
  console.log('\n\nStep 6: Aggregating redemption patterns by token_id...\n');

  const redemptionPatterns = `
    WITH burns AS (
      SELECT
        token_id,
        from_address as wallet,
        CAST(value AS Float64) as burned_amount,
        transaction_hash,
        block_timestamp,
        block_number
      FROM default.erc1155_transfers
      WHERE lower(to_address) = '0x0000000000000000000000000000000000000000'
    ),
    usdc_payouts AS (
      SELECT
        transaction_hash,
        to_address as recipient,
        CAST(value AS Float64) / 1e6 as usdc_amount
      FROM default.erc20_transfers
    )
    SELECT
      b.token_id,
      COUNT(DISTINCT b.wallet) as redeemer_count,
      SUM(b.burned_amount) as total_burned,
      SUM(u.usdc_amount) as total_usdc_paid,
      MIN(b.block_timestamp) as first_redemption,
      MAX(b.block_timestamp) as last_redemption,
      dateDiff('hour', MIN(b.block_timestamp), MAX(b.block_timestamp)) as redemption_window_hours
    FROM burns b
    LEFT JOIN usdc_payouts u ON b.transaction_hash = u.transaction_hash AND b.wallet = u.recipient
    GROUP BY b.token_id
    HAVING redeemer_count > 1
    ORDER BY redeemer_count DESC
    LIMIT 20
  `;

  const patternsResult = await client.query({ query: redemptionPatterns, format: 'JSONEachRow' });
  const patternsData = await patternsResult.json();
  console.log(`\nTop 20 tokens by redemption activity:`);
  console.log(JSON.stringify(patternsData, null, 2));

  await client.close();
}

analyzeRedemptions().catch(console.error);
