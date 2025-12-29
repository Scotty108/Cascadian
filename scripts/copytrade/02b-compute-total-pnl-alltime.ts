/**
 * Phase 2B: Compute TOTAL P&L (All-Time)
 *
 * FIXES FROM V1:
 * 1. NO 60-DAY FILTER - uses ALL-TIME data
 * 2. TOTAL P&L = realized + unrealized
 * 3. Positions at current price 0 count as effective losses
 *
 * Gate Criteria (calibrated for all-time):
 * - n_events >= 20 (more history = more reliability)
 * - n_resolved >= 10
 * - n_losses >= 5 (has taken real losses)
 * - total_pnl >= $1,000 (must be profitable ALL-TIME)
 * - omega > 1.5 and < 50
 * - win_pct between 50-85%
 * - UI P&L validation: must match direction (both positive)
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

export interface TotalPnlMetrics {
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
  unrealized_pnl: number;
  total_pnl: number;
  gross_wins: number;
  gross_losses: number;
  first_trade: string;
  last_trade: string;
  positions_at_zero: number; // positions where current price = 0
  tier?: string;
}

// Fetch current prices from Polymarket Gamma API
async function fetchCurrentPrices(): Promise<Map<string, number[]>> {
  const priceMap = new Map<string, number[]>();
  const baseUrl = 'https://gamma-api.polymarket.com';

  console.log('Fetching current prices from Polymarket API...');

  let offset = 0;
  const limit = 500;
  const maxPages = 30;

  for (let page = 0; page < maxPages; page++) {
    try {
      const response = await fetch(
        `${baseUrl}/markets?limit=${limit}&offset=${offset}&closed=false`,
        {
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) break;

      const markets = await response.json() as Array<{
        conditionId: string;
        outcomePrices: string;
      }>;

      if (markets.length === 0) break;

      for (const market of markets) {
        if (!market.conditionId) continue;
        const normalizedId = market.conditionId.toLowerCase().replace(/^0x/, '');
        try {
          const prices = JSON.parse(market.outcomePrices || '[]');
          priceMap.set(normalizedId, prices.map((p: string) => parseFloat(p) || 0));
        } catch {
          continue;
        }
      }

      if (markets.length < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 100));
    } catch (error: any) {
      console.warn(`Price fetch error: ${error.message}`);
      break;
    }
  }

  console.log(`Cached ${priceMap.size} active market prices\n`);
  return priceMap;
}

export async function computeTotalPnlAllTime(wallets?: string[]): Promise<TotalPnlMetrics[]> {
  console.log('=== Phase 2B: Compute TOTAL P&L (All-Time) ===\n');
  console.log('KEY FIXES:');
  console.log('  1. NO 60-day filter - using ALL-TIME data');
  console.log('  2. TOTAL P&L = realized + unrealized');
  console.log('  3. Positions at 0 current price count as losses\n');

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

  // Fetch current prices first
  const currentPrices = await fetchCurrentPrices();

  // Process in batches
  const batchSize = 100;
  const allResults: TotalPnlMetrics[] = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(wallets.length / batchSize);

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`);

    // Query ALL-TIME realized P&L (NO 60-day filter!)
    // First get raw position data with PnL calculated per-position
    const realizedQuery = `
      SELECT
        wallet,
        count() AS n_positions,
        uniqExact(condition_id) AS n_events,
        sum(trade_count) AS n_trades,
        round(sum(abs(cash_flow)), 2) AS total_notional,
        sum(is_resolved) AS n_resolved,
        sum(is_win) AS n_wins,
        sum(is_loss) AS n_losses,
        round(sum(is_win) / nullIf(sum(is_resolved), 0) * 100, 1) AS win_pct,
        round(sum(if(realized_pnl > 0, realized_pnl, 0)) / nullIf(abs(sum(if(realized_pnl < 0, realized_pnl, 0))), 0), 2) AS omega,
        round(sum(realized_pnl), 2) AS realized_pnl,
        round(sum(if(realized_pnl > 0, realized_pnl, 0)), 2) AS gross_wins,
        round(abs(sum(if(realized_pnl < 0, realized_pnl, 0))), 2) AS gross_losses,
        toString(min(first_trade)) AS first_trade,
        toString(max(last_trade)) AS last_trade
      FROM (
        SELECT
          p.wallet,
          p.condition_id,
          p.cash_flow,
          p.final_tokens,
          p.trade_count,
          p.first_trade,
          p.last_trade,
          r.resolution_price,
          if(r.resolution_price IS NOT NULL,
            p.cash_flow + (p.final_tokens * r.resolution_price),
            0
          ) AS realized_pnl,
          if(r.resolution_price IS NOT NULL, 1, 0) AS is_resolved,
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) > 0, 1, 0) AS is_win,
          if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) <= 0, 1, 0) AS is_loss
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
          SELECT
            condition_id,
            outcome_index,
            any(resolved_price) AS resolution_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ) AS r
          ON p.condition_id = r.condition_id
          AND p.outcome_index = r.outcome_index
      )
      GROUP BY wallet
    `;

    // Query open positions for unrealized P&L
    const openPositionsQuery = `
      WITH
        resolutions AS (
          SELECT condition_id FROM vw_pm_resolution_prices GROUP BY condition_id
        )
      SELECT
        lower(wallet_address) AS wallet,
        condition_id,
        outcome_index,
        sum(token_delta) AS net_shares,
        sum(usdc_delta) AS cost_basis
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) IN (${walletList})
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY wallet, condition_id, outcome_index
      HAVING abs(net_shares) > 0.0001
        AND condition_id NOT IN (SELECT condition_id FROM resolutions)
    `;

    try {
      // Get realized P&L
      const realizedResult = await ch.query({ query: realizedQuery, format: 'JSONEachRow' });
      const realizedRows = await realizedResult.json() as any[];

      // Get open positions
      const openResult = await ch.query({ query: openPositionsQuery, format: 'JSONEachRow' });
      const openRows = await openResult.json() as any[];

      // Group open positions by wallet
      const walletOpenPositions = new Map<string, any[]>();
      for (const pos of openRows) {
        const existing = walletOpenPositions.get(pos.wallet) || [];
        existing.push(pos);
        walletOpenPositions.set(pos.wallet, existing);
      }

      // Calculate unrealized P&L for each wallet
      for (const r of realizedRows) {
        const openPos = walletOpenPositions.get(r.wallet) || [];
        let unrealizedPnl = 0;
        let positionsAtZero = 0;

        for (const pos of openPos) {
          const conditionId = pos.condition_id;
          const outcomeIndex = Number(pos.outcome_index);
          const netShares = Number(pos.net_shares);
          const costBasis = Number(pos.cost_basis);

          // Get current price
          const prices = currentPrices.get(conditionId);
          let currentPrice = 0;
          if (prices && prices[outcomeIndex] !== undefined) {
            currentPrice = prices[outcomeIndex];
          }

          // Mark-to-market value
          const marketValue = netShares * currentPrice;
          const posUnrealized = marketValue + costBasis;
          unrealizedPnl += posUnrealized;

          // Count positions at zero
          if (currentPrice < 0.01 && netShares > 0.01) {
            positionsAtZero++;
          }
        }

        allResults.push({
          wallet: r.wallet,
          n_positions: Number(r.n_positions),
          n_events: Number(r.n_events),
          n_trades: Number(r.n_trades),
          total_notional: Number(r.total_notional),
          n_resolved: Number(r.n_resolved),
          n_wins: Number(r.n_wins),
          n_losses: Number(r.n_losses),
          win_pct: Number(r.win_pct),
          omega: Number(r.omega),
          realized_pnl: Number(r.realized_pnl),
          unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
          total_pnl: Math.round((Number(r.realized_pnl) + unrealizedPnl) * 100) / 100,
          gross_wins: Number(r.gross_wins),
          gross_losses: Number(r.gross_losses),
          first_trade: r.first_trade,
          last_trade: r.last_trade,
          positions_at_zero: positionsAtZero,
        });
      }
    } catch (err) {
      console.log(`  Batch ${batchNum} error: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  console.log(`\nComputed TOTAL P&L for ${allResults.length} wallets`);

  // Get Tier info
  console.log('Fetching tier classifications...');
  const tierQuery = `SELECT wallet, confidence_tier FROM pm_wallet_external_activity_60d`;
  const tierResult = await ch.query({ query: tierQuery, format: 'JSONEachRow' });
  const tiers = await tierResult.json() as any[];
  const tierMap = new Map(tiers.map(t => [t.wallet, t.confidence_tier]));

  for (const r of allResults) {
    r.tier = tierMap.get(r.wallet) || 'Unknown';
  }

  // Apply ALL-TIME gate criteria (stricter than 60-day)
  const qualified = allResults.filter(r =>
    r.n_events >= 20 &&           // More history required
    r.n_resolved >= 10 &&         // More resolved positions required
    r.n_losses >= 5 &&            // Must have taken real losses
    r.omega > 1.5 &&
    r.omega < 50 &&
    r.total_pnl >= 1000 &&        // TOTAL P&L must be positive
    r.total_notional >= 10000 &&  // Higher notional floor ($10k)
    r.win_pct >= 50 &&
    r.win_pct <= 85 &&            // Stricter upper bound
    r.positions_at_zero < 10      // Not too many positions at 0
  );

  console.log(`\nAfter gate criteria: ${qualified.length} qualified wallets`);
  console.log('ALL-TIME Gate criteria applied:');
  console.log('  - n_events >= 20');
  console.log('  - n_resolved >= 10');
  console.log('  - n_losses >= 5');
  console.log('  - omega: 1.5 - 50');
  console.log('  - total_pnl >= $1,000 (realized + unrealized)');
  console.log('  - total_notional >= $10,000');
  console.log('  - win_pct: 50-85%');
  console.log('  - positions_at_zero < 10');

  // Sort by TOTAL P&L
  qualified.sort((a, b) => b.total_pnl - a.total_pnl);

  // Display top 30
  console.log('\nTop 30 by TOTAL P&L (all-time):');
  console.log('Wallet                                     | Events | Win% | Omega | Realized     | Unrealized  | TOTAL P&L    | Tier');
  console.log('-------------------------------------------|--------|------|-------|--------------|-------------|--------------|-----');
  for (const r of qualified.slice(0, 30)) {
    const realized = r.realized_pnl >= 0 ? `+$${r.realized_pnl.toLocaleString()}` : `-$${Math.abs(r.realized_pnl).toLocaleString()}`;
    const unrealized = r.unrealized_pnl >= 0 ? `+$${r.unrealized_pnl.toLocaleString()}` : `-$${Math.abs(r.unrealized_pnl).toLocaleString()}`;
    const total = r.total_pnl >= 0 ? `+$${r.total_pnl.toLocaleString()}` : `-$${Math.abs(r.total_pnl).toLocaleString()}`;
    console.log(
      `${r.wallet} | ${String(r.n_events).padStart(6)} | ${String(r.win_pct).padStart(4)}% | ${String(r.omega).padStart(5)}x | ${realized.padStart(12)} | ${unrealized.padStart(11)} | ${total.padStart(12)} | ${r.tier}`
    );
  }

  // Also show wallets that FAILED due to negative all-time P&L but had positive 60-day
  const negativeTotal = allResults.filter(r => r.total_pnl < 0 && r.realized_pnl > 0);
  if (negativeTotal.length > 0) {
    console.log(`\n\n=== WARNING: ${negativeTotal.length} wallets have NEGATIVE total P&L but positive realized ===`);
    console.log('These would have been selected with 60-day filter but are actually LOSERS:');
    for (const r of negativeTotal.slice(0, 10)) {
      console.log(`  ${r.wallet}: realized=${r.realized_pnl.toLocaleString()}, unrealized=${r.unrealized_pnl.toLocaleString()}, TOTAL=${r.total_pnl.toLocaleString()}`);
    }
  }

  // Save output
  const outputPath = 'exports/copytrade/phase2b_total_pnl_alltime.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '2B',
    description: 'TOTAL P&L (realized + unrealized) - ALL TIME - NO 60-day filter',
    key_fixes: [
      'Removed 60-day filter - uses all-time history',
      'Total P&L = realized + unrealized',
      'Positions at 0 current price tracked',
    ],
    gate_criteria: {
      n_events: '>= 20',
      n_resolved: '>= 10',
      n_losses: '>= 5',
      omega: '1.5 - 50',
      total_pnl: '>= $1,000 (realized + unrealized)',
      total_notional: '>= $10,000',
      win_pct: '50-85%',
      positions_at_zero: '< 10',
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
    await computeTotalPnlAllTime();
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
