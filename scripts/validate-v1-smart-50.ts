/**
 * V1 Smart Validation - 50 wallets with getWalletPnLWithConfidence
 * Uses smart switching (V1 vs V1+) and confidence flags
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletPnLWithConfidence, PnLResultWithConfidence } from '../lib/pnl/pnlEngineV1';
import * as fs from 'fs';

// Stratified 50-wallet cohort
const COHORT = [
  // maker_heavy (8)
  { wallet: '0x9cd2fe89a32d73b06c5f4c0e56947886788b3f9f', cohort: 'maker_heavy' },
  { wallet: '0x4e3aa655e4ab64f611b33ac51465f9d83efc4cb8', cohort: 'maker_heavy' },
  { wallet: '0xeb71ad2f90a443a4f8ae8812899f96e692fa091d', cohort: 'maker_heavy' },
  { wallet: '0x98fb352a4ddbee7cd112f81f13d80606be6ca26e', cohort: 'maker_heavy' },
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
  { wallet: '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d', cohort: 'taker_heavy' },  // W2
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
  { wallet: '0x1d844fceef195f7ec230c6f816ab0ebe1fc3c5ce', cohort: 'open_positions' },
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
  { wallet: '0x90389ac0cedd49ada33432f3b7aac7a28c9fb34f', cohort: 'ctf_users' },  // Wallet 40
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
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    const data = await res.json();
    return data[data.length - 1]?.p || 0;
  } catch {
    return NaN;
  }
}

interface Result {
  wallet: string;
  cohort: string;
  api: number;
  calculated: number;
  gap: number;
  engine: string;
  confidence: string;
  reasons: string[];
  status: string;
  error?: string;
  diagnostics?: any;
}

async function testWallet(w: { wallet: string; cohort: string }): Promise<Result> {
  try {
    // Get API value first (fast)
    const api = await getApiPnL(w.wallet);

    // Get smart PnL with confidence
    const result = await getWalletPnLWithConfidence(w.wallet);

    const gap = Math.abs(api - result.total);

    // Status based on gap AND confidence
    let status: string;
    if (result.confidence === 'low') {
      status = gap <= 100 ? 'LOW-OK' : 'LOW-FAIL';
    } else if (gap <= 10) {
      status = 'PASS';
    } else if (gap <= 100) {
      status = 'CLOSE';
    } else {
      status = 'FAIL';
    }

    return {
      wallet: w.wallet,
      cohort: w.cohort,
      api: Math.round(api * 100) / 100,
      calculated: Math.round(result.total * 100) / 100,
      gap: Math.round(gap * 100) / 100,
      engine: result.engineUsed,
      confidence: result.confidence,
      reasons: result.confidenceReasons,
      status,
      diagnostics: {
        phantom: result.diagnostics.phantomTokens,
        unexplained: result.diagnostics.unexplainedPhantom,
        negRiskTokens: result.diagnostics.negRiskTokens,
      },
    };
  } catch (e: any) {
    return {
      wallet: w.wallet,
      cohort: w.cohort,
      api: NaN,
      calculated: NaN,
      gap: NaN,
      engine: 'ERR',
      confidence: 'unknown',
      reasons: [e.message?.slice(0, 80)],
      status: 'ERR',
      error: e.message?.slice(0, 80),
    };
  }
}

async function main() {
  const startTime = Date.now();
  const outputFile = `scripts/v1-smart-${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.json`;

  console.log('=== V1 SMART VALIDATION (50 wallets) ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Output: ${outputFile}\n`);

  const results: Result[] = [];
  let completed = 0;

  for (const w of COHORT) {
    const start = Date.now();
    process.stdout.write(`[${++completed}/${COHORT.length}] ${w.cohort.padEnd(15)} ${w.wallet.slice(0, 10)}... `);

    const result = await testWallet(w);
    results.push(result);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const confFlag = result.confidence === 'low' ? '⚠️ ' : result.confidence === 'medium' ? '⚡' : '✓';
    console.log(`${result.status.padEnd(8)} (${elapsed}s) Gap=$${result.gap} ${result.engine} ${confFlag}`);

    // Save incrementally
    fs.writeFileSync(outputFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      completed,
      total: COHORT.length,
      results
    }, null, 2));
  }

  // Summary
  const valid = results.filter(r => r.status !== 'ERR');
  const pass = valid.filter(r => r.status === 'PASS').length;
  const close = valid.filter(r => r.status === 'CLOSE').length;
  const fail = valid.filter(r => r.status === 'FAIL').length;
  const lowOk = valid.filter(r => r.status === 'LOW-OK').length;
  const lowFail = valid.filter(r => r.status === 'LOW-FAIL').length;
  const errors = results.filter(r => r.status === 'ERR').length;

  const highConf = valid.filter(r => r.confidence === 'high');
  const highConfPass = highConf.filter(r => r.gap <= 10).length;

  console.log('\n=== SUMMARY ===');
  console.log(`PASS (≤$10, high/med conf): ${pass}/${valid.length}`);
  console.log(`CLOSE (≤$100): ${close}/${valid.length}`);
  console.log(`FAIL (>$100): ${fail}/${valid.length}`);
  console.log(`LOW-OK (low conf, ≤$100): ${lowOk}/${valid.length}`);
  console.log(`LOW-FAIL (low conf, >$100): ${lowFail}/${valid.length}`);
  console.log(`ERRORS: ${errors}`);
  console.log('');
  console.log(`HIGH CONFIDENCE accuracy: ${highConfPass}/${highConf.length} (${(highConfPass/highConf.length*100).toFixed(1)}%)`);
  console.log('');

  // Engine usage
  const v1Count = valid.filter(r => r.engine === 'V1').length;
  const v1PlusCount = valid.filter(r => r.engine === 'V1+').length;
  console.log(`Engine usage: V1=${v1Count}, V1+=${v1PlusCount}`);

  console.log(`\nCompleted in ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
  console.log(`Results saved to: ${outputFile}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
