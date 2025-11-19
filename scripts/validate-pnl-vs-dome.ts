import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

interface BaselineWallet {
  wallet: string;
  expected_pnl: number;
  expected_gains: number;
  expected_losses: number;
}

interface ActualPnL {
  wallet: string;
  realized_pnl_usd: number;
  total_gains: number;
  total_losses: number;
  total_volume_usd: number;
  markets_traded: number;
  trade_count: number;
  source: string;
}

async function main() {
  console.log('================================================================================');
  console.log('P&L VALIDATION: Cascadian vs Dome');
  console.log('================================================================================');
  console.log('Date:', new Date().toISOString());
  console.log('Baseline source: docs/archive/mg_wallet_baselines.md (Dome values)');
  console.log('Cascadian source: ClickHouse P&L tables');
  console.log('================================================================================\n');

  // Load expected values from CSV
  const csvContent = fs.readFileSync('tmp/omega-baseline-2025-11-11.csv', 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header

  const expectedWallets: BaselineWallet[] = lines
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split(',');
      return {
        wallet: parts[0],
        expected_pnl: parseFloat(parts[1]),
        expected_gains: parseFloat(parts[2]),
        expected_losses: parseFloat(parts[3])
      };
    });

  console.log(`Loaded ${expectedWallets.length} baseline wallets\n`);

  // Try multiple P&L sources in order of preference
  const walletList = expectedWallets.map(w => `'${w.wallet}'`).join(',');

  const pnlSources = [
    {
      name: 'wallet_metrics (latest)',
      query: `
        SELECT
          wallet,
          total_pnl_usd as realized_pnl_usd,
          0 as total_gains,
          0 as total_losses,
          total_volume_usd,
          total_markets_traded as markets_traded,
          total_trades as trade_count,
          'wallet_metrics' as source
        FROM wallet_metrics
        WHERE wallet IN (${walletList})
        ORDER BY timestamp DESC
        LIMIT ${expectedWallets.length}
      `
    },
    {
      name: 'realized_pnl_by_market_final (aggregated)',
      query: `
        SELECT
          wallet,
          SUM(realized_pnl_usd) as realized_pnl_usd,
          sumIf(realized_pnl_usd, realized_pnl_usd > 0) as total_gains,
          sumIf(ABS(realized_pnl_usd), realized_pnl_usd < 0) as total_losses,
          0 as total_volume_usd,
          COUNT(DISTINCT condition_id_norm) as markets_traded,
          COUNT(*) as trade_count,
          'realized_pnl_by_market_final' as source
        FROM realized_pnl_by_market_final
        WHERE wallet IN (${walletList})
        GROUP BY wallet
      `
    },
    {
      name: 'vw_wallet_pnl_summary',
      query: `
        SELECT
          wallet,
          total_pnl as realized_pnl_usd,
          total_gains,
          total_losses,
          0 as total_volume_usd,
          0 as markets_traded,
          0 as trade_count,
          'vw_wallet_pnl_summary' as source
        FROM vw_wallet_pnl_summary
        WHERE wallet IN (${walletList})
      `
    },
    {
      name: 'clob_fills (raw calculation)',
      query: `
        SELECT
          proxy_wallet as wallet,
          0 as realized_pnl_usd,
          0 as total_gains,
          0 as total_losses,
          SUM(price * size) as total_volume_usd,
          COUNT(DISTINCT condition_id) as markets_traded,
          COUNT(*) as trade_count,
          'clob_fills_raw' as source
        FROM clob_fills
        WHERE proxy_wallet IN (${walletList})
        GROUP BY proxy_wallet
      `
    }
  ];

  let actualPnL: ActualPnL[] = [];
  let successfulSource = '';

  // Try each source until we find one that works
  for (const source of pnlSources) {
    try {
      console.log(`Trying source: ${source.name}...`);
      const result = await clickhouse.query({
        query: source.query,
        format: 'JSONEachRow'
      });
      const data = await result.json();

      if (data.length > 0) {
        actualPnL = data as ActualPnL[];
        successfulSource = source.name;
        console.log(`✅ Success! Found ${actualPnL.length} wallets in ${source.name}\n`);
        break;
      } else {
        console.log(`⚠️  No data in ${source.name}, trying next source...\n`);
      }
    } catch (e: any) {
      console.log(`❌ Error with ${source.name}: ${e.message}`);
      console.log(`   Trying next source...\n`);
    }
  }

  if (actualPnL.length === 0) {
    console.error('❌ FAILED: Could not retrieve P&L data from any source');
    console.error('   Available sources tried:', pnlSources.map(s => s.name).join(', '));
    console.error('\n   Recommendation: Check that P&L tables are populated');
    process.exit(1);
  }

  // Generate comparison report
  console.log('================================================================================');
  console.log('COMPARISON REPORT');
  console.log('================================================================================');
  console.log('Source:', successfulSource);
  console.log('Wallets compared:', expectedWallets.length);
  console.log('================================================================================\n');

  const diffReport: any[] = [];
  let walletsOver1Percent = 0;
  let maxVariance = 0;

  for (const expected of expectedWallets) {
    const actual = actualPnL.find(a => a.wallet.toLowerCase() === expected.wallet.toLowerCase());

    if (!actual) {
      console.log(`⚠️  Wallet ${expected.wallet}: NOT FOUND in ${successfulSource}`);
      diffReport.push({
        wallet: expected.wallet,
        expected_pnl: expected.expected_pnl,
        actual_pnl: 'N/A',
        delta_abs: 'N/A',
        delta_pct: 'N/A',
        status: 'MISSING'
      });
      continue;
    }

    const deltaAbs = actual.realized_pnl_usd - expected.expected_pnl;
    const deltaPct = expected.expected_pnl !== 0
      ? (deltaAbs / Math.abs(expected.expected_pnl)) * 100
      : 0;

    const absDeltaPct = Math.abs(deltaPct);
    maxVariance = Math.max(maxVariance, absDeltaPct);

    const status = absDeltaPct > 1 ? '⚠️  VARIANCE' : '✅ OK';
    if (absDeltaPct > 1) walletsOver1Percent++;

    console.log(`${status} ${expected.wallet.slice(0, 10)}...`);
    console.log(`   Expected: $${expected.expected_pnl.toLocaleString()}`);
    console.log(`   Actual:   $${actual.realized_pnl_usd.toLocaleString()}`);
    console.log(`   Delta:    $${deltaAbs.toLocaleString()} (${deltaPct.toFixed(2)}%)`);

    if (actual.source === 'clob_fills_raw') {
      console.log(`   Volume:   $${actual.total_volume_usd.toLocaleString()}`);
      console.log(`   Markets:  ${actual.markets_traded}`);
      console.log(`   Trades:   ${actual.trade_count}`);
    }
    console.log();

    diffReport.push({
      wallet: expected.wallet,
      expected_pnl: expected.expected_pnl,
      expected_gains: expected.expected_gains,
      expected_losses: expected.expected_losses,
      actual_pnl: actual.realized_pnl_usd,
      actual_gains: actual.total_gains,
      actual_losses: actual.total_losses,
      delta_abs: deltaAbs,
      delta_pct: deltaPct,
      volume_usd: actual.total_volume_usd,
      markets_traded: actual.markets_traded,
      trade_count: actual.trade_count,
      source: actual.source,
      status: absDeltaPct > 1 ? 'VARIANCE' : 'OK'
    });
  }

  // Summary
  console.log('================================================================================');
  console.log('SUMMARY');
  console.log('================================================================================');
  console.log(`Total wallets:        ${expectedWallets.length}`);
  console.log(`Wallets with data:    ${actualPnL.length}`);
  console.log(`Wallets >1% variance: ${walletsOver1Percent}`);
  console.log(`Max variance:         ${maxVariance.toFixed(2)}%`);
  console.log(`Data source:          ${successfulSource}`);
  console.log('================================================================================\n');

  // Write CSV
  const csvHeader = 'wallet,expected_pnl,expected_gains,expected_losses,actual_pnl,actual_gains,actual_losses,delta_abs,delta_pct,volume_usd,markets_traded,trade_count,source,status';
  const csvRows = diffReport.map(r =>
    `${r.wallet},${r.expected_pnl},${r.expected_gains || 0},${r.expected_losses || 0},${r.actual_pnl || 0},${r.actual_gains || 0},${r.actual_losses || 0},${r.delta_abs || 'N/A'},${r.delta_pct || 'N/A'},${r.volume_usd || 0},${r.markets_traded || 0},${r.trade_count || 0},${r.source || 'N/A'},${r.status}`
  );
  const csvOutput = [csvHeader, ...csvRows].join('\n');

  fs.writeFileSync('tmp/dome-vs-cascadian-2025-11-11.csv', csvOutput);
  console.log('✅ Diff report saved to: tmp/dome-vs-cascadian-2025-11-11.csv\n');

  if (walletsOver1Percent > 0) {
    console.log('⚠️  ACTION REQUIRED: Some wallets have >1% variance');
    console.log('   Next step: Run root cause analysis for these wallets');
    console.log('   Script: scripts/analyze-pnl-discrepancies.ts');
  } else {
    console.log('✅ VALIDATION PASSED: All wallets within 1% tolerance');
    console.log('   Ready to proceed with leaderboard materialization');
  }
}

main().catch(console.error);
