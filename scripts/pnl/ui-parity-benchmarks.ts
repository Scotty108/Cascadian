/**
 * UI Parity Benchmark Script
 *
 * Compares our computed PnL metrics against actual Polymarket UI values.
 *
 * Usage: npx tsx scripts/pnl/ui-parity-benchmarks.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';

// UI benchmark values captured from polymarket.com wallet pages (ALL timeframe)
const UI_BENCHMARK_WALLETS = [
  {
    wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486',
    label: 'W1',
    profitLoss_all: -6138.90,
    volume_all: 205876.66,
    gain_all: 37312.46,
    loss_all: -43451.36,
    positions_value: 0.01,
    predictions: 15,
    notes: 'UI says All Time. Our V9 econ PnL is ~-17.5k. Suspect different time filter or special handling.'
  },
  {
    wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838',
    label: 'W2',
    profitLoss_all: 4404.92,
    volume_all: 23191.46,
    gain_all: 6222.31,
    loss_all: -1817.39,
    positions_value: 0.01,
    predictions: 22,
    notes: 'V9 econ PnL was ~4417.84, extremely close to UI net total.'
  },
  {
    wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786',
    label: 'W3',
    profitLoss_all: 5.44,
    volume_all: 30868.84,
    gain_all: 14.90,
    loss_all: -9.46,
    positions_value: 5.57,
    predictions: 30,
  },
  {
    wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15',
    label: 'W4',
    profitLoss_all: -294.61,
    volume_all: 141825.27,
    gain_all: 3032.88,
    loss_all: -3327.49,
    positions_value: 168.87,
    predictions: 52,
  },
  {
    wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2',
    label: 'W5',
    profitLoss_all: 146.90,
    volume_all: 6721.77,
    gain_all: 148.40,
    loss_all: -1.50,
    positions_value: 0.01,
    predictions: 9,
  },
  {
    wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d',
    label: 'W6',
    profitLoss_all: 470.40,
    volume_all: 44145.02,
    gain_all: 1485.80,
    loss_all: -1015.40,
    positions_value: 1628.12,
    predictions: 89,
  },
];

interface ComputedMetrics {
  wallet: string;
  label: string;
  // V9 Economic PnL metrics
  pnl_v9_total: number;
  pnl_v9_gain: number;
  pnl_v9_loss: number;
  resolved_conditions: number;
  // Volume candidates
  volume_clob_total: number;
  volume_buy: number;
  volume_sell: number;
  // Predictions candidates
  predictions_conditions: number;
  predictions_markets: number;
  // Trade counts
  total_trades: number;
}

async function computeMetricsForWallet(wallet: string, label: string): Promise<ComputedMetrics> {
  // Query 1: V9 Economic PnL with gain/loss breakdown
  // Simplified query structure to avoid ClickHouse CTE scoping issues
  const pnlQuery = `
    SELECT
      SUM(realized_pnl) as pnl_total,
      SUM(CASE WHEN realized_pnl > 0 THEN realized_pnl ELSE 0 END) as pnl_gain,
      SUM(CASE WHEN realized_pnl < 0 THEN realized_pnl ELSE 0 END) as pnl_loss,
      count() as resolved_conditions
    FROM (
      SELECT
        net_cash + (net_tokens * payout_price) as realized_pnl
      FROM (
        SELECT
          n.net_cash,
          n.net_tokens,
          m.outcome_index,
          CASE WHEN r.resolved_at IS NOT NULL AND r.payout_numerators IS NOT NULL THEN
            arrayElement(JSONExtract(r.payout_numerators, 'Array(Float64)'), toUInt32(m.outcome_index + 1))
          ELSE 0 END as payout_price,
          r.resolved_at IS NOT NULL as is_resolved
        FROM (
          SELECT
            token_id,
            SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
            SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash
          FROM (
            SELECT
              event_id,
              any(token_id) as token_id,
              any(side) as side,
              any(token_amount) / 1000000.0 as tokens,
              any(usdc_amount) / 1000000.0 as usdc
            FROM pm_trader_events_v2
            WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
            GROUP BY event_id
          )
          GROUP BY token_id
        ) n
        INNER JOIN pm_token_to_condition_map_v3 m ON n.token_id = m.token_id_dec
        LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
      )
      WHERE is_resolved = 1
    )
  `;

  // Query 2: Volume metrics
  const volumeQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      SUM(usdc) as volume_total,
      SUM(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as volume_buy,
      SUM(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) as volume_sell,
      count() as total_trades
    FROM deduped
  `;

  // Query 3: Predictions count (distinct conditions and markets)
  const predictionsQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      count(DISTINCT m.condition_id) as distinct_conditions,
      count(DISTINCT m.slug) as distinct_markets
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
  `;

  try {
    const [pnlResult, volumeResult, predictionsResult] = await Promise.all([
      clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' }),
      clickhouse.query({ query: volumeQuery, format: 'JSONEachRow' }),
      clickhouse.query({ query: predictionsQuery, format: 'JSONEachRow' }),
    ]);

    const pnlData = (await pnlResult.json())[0] as any;
    const volumeData = (await volumeResult.json())[0] as any;
    const predictionsData = (await predictionsResult.json())[0] as any;

    return {
      wallet,
      label,
      pnl_v9_total: Number(pnlData?.pnl_total) || 0,
      pnl_v9_gain: Number(pnlData?.pnl_gain) || 0,
      pnl_v9_loss: Number(pnlData?.pnl_loss) || 0,
      resolved_conditions: Number(pnlData?.resolved_conditions) || 0,
      volume_clob_total: Number(volumeData?.volume_total) || 0,
      volume_buy: Number(volumeData?.volume_buy) || 0,
      volume_sell: Number(volumeData?.volume_sell) || 0,
      total_trades: Number(volumeData?.total_trades) || 0,
      predictions_conditions: Number(predictionsData?.distinct_conditions) || 0,
      predictions_markets: Number(predictionsData?.distinct_markets) || 0,
    };
  } catch (e) {
    console.error(`Error computing metrics for ${label}:`, (e as Error).message);
    return {
      wallet,
      label,
      pnl_v9_total: 0,
      pnl_v9_gain: 0,
      pnl_v9_loss: 0,
      resolved_conditions: 0,
      volume_clob_total: 0,
      volume_buy: 0,
      volume_sell: 0,
      total_trades: 0,
      predictions_conditions: 0,
      predictions_markets: 0,
    };
  }
}

function formatDiff(computed: number, ui: number): string {
  const diff = computed - ui;
  const pct = ui !== 0 ? ((diff / Math.abs(ui)) * 100).toFixed(1) : 'N/A';
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(2)} (${pct}%)`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  console.log('='.repeat(100));
  console.log('UI PARITY BENCHMARK - Comparing V9 Metrics to Polymarket UI Values');
  console.log('='.repeat(100));
  console.log('');

  const results: Array<{ ui: typeof UI_BENCHMARK_WALLETS[0]; computed: ComputedMetrics }> = [];

  // Compute metrics for each wallet
  for (const uiWallet of UI_BENCHMARK_WALLETS) {
    console.log(`Computing metrics for ${uiWallet.label} (${uiWallet.wallet.substring(0, 10)}...)...`);
    const computed = await computeMetricsForWallet(uiWallet.wallet, uiWallet.label);
    results.push({ ui: uiWallet, computed });
  }

  console.log('\n');

  // Print detailed comparison for each wallet
  for (const { ui, computed } of results) {
    console.log('='.repeat(80));
    console.log(`Wallet ${ui.label} (${ui.wallet.substring(0, 14)}...)`);
    if (ui.notes) {
      console.log(`Notes: ${ui.notes}`);
    }
    console.log('='.repeat(80));
    console.log('');

    // PnL Comparison
    console.log('PROFIT/LOSS:');
    console.log(`  UI Profit/Loss:     $${formatNumber(ui.profitLoss_all)}`);
    console.log(`  V9 Economic PnL:    $${formatNumber(computed.pnl_v9_total)}`);
    console.log(`  Difference:         ${formatDiff(computed.pnl_v9_total, ui.profitLoss_all)}`);
    console.log('');

    // Gain/Loss Breakdown
    console.log('GAIN/LOSS BREAKDOWN:');
    console.log(`  UI Gain:            $${formatNumber(ui.gain_all)}`);
    console.log(`  V9 Gain:            $${formatNumber(computed.pnl_v9_gain)}`);
    console.log(`  Difference:         ${formatDiff(computed.pnl_v9_gain, ui.gain_all)}`);
    console.log('');
    console.log(`  UI Loss:            $${formatNumber(ui.loss_all)}`);
    console.log(`  V9 Loss:            $${formatNumber(computed.pnl_v9_loss)}`);
    console.log(`  Difference:         ${formatDiff(computed.pnl_v9_loss, ui.loss_all)}`);
    console.log('');

    // Volume Comparison
    console.log('VOLUME:');
    console.log(`  UI Volume:          $${formatNumber(ui.volume_all)}`);
    console.log(`  V9 Volume (total):  $${formatNumber(computed.volume_clob_total)}`);
    console.log(`  Difference:         ${formatDiff(computed.volume_clob_total, ui.volume_all)}`);
    console.log(`  (Buy: $${formatNumber(computed.volume_buy)}, Sell: $${formatNumber(computed.volume_sell)})`);
    console.log('');

    // Predictions Comparison
    console.log('PREDICTIONS:');
    console.log(`  UI Predictions:     ${ui.predictions}`);
    console.log(`  V9 Conditions:      ${computed.predictions_conditions}`);
    console.log(`  V9 Markets (slugs): ${computed.predictions_markets}`);
    console.log(`  Total Trades:       ${computed.total_trades}`);
    console.log('');

    // Positions Value (stub)
    console.log('POSITIONS VALUE:');
    console.log(`  UI Positions Value: $${formatNumber(ui.positions_value)}`);
    console.log(`  V9 (not computed):  N/A (requires live prices)`);
    console.log('');
  }

  // Summary table
  console.log('\n');
  console.log('='.repeat(100));
  console.log('SUMMARY TABLE - PnL Comparison');
  console.log('='.repeat(100));
  console.log('');
  console.log('| Wallet | UI PnL | V9 PnL | Diff | Diff % | Match? |');
  console.log('|--------|--------|--------|------|--------|--------|');

  for (const { ui, computed } of results) {
    const diff = computed.pnl_v9_total - ui.profitLoss_all;
    const pct = ui.profitLoss_all !== 0
      ? Math.abs((diff / Math.abs(ui.profitLoss_all)) * 100)
      : (computed.pnl_v9_total !== 0 ? 100 : 0);
    const match = pct < 5 ? 'YES' : pct < 20 ? 'PARTIAL' : 'NO';

    console.log(`| ${ui.label.padEnd(6)} | ${formatNumber(ui.profitLoss_all).padStart(10)} | ${formatNumber(computed.pnl_v9_total).padStart(10)} | ${formatNumber(diff).padStart(8)} | ${pct.toFixed(1).padStart(5)}% | ${match.padStart(7)} |`);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('SUMMARY TABLE - Volume Comparison');
  console.log('='.repeat(100));
  console.log('');
  console.log('| Wallet | UI Volume | V9 Volume | Diff % | Match? |');
  console.log('|--------|-----------|-----------|--------|--------|');

  for (const { ui, computed } of results) {
    const pct = ui.volume_all !== 0
      ? Math.abs((computed.volume_clob_total - ui.volume_all) / ui.volume_all * 100)
      : 0;
    const match = pct < 5 ? 'YES' : pct < 20 ? 'PARTIAL' : 'NO';

    console.log(`| ${ui.label.padEnd(6)} | ${formatNumber(ui.volume_all).padStart(12)} | ${formatNumber(computed.volume_clob_total).padStart(12)} | ${pct.toFixed(1).padStart(5)}% | ${match.padStart(7)} |`);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('SUMMARY TABLE - Predictions Comparison');
  console.log('='.repeat(100));
  console.log('');
  console.log('| Wallet | UI Predictions | V9 Conditions | V9 Markets |');
  console.log('|--------|----------------|---------------|------------|');

  for (const { ui, computed } of results) {
    console.log(`| ${ui.label.padEnd(6)} | ${String(ui.predictions).padStart(14)} | ${String(computed.predictions_conditions).padStart(13)} | ${String(computed.predictions_markets).padStart(10)} |`);
  }

  console.log('');
  console.log('Done!');
}

main().catch(console.error);
