/**
 * Phase 3: Refined Portfolio with Phantom Losses + Whale Risk Filter
 *
 * Fixes two critical issues:
 * 1. PHANTOM LOSSES: Positions where market ended but no resolution in our data
 *    - If market ended AND wallet holds tokens → assume worst case (loss = cash spent)
 * 2. WHALE RISK: High-visibility wallets are likely already copied, edge arbitraged away
 *    - Filter out wallets with > $200k realized P&L (too visible)
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

interface RefinedMetrics {
  wallet: string;
  // Known resolved
  resolved_pnl: number;
  n_resolved: number;
  n_wins: number;
  n_losses: number;
  gross_wins: number;
  gross_losses: number;
  // Phantom losses (ended markets with no resolution)
  phantom_loss: number;
  n_phantom_positions: number;
  // Combined
  total_pnl: number;
  omega: number;
  win_pct: number;
  // Activity
  n_events: number;
  total_notional: number;
  first_trade: string;
  last_trade: string;
  tier: string;
}

async function computeRefinedMetrics(): Promise<RefinedMetrics[]> {
  console.log('=== Phase 3: Refined Portfolio with Phantom Losses ===\n');
  console.log('KEY FIXES:');
  console.log('  1. Phantom losses: Markets that ended but no resolution → assume loss');
  console.log('  2. Whale filter: Exclude >$200k realized (too visible, copied already)');
  console.log();

  // Load Phase 1 candidates
  const phase1Path = 'exports/copytrade/phase1_candidates.json';
  if (!fs.existsSync(phase1Path)) {
    throw new Error('Phase 1 output not found. Run 01-build-candidate-universe.ts first.');
  }
  const phase1 = JSON.parse(fs.readFileSync(phase1Path, 'utf-8'));
  const wallets: string[] = phase1.wallets.map((w: any) => w.wallet);
  console.log(`Loaded ${wallets.length} candidates from Phase 1\n`);

  // Process in batches
  const batchSize = 100;
  const allResults: RefinedMetrics[] = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(wallets.length / batchSize);

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`);

    // Simplified query - compute raw position data, aggregate in code
    const query = `
      SELECT
        wallet,
        count() AS n_positions,
        uniqExact(condition_id) AS n_events,
        sum(abs_cash_flow) AS total_notional,
        -- Resolved metrics
        sum(is_resolved) AS n_resolved,
        sum(is_win) AS n_wins,
        sum(is_loss) AS n_losses,
        sum(rpnl) AS resolved_pnl,
        sum(win_pnl) AS gross_wins,
        sum(loss_pnl) AS gross_losses,
        -- Phantom losses
        sum(phantom_loss) AS phantom_loss,
        sum(is_phantom) AS n_phantom_positions,
        -- Activity
        toString(min(first_trade)) AS first_trade,
        toString(max(last_trade)) AS last_trade
      FROM (
        SELECT
          p.wallet AS wallet,
          p.condition_id AS condition_id,
          abs(p.cash_flow) AS abs_cash_flow,
          p.first_trade AS first_trade,
          p.last_trade AS last_trade,
          -- Resolution status
          if(r.resolution_price IS NOT NULL, 1, 0) AS is_resolved,
          -- Realized P&L
          if(r.resolution_price IS NOT NULL,
            p.cash_flow + (p.final_tokens * r.resolution_price),
            0
          ) AS rpnl,
          -- Win/loss flags
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) > 0, 1, 0) AS is_win,
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) <= 0, 1, 0) AS is_loss,
          -- Win/loss amounts
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) > 0,
            p.cash_flow + (p.final_tokens * r.resolution_price), 0) AS win_pnl,
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) < 0,
            p.cash_flow + (p.final_tokens * r.resolution_price), 0) AS loss_pnl,
          -- PHANTOM LOSS: Market ended/closed, no resolution, holding tokens, spent money
          if(
            r.resolution_price IS NULL
            AND p.final_tokens > 100
            AND p.cash_flow < -100
            AND (m.is_closed = 1 OR (m.end_date IS NOT NULL AND m.end_date < now() - INTERVAL 1 DAY)),
            p.cash_flow,
            0
          ) AS phantom_loss,
          if(
            r.resolution_price IS NULL
            AND p.final_tokens > 100
            AND p.cash_flow < -100
            AND (m.is_closed = 1 OR (m.end_date IS NOT NULL AND m.end_date < now() - INTERVAL 1 DAY)),
            1, 0
          ) AS is_phantom
        FROM (
          SELECT
            lower(wallet_address) AS wallet,
            condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow,
            sum(token_delta) AS final_tokens,
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
        LEFT JOIN (
          SELECT lower(condition_id) AS condition_id, end_date, is_closed
          FROM pm_market_metadata
        ) AS m ON lower(p.condition_id) = m.condition_id
      )
      GROUP BY wallet
    `;

    try {
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const batchResults = await result.json() as any[];

      for (const r of batchResults) {
        const grossWins = Number(r.gross_wins);
        const grossLosses = Math.abs(Number(r.gross_losses));
        const phantomLoss = Math.abs(Number(r.phantom_loss));
        const totalLosses = grossLosses + phantomLoss;

        // Calculate omega (win/loss ratio) including phantom losses
        const omega = totalLosses > 0 ? Math.round((grossWins / totalLosses) * 100) / 100 : 0;

        // Calculate total P&L
        const totalPnl = Number(r.resolved_pnl) + Number(r.phantom_loss);

        allResults.push({
          wallet: r.wallet,
          resolved_pnl: Math.round(Number(r.resolved_pnl) * 100) / 100,
          n_resolved: Number(r.n_resolved),
          n_wins: Number(r.n_wins),
          n_losses: Number(r.n_losses),
          gross_wins: Math.round(grossWins * 100) / 100,
          gross_losses: Math.round(grossLosses * 100) / 100,
          phantom_loss: Math.round(Number(r.phantom_loss) * 100) / 100,
          n_phantom_positions: Number(r.n_phantom_positions),
          total_pnl: Math.round(totalPnl * 100) / 100,
          omega,
          win_pct: Number(r.n_resolved) > 0
            ? Math.round((Number(r.n_wins) / Number(r.n_resolved)) * 1000) / 10
            : 0,
          n_events: Number(r.n_events),
          total_notional: Math.round(Number(r.total_notional) * 100) / 100,
          first_trade: r.first_trade,
          last_trade: r.last_trade,
          tier: 'Unknown',
        });
      }
    } catch (err) {
      console.log(`  Batch ${batchNum} error: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  console.log(`\nComputed refined metrics for ${allResults.length} wallets`);

  // Get Tier info
  console.log('Fetching tier classifications...');
  const tierQuery = `SELECT wallet, confidence_tier FROM pm_wallet_external_activity_60d`;
  const tierResult = await ch.query({ query: tierQuery, format: 'JSONEachRow' });
  const tiers = await tierResult.json() as any[];
  const tierMap = new Map(tiers.map(t => [t.wallet, t.confidence_tier]));

  for (const r of allResults) {
    r.tier = tierMap.get(r.wallet) || 'Unknown';
  }

  // Show phantom loss impact
  const withPhantom = allResults.filter(r => r.phantom_loss < -1000);
  console.log(`\n${withPhantom.length} wallets have significant phantom losses (> $1k)`);
  withPhantom.sort((a, b) => a.phantom_loss - b.phantom_loss);
  console.log('Worst 10:');
  for (const r of withPhantom.slice(0, 10)) {
    console.log(`  ${r.wallet}: phantom ${r.phantom_loss.toLocaleString()} | resolved ${r.resolved_pnl.toLocaleString()} | total ${r.total_pnl.toLocaleString()}`);
  }

  // Gate criteria with whale filter
  const qualified = allResults.filter(r =>
    r.n_events >= 15 &&
    r.n_resolved >= 8 &&
    r.n_losses >= 4 &&
    r.omega > 1.3 &&
    r.omega < 50 &&
    r.total_pnl >= 500 &&              // Must be profitable AFTER phantom losses
    r.total_pnl <= 200000 &&           // WHALE FILTER: Not too big (copied already)
    r.total_notional >= 5000 &&
    r.win_pct >= 45 &&
    r.win_pct <= 90 &&
    r.tier === 'A'                      // CLOB-only, verifiable
  );

  console.log(`\nAfter gates (including whale filter <$200k): ${qualified.length} qualified wallets`);

  // Sort by omega (risk-adjusted)
  qualified.sort((a, b) => b.omega - a.omega);

  // Display top 30
  console.log('\n=== TOP 30 REFINED CANDIDATES ===');
  console.log('Wallet                                     | Omega | Win% | Total P&L    | Phantom Loss | Events | Tier');
  console.log('-------------------------------------------|-------|------|--------------|--------------|--------|-----');
  for (const r of qualified.slice(0, 30)) {
    const pnl = r.total_pnl >= 0 ? `+$${r.total_pnl.toLocaleString()}` : `-$${Math.abs(r.total_pnl).toLocaleString()}`;
    const phantom = r.phantom_loss < 0 ? `-$${Math.abs(r.phantom_loss).toLocaleString()}` : '$0';
    console.log(
      `${r.wallet} | ${String(r.omega).padStart(5)}x | ${String(r.win_pct).padStart(4)}% | ${pnl.padStart(12)} | ${phantom.padStart(12)} | ${String(r.n_events).padStart(6)} | ${r.tier}`
    );
  }

  // Show who got filtered by whale rule
  const whales = allResults.filter(r =>
    r.n_events >= 15 &&
    r.n_resolved >= 8 &&
    r.total_pnl > 200000 &&
    r.omega > 1.3
  );
  console.log(`\n=== ${whales.length} WHALE EXCLUSIONS (>$200k, too visible) ===`);
  whales.sort((a, b) => b.total_pnl - a.total_pnl);
  for (const r of whales.slice(0, 10)) {
    console.log(`  ${r.wallet}: $${r.total_pnl.toLocaleString()} | omega ${r.omega} | ${r.n_events} events`);
  }

  // Show who got filtered by phantom losses
  const phantomFiltered = allResults.filter(r =>
    r.resolved_pnl >= 500 &&  // Would have passed
    r.total_pnl < 500         // But didn't after phantom
  );
  console.log(`\n=== ${phantomFiltered.length} FILTERED BY PHANTOM LOSSES ===`);
  console.log('(Looked profitable on resolved, but hidden losses on ended markets)');
  phantomFiltered.sort((a, b) => a.total_pnl - b.total_pnl);
  for (const r of phantomFiltered.slice(0, 10)) {
    console.log(`  ${r.wallet}: resolved ${r.resolved_pnl.toLocaleString()} → total ${r.total_pnl.toLocaleString()} | phantom: ${r.phantom_loss.toLocaleString()}`);
  }

  // Save output
  const outputPath = 'exports/copytrade/phase3_refined.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '3',
    description: 'Refined portfolio with phantom losses + whale filter',
    key_fixes: [
      'Phantom losses: Markets ended but no resolution → assume loss',
      'Whale filter: Exclude >$200k (too visible, copied already)',
      'Tier A only: CLOB-only wallets',
    ],
    gate_criteria: {
      n_events: '>= 15',
      n_resolved: '>= 8',
      n_losses: '>= 4',
      omega: '1.3 - 50',
      total_pnl: '$500 - $200,000',
      total_notional: '>= $5,000',
      win_pct: '45-90%',
      tier: 'A (CLOB-only)',
    },
    input_count: wallets.length,
    qualified_count: qualified.length,
    whale_exclusions: whales.length,
    phantom_filtered: phantomFiltered.length,
    wallets: qualified,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return qualified;
}

async function main() {
  try {
    await computeRefinedMetrics();
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
