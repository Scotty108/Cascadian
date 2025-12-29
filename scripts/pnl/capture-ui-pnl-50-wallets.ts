/**
 * Capture UI PnL for 50 Benchmark Wallets
 *
 * Generates a template JSON file with the 50 benchmark wallets.
 * User should manually fill in UI PnL values from polymarket.com.
 *
 * Usage:
 *   npx tsx scripts/pnl/capture-ui-pnl-50-wallets.ts
 *
 * This creates: data/pnl/ui_benchmarks_50_wallets_YYYYMMDD.json
 * Then manually edit that file to add UI PnL values, and run:
 *   npx tsx scripts/pnl/seed-ui-benchmarks-from-file.ts data/pnl/ui_benchmarks_50_wallets_YYYYMMDD.json
 */

import * as fs from 'fs';
import * as path from 'path';

// The canonical 50 wallet list
const WALLET_LIST = [
  // Fresh UI batch
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', note: 'Small profit' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', note: 'Small loss' },
  { wallet: '0xb0adc6b10fad31c5f039dc2bc909cda1e10c29c6', note: 'Fresh UI' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', note: 'Medium profit' },
  { wallet: '0x114d7a8e7a1dd2dde555744a432ddcb871454c92', note: 'Fresh UI' },
  { wallet: '0xa7cfafa0db244f760436fcf83c8b1eb98904ba10', note: 'Fresh UI' },
  { wallet: '0x18f343d8f03234321dbddd237e069b26aa45c87a', note: 'Fresh UI' },
  { wallet: '0xbb49c8d518f71db91f7a0a61bc8a29d3364355bf', note: 'Fresh UI' },
  { wallet: '0x8672768b9fadf29d8ad810ae2966d4e89e9ad2c1', note: 'Fresh UI' },
  { wallet: '0x3c3c46c1442ddbafce15a0097d2f5a0f4d797d32', note: 'Fresh UI' },
  { wallet: '0x71e96aad0fa2e55d7428bf46dfb2ee8978673d26', note: 'Fresh UI' },
  { wallet: '0x4aec7657999ede3ba3a2f9c53f550cb7f1274508', note: 'Fresh UI' },
  { wallet: '0x99f8d8bad56ed2541d64fbbc3fc6c71873a17dd5', note: 'Fresh UI' },
  { wallet: '0x7da9710476bf0d83239fcc1b306ee592aa563279', note: 'Fresh UI' },
  { wallet: '0x12c879cf99ec301cd144839e798dc87e9c2e4a62', note: 'Fresh UI' },
  { wallet: '0xa6e3af9b0baa3c39ad918e3600ebe507d8055893', note: 'Fresh UI' },
  { wallet: '0x7ea09d2d4e8fe05f748c1a7f553d90582b093583', note: 'Fresh UI' },
  { wallet: '0x4eae829a112298efa38f4e66cc5a58787f4a9b12', note: 'Fresh UI' },
  { wallet: '0x89915ad00d26caf10c642b0858d9cc527db835bf', note: 'Fresh UI' },
  { wallet: '0xbc51223c95844063d31a71dd64e169df5b42f26c', note: 'Fresh UI' },

  // Smart money batch
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', note: 'Smart Money 1' },
  { wallet: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', note: 'Smart Money' },
  { wallet: '0x1f0a343513aa6060488fabe96960e6d1e177f7aa', note: 'Smart Money' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', note: 'Smart Money 2' },
  { wallet: '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed', note: 'Smart Money' },
  { wallet: '0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f', note: 'Smart Money' },
  { wallet: '0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37', note: 'Smart Money' },
  { wallet: '0x12d6cccfc766d3c43a8f7fddb17ee10c5e47a5ed', note: 'Smart Money' },
  { wallet: '0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db', note: 'Smart Money' },
  { wallet: '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', note: 'Smart Money' },
  { wallet: '0x662244931c16cb1e6c72d91f26cc1b2af0d25b06', note: 'Smart Money' },
  { wallet: '0x2e0b70d482e6b389e81dea528be57d825dd48070', note: 'Smart Money' },
  { wallet: '0x3b6fd06a5915ab90d01b052b6937f4eb7ffa1c07', note: 'Smart Money' },
  { wallet: '0xd748c701ad93cfec32a3420e10f3b08e68612125', note: 'Smart Money' },
  { wallet: '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397', note: 'Smart Money' },
  { wallet: '0xd06f0f7719df1b3b75b607923536b3250825d4a6', note: 'Smart Money' },
  { wallet: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', note: 'Smart Money' },
  { wallet: '0xeb6f0a13ea3f0eb8fb8c5d45c703cbf74d0d2f34', note: 'Smart Money' },
  { wallet: '0x7f3c8979d0afa00007bae4747d5347122af05613', note: 'Smart Money' },
  { wallet: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', note: 'Smart Money' },
  { wallet: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', note: 'Smart Money' },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', note: 'Smart Money' },
  { wallet: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', note: 'Smart Money' },

  // Additional wallets
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', note: 'Theo NegRisk' },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', note: 'Fresh UI' },
  { wallet: '0x418db17eaab13c6bfef00e3e9c66f60e54f7f546', note: 'Fresh UI' },
  { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', note: 'Sign flip case' },
  { wallet: '0xeab03de44f5a2f33e5e8ea9f5c09c8f31b4b5ae7', note: 'Fresh UI' },
  { wallet: '0x7dca4d9f31fc38db98c7feebea9e0c8be1b39a71', note: 'Fresh UI' },
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', note: 'Theo4 whale' },
];

function main() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
  const filename = `ui_benchmarks_50_wallets_${dateStr}.json`;
  const filepath = path.join(process.cwd(), 'data', 'pnl', filename);

  console.log('='.repeat(100));
  console.log('CAPTURE UI PNL - 50 BENCHMARK WALLETS');
  console.log('='.repeat(100));
  console.log('');
  console.log('This script generates a template JSON file.');
  console.log('You need to manually visit each wallet on polymarket.com and record the PnL.');
  console.log('');

  // Generate template
  const template = {
    metadata: {
      benchmark_set: `50_wallet_v2_${dateStr}`,
      source: 'polymarket_ui_manual',
      captured_at: today.toISOString(),
      notes: `Fresh UI PnL values captured on ${today.toISOString().split('T')[0]}. Manually collected from polymarket.com profile pages.`,
    },
    wallets: WALLET_LIST.map((w) => ({
      wallet: w.wallet,
      ui_pnl: 0, // PLACEHOLDER - fill in manually
      note: w.note,
    })),
  };

  // Write file
  fs.writeFileSync(filepath, JSON.stringify(template, null, 2));

  console.log(`Template written to: ${filepath}`);
  console.log('');
  console.log('NEXT STEPS:');
  console.log('-'.repeat(100));
  console.log('1. Open the JSON file in your editor');
  console.log('2. For each wallet, visit: https://polymarket.com/profile/<wallet>');
  console.log('3. Record the "Profit" value shown on their profile');
  console.log('4. Update the "ui_pnl" field for each wallet');
  console.log('5. Run the seed script:');
  console.log(`   npx tsx scripts/pnl/seed-ui-benchmarks-from-file.ts ${filepath}`);
  console.log('6. Test against the new benchmarks:');
  console.log(`   npx tsx scripts/pnl/test-v17-from-benchmark-table.ts 50_wallet_v2_${dateStr}`);
  console.log('');

  // Print helper table
  console.log('WALLET LIST FOR MANUAL CAPTURE:');
  console.log('-'.repeat(100));
  console.log('# | Wallet                                      | Note            | Polymarket URL');
  console.log('-'.repeat(100));

  for (let i = 0; i < WALLET_LIST.length; i++) {
    const w = WALLET_LIST[i];
    const url = `https://polymarket.com/profile/${w.wallet}`;
    console.log(`${(i + 1).toString().padStart(2)} | ${w.wallet} | ${w.note.padEnd(15)} | ${url}`);
  }

  console.log('-'.repeat(100));
  console.log('');
  console.log('='.repeat(100));
  console.log('TEMPLATE GENERATION COMPLETE');
  console.log('='.repeat(100));
}

main();
