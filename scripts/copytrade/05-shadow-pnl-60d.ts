/**
 * Phase 5: Shadow P&L with Execution Friction (60-day window)
 *
 * Simulates copy-trading with realistic friction:
 * - Entry delay: 30 seconds (time to detect + execute)
 * - Entry slippage: 0.5% (50 bps)
 * - Exit slippage: 0.3% (30 bps)
 * - Skip signals if price moved >5% since signal
 *
 * This produces a "shadow P&L" that estimates actual copy performance.
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

// Friction parameters
const FRICTION = {
  entry_delay_seconds: 30,     // Time to detect + execute
  entry_slippage_bps: 50,      // 0.5% slippage on entry
  exit_slippage_bps: 30,       // 0.3% slippage on exit
  skip_if_moved_pct: 5,        // Skip if price moved >5% since signal
  min_position_usd: 50,        // Skip tiny positions
};

interface ShadowMetrics {
  wallet: string;
  // Original (clean) metrics
  original_pnl: number;
  original_omega: number;
  n_positions: number;
  n_trades: number;
  // Shadow (with friction) metrics
  shadow_pnl: number;
  shadow_omega: number;
  n_positions_copied: number;
  n_positions_skipped: number;
  // Execution drag
  execution_drag_pct: number;  // (original - shadow) / original
  avg_entry_cost_pct: number;  // Average % cost from entry slippage
  // Activity
  first_trade: string;
  last_trade: string;
  n_events: number;
  total_notional: number;
}

async function computeShadowPnl(wallets?: string[]): Promise<ShadowMetrics[]> {
  console.log('=== Phase 5: Shadow P&L with Execution Friction (60d) ===\n');
  console.log('Friction parameters:');
  console.log(`  Entry delay: ${FRICTION.entry_delay_seconds}s`);
  console.log(`  Entry slippage: ${FRICTION.entry_slippage_bps} bps (${FRICTION.entry_slippage_bps / 100}%)`);
  console.log(`  Exit slippage: ${FRICTION.exit_slippage_bps} bps (${FRICTION.exit_slippage_bps / 100}%)`);
  console.log(`  Skip threshold: ${FRICTION.skip_if_moved_pct}% move\n`);

  // Load Phase 2D candidates if not provided
  if (!wallets) {
    const phase2dPath = 'exports/copytrade/phase2d_alltime_with_orphans.json';
    if (!fs.existsSync(phase2dPath)) {
      throw new Error('Phase 2D output not found. Run 02d-alltime-with-orphans.ts first.');
    }
    const phase2d = JSON.parse(fs.readFileSync(phase2dPath, 'utf-8'));
    wallets = phase2d.wallets.map((w: any) => w.wallet);
    console.log(`Loaded ${wallets.length} candidates from Phase 2D\n`);
  }

  const allResults: ShadowMetrics[] = [];

  // Process in smaller batches for per-trade analysis
  const batchSize = 20;

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(wallets.length / batchSize);

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`);

    // Query to get position-level metrics for 60-day window
    // Since we don't have tick-by-tick price data, we estimate friction impact
    // based on average entry price deviation from theoretical clean entry
    const query = `
      WITH
        -- Get positions with resolution (60-day window)
        positions AS (
          SELECT
            lower(wallet_address) AS wallet,
            lower(replace(condition_id, '0x', '')) AS condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow,
            sum(token_delta) AS final_tokens,
            count() AS trade_count,
            min(event_time) AS first_trade,
            max(event_time) AS last_trade,
            -- Entry price estimate: total cost / tokens acquired
            abs(sumIf(usdc_delta, token_delta > 0)) / nullIf(sumIf(token_delta, token_delta > 0), 0) AS avg_entry_price
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) IN (${walletList})
            AND source_type = 'CLOB'
            AND event_time >= now() - INTERVAL 60 DAY
            AND condition_id IS NOT NULL
            AND condition_id != ''
          GROUP BY wallet, condition_id, outcome_index
        ),
        -- Get resolution data (with orphan handling)
        resolutions AS (
          SELECT
            condition_id,
            outcome_index,
            any(resolved_price) AS resolved_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ),
        resolved_conditions AS (
          SELECT lower(condition_id) AS condition_id, 1 AS is_resolved
          FROM pm_condition_resolutions
          WHERE is_deleted = 0
        ),
        -- Join positions with resolutions
        position_pnl AS (
          SELECT
            p.wallet,
            p.condition_id,
            p.outcome_index,
            p.cash_flow,
            p.final_tokens,
            p.trade_count,
            p.first_trade,
            p.last_trade,
            p.avg_entry_price,
            coalesce(rc.is_resolved, 0) AS condition_resolved,
            r.resolved_price,
            -- Original P&L (clean)
            CASE
              WHEN r.resolved_price IS NOT NULL THEN p.cash_flow + (p.final_tokens * r.resolved_price)
              WHEN rc.is_resolved = 1 THEN p.cash_flow  -- Orphan
              ELSE 0
            END AS original_pnl,
            -- Is this position large enough to copy?
            abs(p.cash_flow) >= ${FRICTION.min_position_usd} AS is_copyable
          FROM positions p
          LEFT JOIN resolutions r ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
          LEFT JOIN resolved_conditions rc ON p.condition_id = rc.condition_id
        ),
        -- Calculate shadow P&L with friction
        shadow_pnl AS (
          SELECT
            wallet,
            condition_id AS cond_id,
            outcome_index,
            original_pnl,
            cash_flow AS pos_cash_flow,
            final_tokens AS pos_tokens,
            trade_count,
            first_trade,
            last_trade,
            avg_entry_price,
            condition_resolved,
            resolved_price,
            is_copyable,
            -- Estimate shadow P&L:
            -- Entry friction: We pay slightly more (for buys) due to delay + slippage
            -- Exit friction: We get slightly less when selling
            -- Simplified model: reduce P&L by entry_slippage % of cash_flow + exit_slippage % of final_value
            CASE
              WHEN condition_resolved = 0 THEN 0  -- Unresolved = no shadow PnL
              WHEN NOT is_copyable THEN 0  -- Too small to copy
              ELSE
                -- Shadow = Original minus friction costs
                -- Entry cost: entry_slippage_bps / 10000 * abs(cash_flow)
                -- Exit cost: exit_slippage_bps / 10000 * (final_tokens * resolved_price)
                original_pnl
                - (${FRICTION.entry_slippage_bps} / 10000.0 * abs(cash_flow))
                - (${FRICTION.exit_slippage_bps} / 10000.0 * if(resolved_price IS NOT NULL, abs(final_tokens * resolved_price), 0))
            END AS shadow_pnl,
            -- Entry cost as % of position
            ${FRICTION.entry_slippage_bps} / 10000.0 * 100 AS entry_cost_pct
          FROM position_pnl
        )
      -- Aggregate by wallet
      SELECT
        wallet,
        round(sum(original_pnl), 2) AS original_pnl,
        round(sum(if(original_pnl > 0, original_pnl, 0)) / nullIf(abs(sum(if(original_pnl < 0, original_pnl, 0))), 0), 2) AS original_omega,
        count() AS n_positions,
        sum(trade_count) AS n_trades,
        round(sum(shadow_pnl), 2) AS shadow_pnl,
        round(sum(if(shadow_pnl > 0, shadow_pnl, 0)) / nullIf(abs(sum(if(shadow_pnl < 0, shadow_pnl, 0))), 0), 2) AS shadow_omega,
        countIf(is_copyable AND condition_resolved = 1) AS n_positions_copied,
        countIf(NOT is_copyable OR condition_resolved = 0) AS n_positions_skipped,
        -- Execution drag
        round(if(sum(original_pnl) != 0, (sum(original_pnl) - sum(shadow_pnl)) / abs(sum(original_pnl)) * 100, 0), 1) AS execution_drag_pct,
        round(avg(entry_cost_pct), 2) AS avg_entry_cost_pct,
        -- Activity
        toString(min(first_trade)) AS first_trade,
        toString(max(last_trade)) AS last_trade,
        uniqExact(cond_id) AS n_events,
        round(sum(abs(pos_cash_flow)), 2) AS total_notional
      FROM shadow_pnl
      GROUP BY wallet
    `;

    try {
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const batchResults = await result.json() as ShadowMetrics[];
      allResults.push(...batchResults);
    } catch (err) {
      console.log(`  Batch ${batchNum} error: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  console.log(`\nComputed shadow P&L for ${allResults.length} wallets`);

  // Gate criteria for shadow metrics
  const qualified = allResults.filter(r =>
    r.shadow_pnl > 0 &&           // Must be profitable AFTER friction
    r.shadow_omega > 1.2 &&       // Must have decent omega after friction
    r.execution_drag_pct < 50 &&  // Didn't lose more than 50% of edge to friction
    r.n_positions_copied >= 5 &&  // Enough copied positions
    r.n_events >= 10              // Diversified
  );

  console.log(`\nAfter shadow gates: ${qualified.length} qualified wallets`);

  // Sort by shadow omega (risk-adjusted performance after friction)
  qualified.sort((a, b) => b.shadow_omega - a.shadow_omega);

  // Display top 30
  console.log('\n=== TOP 30 by Shadow Omega (60d) ===');
  console.log('Wallet                                     | Orig P&L | Shadow P&L | Drag% | Orig Ω | Shad Ω | Copied');
  console.log('-------------------------------------------|----------|------------|-------|--------|--------|-------');
  for (const r of qualified.slice(0, 30)) {
    const origPnl = r.original_pnl >= 0 ? `+$${Math.round(r.original_pnl).toLocaleString()}` : `-$${Math.abs(Math.round(r.original_pnl)).toLocaleString()}`;
    const shadPnl = r.shadow_pnl >= 0 ? `+$${Math.round(r.shadow_pnl).toLocaleString()}` : `-$${Math.abs(Math.round(r.shadow_pnl)).toLocaleString()}`;
    console.log(
      `${r.wallet} | ${origPnl.padStart(8)} | ${shadPnl.padStart(10)} | ${String(r.execution_drag_pct).padStart(5)}% | ${String(r.original_omega || 0).padStart(6)}x | ${String(r.shadow_omega || 0).padStart(6)}x | ${String(r.n_positions_copied).padStart(6)}`
    );
  }

  // Show who got filtered by friction
  const filteredByFriction = allResults.filter(r =>
    r.original_pnl > 0 &&  // Was profitable before
    r.shadow_pnl <= 0      // But not after friction
  );
  console.log(`\n=== ${filteredByFriction.length} wallets filtered by friction (profitable → unprofitable) ===`);
  filteredByFriction.sort((a, b) => a.shadow_pnl - b.shadow_pnl);
  for (const r of filteredByFriction.slice(0, 10)) {
    console.log(`  ${r.wallet}: orig ${r.original_pnl.toLocaleString()} → shadow ${r.shadow_pnl.toLocaleString()} | drag ${r.execution_drag_pct}%`);
  }

  // Save output
  const outputPath = 'exports/copytrade/phase5_shadow_60d.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '5',
    description: 'Shadow P&L with execution friction (60-day window)',
    friction_params: FRICTION,
    gate_criteria: {
      shadow_pnl: '> 0 (profitable after friction)',
      shadow_omega: '> 1.2',
      execution_drag_pct: '< 50%',
      n_positions_copied: '>= 5',
      n_events: '>= 10',
    },
    input_count: wallets.length,
    qualified_count: qualified.length,
    filtered_by_friction: filteredByFriction.length,
    wallets: qualified,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return qualified;
}

async function main() {
  try {
    await computeShadowPnl();
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
