import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || '';

async function getLatestBlock(): Promise<number> {
  const resp = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: []
    })
  });
  const data = await resp.json();
  return parseInt(data.result, 16);
}

async function main() {
  console.log('RPC URL configured:', RPC_URL ? 'Yes' : 'No');
  
  // Step 1: Get current state
  console.log('\n1. Checking ClickHouse...');
  const result = await clickhouse.query({
    query: 'SELECT max(block_number) as max_block FROM pm_erc1155_transfers WHERE is_deleted = 0',
    format: 'JSONEachRow'
  });
  const current = (await result.json() as any[])[0];
  const startBlock = Number(current.max_block) + 1;
  console.log('   Last synced block:', current.max_block);
  console.log('   Will start from:', startBlock);
  
  // Step 2: Get latest block
  console.log('\n2. Getting latest block from RPC...');
  const latestBlock = await getLatestBlock();
  console.log('   Latest chain block:', latestBlock);
  console.log('   Blocks behind:', latestBlock - startBlock);
  
  // Step 3: Test a small fetch
  console.log('\n3. Testing fetch for 100 blocks...');
  const testStart = Date.now();
  const resp = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random(),
      method: 'alchemy_getAssetTransfers',
      params: [{
        fromBlock: '0x' + startBlock.toString(16),
        toBlock: '0x' + (startBlock + 100).toString(16),
        contractAddresses: ['0x4d97dcd97ec945f40cf65f87097ace5ea0476045'],
        category: ['erc1155'],
        maxCount: '0x3e8',
        withMetadata: true,
        excludeZeroValue: false
      }]
    })
  });
  
  const data = await resp.json() as any;
  console.log('   Fetch time:', Date.now() - testStart, 'ms');
  
  if (data.error) {
    console.log('   ERROR:', data.error.message);
  } else {
    console.log('   Transfers found:', data.result?.transfers?.length || 0);
    if (data.result?.transfers?.length > 0) {
      const t = data.result.transfers[0];
      console.log('   Sample timestamp:', t.metadata?.blockTimestamp);
    }
  }
  
  console.log('\nDone!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
