/**
 * Phase 2: Compute Core Metrics
 *
 * Uses V19s methodology (pm_unified_ledger_v6 + vw_pm_resolution_prices)
 * to compute P&L metrics for each candidate.
 *
 * Gate Criteria (calibrated):
 * - n_events >= 10
 * - n_resolved >= 5
 * - n_losses >= 3 (has taken real losses)
 * - omega > 1.5 and < 50
 * - pnl_60d >= $1,000
 * - win_pct between 50-90%
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

export interface CoreMetrics {
  wallet: string;
  n_positions: number;
  n_events: number;
  n_trades: number;
  total_notional: number;
  n_resolved: number;
  n_wins: number;
  n_losses: number;
  win_pct: number;
  omega: number;
  pnl_60d: number;
  gross_wins: number;
  gross_losses: number;
  last_active: string;
  tier?: string;
}

export async function computeCoreMetrics(wallets?: string[]): Promise<CoreMetrics[]> {
  console.log('=== Phase 2: Compute Core Metrics ===\n');

  // Load Phase 1 candidates if not provided
  if (!wallets) {
    const phase1Path = 'exports/copytrade/phase1_candidates.json';
    if (!fs.existsSync(phase1Path)) {
      throw new Error('Phase 1 output not found. Run 01-build-candidate-universe.ts first.');
    }
    const phase1 = JSON.parse(fs.readFileSync(phase1Path, 'utf-8'));
    wallets = phase1.wallets.map((w: any) => w.wallet);
    console.log(`Loaded ${wallets.length} candidates from Phase 1\n`);
  }

  // Process in batches to avoid memory issues
  const batchSize = 200;
  const allResults: CoreMetrics[] = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(wallets.length / batchSize);

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`);

    const query = `
      WITH
        resolutions AS (
          SELECT
            condition_id,
            outcome_index,
            any(resolved_price) AS resolution_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ),
        positions AS (
          SELECT
            lower(wallet_address) AS wallet,
            condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow,
            sum(token_delta) AS final_tokens,
            count() AS trade_count,
            min(event_time) AS first_trade,
            max(event_time) AS last_trade
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) IN (${walletList})
            AND event_time >= now() - INTERVAL 60 DAY
            AND source_type = 'CLOB'
            AND condition_id IS NOT NULL
            AND condition_id != ''
          GROUP BY wallet, condition_id, outcome_index
        ),
        position_pnl AS (
          SELECT
            p.*,
            r.resolution_price,
            CASE WHEN r.resolution_price IS NOT NULL
              THEN p.cash_flow + (p.final_tokens * r.resolution_price)
              ELSE NULL
            END AS realized_pnl,
            r.resolution_price IS NOT NULL AS is_resolved
          FROM positions p
          LEFT JOIN resolutions r
            ON p.condition_id = r.condition_id
            AND p.outcome_index = r.outcome_index
        )
      SELECT
        wallet,
        count() AS n_positions,
        uniqExact(condition_id) AS n_events,
        sum(trade_count) AS n_trades,
        round(sum(abs(cash_flow)), 2) AS total_notional,
        countIf(is_resolved) AS n_resolved,
        countIf(realized_pnl > 0 AND is_resolved) AS n_wins,
        countIf(realized_pnl <= 0 AND is_resolved) AS n_losses,
        round(countIf(realized_pnl > 0 AND is_resolved) / nullIf(countIf(is_resolved), 0) * 100, 1) AS win_pct,
        round(sumIf(realized_pnl, realized_pnl > 0) / nullIf(abs(sumIf(realized_pnl, realized_pnl < 0)), 0), 2) AS omega,
        round(sumIf(realized_pnl, is_resolved), 2) AS pnl_60d,
        round(sumIf(realized_pnl, realized_pnl > 0 AND is_resolved), 2) AS gross_wins,
        round(abs(sumIf(realized_pnl, realized_pnl < 0 AND is_resolved)), 2) AS gross_losses,
        toString(max(last_trade)) AS last_active
      FROM position_pnl
      GROUP BY wallet
    `;

    try {
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const batchResults = await result.json() as CoreMetrics[];
      allResults.push(...batchResults);
    } catch (err) {
      console.log(`  Batch ${batchNum} error: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  console.log(`\nComputed metrics for ${allResults.length} wallets`);

  // Get Tier info
  console.log('Fetching tier classifications...');
  const tierQuery = `SELECT wallet, confidence_tier FROM pm_wallet_external_activity_60d`;
  const tierResult = await ch.query({ query: tierQuery, format: 'JSONEachRow' });
  const tiers = await tierResult.json() as any[];
  const tierMap = new Map(tiers.map(t => [t.wallet, t.confidence_tier]));

  // Add tier to results
  for (const r of allResults) {
    r.tier = tierMap.get(r.wallet) || 'Unknown';
  }

  // Apply gate criteria
  const qualified = allResults.filter(r =>
    r.n_events >= 10 &&
    r.n_resolved >= 5 &&
    r.n_losses >= 3 &&
    r.omega > 1.5 &&
    r.omega < 50 &&
    r.pnl_60d >= 1000 &&
    r.total_notional >= 5000 &&
    r.win_pct >= 50 &&
    r.win_pct <= 90
  );

  console.log(`\nAfter gate criteria: ${qualified.length} qualified wallets`);
  console.log('Gate criteria applied:');
  console.log('  - n_events >= 10');
  console.log('  - n_resolved >= 5');
  console.log('  - n_losses >= 3');
  console.log('  - omega: 1.5 - 50');
  console.log('  - pnl_60d >= $1,000');
  console.log('  - win_pct: 50-90%');

  // Sort by P&L
  qualified.sort((a, b) => b.pnl_60d - a.pnl_60d);

  // Display top 30
  console.log('\nTop 30 by P&L (qualified):');
  console.log('Wallet                                     | Events | Resol | Win% | Omega | PnL 60d    | Tier');
  console.log('-------------------------------------------|--------|-------|------|-------|------------|-----');
  for (const r of qualified.slice(0, 30)) {
    console.log(
      `${r.wallet} | ${String(r.n_events).padStart(6)} | ${String(r.n_resolved).padStart(5)} | ${String(r.win_pct).padStart(4)}% | ${String(r.omega).padStart(5)}x | $${Number(r.pnl_60d).toLocaleString().padStart(9)} | ${r.tier}`
    );
  }

  // Save output
  const outputPath = 'exports/copytrade/phase2_core_metrics.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: 2,
    description: 'Core metrics using V19s methodology',
    gate_criteria: {
      n_events: '>= 10',
      n_resolved: '>= 5',
      n_losses: '>= 3',
      omega: '1.5 - 50',
      pnl_60d: '>= $1,000',
      win_pct: '50-90%',
    },
    input_count: wallets.length,
    qualified_count: qualified.length,
    wallets: qualified,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  // Tier breakdown
  const tierA = qualified.filter(r => r.tier === 'A').length;
  const tierB = qualified.filter(r => r.tier === 'B').length;
  console.log(`\nTier breakdown: A=${tierA}, B=${tierB}, Other=${qualified.length - tierA - tierB}`);

  return qualified;
}

async function main() {
  try {
    await computeCoreMetrics();
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
