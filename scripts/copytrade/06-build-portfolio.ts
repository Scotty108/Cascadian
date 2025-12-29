/**
 * Phase 6: Build Diversified Portfolio
 *
 * Uses capped portfolio construction (NOT pseudo-Kelly):
 * - Tier 1 (Conservative): 4 wallets × $150 = $600 (60%)
 * - Tier 2 (Balanced): 4 wallets × $75 = $300 (30%)
 * - Tier 3 (Aggressive): 2 wallets × $50 = $100 (10%)
 *
 * Diversification constraints:
 * - Max 2 wallets from same strategy type
 * - Max 3 wallets from same category
 * - Must include multiple strategy types
 */
import * as fs from 'fs';
import { ShadowMetrics } from './05-shadow-simulation';

// Portfolio construction config
const PORTFOLIO_CONFIG = {
  total_capital: 1000,
  tiers: {
    conservative: { count: 4, allocation_each: 150 },
    balanced: { count: 4, allocation_each: 75 },
    aggressive: { count: 2, allocation_each: 50 },
  },
  diversification: {
    max_same_strategy: 2,
    max_same_category: 3,
    min_strategies: 3,
  },
  alternates_per_tier: 2,
};

export interface PortfolioWallet extends ShadowMetrics {
  allocation_usd: number;
  portfolio_tier: 'conservative' | 'balanced' | 'aggressive';
  selection_rank: number;
  selection_reason: string;
}

export interface PortfolioResult {
  selected: PortfolioWallet[];
  alternates: PortfolioWallet[];
  diversification: {
    strategies: Record<string, number>;
    categories: Record<string, number>;
  };
}

