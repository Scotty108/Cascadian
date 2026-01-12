/**
 * V28 Random Sample Test - 50 wallets
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV28 } from '../lib/pnl/pnlEngineV28';

const RANDOM_WALLETS = [
  '0x93ccc751edcc228afc60bcebde734ac081b0bdbf',
  '0xddfa3be59b73ede20129c3cf3305749820419aba',
  '0x6e057d8ab144e8cb59357e515139fe7648a79f02',
  '0xc6b82cb2d2be89488bd4e32a5352bb4821fd06c5',
  '0x25c19f0fea284572b9673ce3bf45cb0b806d7a42',
  '0xb0b54f9f70927adb47fad1d22dfd11d4a7e2b005',
  '0x3b83758671d994eb39d4b678defd5ec363b6068d',
  '0x44971b7f7cf519f80b81977fee88f66910e5673e',
  '0x099b2357281f7a59cca6f7df385c4ecbf6720b60',
  '0xe698efc3e2d179ff40e32b02009772e70aa5d100',
  '0x4e0f62d40ec22fe43f922af098ea46fa8c986f1a',
  '0xf939b36877b179e09780966198190815f0d21e8f',
  '0x29d7c7c3cb42c0cc9895d5fd9b62491819e6ac6d',
  '0x694bb3da6fe177c2ac1b668a95d78d0948b91e47',
  '0x5ab3716a411766182ea0d64a24b559bb8b7e4f78',
  '0x873473d4120b150b0678a6ee65ca81afd3984ded',
  '0xaa104951c2a641ec43bde06abb2bc286e624721b',
  '0x931b4ba47921359e4348f4f2d776250e9300d791',
  '0xc3dfec3be546b7187f128f185ef533fa4590e24b',
  '0x6a721f4ed4e67d7b689ba4f59dee2b2c5d12446a',
  '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb',
  '0x56502d017af329ba9d9a796d1e2369b5f3c6ad8f',
  '0x52057290027293cf7fc1639e63bf4c74175e7408',
  '0x6c44f80016a0dcb5b93b234b25ce3d2d728a4c31',
  '0x3a0da452da168c705cf08c4706faa470336d9a88',
  '0x855a494daec234afb8e46c4f8446454712fc09fd',
  '0x56e2aabf3ff90c2cceb8a690443805e8f9e572bb',
  '0x26e146030013538d734bbb046dd91fa4c79a73b8',
  '0xcba74945177aa07b3536c0094b1668b4e6880c46',
  '0x7d87eda02512d7b442214884daf6081dcf84eadc',
  '0x2303dd5f9c5d20b2f0461fd752cef32dcf268682',
  '0x1f8fe54b3fa86cde7b2c1d76635130439508b43a',
  '0x00fd159ba40fc550281d4fe661f01a30af61a304',
  '0xc996a912fa54cd146da024a0fea7444b01047fed',
  '0xd2f24eb6261d0d363e3b9dc5843e9e4ae08405c3',
  '0xb5baec25e5816c48fe7f6e513b856fded7327587',
  '0x7762b15ee1b61cc6d97d0090afa8ba4dfbcf01cd',
  '0xf5b64888f61ac9adc91cb2a998fec41720974429',
  '0xb2e47ce3a2bccb5fbd99201838058962985c5823',
  '0xb52ad2d9bf486fa65db92b5e0f969a1345b77b1b',
  '0x115de038f5809219a0ee09fe92f1cea1bbbcaef4',
  '0x630bf4971842b0dbde489cd0d645b123fe475ddb',
  '0x87830eb7677b157a7285dc69adac4ce0588e9a3b',
  '0x2c62de87e4c370e9d65ef355eabe2a2ab09c09ba',
  '0xfc9cfb29082a9f2405b7dd0ebd0c4892e332deff',
  '0xc9cf37430dbb680f9e8995af9d578321330010f3',
  '0xfca6f4715764646c3baa2ac7a1aff8951b2777a0',
  '0x47e58b72eda8a7840978717170a5471e83392bb1',
  '0x23edf6945c6e28820929adb79c874929916a17ed',
  '0x826194a3eaa7e4f27106281b79b58a5bd98fd341',
];

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = 'https://user-pnl-api.polymarket.com/user-pnl?user_address=' + wallet.toLowerCase();
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

async function runTests() {
  console.log('=== V28 RANDOM 50 WALLET TEST ===\n');

  let passed = 0;
  let failed = 0;
  let apiMissing = 0;
  const results: { wallet: string; v28: number; api: number; diff: number; pct: number; pass: boolean }[] = [];

  for (let i = 0; i < RANDOM_WALLETS.length; i++) {
    const wallet = RANDOM_WALLETS[i];
    try {
      const [v28Result, apiPnl] = await Promise.all([
        getWalletPnLV28(wallet),
        fetchApiPnl(wallet)
      ]);

      if (apiPnl === null) {
        apiMissing++;
        continue;
      }

      const v28Total = v28Result.totalPnl;
      const apiTotal = apiPnl;
      const absDiff = Math.abs(v28Total - apiTotal);
      const pctDiff = apiTotal !== 0 ? (absDiff / Math.abs(apiTotal)) * 100 : (v28Total === 0 ? 0 : 999);
      const match = pctDiff < 10 || absDiff < 5;

      results.push({ wallet, v28: v28Total, api: apiTotal, diff: absDiff, pct: pctDiff, pass: match });

      if (match) passed++;
      else failed++;

      process.stdout.write('\r[' + (i + 1) + '/50] Passed: ' + passed + ', Failed: ' + failed + ', API Missing: ' + apiMissing);
    } catch (error) {
      failed++;
    }
  }

  console.log('\n\n=== SUMMARY ===');
  console.log('Passed: ' + passed + '/' + (passed + failed) + ' (' + ((passed / (passed + failed)) * 100).toFixed(1) + '%)');
  console.log('Failed: ' + failed + '/' + (passed + failed));
  console.log('API Missing: ' + apiMissing);

  // Show worst failures
  const failures = results.filter(r => !r.pass).sort((a, b) => b.diff - a.diff);
  if (failures.length > 0) {
    console.log('\n=== WORST FAILURES ===');
    failures.slice(0, 10).forEach(f => {
      console.log(f.wallet.slice(0, 10) + '... V28=$' + f.v28.toFixed(0) + ' API=$' + f.api.toFixed(0) + ' Diff=$' + f.diff.toFixed(0) + ' (' + f.pct.toFixed(1) + '%)');
    });
  }
}

runTests().catch(console.error);
