/**
 * Phase 3: Compute Copyability Metrics
 *
 * For each qualified candidate, compute:
 * 1. avg_entry_price - Average price paid for tokens (detect safe-bet grinders)
 * 2. entry_price_std - Variety vs repetitive betting
 * 3. avg_hold_hours - Time from buy to resolution/exit (detect scalpers)
 * 4. category_hhi - Herfindahl-Hirschman Index (diversification)
 * 5. time_weighted_pnl - Momentum (recent performance weighted)
 * 6. max_drawdown_pct - Risk estimate
 *
 * Final copyability score combines all factors.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import { CoreMetrics } from './02-compute-core-metrics';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

export interface CopyabilityMetrics extends CoreMetrics {
  avg_entry_price: number;
  entry_price_std: number;
  avg_hold_hours: number;
  category_hhi: number;
  time_weighted_pnl: number;
  max_single_loss: number;
  max_drawdown_pct: number;
  copyability_score: number;
}

export async function computeCopyability(): Promise<CopyabilityMetrics[]> {
  console.log('=== Phase 3: Compute Copyability Metrics ===\n');

  // Load Phase 2 qualified candidates
  const phase2Path = 'exports/copytrade/phase2_core_metrics.json';
  if (!fs.existsSync(phase2Path)) {
    throw new Error('Phase 2 output not found. Run 02-compute-core-metrics.ts first.');
  }
  const phase2 = JSON.parse(fs.readFileSync(phase2Path, 'utf-8'));
  const candidates: CoreMetrics[] = phase2.wallets;
  console.log(`Loaded ${candidates.length} qualified candidates from Phase 2\n`);

  // Process in batches
  const batchSize = 100;
  const allResults: CopyabilityMetrics[] = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w.wallet}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(candidates.length / batchSize);

    console.log(`Processing batch ${batchNum}/${totalBatches}...`);

    // Query 1: Entry price metrics and hold time
    const entryQuery = `
      WITH
        resolutions AS (
          SELECT
            condition_id,
            outcome_index,
            any(resolved_price) AS resolution_price,
            any(resolution_time) AS resolution_time
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ),
        trades AS (
          SELECT
            lower(wallet_address) AS wallet,
            condition_id,
            outcome_index,
            usdc_delta,
            token_delta,
            event_time,
            -- Entry price for buys only (token_delta > 0)
            CASE WHEN token_delta > 0 AND token_delta != 0
              THEN abs(usdc_delta) / token_delta
              ELSE NULL
            END AS entry_price
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) IN (${walletList})
            AND event_time >= now() - INTERVAL 60 DAY
            AND source_type = 'CLOB'
            AND condition_id IS NOT NULL
        ),
        position_times AS (
          SELECT
            t.wallet,
            t.condition_id,
            t.outcome_index,
            min(t.event_time) AS first_trade,
            max(t.event_time) AS last_trade,
            r.resolution_time
          FROM trades t
          LEFT JOIN resolutions r
            ON t.condition_id = r.condition_id
            AND t.outcome_index = r.outcome_index
          GROUP BY t.wallet, t.condition_id, t.outcome_index, r.resolution_time
        )
      SELECT
        wallet,
        -- Average entry price (weighted by notional)
        round(sumIf(abs(usdc_delta), token_delta > 0) / nullIf(sumIf(token_delta, token_delta > 0), 0), 4) AS avg_entry_price,
        -- Entry price std deviation
        round(stddevPopIf(entry_price, entry_price IS NOT NULL AND entry_price > 0 AND entry_price < 1), 4) AS entry_price_std,
        -- Hold time calculation from position_times
        0 AS avg_hold_hours_placeholder
      FROM trades
      GROUP BY wallet
    `;

    // Query 2: Hold time and max loss (separate for clarity)
    const holdTimeQuery = `
      WITH
        resolutions AS (
          SELECT condition_id, outcome_index,
            any(resolved_price) AS resolution_price,
            any(resolution_time) AS resolution_time
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
            min(event_time) AS first_trade,
            max(event_time) AS last_trade
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) IN (${walletList})
            AND event_time >= now() - INTERVAL 60 DAY
            AND source_type = 'CLOB'
          GROUP BY wallet, condition_id, outcome_index
        ),
        position_pnl AS (
          SELECT
            p.wallet,
            p.condition_id,
            p.first_trade,
            coalesce(r.resolution_time, p.last_trade) AS end_time,
            CASE WHEN r.resolution_price IS NOT NULL
              THEN p.cash_flow + (p.final_tokens * r.resolution_price)
              ELSE NULL
            END AS realized_pnl
          FROM positions p
          LEFT JOIN resolutions r
            ON p.condition_id = r.condition_id
            AND p.outcome_index = r.outcome_index
        )
      SELECT
        wallet,
        round(avg(dateDiff('hour', first_trade, end_time)), 1) AS avg_hold_hours,
        round(minIf(realized_pnl, realized_pnl IS NOT NULL), 2) AS max_single_loss
      FROM position_pnl
      GROUP BY wallet
    `;

    // Query 3: Category concentration (HHI)
    const categoryQuery = `
      WITH
        resolutions AS (
          SELECT condition_id, outcome_index, any(resolved_price) AS resolution_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ),
        positions AS (
          SELECT
            lower(wallet_address) AS wallet,
            condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow,
            sum(token_delta) AS final_tokens
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) IN (${walletList})
            AND event_time >= now() - INTERVAL 60 DAY
            AND source_type = 'CLOB'
          GROUP BY wallet, condition_id, outcome_index
        ),
        position_pnl AS (
          SELECT
            p.wallet,
            p.condition_id,
            CASE WHEN r.resolution_price IS NOT NULL
              THEN p.cash_flow + (p.final_tokens * r.resolution_price)
              ELSE 0
            END AS realized_pnl
          FROM positions p
          LEFT JOIN resolutions r USING (condition_id, outcome_index)
        ),
        categories AS (
          SELECT condition_id, any(category) AS category
          FROM pm_token_to_condition_map_v5
          GROUP BY condition_id
        ),
        wallet_category_pnl AS (
          SELECT
            pp.wallet,
            coalesce(c.category, 'Unknown') AS category,
            sum(pp.realized_pnl) AS category_pnl
          FROM position_pnl pp
          LEFT JOIN categories c ON pp.condition_id = c.condition_id
          GROUP BY pp.wallet, category
        ),
        wallet_totals AS (
          SELECT wallet, sum(abs(category_pnl)) AS total_abs_pnl
          FROM wallet_category_pnl
          GROUP BY wallet
        )
      SELECT
        wcp.wallet,
        -- HHI = sum of squared shares
        round(sum(pow(wcp.category_pnl / nullIf(wt.total_abs_pnl, 0), 2)), 4) AS category_hhi
      FROM wallet_category_pnl wcp
      JOIN wallet_totals wt ON wcp.wallet = wt.wallet
      GROUP BY wcp.wallet
    `;

    // Query 4: Time-weighted P&L (7d, 30d, 60d)
    const timeWeightedQuery = `
      WITH
        resolutions AS (
          SELECT condition_id, outcome_index, any(resolved_price) AS resolution_price
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
            max(event_time) AS last_trade
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) IN (${walletList})
            AND event_time >= now() - INTERVAL 60 DAY
            AND source_type = 'CLOB'
          GROUP BY wallet, condition_id, outcome_index
        ),
        position_pnl AS (
          SELECT
            p.wallet,
            p.last_trade,
            CASE WHEN r.resolution_price IS NOT NULL
              THEN p.cash_flow + (p.final_tokens * r.resolution_price)
              ELSE 0
            END AS realized_pnl
          FROM positions p
          LEFT JOIN resolutions r USING (condition_id, outcome_index)
        )
      SELECT
        wallet,
        round(
          0.50 * sumIf(realized_pnl, last_trade >= now() - INTERVAL 7 DAY) +
          0.35 * sumIf(realized_pnl, last_trade >= now() - INTERVAL 30 DAY) +
          0.15 * sum(realized_pnl)
        , 2) AS time_weighted_pnl
      FROM position_pnl
      GROUP BY wallet
    `;

    try {
      // Run all queries in parallel
      const [entryResult, holdResult, categoryResult, timeResult] = await Promise.all([
        ch.query({ query: entryQuery, format: 'JSONEachRow' }),
        ch.query({ query: holdTimeQuery, format: 'JSONEachRow' }),
        ch.query({ query: categoryQuery, format: 'JSONEachRow' }),
        ch.query({ query: timeWeightedQuery, format: 'JSONEachRow' }),
      ]);

      const entryData = await entryResult.json() as any[];
      const holdData = await holdResult.json() as any[];
      const categoryData = await categoryResult.json() as any[];
      const timeData = await timeResult.json() as any[];

      // Create lookup maps
      const entryMap = new Map(entryData.map(d => [d.wallet, d]));
      const holdMap = new Map(holdData.map(d => [d.wallet, d]));
      const categoryMap = new Map(categoryData.map(d => [d.wallet, d]));
      const timeMap = new Map(timeData.map(d => [d.wallet, d]));

      // Merge with base candidates
      for (const c of batch) {
        const entry = entryMap.get(c.wallet) || {};
        const hold = holdMap.get(c.wallet) || {};
        const cat = categoryMap.get(c.wallet) || {};
        const time = timeMap.get(c.wallet) || {};

        const avgEntryPrice = entry.avg_entry_price || 0.5;
        const entryPriceStd = entry.entry_price_std || 0.1;
        const avgHoldHours = hold.avg_hold_hours || 24;
        const categoryHhi = cat.category_hhi || 0.25;
        const timeWeightedPnl = time.time_weighted_pnl || c.pnl_60d;
        const maxSingleLoss = Math.abs(hold.max_single_loss || 0);

        // Calculate max drawdown estimate
        const maxDrawdownPct = c.gross_wins > 0 ? maxSingleLoss / c.gross_wins : 0.5;

        // Calculate copyability score
        const safeBetPenalty = avgEntryPrice > 0.90 ? 0.3 :
                               avgEntryPrice > 0.85 ? 0.6 :
                               avgEntryPrice > 0.80 ? 0.8 : 1.0;

        const holdTimeBonus = avgHoldHours > 24 ? 1.3 :
                              avgHoldHours > 4 ? 1.1 :
                              avgHoldHours < 0.5 ? 0.5 : 1.0;

        const concentrationPenalty = 1 / (1 + categoryHhi);

        const copyabilityScore = c.omega *
                                  safeBetPenalty *
                                  holdTimeBonus *
                                  concentrationPenalty *
                                  Math.pow(c.pnl_60d / 10000, 0.3);

        allResults.push({
          ...c,
          avg_entry_price: avgEntryPrice,
          entry_price_std: entryPriceStd,
          avg_hold_hours: avgHoldHours,
          category_hhi: categoryHhi,
          time_weighted_pnl: timeWeightedPnl,
          max_single_loss: maxSingleLoss,
          max_drawdown_pct: Math.round(maxDrawdownPct * 100) / 100,
          copyability_score: Math.round(copyabilityScore * 100) / 100,
        });
      }
    } catch (err) {
      console.log(`  Batch ${batchNum} error: ${(err as Error).message.slice(0, 100)}`);
      // Add candidates without copyability data
      for (const c of batch) {
        allResults.push({
          ...c,
          avg_entry_price: 0.5,
          entry_price_std: 0.1,
          avg_hold_hours: 24,
          category_hhi: 0.25,
          time_weighted_pnl: c.pnl_60d,
          max_single_loss: 0,
          max_drawdown_pct: 0.5,
          copyability_score: c.omega,
        });
      }
    }
  }

  // Sort by copyability score
  allResults.sort((a, b) => b.copyability_score - a.copyability_score);

  // Filter out safe-bet grinders (avg entry > 85%)
  const filtered = allResults.filter(r => r.avg_entry_price < 0.85);
  console.log(`\nFiltered out ${allResults.length - filtered.length} safe-bet grinders (avg entry > 85%)`);
  console.log(`Remaining: ${filtered.length} wallets\n`);

  // Display top 30
  console.log('Top 30 by Copyability Score:');
  console.log('Wallet                                     | Omega | AvgEntry | HoldHrs | HHI  | Copyability');
  console.log('-------------------------------------------|-------|----------|---------|------|------------');
  for (const r of filtered.slice(0, 30)) {
    console.log(
      `${r.wallet} | ${String(r.omega).padStart(5)}x | ${(r.avg_entry_price * 100).toFixed(1).padStart(6)}% | ${String(r.avg_hold_hours).padStart(7)} | ${r.category_hhi.toFixed(2)} | ${r.copyability_score.toFixed(2)}`
    );
  }

  // Save output
  const outputPath = 'exports/copytrade/phase3_copyability.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: 3,
    description: 'Copyability metrics and scores',
    metrics_computed: [
      'avg_entry_price - Average price paid (detect safe-bet grinders)',
      'entry_price_std - Variety in entry prices',
      'avg_hold_hours - Time from buy to exit (detect scalpers)',
      'category_hhi - Concentration index (diversification)',
      'time_weighted_pnl - Momentum (recent performance)',
      'max_drawdown_pct - Risk estimate',
      'copyability_score - Combined score',
    ],
    filter_applied: 'avg_entry_price < 0.85 (no safe-bet grinders)',
    input_count: candidates.length,
    output_count: filtered.length,
    wallets: filtered,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return filtered;
}

async function main() {
  try {
    await computeCopyability();
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
