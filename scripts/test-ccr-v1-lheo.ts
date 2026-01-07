/**
 * Test CCR-v1 on Lheo wallet and compare to V6 ledger
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

const WALLET = '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61';
const V6_CLOB_PNL = 580.13; // From our validated TX-level
const V6_FULL_PNL = 1437.17; // From V6 with redemptions

async function main() {
  console.log('Testing CCR-v1 on Lheo wallet\n');
  console.log(`Wallet: ${WALLET}`);
  console.log('='.repeat(60));

  const result = await computeCCRv1(WALLET);

  console.log('\nRaw result:', JSON.stringify(result, null, 2));

  // Use snake_case as in the result object
  const realizedPnL = result.realized_pnl ?? 0;
  const unrealizedPnL = result.unrealized_pnl ?? 0;
  const totalPnL = result.total_pnl ?? 0;
  const split = result.ctf_split_tokens ?? 0;
  const merge = result.ctf_merge_tokens ?? 0;
  const redemption = result.ctf_redemption_tokens ?? 0;

  console.log('\nCCR-v1 Results:');
  console.log(`  Realized PnL: $${realizedPnL.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${unrealizedPnL.toFixed(2)}`);
  console.log(`  Total PnL: $${totalPnL.toFixed(2)}`);

  console.log('\nCTF Events:');
  console.log(`  Split: $${split.toFixed(2)}`);
  console.log(`  Merge: $${merge.toFixed(2)}`);
  console.log(`  Redemption: $${redemption.toFixed(2)}`);

  console.log('\nComparison:');
  console.log(`  V6 CLOB-only PnL: $${V6_CLOB_PNL.toFixed(2)}`);
  console.log(`  V6 Full PnL: $${V6_FULL_PNL.toFixed(2)}`);
  console.log(`  CCR-v1 Total: $${totalPnL.toFixed(2)}`);
  console.log(`  Delta vs V6 CLOB: $${(totalPnL - V6_CLOB_PNL).toFixed(2)} (${((totalPnL - V6_CLOB_PNL) / V6_CLOB_PNL * 100).toFixed(1)}%)`);
  console.log(`  Delta vs V6 Full: $${(totalPnL - V6_FULL_PNL).toFixed(2)} (${((totalPnL - V6_FULL_PNL) / V6_FULL_PNL * 100).toFixed(1)}%)`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
