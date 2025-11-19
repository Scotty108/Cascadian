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
  console.log('=== REDEMPTION-BASED RESOLUTION DETECTION V2 ===\n');

  // Step 1: Find the CTF contract address
  console.log('Step 1: Identifying CTF contract address...\n');

  const ctfContract = `
    SELECT
      contract,
      COUNT(*) as transfer_count,
      COUNT(DISTINCT from_address) as unique_senders,
      COUNT(DISTINCT token_id) as unique_tokens,
      MIN(block_timestamp) as first_transfer,
      MAX(block_timestamp) as last_transfer
    FROM default.erc1155_transfers
    GROUP BY contract
    ORDER BY transfer_count DESC
    LIMIT 5
  `;

  const ctfResult = await client.query({ query: ctfContract, format: 'JSONEachRow' });
  const ctfData = await ctfResult.json();
  console.log('Top ERC1155 contracts by transfer count:');
  console.log(JSON.stringify(ctfData, null, 2));

  const mainCTF = ctfData[0]?.contract;
  console.log(`\n\nMain CTF contract: ${mainCTF}`);

  // Step 2: Look for transfers TO the CTF contract (potential redemptions)
  console.log('\n\nStep 2: Looking for transfers TO the CTF contract...\n');

  const transfersToCTF = `
    SELECT
      COUNT(*) as count,
      COUNT(DISTINCT from_address) as unique_senders,
      COUNT(DISTINCT token_id) as unique_tokens,
      MIN(block_timestamp) as first,
      MAX(block_timestamp) as last
    FROM default.erc1155_transfers
    WHERE lower(to_address) = lower('${mainCTF}')
    LIMIT 1
  `;

  const toCTFResult = await client.query({ query: transfersToCTF, format: 'JSONEachRow' });
  const toCTFData = await toCTFResult.json();
  console.log('Transfers TO CTF contract:');
  console.log(JSON.stringify(toCTFData[0], null, 2));

  // Step 3: Sample transfers to CTF contract
  console.log('\n\nStep 3: Sampling transfers to CTF contract...\n');

  const sampleToCTF = `
    SELECT
      from_address as wallet,
      to_address,
      token_id,
      CAST(value AS Float64) as amount,
      tx_hash,
      block_timestamp,
      block_number
    FROM default.erc1155_transfers
    WHERE lower(to_address) = lower('${mainCTF}')
    ORDER BY block_timestamp DESC
    LIMIT 10
  `;

  const sampleResult = await client.query({ query: sampleToCTF, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json();
  console.log('Sample transfers to CTF:');
  sampleData.forEach((s: any, i: number) => {
    console.log(`\n${i + 1}. Transfer to CTF:`);
    console.log(`   Wallet: ${s.wallet}`);
    console.log(`   Token ID: ${s.token_id}`);
    console.log(`   Amount: ${s.amount}`);
    console.log(`   Tx Hash: ${s.tx_hash}`);
    console.log(`   Timestamp: ${s.block_timestamp}`);
  });

  // Step 4: Check if those tx_hashes have corresponding USDC transfers
  if (sampleData.length > 0) {
    const txHashes = sampleData.map((s: any) => `'${s.tx_hash}'`).join(',');

    console.log('\n\nStep 4: Checking for ERC20 (USDC) transfers in same transactions...\n');

    const usdcInSameTx = `
      SELECT
        tx_hash,
        from_address as usdc_from,
        to_address as usdc_to,
        CAST(value AS Float64) / 1e6 as usdc_amount,
        block_timestamp
      FROM default.erc20_transfers
      WHERE tx_hash IN (${txHashes})
      ORDER BY block_timestamp DESC
    `;

    const usdcResult = await client.query({ query: usdcInSameTx, format: 'JSONEachRow' });
    const usdcData = await usdcResult.json();
    console.log(`Found ${usdcData.length} ERC20 (USDC) transfers in same transactions:`);
    usdcData.forEach((u: any, i: number) => {
      console.log(`\n${i + 1}. USDC Transfer:`);
      console.log(`   From: ${u.usdc_from}`);
      console.log(`   To: ${u.usdc_to}`);
      console.log(`   Amount: ${u.usdc_amount} USDC`);
      console.log(`   Tx: ${u.tx_hash}`);
    });

    // Step 5: Match transfers with USDC payouts
    console.log('\n\nStep 5: Matching ERC1155 transfers to CTF with USDC payouts...\n');

    let redemptionCount = 0;
    sampleData.forEach((transfer: any) => {
      const matchingUsdc = usdcData.filter((u: any) => u.tx_hash === transfer.tx_hash);
      if (matchingUsdc.length > 0) {
        console.log(`\nPOTENTIAL REDEMPTION:`);
        console.log(`  Wallet: ${transfer.wallet}`);
        console.log(`  Sent ${transfer.amount} tokens (ID: ${transfer.token_id}) to CTF`);
        console.log(`  USDC movements in same tx:`);
        matchingUsdc.forEach((u: any) => {
          console.log(`    ${u.usdc_amount} USDC: ${u.usdc_from} → ${u.usdc_to}`);
        });
        console.log(`  Tx: ${transfer.tx_hash}`);
        redemptionCount++;
      }
    });

    console.log(`\n\nFound ${redemptionCount} potential redemptions out of ${sampleData.length} sampled transfers`);
  }

  // Step 6: Look for different redemption pattern - check ERC20 transfers FROM CTF contract
  console.log('\n\nStep 6: Looking for USDC transfers FROM CTF contract (redemption payouts)...\n');

  const usdcFromCTF = `
    SELECT
      COUNT(*) as payout_count,
      COUNT(DISTINCT to_address) as unique_recipients,
      SUM(CAST(value AS Float64)) / 1e6 as total_usdc_paid,
      MIN(block_timestamp) as first_payout,
      MAX(block_timestamp) as last_payout
    FROM default.erc20_transfers
    WHERE lower(from_address) = lower('${mainCTF}')
    LIMIT 1
  `;

  const payoutResult = await client.query({ query: usdcFromCTF, format: 'JSONEachRow' });
  const payoutData = await payoutResult.json();
  console.log('USDC transfers FROM CTF contract:');
  console.log(JSON.stringify(payoutData[0], null, 2));

  // Step 7: Sample USDC payouts from CTF
  console.log('\n\nStep 7: Sampling USDC payouts from CTF...\n');

  const samplePayouts = `
    SELECT
      tx_hash,
      from_address,
      to_address as recipient,
      CAST(value AS Float64) / 1e6 as usdc_amount,
      block_timestamp
    FROM default.erc20_transfers
    WHERE lower(from_address) = lower('${mainCTF}')
    ORDER BY block_timestamp DESC
    LIMIT 10
  `;

  const payoutSampleResult = await client.query({ query: samplePayouts, format: 'JSONEachRow' });
  const payoutSampleData = await payoutSampleResult.json();
  console.log('Sample USDC payouts from CTF:');
  payoutSampleData.forEach((p: any, i: number) => {
    console.log(`\n${i + 1}. Payout:`);
    console.log(`   Recipient: ${p.recipient}`);
    console.log(`   Amount: ${p.usdc_amount} USDC`);
    console.log(`   Tx Hash: ${p.tx_hash}`);
    console.log(`   Timestamp: ${p.block_timestamp}`);
  });

  // Step 8: For those payout txs, check for ERC1155 burns/transfers in same tx
  if (payoutSampleData.length > 0) {
    const payoutTxHashes = payoutSampleData.map((p: any) => `'${p.tx_hash}'`).join(',');

    console.log('\n\nStep 8: Checking for ERC1155 transfers in same payout transactions...\n');

    const erc1155InPayoutTx = `
      SELECT
        tx_hash,
        from_address as wallet,
        to_address,
        token_id,
        CAST(value AS Float64) as amount,
        block_timestamp
      FROM default.erc1155_transfers
      WHERE tx_hash IN (${payoutTxHashes})
      ORDER BY block_timestamp DESC
    `;

    const erc1155Result = await client.query({ query: erc1155InPayoutTx, format: 'JSONEachRow' });
    const erc1155Data = await erc1155Result.json();
    console.log(`Found ${erc1155Data.length} ERC1155 transfers in same payout transactions:`);
    erc1155Data.forEach((e: any, i: number) => {
      console.log(`\n${i + 1}. ERC1155 Transfer:`);
      console.log(`   From: ${e.wallet}`);
      console.log(`   To: ${e.to_address}`);
      console.log(`   Token ID: ${e.token_id}`);
      console.log(`   Amount: ${e.amount}`);
      console.log(`   Tx: ${e.tx_hash}`);
    });

    // Step 9: Match redemptions
    console.log('\n\nStep 9: Matching redemptions (ERC1155 → USDC)...\n');

    payoutSampleData.forEach((payout: any) => {
      const matchingERC1155 = erc1155Data.filter((e: any) => e.tx_hash === payout.tx_hash);
      if (matchingERC1155.length > 0) {
        console.log(`\nREDEMPTION CONFIRMED:`);
        console.log(`  Wallet: ${payout.recipient}`);
        console.log(`  Received: ${payout.usdc_amount} USDC`);
        console.log(`  Token movements:`);
        matchingERC1155.forEach((e: any) => {
          console.log(`    ${e.amount} tokens (ID: ${e.token_id}): ${e.wallet} → ${e.to_address}`);
        });
        console.log(`  Tx: ${payout.tx_hash}`);
      }
    });
  }

  await client.close();
}

analyzeRedemptions().catch(console.error);
