#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';
import { ethers } from 'ethers';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function checkBlockchain() {
  console.log('\n🔗 CHECKING BLOCKCHAIN FOR "MISSING" TRANSACTIONS');
  console.log('='.repeat(80));
  
  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';
  
  // Get sample tx_hashes
  const sampleTxs = await client.query({
    query: `
      SELECT DISTINCT transaction_hash
      FROM trades_raw
      WHERE wallet_address = {wallet:String}
        AND transaction_hash NOT IN (
          SELECT DISTINCT tx_hash 
          FROM trades_with_direction 
          WHERE wallet_address = {wallet:String}
        )
        AND transaction_hash != ''
        AND length(transaction_hash) = 66
      LIMIT 10
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const txList: any[] = await sampleTxs.json();
  
  console.log(`\nChecking ${txList.length} sample transactions on Polygon blockchain...\n`);
  
  // Initialize provider
  const provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
  
  let realCount = 0;
  let notFoundCount = 0;
  
  for (const item of txList) {
    const txHash = item.transaction_hash;
    console.log(`Checking ${txHash}...`);
    
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      
      if (receipt) {
        console.log(`  ✅ REAL transaction!`);
        console.log(`     Block: ${receipt.blockNumber}`);
        console.log(`     Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
        console.log(`     Logs: ${receipt.logs.length} events`);
        realCount++;
      } else {
        console.log(`  ❌ Transaction NOT found on blockchain`);
        notFoundCount++;
      }
    } catch (e: any) {
      console.log(`  ⚠️  Error checking: ${e.message}`);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log(`\n📊 Results:`);
  console.log(`   Real transactions: ${realCount}/${txList.length}`);
  console.log(`   Not found: ${notFoundCount}/${txList.length}`);
  
  if (realCount > 0) {
    console.log(`\n🚨 CRITICAL: ${realCount} "missing" transactions ARE REAL!`);
    console.log(`   These need to be recovered from blockchain.`);
    console.log(`   The blockchain backfill SHOULD recover them.`);
  } else {
    console.log(`\n✅ None of the sampled transactions exist on blockchain.`);
    console.log(`   They are phantom records from buggy API import.`);
  }
  
  await client.close();
}

checkBlockchain().catch(console.error);
