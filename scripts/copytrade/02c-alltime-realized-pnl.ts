/**
 * Phase 2C: Compute ALL-TIME Realized P&L
 *
 * KEY FIX: Removes the 60-day filter to get true historical performance.
 * This is a copy of the working 02-compute-core-metrics.ts but with NO time filter.
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

export interface AllTimeMetrics {
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
  realized_pnl: number;
  gross_wins: number;
  gross_losses: number;
  first_trade: string;
  last_trade: string;
  tier?: string;
}

export async function computeAllTimeRealizedPnl(wallets?: string[]): Promise<AllTimeMetrics[]> {
  console.log('=== Phase 2C: Compute ALL-TIME Realized P&L ===\n');
  console.log('KEY FIX: NO 60-day filter - using all historical data\n');

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

  // Process in batches
  const batchSize = 200;
  const allResults: AllTimeMetrics[] = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(wallets.length / batchSize);

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`);

    // Restructured query to avoid ClickHouse nested aggregate error
    // Pre-computes all PnL values in subquery to avoid referencing aggregated values
    const query = `
      SELECT
        wallet,
        count() AS n_positions,
        uniqExact(condition_id) AS n_events,
        sum(trade_count) AS n_trades,
        round(sum(abs_cash_flow), 2) AS total_notional,
        sum(is_resolved) AS n_resolved,
        sum(is_win) AS n_wins,
        sum(is_loss) AS n_losses,
        round(sum(is_win) / nullIf(sum(is_resolved), 0) * 100, 1) AS win_pct,
        round(sum(win_pnl) / nullIf(abs(sum(loss_pnl)), 0), 2) AS omega,
        round(sum(rpnl), 2) AS realized_pnl,
        round(sum(win_pnl), 2) AS gross_wins,
        round(abs(sum(loss_pnl)), 2) AS gross_losses,
        toString(min(first_trade)) AS first_trade,
        toString(max(last_trade)) AS last_trade
      FROM (
        SELECT
          p.wallet,
          p.condition_id,
          abs(p.cash_flow) AS abs_cash_flow,
          p.trade_count,
          p.first_trade,
          p.last_trade,
          if(r.resolution_price IS NOT NULL, 1, 0) AS is_resolved,
          if(r.resolution_price IS NOT NULL,
            p.cash_flow + (p.final_tokens * r.resolution_price),
            0
          ) AS rpnl,
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) > 0, 1, 0) AS is_win,
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) <= 0, 1, 0) AS is_loss,
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) > 0,
            p.cash_flow + (p.final_tokens * r.resolution_price), 0) AS win_pnl,
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) < 0,
            p.cash_flow + (p.final_tokens * r.resolution_price), 0) AS loss_pnl
        FROM (
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
            AND source_type = 'CLOB'
            AND condition_id IS NOT NULL
            AND condition_id != ''
          GROUP BY wallet, condition_id, outcome_index
        ) AS p
        LEFT JOIN (
          SELECT condition_id, outcome_index, any(resolved_price) AS resolution_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ) AS r ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
      )
      GROUP BY wallet
    `;

    try {
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const batchResults = await result.json() as AllTimeMetrics[];
      allResults.push(...batchResults);
    } catch (err) {
      console.log(`  Batch ${batchNum} error: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  console.log(`\nComputed ALL-TIME realized P&L for ${allResults.length} wallets`);

  // Get Tier info
  console.log('Fetching tier classifications...');
  const tierQuery = `SELECT wallet, confidence_tier FROM pm_wallet_external_activity_60d`;
  const tierResult = await ch.query({ query: tierQuery, format: 'JSONEachRow' });
  const tiers = await tierResult.json() as any[];
  const tierMap = new Map(tiers.map(t => [t.wallet, t.confidence_tier]));

  for (const r of allResults) {
    r.tier = tierMap.get(r.wallet) || 'Unknown';
  }

  // ALL-TIME gate criteria (must be profitable over ENTIRE history)
  const qualified = allResults.filter(r =>
    r.n_events >= 15 &&           // More events = more reliable
    r.n_resolved >= 8 &&          // More resolved = better data
    r.n_losses >= 4 &&            // Must have taken real losses
    r.omega > 1.3 &&              // Must be profitable
    r.omega < 50 &&
    r.realized_pnl >= 500 &&      // Must be profitable ALL-TIME
    r.total_notional >= 5000 &&
    r.win_pct >= 45 &&
    r.win_pct <= 90
  );

  console.log(`\nAfter ALL-TIME gate criteria: ${qualified.length} qualified wallets`);

  // Sort by realized P&L
  qualified.sort((a, b) => b.realized_pnl - a.realized_pnl);

  // Display top 40
  console.log('\nTop 40 by ALL-TIME Realized P&L:');
  console.log('Wallet                                     | Events | Resol | Win% | Omega | Realized P&L | First Trade | Tier');
  console.log('-------------------------------------------|--------|-------|------|-------|--------------|-------------|-----');
  for (const r of qualified.slice(0, 40)) {
    const pnl = r.realized_pnl >= 0 ? `+$${r.realized_pnl.toLocaleString()}` : `-$${Math.abs(r.realized_pnl).toLocaleString()}`;
    const firstDate = r.first_trade.slice(0, 10);
    console.log(
      `${r.wallet} | ${String(r.n_events).padStart(6)} | ${String(r.n_resolved).padStart(5)} | ${String(r.win_pct).padStart(4)}% | ${String(r.omega).padStart(5)}x | ${pnl.padStart(12)} | ${firstDate} | ${r.tier}`
    );
  }

  // Show wallets that would have passed with 60-day but fail all-time
  const negative = allResults.filter(r => r.realized_pnl < 0);
  console.log(`\n\n=== ${negative.length} wallets have NEGATIVE all-time P&L ===`);
  console.log('Worst 10 (these might have looked good with 60-day filter):');
  negative.sort((a, b) => a.realized_pnl - b.realized_pnl);
  for (const r of negative.slice(0, 10)) {
    console.log(`  ${r.wallet}: ${r.realized_pnl.toLocaleString()} (${r.n_resolved} resolved, ${r.win_pct}% win rate)`);
  }

  // Save output
  const outputPath = 'exports/copytrade/phase2c_alltime_realized.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '2C',
    description: 'ALL-TIME Realized P&L - NO 60-day filter',
    key_fix: 'Removed 60-day survivorship bias filter',
    gate_criteria: {
      n_events: '>= 15',
      n_resolved: '>= 8',
      n_losses: '>= 4',
      omega: '1.3 - 50',
      realized_pnl: '>= $500 (all-time)',
      total_notional: '>= $5,000',
      win_pct: '45-90%',
    },
    input_count: wallets.length,
    qualified_count: qualified.length,
    negative_pnl_count: negative.length,
    wallets: qualified,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return qualified;
}

async function main() {
  try {
    await computeAllTimeRealizedPnl();
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
