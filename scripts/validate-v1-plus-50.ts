/**
 * V1+ Validation Script - Test on stratified 50-wallet cohort
 *
 * Tests both V1 and V1+ on our stratified cohort covering:
 * - maker_heavy
 * - taker_heavy
 * - mixed
 * - open_positions
 * - ctf_users
 * - random
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletPnLV1, getWalletPnLV1Plus, getNegRiskConversionCount } from '../lib/pnl/pnlEngineV1';

// Stratified 50-wallet cohort from validation-50-2026-01-11T23-14-39-820Z.json
const COHORT = [
  // maker_heavy (8)
  { wallet: '0x9cd2fe89a32d73b06c5f4c0e56947886788b3f9f', cohort: 'maker_heavy' },
  { wallet: '0x4e3aa655e4ab64f611b33ac51465f9d83efc4cb8', cohort: 'maker_heavy' },
  { wallet: '0xeb71ad2f90a443a4f8ae8812899f96e692fa091d', cohort: 'maker_heavy' },
  { wallet: '0x98fb352a4ddbee7cd112f81f13d80606be6ca26e', cohort: 'maker_heavy' }, // W1 problem wallet
  { wallet: '0x183b63e70df38cecc35f0cdf6084cdb1b9fa9734', cohort: 'maker_heavy' },
  { wallet: '0x80304bec6d3bebcf8928fd45cce9e03a02aa03f4', cohort: 'maker_heavy' },
  { wallet: '0x7ab3d29b907310a344b1b09b85f9bfecd00e9e47', cohort: 'maker_heavy' },
  { wallet: '0x093f608f05d94e3daa2c77080cf1730433b1923d', cohort: 'maker_heavy' },

  // taker_heavy (8)
  { wallet: '0x714586cb6aa46307506ccda2fc0bc8da413289e6', cohort: 'taker_heavy' },
  { wallet: '0xac48889c65afb64279f12ee3386c0986ba8ab40c', cohort: 'taker_heavy' },
  { wallet: '0xf4a582ecca92129a027a4cbeda38034bdafe31ce', cohort: 'taker_heavy' },
  { wallet: '0x9188d94341cd726b5be3cc72131b366fa16bd309', cohort: 'taker_heavy' },
  { wallet: '0x736af40540b885bef025f220d65cbddd9486afb5', cohort: 'taker_heavy' },
  { wallet: '0x9d5b1a37d2c0529cf15f9cbb6634d938a9abd077', cohort: 'taker_heavy' },
  { wallet: '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d', cohort: 'taker_heavy' }, // W2 problem wallet
  { wallet: '0x3fc5cdc99b2cdc963b892cd99e5572896b0d5cc9', cohort: 'taker_heavy' },

  // mixed (8)
  { wallet: '0x166fa2ce4f98549d1121d57e4e7a0cdae6178f0e', cohort: 'mixed' },
  { wallet: '0x41dbc9f8a430e678ec2978fe356cba2352c5eeaf', cohort: 'mixed' },
  { wallet: '0xfaa40093c0daca3cd803361c4a37c5be558fe8a1', cohort: 'mixed' },
  { wallet: '0x060be258adfbcad181714bc4c6e2f26180a013c6', cohort: 'mixed' },
  { wallet: '0xb633ca1967c788df37f7ec8331fad1ad027e34d5', cohort: 'mixed' },
  { wallet: '0x68973ae36a135ad2bf3906d120c9b9524b0b1906', cohort: 'mixed' },
  { wallet: '0x61220b1e37f60e84a5e88900f07163e1d23eee7c', cohort: 'mixed' },
  { wallet: '0xe213171d6c85c4988073eae7ae223857f3323be9', cohort: 'mixed' },

  // open_positions (10)
  { wallet: '0x076c8d71c3244b933648aaff8797f23901cb7ffb', cohort: 'open_positions' },
  { wallet: '0xe27e606408aa03b77c56ab44893dbeec6e4f5ae8', cohort: 'open_positions' },
  { wallet: '0xac69f2f03981a3919bf60522878a6be9e4c365ec', cohort: 'open_positions' },
  { wallet: '0xfbcc4b14592adb4f85629f125110c60e298c09cc', cohort: 'open_positions' },
  { wallet: '0xe272a0fb66749a547d9fb829f430d94f0a47edde', cohort: 'open_positions' },
  { wallet: '0x1d844fceef195f7ec230c6f816ab0ebe1fc3c5ce', cohort: 'open_positions' }, // W3 problem wallet
  { wallet: '0xf862af826f0fa15327381b84f737153cc7e83127', cohort: 'open_positions' },
  { wallet: '0x2e07191ce0f0ed1158236db1e7786f235c4b4741', cohort: 'open_positions' },
  { wallet: '0xcfff54418d7b59de0129eaa171c6470d6ec9a76a', cohort: 'open_positions' },
  { wallet: '0xfb0ee016af4f08c63ac3e45d9335cd4820c6ca40', cohort: 'open_positions' },

  // ctf_users (8)
  { wallet: '0xbf7423436d727c94b1337ac3d84dba3b1069c2ec', cohort: 'ctf_users' },
  { wallet: '0x06c358af640b541664d0a58b5b5e5186cd449487', cohort: 'ctf_users' },
  { wallet: '0x2cad2f963f17d5258ab31b71bac4f32cdaad3520', cohort: 'ctf_users' },
  { wallet: '0xb5bd07658c6fb475c6f20911b6011338578a39ce', cohort: 'ctf_users' },
  { wallet: '0x2ff0f4d709922a203d5aa321ae9095c8875f8f87', cohort: 'ctf_users' },
  { wallet: '0x90389ac0cedd49ada33432f3b7aac7a28c9fb34f', cohort: 'ctf_users' },
  { wallet: '0xd1d83b5801cebc047a56e758d28da8f9c0d5184a', cohort: 'ctf_users' },
  { wallet: '0x6aea309a0b468bf8bbc7b0143dceba914124e2cd', cohort: 'ctf_users' },

  // random (8)
  { wallet: '0x2ef60f6f342f96ab569914e078954e3a9532e1d8', cohort: 'random' },
  { wallet: '0x6a31595989176ac4e4fb72c9ce2da63d0b97a21e', cohort: 'random' },
  { wallet: '0x72b5b0adcf6677ce497482ca311d65db410c7946', cohort: 'random' },
  { wallet: '0x4fd967834bb9b2fa44b81a45b9a8f6a4cab79451', cohort: 'random' },
  { wallet: '0xd57f8dc9e23c3fe639f79b480a77e9106c0e7fe8', cohort: 'random' },
  { wallet: '0x29569f0b4f45abcd610579dc9f6d4499cd5ad31b', cohort: 'random' },
  { wallet: '0x59207e5ef030c97ecb9e9d1299ed54b4753af9a3', cohort: 'random' },
  { wallet: '0x81b1711c4b7e3b4342e6ecdbd596ede4babc80bc', cohort: 'random' },
];

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://data-api.polymarket.com/value?user=${wallet}`);
    const data = await res.json();
    return data.pnl || 0;
  } catch {
    return NaN;
  }
}

interface Result {
  wallet: string;
  cohort: string;
  nrCount: number;
  api: number;
  v1: number;
  v1plus: number;
  v1Gap: number;
  v1pGap: number;
  winner: string;
  status: string;
}

async function testWallet(w: { wallet: string; cohort: string }): Promise<Result> {
  try {
    const [nrCount, v1, v1plus, api] = await Promise.all([
      getNegRiskConversionCount(w.wallet),
      getWalletPnLV1(w.wallet),
      getWalletPnLV1Plus(w.wallet),
      getApiPnL(w.wallet),
    ]);

    const v1Gap = Math.abs(api - v1.total);
    const v1pGap = Math.abs(api - v1plus.total);
    const winner = v1pGap < v1Gap ? 'V1+' : (v1pGap > v1Gap ? 'V1' : 'TIE');
    const status = Math.min(v1Gap, v1pGap) <= 10 ? 'PASS' : (Math.min(v1Gap, v1pGap) <= 100 ? 'CLOSE' : 'FAIL');

    return {
      wallet: w.wallet.slice(0, 10) + '...',
      cohort: w.cohort,
      nrCount,
      api: Math.round(api),
      v1: Math.round(v1.total),
      v1plus: Math.round(v1plus.total),
      v1Gap: Math.round(v1Gap),
      v1pGap: Math.round(v1pGap),
      winner,
      status,
    };
  } catch (e) {
    return {
      wallet: w.wallet.slice(0, 10) + '...',
      cohort: w.cohort,
      nrCount: -1,
      api: NaN,
      v1: NaN,
      v1plus: NaN,
      v1Gap: NaN,
      v1pGap: NaN,
      winner: 'ERR',
      status: 'ERR',
    };
  }
}

async function main() {
  console.log('=== V1+ VALIDATION: Stratified 50-Wallet Cohort ===\n');
  console.log(`Total wallets: ${COHORT.length}`);
  console.log(`Cohorts: maker_heavy(8), taker_heavy(8), mixed(8), open_positions(10), ctf_users(8), random(8)\n`);

  const results: Result[] = [];
  let completed = 0;

  for (const w of COHORT) {
    process.stdout.write(`[${++completed}/${COHORT.length}] ${w.cohort} ${w.wallet.slice(0, 10)}... `);
    const r = await testWallet(w);
    console.log(`NR=${r.nrCount} ${r.status}`);
    results.push(r);
  }

  console.log('\n');
  console.table(results);

  // Summary by cohort
  const cohorts = [...new Set(COHORT.map(c => c.cohort))];
  console.log('\n=== SUMMARY BY COHORT ===');

  for (const cohort of cohorts) {
    const cohortResults = results.filter(r => r.cohort === cohort && r.winner !== 'ERR');
    const v1Wins = cohortResults.filter(r => r.winner === 'V1').length;
    const v1pWins = cohortResults.filter(r => r.winner === 'V1+').length;
    const ties = cohortResults.filter(r => r.winner === 'TIE').length;
    const pass = cohortResults.filter(r => r.status === 'PASS').length;
    const nrCount = cohortResults.reduce((sum, r) => sum + r.nrCount, 0);
    console.log(`${cohort.padEnd(15)}: V1=${v1Wins} V1+=${v1pWins} TIE=${ties} | PASS=${pass}/${cohortResults.length} | NR_total=${nrCount}`);
  }

  // Overall summary
  const valid = results.filter(r => r.winner !== 'ERR');
  const v1Wins = valid.filter(r => r.winner === 'V1').length;
  const v1pWins = valid.filter(r => r.winner === 'V1+').length;
  const ties = valid.filter(r => r.winner === 'TIE').length;
  const v1Pass = valid.filter(r => r.v1Gap <= 10).length;
  const v1pPass = valid.filter(r => r.v1pGap <= 10).length;
  const totalNR = valid.reduce((sum, r) => sum + r.nrCount, 0);
  const nrWallets = valid.filter(r => r.nrCount > 0).length;

  console.log('\n=== OVERALL ===');
  console.log(`Winners: V1=${v1Wins}, V1+=${v1pWins}, TIE=${ties}`);
  console.log(`Within $10: V1=${v1Pass}/${valid.length} (${(v1Pass/valid.length*100).toFixed(1)}%), V1+=${v1pPass}/${valid.length} (${(v1pPass/valid.length*100).toFixed(1)}%)`);
  console.log(`NegRisk: ${nrWallets}/${valid.length} wallets have NR activity, total ${totalNR} conversions`);

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: valid.length,
      v1Wins,
      v1pWins,
      ties,
      v1PassRate: v1Pass / valid.length,
      v1pPassRate: v1pPass / valid.length,
      nrWallets,
      totalNRConversions: totalNR,
    },
  };

  const fs = await import('fs');
  const filename = `scripts/v1plus-validation-${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.json`;
  fs.writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${filename}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
