import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

const GOLDSKY_ENDPOINT = 'https://api.goldsky.com/api/public/project_clz7i86vs0xpi01we6h8qdss6/subgraphs/polymarket-ctf/1.0.0/gn';

const MISSING_CTFS = [
  '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
  '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
  '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
  '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
  '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
];

interface ConditionData {
  id: string;
  conditionId: string;
  payouts: string[];
  outcomeSlotCount: number;
  resolved: boolean;
  resolutionTimestamp?: string;
}

async function queryGoldsky(conditionId: string): Promise<any> {
  const query = `
    query GetCondition($id: ID!) {
      condition(id: $id) {
        id
        conditionId
        outcomeSlotCount
        payouts
        resolved
        resolutionTimestamp
      }
    }
  `;

  const response = await fetch(GOLDSKY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { id: conditionId }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.9: GOLDSKY PAYOUT FETCH');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Querying Goldsky for 5 missing CTF IDs...\n');

  const results: ConditionData[] = [];
  const notFound: string[] = [];

  for (const ctfId of MISSING_CTFS) {
    console.log(`\n[${ctfId.substring(0, 20)}...]`);

    try {
      const data = await queryGoldsky(ctfId);

      if (data.errors) {
        console.log(`   ❌ GraphQL errors: ${JSON.stringify(data.errors)}`);
        notFound.push(ctfId);
        continue;
      }

      if (!data.data?.condition) {
        console.log('   ❌ Not found in Goldsky');
        notFound.push(ctfId);
        continue;
      }

      const condition = data.data.condition;

      console.log(`   ✅ Found in Goldsky`);
      console.log(`   Condition ID: ${condition.conditionId}`);
      console.log(`   Resolved: ${condition.resolved}`);
      console.log(`   Outcome slots: ${condition.outcomeSlotCount}`);

      if (condition.payouts) {
        console.log(`   Payouts: [${condition.payouts.join(', ')}]`);
      } else {
        console.log(`   Payouts: null (unresolved)`);
      }

      if (condition.resolutionTimestamp) {
        const date = new Date(Number(condition.resolutionTimestamp) * 1000);
        console.log(`   Resolved at: ${date.toISOString()}`);
      }

      if (condition.resolved && condition.payouts) {
        results.push({
          id: ctfId,
          conditionId: condition.conditionId,
          payouts: condition.payouts,
          outcomeSlotCount: condition.outcomeSlotCount,
          resolved: condition.resolved,
          resolutionTimestamp: condition.resolutionTimestamp
        });
      } else {
        console.log('   ⚠️  Not resolved yet');
        notFound.push(ctfId);
      }

      // Rate limit
      await new Promise(res => setTimeout(res, 1000));

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      notFound.push(ctfId);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('GOLDSKY RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Found with payouts: ${results.length} / ${MISSING_CTFS.length}`);
  console.log(`   Not found or unresolved: ${notFound.length}\n`);

  if (results.length > 0) {
    console.log('✅ Resolved conditions:\n');

    results.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.id.substring(0, 20)}...`);
      console.log(`      Condition ID: ${r.conditionId}`);
      console.log(`      Payouts: [${r.payouts.join(', ')}]`);
      console.log(`      Slots: ${r.outcomeSlotCount}`);

      // Calculate PPS
      const payoutNums = r.payouts.map(p => parseFloat(p));
      const sum = payoutNums.reduce((a, b) => a + b, 0);
      const pps = payoutNums.map(p => (p / sum).toFixed(4));
      console.log(`      PPS: [${pps.join(', ')}]`);

      if (r.resolutionTimestamp) {
        const date = new Date(Number(r.resolutionTimestamp) * 1000);
        console.log(`      Resolved: ${date.toISOString()}`);
      }

      console.log();
    });

    // Save results
    const output = {
      fetched_at: new Date().toISOString(),
      source: 'goldsky_ctf_subgraph',
      conditions: results
    };

    writeFileSync(
      'tmp/phase7-goldsky-payouts.json',
      JSON.stringify(output, null, 2)
    );

    console.log('   ✅ Saved to tmp/phase7-goldsky-payouts.json\n');
  }

  if (notFound.length > 0) {
    console.log('⚠️  Not found or unresolved:\n');

    notFound.forEach((ctf, i) => {
      console.log(`   ${i + 1}. ${ctf.substring(0, 20)}...`);
    });

    console.log();
    console.log('   Next: Try on-chain ConditionResolved events');
    console.log('   Run: npx tsx phase7-step10-onchain-fallback.ts\n');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Total queried: ${MISSING_CTFS.length}`);
  console.log(`   Resolved: ${results.length}`);
  console.log(`   Unresolved/Not found: ${notFound.length}\n`);

  if (results.length > 0) {
    const totalValue = results.reduce((sum, r) => {
      // Get shares from target list
      const sharesMap = {
        '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48': 6109,
        '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af': 3359,
        '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb': 2000,
        '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22': 1223,
        '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e': 1000
      };

      const shares = sharesMap[r.id] || 0;
      const payoutNums = r.payouts.map(p => parseFloat(p));
      const sumPayouts = payoutNums.reduce((a, b) => a + b, 0);
      const maxPayout = Math.max(...payoutNums);
      const pps = maxPayout / sumPayouts;

      return sum + (shares * pps);
    }, 0);

    console.log(`   Estimated recoverable value: $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

    console.log('   Next steps:');
    console.log('   1. Insert payouts: npx tsx phase7-step11-insert-payouts.ts');
    console.log('   2. Rebuild PPS: npx tsx phase3-rebuild-pps.ts');
    console.log('   3. Rebuild burns: npx tsx phase4-burns-valuation.ts');
    console.log('   4. Validate results\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
