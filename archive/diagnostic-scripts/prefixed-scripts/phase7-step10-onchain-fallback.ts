import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { writeFileSync } from 'fs';

// Polymarket CTF contract on Polygon
const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const RPC_URL = process.env.POLYGON_RPC_URL;

const MISSING_CTFS = [
  '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
  '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
  '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
  '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
  '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
];

// ConditionResolved event signature
// event ConditionResolved(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount, uint[] payoutNumerators)
const CONDITION_RESOLVED_TOPIC = '0xbf3f493c772c8c1c34f5f4c0f8b349ce0c8f0e9e9b72981e4548e2820d7d96e7';

interface ResolutionEvent {
  conditionId: string;
  outcomeSlotCount: number;
  payoutNumerators: string[];
  blockNumber: number;
  blockTimestamp?: number;
  transactionHash: string;
}

async function queryRPC(method: string, params: any[]): Promise<any> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return data.result;
}

async function getBlockTimestamp(blockNumber: number): Promise<number> {
  const block = await queryRPC('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]);
  return parseInt(block.timestamp, 16);
}

async function queryConditionResolved(conditionId: string): Promise<ResolutionEvent | null> {
  console.log(`   Querying on-chain events for ${conditionId.substring(0, 20)}...`);

  // Query logs with conditionId as indexed parameter
  const logs = await queryRPC('eth_getLogs', [{
    address: CTF_CONTRACT,
    topics: [
      CONDITION_RESOLVED_TOPIC,
      `0x${conditionId}` // First indexed parameter
    ],
    fromBlock: '0x0', // From genesis
    toBlock: 'latest'
  }]);

  if (!logs || logs.length === 0) {
    console.log('   ❌ No resolution event found');
    return null;
  }

  const log = logs[0]; // Take first (should only be one)
  console.log(`   ✅ Found event in block ${parseInt(log.blockNumber, 16)}`);

  // Decode event data
  // The non-indexed parameters are in data: outcomeSlotCount (uint256) + payoutNumerators (uint256[])
  const data = log.data.slice(2); // Remove 0x

  // First 32 bytes = outcomeSlotCount
  const outcomeSlotCount = parseInt(data.slice(0, 64), 16);
  console.log(`   Outcome slots: ${outcomeSlotCount}`);

  // Remaining bytes = array encoding
  // Next 32 bytes = offset to array (should be 0x20 = 32)
  // Next 32 bytes = array length
  const arrayLength = parseInt(data.slice(64 + 64, 64 + 64 + 64), 16);
  console.log(`   Payout array length: ${arrayLength}`);

  // Next arrayLength * 32 bytes = array elements
  const payoutNumerators: string[] = [];
  for (let i = 0; i < arrayLength; i++) {
    const offset = 64 + 64 + 64 + (i * 64);
    const value = data.slice(offset, offset + 64);
    payoutNumerators.push(parseInt(value, 16).toString());
  }

  console.log(`   Payouts: [${payoutNumerators.join(', ')}]`);

  const blockNumber = parseInt(log.blockNumber, 16);
  const blockTimestamp = await getBlockTimestamp(blockNumber);
  const date = new Date(blockTimestamp * 1000);
  console.log(`   Block timestamp: ${date.toISOString()}`);

  return {
    conditionId,
    outcomeSlotCount,
    payoutNumerators,
    blockNumber,
    blockTimestamp,
    transactionHash: log.transactionHash
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.10: ON-CHAIN RESOLUTION FALLBACK');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`RPC endpoint: ${RPC_URL}`);
  console.log(`CTF contract: ${CTF_CONTRACT}\n`);

  console.log('Querying ConditionResolved events for 5 missing CTFs...\n');

  const results: ResolutionEvent[] = [];
  const notFound: string[] = [];

  for (const ctfId of MISSING_CTFS) {
    console.log(`\n[${ctfId.substring(0, 20)}...]`);

    try {
      const event = await queryConditionResolved(ctfId);

      if (event) {
        results.push(event);
      } else {
        notFound.push(ctfId);
      }

      // Rate limit
      await new Promise(res => setTimeout(res, 500));

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      notFound.push(ctfId);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('ON-CHAIN RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Found resolutions: ${results.length} / ${MISSING_CTFS.length}`);
  console.log(`   Not found: ${notFound.length}\n`);

  if (results.length > 0) {
    console.log('✅ Resolved conditions:\n');

    results.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.conditionId.substring(0, 20)}...`);
      console.log(`      Payouts: [${r.payoutNumerators.join(', ')}]`);
      console.log(`      Slots: ${r.outcomeSlotCount}`);

      // Calculate PPS
      const payoutNums = r.payoutNumerators.map(p => parseFloat(p));
      const sum = payoutNums.reduce((a, b) => a + b, 0);
      const pps = payoutNums.map(p => (p / sum).toFixed(4));
      console.log(`      PPS: [${pps.join(', ')}]`);

      if (r.blockTimestamp) {
        const date = new Date(r.blockTimestamp * 1000);
        console.log(`      Resolved: ${date.toISOString()}`);
      }

      console.log(`      Tx: ${r.transactionHash}`);
      console.log();
    });

    // Save results
    const output = {
      fetched_at: new Date().toISOString(),
      source: 'polygon_blockchain',
      contract: CTF_CONTRACT,
      conditions: results
    };

    writeFileSync(
      'tmp/phase7-onchain-resolutions.json',
      JSON.stringify(output, null, 2)
    );

    console.log('   ✅ Saved to tmp/phase7-onchain-resolutions.json\n');
  }

  if (notFound.length > 0) {
    console.log('⚠️  Not found on-chain:\n');

    notFound.forEach((ctf, i) => {
      console.log(`   ${i + 1}. ${ctf.substring(0, 20)}...`);
    });

    console.log('\n   These conditions may be:');
    console.log('   - Test markets (never resolved)');
    console.log('   - Very old markets (before CTF v2)');
    console.log('   - Invalid condition IDs');
    console.log('   - Markets using different oracle contracts\n');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Total queried: ${MISSING_CTFS.length}`);
  console.log(`   Resolved: ${results.length}`);
  console.log(`   Not found: ${notFound.length}\n`);

  if (results.length > 0) {
    const sharesMap = {
      '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48': 6109,
      '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af': 3359,
      '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb': 2000,
      '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22': 1223,
      '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e': 1000
    };

    const totalValue = results.reduce((sum, r) => {
      const shares = sharesMap[r.conditionId] || 0;
      const payoutNums = r.payoutNumerators.map(p => parseFloat(p));
      const sumPayouts = payoutNums.reduce((a, b) => a + b, 0);
      const maxPayout = Math.max(...payoutNums);
      const pps = maxPayout / sumPayouts;

      return sum + (shares * pps);
    }, 0);

    console.log(`   Estimated recoverable value: $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

    console.log('   Next steps:');
    console.log('   1. Insert resolutions: npx tsx phase7-step11-insert-resolutions.ts');
    console.log('   2. Rebuild PPS: npx tsx phase3-rebuild-pps.ts');
    console.log('   3. Rebuild burns: npx tsx phase4-burns-valuation.ts');
    console.log('   4. Validate final P&L\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
