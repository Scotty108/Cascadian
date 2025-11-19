#!/usr/bin/env npx tsx
/**
 * Check the actual on-chain ERC-1155 transfer count
 * Compare against our backfill progress
 */

async function main() {
  console.log('\n' + '═'.repeat(100));
  console.log('CHECKING BLOCKCHAIN FOR ACTUAL ERC-1155 TRANSFER COUNT');
  console.log('═'.repeat(100) + '\n');

  // Try The Graph (Polymarket subgraph)
  console.log('1️⃣  Querying The Graph for Polymarket ERC-1155 events...\n');

  try {
    const query = `
      query {
        transferBatchEvents(first: 1, orderBy: blockNumber, orderDirection: desc) {
          id
          blockNumber
          transactionHash
        }
      }
    `;

    const response = await fetch('https://api.thegraph.com/subgraphs/name/polymarket/polymarket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    console.log('   The Graph Response:', JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.log(`   Error querying The Graph: ${e.message}\n`);
  }

  // Try Etherscan API
  console.log('\n2️⃣  Checking Etherscan for ERC-1155 event logs...\n');
  console.log('   To use Etherscan API:');
  console.log('   - Visit: https://etherscan.io/address/0x4D97DCd97eB9015F397158418cab32640A739D6a#events');
  console.log('   - Look for TransferBatch event count');
  console.log('   - Or use API: https://api.etherscan.io/api?module=logs&action=getLogs&address=0x4D97DCd97eB9015F397158418cab32640A739D6a&topic0=0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07ce33e6397d841b9d16230&apikey=YOUR_KEY\n');

  // Comparison
  console.log('═'.repeat(100));
  console.log('CURRENT BACKFILL STATUS');
  console.log('═'.repeat(100) + '\n');
  console.log('Database:       10,179,996 rows (current)');
  console.log('Estimated:      11,000,000 - 13,000,000 rows (your prediction)');
  console.log('\nTo get exact on-chain count:');
  console.log('  1. Check Etherscan: https://etherscan.io/address/0x4D97DCd97eB9015F397158418cab32640A739D6a#events');
  console.log('  2. Filter by "TransferBatch" event');
  console.log('  3. Note the total event count shown');
  console.log('  4. That\'s the actual blockchain count we should reach\n');
}

main().catch(console.error);
