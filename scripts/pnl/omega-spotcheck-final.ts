/**
 * Final Step: Merge Omega + V29 + Dome data and produce spot-check report
 */
import fs from 'fs';

function pctErr(a: number, b: number): number {
  const denom = Math.max(1, Math.abs(b));
  return Math.abs(a - b) / denom * 100;
}

async function main() {
  // Load all data
  const omegaRaw = JSON.parse(fs.readFileSync('tmp/omega_top50_raw.json', 'utf8'));
  const v29Pnl = JSON.parse(fs.readFileSync('tmp/omega_top50_v29_pnl.json', 'utf8'));
  const domeSnap = JSON.parse(fs.readFileSync('tmp/dome_realized_omega_top50_2025_12_07.json', 'utf8'));

  console.log('Loaded data:');
  console.log(`  Omega raw: ${omegaRaw.rows.length} wallets`);
  console.log(`  V29 PnL: ${v29Pnl.length} wallets`);
  console.log(`  Dome snapshot: ${domeSnap.wallets?.length || 0} wallets`);
  console.log('');

  // Create lookup maps
  const v29Map = new Map(v29Pnl.map((r: any) => [r.wallet.toLowerCase(), r]));
  const domeMap = new Map(
    (domeSnap.wallets || []).map((w: any) => [w.wallet.toLowerCase(), w])
  );

  // Merge data
  const rows = omegaRaw.rows.map((r: any) => {
    const wallet = r.wallet_address.toLowerCase();
    const v29 = v29Map.get(wallet);
    const dome = domeMap.get(wallet);

    const domeRealized = dome?.realizedPnl ?? 0;
    const domeConfidence = dome?.confidence ?? 'unknown';

    const v29Realized = Number(v29?.v29_realized ?? 0);
    const v29Unrealized = Number(v29?.v29_unrealized ?? 0);
    const v29Total = v29Realized + v29Unrealized;

    const errPct = (domeConfidence === 'high' && Math.abs(domeRealized) > 100)
      ? pctErr(v29Realized, domeRealized)
      : null;

    return {
      wallet,
      omega: Number(r.omega_ratio),
      cascadian_net_pnl: Number(r.net_pnl),
      condition_count: Number(r.condition_count),
      v29_realized: v29Realized,
      v29_unrealized: v29Unrealized,
      v29_total: v29Total,
      dome_realized: domeRealized,
      dome_confidence: domeConfidence,
      realized_error_pct: errPct
    };
  });

  // Save full results
  fs.writeFileSync(
    'tmp/omega_top50_realized_spotcheck_2025_12_07.json',
    JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2)
  );
  console.log('Wrote tmp/omega_top50_realized_spotcheck_2025_12_07.json');
  console.log('');

  // Calculate summary stats
  const total = rows.length;
  const domeHigh = rows.filter((r: any) => r.dome_confidence === 'high');
  const testable = domeHigh.filter((r: any) => Math.abs(r.dome_realized) > 100);
  const pass6pct = testable.filter((r: any) => r.realized_error_pct !== null && r.realized_error_pct < 6);

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('OMEGA TOP 50 - REALIZED PNL SPOT-CHECK');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Summary:');
  console.log(`  Total wallets:           ${total}`);
  console.log(`  Dome high-confidence:    ${domeHigh.length}`);
  console.log(`  Testable (|dome|>$100):  ${testable.length}`);
  console.log(`  Pass (< 6% error):       ${pass6pct.length}/${testable.length} (${testable.length > 0 ? ((pass6pct.length / testable.length) * 100).toFixed(1) : 0}%)`);
  console.log('');

  // Show top 10 by omega with V29 vs Dome comparison
  console.log('Top 10 by Omega (V29 Realized vs Dome Realized):');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log('| Rank | Wallet     | Omega    | V29 Realized | Dome Realized | Err%  |');
  console.log('|------|------------|----------|--------------|---------------|-------|');
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i];
    const walletShort = r.wallet.slice(0, 8) + '...';
    const errStr = r.realized_error_pct !== null ? r.realized_error_pct.toFixed(1) + '%' : '-';
    const status = r.realized_error_pct !== null && r.realized_error_pct < 6 ? '✅' : (r.dome_confidence !== 'high' ? '⚪' : '❌');
    console.log(`| ${(i + 1).toString().padStart(4)} | ${walletShort} | ${r.omega.toFixed(1).padStart(8)} | $${r.v29_realized.toLocaleString().padStart(11)} | $${r.dome_realized.toLocaleString().padStart(12)} | ${errStr.padStart(5)} ${status} |`);
  }
  console.log('');

  // Show passing wallets
  console.log('Passing Wallets (< 6% error):');
  console.log('─────────────────────────────────────────────────────────────────────');
  if (pass6pct.length === 0) {
    console.log('  (none)');
  } else {
    console.log('| Wallet     | Omega    | V29 Realized | Dome Realized | Err%  |');
    console.log('|------------|----------|--------------|---------------|-------|');
    for (const r of pass6pct.slice(0, 20)) {
      const walletShort = r.wallet.slice(0, 8) + '...';
      console.log(`| ${walletShort} | ${r.omega.toFixed(1).padStart(8)} | $${r.v29_realized.toLocaleString().padStart(11)} | $${r.dome_realized.toLocaleString().padStart(12)} | ${r.realized_error_pct?.toFixed(1).padStart(5)}% |`);
    }
  }
  console.log('');

  // Show failing wallets (worst errors)
  const failing = testable.filter((r: any) => r.realized_error_pct === null || r.realized_error_pct >= 6)
    .sort((a: any, b: any) => (b.realized_error_pct || 0) - (a.realized_error_pct || 0));
  console.log('Top 10 Worst Errors (>= 6%):');
  console.log('─────────────────────────────────────────────────────────────────────');
  if (failing.length === 0) {
    console.log('  (none)');
  } else {
    console.log('| Wallet     | Omega    | V29 Realized | Dome Realized | Err%  |');
    console.log('|------------|----------|--------------|---------------|-------|');
    for (const r of failing.slice(0, 10)) {
      const walletShort = r.wallet.slice(0, 8) + '...';
      console.log(`| ${walletShort} | ${r.omega.toFixed(1).padStart(8)} | $${r.v29_realized.toLocaleString().padStart(11)} | $${r.dome_realized.toLocaleString().padStart(12)} | ${r.realized_error_pct?.toFixed(1).padStart(5)}% |`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