export async function buildPortfolio(): Promise<PortfolioResult> {
  console.log('=== Phase 6: Build Diversified Portfolio ===\n');
  console.log('Portfolio Construction:');
  console.log(`  Total Capital: $${PORTFOLIO_CONFIG.total_capital}`);
  console.log(`  Conservative (4 × $150): $600 (60%)`);
  console.log(`  Balanced (4 × $75): $300 (30%)`);
  console.log(`  Aggressive (2 × $50): $100 (10%)`);
  console.log('');

  // Load Phase 5 output
  const phase5Path = 'exports/copytrade/phase5_shadow.json';
  if (!fs.existsSync(phase5Path)) {
    throw new Error('Phase 5 output not found. Run 05-shadow-simulation.ts first.');
  }
  const phase5 = JSON.parse(fs.readFileSync(phase5Path, 'utf-8'));
  const candidates: ShadowMetrics[] = phase5.wallets;
  console.log(`Loaded ${candidates.length} shadow-validated candidates from Phase 5\n`);

  // Track selection state
  const selected: PortfolioWallet[] = [];
  const alternates: PortfolioWallet[] = [];
  const strategyCount: Record<string, number> = {};
  const categoryCount: Record<string, number> = {};

  // Selection scoring function
  const scoreCandidate = (c: ShadowMetrics): number => {
    return (
      c.shadow_omega * 0.4 +
      c.copyability_score * 0.3 +
      (c.time_weighted_pnl / 10000) * 0.2 +
      (100 - c.execution_drag * 100) * 0.1
    );
  };

  // Check diversification constraints
  const passesDiversification = (candidate: ShadowMetrics): boolean => {
    const stratCount = strategyCount[candidate.strategy_type] || 0;
    const catCount = categoryCount[candidate.primary_category] || 0;

    return (
      stratCount < PORTFOLIO_CONFIG.diversification.max_same_strategy &&
      catCount < PORTFOLIO_CONFIG.diversification.max_same_category
    );
  };

  // Add to portfolio
  const addToPortfolio = (
    candidate: ShadowMetrics,
    tier: 'conservative' | 'balanced' | 'aggressive',
    allocation: number,
    rank: number,
    reason: string
  ) => {
    selected.push({
      ...candidate,
      allocation_usd: allocation,
      portfolio_tier: tier,
      selection_rank: rank,
      selection_reason: reason,
    });
    strategyCount[candidate.strategy_type] = (strategyCount[candidate.strategy_type] || 0) + 1;
    categoryCount[candidate.primary_category] = (categoryCount[candidate.primary_category] || 0) + 1;
  };

  // Process each tier
  for (const tier of ['conservative', 'balanced', 'aggressive'] as const) {
    const tierConfig = PORTFOLIO_CONFIG.tiers[tier];
    console.log(`\nSelecting ${tier} tier (${tierConfig.count} wallets × $${tierConfig.allocation_each})...`);

    // Filter candidates for this tier
    let tierCandidates = candidates.filter(c => c.risk_profile === tier);

    // If not enough in exact tier, allow adjacent tiers
    if (tierCandidates.length < tierConfig.count + PORTFOLIO_CONFIG.alternates_per_tier) {
      if (tier === 'conservative') {
        tierCandidates = candidates.filter(c =>
          c.risk_profile === 'conservative' || c.risk_profile === 'balanced'
        );
      } else if (tier === 'aggressive') {
        tierCandidates = candidates.filter(c =>
          c.risk_profile === 'aggressive' || c.risk_profile === 'balanced'
        );
      }
    }

    // Sort by score
    tierCandidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

    console.log(`  Found ${tierCandidates.length} candidates for ${tier} tier`);

    // Select with diversification
    let selectedCount = 0;
    let alternateCount = 0;

    for (const candidate of tierCandidates) {
      if (selectedCount >= tierConfig.count) {
        // Check for alternates
        if (alternateCount < PORTFOLIO_CONFIG.alternates_per_tier) {
          if (passesDiversification(candidate)) {
            alternates.push({
              ...candidate,
              allocation_usd: tierConfig.allocation_each,
              portfolio_tier: tier,
              selection_rank: selected.length + alternates.length + 1,
              selection_reason: `Alternate for ${tier} tier`,
            });
            alternateCount++;
          }
        }
        continue;
      }

      if (passesDiversification(candidate)) {
        const reason = generateSelectionReason(candidate, tier);
        addToPortfolio(candidate, tier, tierConfig.allocation_each, selected.length + 1, reason);
        selectedCount++;
        console.log(`  ✓ Selected: ${candidate.wallet.slice(0, 10)}... (${candidate.strategy_type})`);
      }
    }

    console.log(`  Selected ${selectedCount}/${tierConfig.count} for ${tier}`);
  }

  // Validate diversification
  const uniqueStrategies = Object.keys(strategyCount).length;
  if (uniqueStrategies < PORTFOLIO_CONFIG.diversification.min_strategies) {
    console.log(`\n⚠️ Warning: Only ${uniqueStrategies} strategy types (min: ${PORTFOLIO_CONFIG.diversification.min_strategies})`);
  }

  // Display results
  console.log('\n=== Portfolio Summary ===\n');
  console.log(`Selected: ${selected.length}/10 wallets`);
  console.log(`Alternates: ${alternates.length}`);

  console.log('\nStrategy Distribution:');
  for (const [strategy, count] of Object.entries(strategyCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${strategy.padEnd(14)}: ${count}`);
  }

  console.log('\nCategory Distribution:');
  for (const [cat, count] of Object.entries(categoryCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(16)}: ${count}`);
  }

  // Display selected wallets
  console.log('\n=== Selected Portfolio ===\n');
  console.log('Rank | Tier         | Wallet               | Strategy     | Shadow Ω | Alloc  | Reason');
  console.log('-----|--------------|----------------------|--------------|----------|--------|-------');

  for (const w of selected) {
    console.log(
      `${String(w.selection_rank).padStart(4)} | ${w.portfolio_tier.padEnd(12)} | ${w.wallet.slice(0, 20)} | ${w.strategy_type.padEnd(12)} | ${w.shadow_omega.toFixed(2).padStart(8)}x | $${String(w.allocation_usd).padStart(4)} | ${w.selection_reason.slice(0, 30)}`
    );
  }

  // Total allocation
  const totalAllocated = selected.reduce((sum, w) => sum + w.allocation_usd, 0);
  console.log(`\nTotal Allocated: $${totalAllocated}`);

  // Save output
  const result: PortfolioResult = {
    selected,
    alternates,
    diversification: {
      strategies: strategyCount,
      categories: categoryCount,
    },
  };

  const outputPath = 'exports/copytrade/phase6_portfolio.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: 6,
    description: 'Diversified portfolio with capped tier construction',
    config: PORTFOLIO_CONFIG,
    summary: {
      total_wallets: selected.length,
      total_allocated: totalAllocated,
      alternates_count: alternates.length,
      unique_strategies: uniqueStrategies,
      unique_categories: Object.keys(categoryCount).length,
    },
    ...result,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return result;
}

function generateSelectionReason(candidate: ShadowMetrics, tier: string): string {
  const reasons: string[] = [];

  if (candidate.shadow_omega > 3) {
    reasons.push('High shadow omega');
  }
  if (candidate.execution_drag < 0.15) {
    reasons.push('Low execution drag');
  }
  if (candidate.copyability_score > 5) {
    reasons.push('High copyability');
  }
  if (candidate.win_pct > 70) {
    reasons.push('Strong win rate');
  }
  if (candidate.pnl_60d > 10000) {
    reasons.push('Large P&L');
  }
  if (candidate.avg_hold_hours > 24) {
    reasons.push('Patient holding');
  }

  return reasons.length > 0 ? reasons.join(', ') : `Strong ${tier} candidate`;
}

async function main() {
  await buildPortfolio();
}

if (require.main === module) {
  main().catch(console.error);
}
