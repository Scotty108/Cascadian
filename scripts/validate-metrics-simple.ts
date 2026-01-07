/**
 * Simple Metrics Validation using CCR-v1
 *
 * Uses the canonical CCR-v1 engine and compares to Polymarket UI.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletPnl } from '../lib/pnl/getWalletPnl';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  const wallet = process.argv[2] || '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

  console.log(`\n${'═'.repeat(80)}`);
  console.log('METRICS VALIDATION - CCR-v1 vs Polymarket UI');
  console.log(`${'═'.repeat(80)}`);
  console.log(`Wallet: ${wallet}\n`);

  // Get CCR-v1 metrics
  console.log('Running CCR-v1...');
  const ccrResult = await getWalletPnl(wallet);

  // Get trade counts
  const tradeCountQuery = `
    SELECT
      countDistinct(event_id) as total_trades,
      sumIf(1, trade_time >= now() - INTERVAL 30 DAY) as trades_30d,
      max(trade_time) as last_trade
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
      AND role = 'maker'
  `;
  const tradeResult = await client.query({ query: tradeCountQuery, format: 'JSONEachRow' });
  const tradeRows = await tradeResult.json() as any[];
  const tradeCounts = tradeRows[0] || {};

  // UI values (manually observed from Polymarket)
  const uiValues: Record<string, any> = {
    '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae': {
      name: '@Latina',
      realized_pnl: 519149.75,
      predictions: 52,
    },
    '0x03a9f592e5eb9a34f0df6c41c3a37c1f063237ba': {
      name: '@Btlenc9',
      realized_pnl: 2508,
    },
    '0x92d8a88f0a9fef812bdf5628770d6a0ecee39762': {
      name: 'Test wallet',
      realized_pnl: 33540,
    },
  };

  const ui = uiValues[wallet.toLowerCase()] || {};

  console.log('\n┌─────────────────────────────┬───────────────────┬───────────────────┬──────────┬──────────┐');
  console.log('│ Metric                      │ CCR-v1            │ UI Value          │ Diff %   │ Match?   │');
  console.log('├─────────────────────────────┼───────────────────┼───────────────────┼──────────┼──────────┤');

  const formatNum = (n: number) => {
    if (Math.abs(n) >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return `$${n.toFixed(2)}`;
  };

  const calcDiff = (ours: number, theirs: number) => {
    if (!theirs) return '-';
    const diff = ((ours - theirs) / Math.abs(theirs)) * 100;
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
  };

  const checkMatch = (ours: number, theirs: number, tolerance = 0.1) => {
    if (!theirs) return '-';
    const diff = Math.abs((ours - theirs) / theirs);
    return diff <= tolerance ? '✅' : '❌';
  };

  // Core metrics comparison
  const metrics = [
    {
      name: 'Realized PnL',
      ours: ccrResult.realized_pnl,
      ui: ui.realized_pnl,
    },
    {
      name: '# Trades (maker)',
      ours: ccrResult.total_trades,
      ui: null,
    },
    {
      name: 'Markets Traded',
      ours: ccrResult.markets_traded,
      ui: ui.predictions,
    },
    {
      name: 'Resolutions',
      ours: ccrResult.resolutions,
      ui: null,
    },
    {
      name: 'Win Rate',
      ours: ccrResult.win_rate * 100,
      ui: null,
      suffix: '%',
    },
    {
      name: 'Omega Ratio',
      ours: ccrResult.omega_ratio,
      ui: null,
    },
    {
      name: 'Trades Last 30d',
      ours: parseInt(tradeCounts.trades_30d) || 0,
      ui: null,
    },
  ];

  for (const m of metrics) {
    const oursStr = m.suffix
      ? `${m.ours?.toFixed(1)}${m.suffix}`
      : (typeof m.ours === 'number' ? formatNum(m.ours) : String(m.ours));
    const uiStr = m.ui != null
      ? (m.suffix ? `${m.ui}${m.suffix}` : formatNum(m.ui))
      : '?';
    const diff = m.ui != null ? calcDiff(m.ours as number, m.ui) : '-';
    const match = m.ui != null ? checkMatch(m.ours as number, m.ui) : '-';

    console.log(`│ ${m.name.padEnd(27)} │ ${oursStr.padEnd(17)} │ ${uiStr.padEnd(17)} │ ${diff.padEnd(8)} │ ${match.padEnd(8)} │`);
  }

  console.log('└─────────────────────────────┴───────────────────┴───────────────────┴──────────┴──────────┘');

  console.log('\n📄 CCR-v1 Raw Output:');
  console.log(JSON.stringify(ccrResult, null, 2));

  // Analysis
  if (ui.realized_pnl) {
    const diff = ccrResult.realized_pnl - ui.realized_pnl;
    const pct = (diff / ui.realized_pnl) * 100;
    console.log(`\n📊 PnL Analysis:`);
    console.log(`   CCR-v1: ${formatNum(ccrResult.realized_pnl)}`);
    console.log(`   UI:     ${formatNum(ui.realized_pnl)}`);
    console.log(`   Diff:   ${formatNum(diff)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`);

    if (Math.abs(pct) <= 5) {
      console.log(`   Status: ✅ Within 5% tolerance`);
    } else if (Math.abs(pct) <= 10) {
      console.log(`   Status: ⚠️ Within 10% - minor discrepancy`);
    } else {
      console.log(`   Status: ❌ > 10% difference - needs investigation`);
    }
  }

  await client.close();
}

main().catch(console.error);
