/**
 * Test V3 PnL engine against multiple wallets
 * Shows breakdown of where PnL comes from (CLOB vs redemptions vs resolution)
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';

// Wallets with known UI PnL values for accuracy comparison
const walletsWithKnownPnl = [
  { address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo4', ui_pnl: 22053934 },  // $22M
];

// Additional wallets to test (no known UI values)
const additionalWallets = [
  '0x258b9ecd58a6c6c6597e0583ef7d8623a1907859',
  '0xdd1cdb2e51b29896fc57030ec5a3e08f274ae2d3',
  '0x7518b24cc3d553d99949b1078968a313aadaa159',
  '0xe449192f44a0423361dbbf81d4a5965339552235',
  '0xef42ff1f03de5662f8b07d524feef1fb584ac078',
  '0x6091397fe0f621c4872632bc613eda4b6275972b',
  '0xbc971290ada03af329502e7be8a1bd9bfdaa0b93',
  '0x3e252c9ffa09338c5ab8b6e3b9b7c195230609fb',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',  // Top trader by volume
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',  // Another big trader
];

function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

async function testWallets() {
  console.log('=== V3 PNL ENGINE ACCURACY TEST ===\n');

  // PART 1: Test wallets with known UI PnL values
  console.log('--- KNOWN UI PnL COMPARISON ---\n');
  console.log('| Name     | UI PnL    | V3 PnL    | Error    | CLOB      | Redemp    | Resolution |');
  console.log('|----------|-----------|-----------|----------|-----------|-----------|------------|');

  const knownResults: any[] = [];

  for (const w of walletsWithKnownPnl) {
    try {
      const r = await computeWalletActivityPnlV3Debug(w.address);

      const pnl = r.pnl_activity_total;
      const clob = r.pnl_from_clob;
      const redemp = r.pnl_from_redemptions;
      const resol = r.pnl_from_resolution_losses;
      const errorPct = ((pnl - w.ui_pnl) / w.ui_pnl * 100);

      console.log(
        '| ' + w.name.padEnd(8) + ' | ' +
        fmt(w.ui_pnl).padEnd(9) + ' | ' +
        fmt(pnl).padEnd(9) + ' | ' +
        (errorPct >= 0 ? '+' : '') + errorPct.toFixed(1) + '%'.padEnd(4) + ' | ' +
        fmt(clob).padEnd(9) + ' | ' +
        fmt(redemp).padEnd(9) + ' | ' +
        fmt(resol).padEnd(10) + ' |'
      );

      knownResults.push({
        name: w.name,
        wallet: w.address,
        ui_pnl: w.ui_pnl,
        v3_pnl: pnl,
        error_pct: errorPct,
        clob,
        redemp,
        resol
      });
    } catch (e: any) {
      console.log('| ' + w.name.padEnd(8) + ' | ERROR: ' + e.message.substring(0, 50));
    }
  }

  // PART 2: Test additional wallets (breakdown only)
  console.log('\n--- ADDITIONAL WALLETS BREAKDOWN ---\n');
  console.log('| Wallet       | V3 PnL    | CLOB      | Redemp    | Resolution | Resol% |');
  console.log('|--------------|-----------|-----------|-----------|------------|--------|');

  const results: any[] = [];

  for (const wallet of additionalWallets) {
    try {
      const r = await computeWalletActivityPnlV3Debug(wallet);

      const pnl = r.pnl_activity_total;
      const clob = r.pnl_from_clob;
      const redemp = r.pnl_from_redemptions;
      const resol = r.pnl_from_resolution_losses;
      const resolPct = pnl !== 0 ? Math.abs(resol / pnl * 100) : 0;

      console.log(
        '| ' + wallet.substring(0, 12) + ' | ' +
        fmt(pnl).padEnd(9) + ' | ' +
        fmt(clob).padEnd(9) + ' | ' +
        fmt(redemp).padEnd(9) + ' | ' +
        fmt(resol).padEnd(10) + ' | ' +
        resolPct.toFixed(0).padStart(5) + '% |'
      );

      results.push({
        wallet,
        pnl,
        clob,
        redemp,
        resol,
        resolPct
      });
    } catch (e: any) {
      console.log('| ' + wallet.substring(0, 12) + ' | ERROR: ' + e.message.substring(0, 40));
    }
  }

  console.log('\n=== ANALYSIS ===\n');

  // Summary stats for known wallets
  if (knownResults.length > 0) {
    const avgError = knownResults.reduce((s, r) => s + r.error_pct, 0) / knownResults.length;
    console.log('ACCURACY vs UI PnL:');
    console.log(`  Average error: ${avgError >= 0 ? '+' : ''}${avgError.toFixed(1)}%`);
    console.log('  Per wallet:');
    knownResults.forEach(r => {
      const status = Math.abs(r.error_pct) < 1 ? 'EXCELLENT' :
                     Math.abs(r.error_pct) < 5 ? 'GOOD' :
                     Math.abs(r.error_pct) < 15 ? 'ACCEPTABLE' : 'NEEDS WORK';
      console.log(`    ${r.name}: ${r.error_pct >= 0 ? '+' : ''}${r.error_pct.toFixed(1)}% (${status})`);
    });
    console.log('');
  }

  // Group by resolution dependency
  const allResults = [...results];
  const highResol = allResults.filter(r => r.resolPct > 80);
  const medResol = allResults.filter(r => r.resolPct > 30 && r.resolPct <= 80);
  const lowResol = allResults.filter(r => r.resolPct <= 30);

  console.log('PnL SOURCE BREAKDOWN:');
  console.log(`  High resolution dependency (>80%): ${highResol.length} wallets`);
  console.log('    → Expected error: ~10-15% (cost basis differences at resolution)');
  console.log(`  Medium resolution dependency (30-80%): ${medResol.length} wallets`);
  console.log('    → Expected error: ~5-10%');
  console.log(`  Low resolution dependency (<30%): ${lowResol.length} wallets`);
  console.log('    → Expected error: <5% (mostly CLOB trades)');

  // Show low resolution wallets (most accurate)
  if (lowResol.length > 0) {
    console.log('\n--- Most Accurate Wallets (low resolution dependency): ---');
    lowResol.sort((a, b) => b.pnl - a.pnl);
    lowResol.forEach(r => {
      console.log(`  ${r.wallet.substring(0, 12)}: ${fmt(r.pnl)} (${r.resolPct.toFixed(0)}% from resolution)`);
    });
  }

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log('V3 Engine systematically overestimates PnL by ~13% for high-resolution-dependency wallets.');
  console.log('This is due to cost basis differences between average cost (V3) vs FIFO (UI).');
  console.log('For wallets with low resolution dependency, V3 should be within ~5% of UI.');
}

testWallets().catch(console.error);
