/**
 * Phase 4: Strategy Classification
 *
 * Classify each wallet into:
 * - Strategy Type: Value/Contrarian, Momentum, Event-Driven, Generalist, Scalper
 * - Risk Profile: Conservative, Balanced, Aggressive
 *
 * These classifications drive portfolio diversification in Phase 6.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import { CopyabilityMetrics } from './03-compute-copyability';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

export type StrategyType = 'Value' | 'Momentum' | 'Event-Driven' | 'Generalist' | 'Scalper' | 'Mixed';
export type RiskProfile = 'conservative' | 'balanced' | 'aggressive' | 'exclude';

export interface ClassifiedWallet extends CopyabilityMetrics {
  strategy_type: StrategyType;
  risk_profile: RiskProfile;
  primary_category: string;
}

function classifyStrategy(wallet: CopyabilityMetrics): StrategyType {
  const { avg_entry_price, avg_hold_hours, category_hhi, n_events, n_trades } = wallet;

  // Scalper: Very short hold times, high trade count
  if (avg_hold_hours < 1 && n_trades > 100) {
    return 'Scalper';
  }

  // Value/Contrarian: Low entry prices, patient holding
  if (avg_entry_price < 0.40 && wallet.win_pct > 60 && avg_hold_hours > 24) {
    return 'Value';
  }

  // Event-Driven: High category concentration
  if (category_hhi > 0.5) {
    return 'Event-Driven';
  }

  // Generalist: Low concentration, many events
  if (category_hhi < 0.3 && n_events > 20) {
    return 'Generalist';
  }

  // Momentum: Mid-range entries, moderate hold times
  if (avg_entry_price >= 0.45 && avg_entry_price <= 0.75 && avg_hold_hours >= 2 && avg_hold_hours <= 48) {
    return 'Momentum';
  }

  // Default to Mixed if no clear pattern
  return 'Mixed';
}

function classifyRisk(wallet: CopyabilityMetrics): RiskProfile {
  const { omega, max_drawdown_pct, win_pct } = wallet;

  // Conservative: High omega, low drawdown
  if (omega > 4 && max_drawdown_pct < 0.15 && win_pct >= 65) {
    return 'conservative';
  }

  // Balanced: Good omega, moderate drawdown
  if (omega > 2.5 && max_drawdown_pct < 0.25 && win_pct >= 55) {
    return 'balanced';
  }

  // Aggressive: Profitable but higher risk
  if (omega > 1.5 && win_pct >= 50) {
    return 'aggressive';
  }

  // Exclude: Doesn't meet minimum criteria
  return 'exclude';
}

export async function classifyStrategies(): Promise<ClassifiedWallet[]> {
  console.log('=== Phase 4: Strategy Classification ===\n');

  // Load Phase 3 output
  const phase3Path = 'exports/copytrade/phase3_copyability.json';
  if (!fs.existsSync(phase3Path)) {
    throw new Error('Phase 3 output not found. Run 03-compute-copyability.ts first.');
  }
  const phase3 = JSON.parse(fs.readFileSync(phase3Path, 'utf-8'));
  const candidates: CopyabilityMetrics[] = phase3.wallets;
  console.log(`Loaded ${candidates.length} candidates from Phase 3\n`);

  // Get primary category for each wallet
  const walletList = candidates.map(w => `'${w.wallet}'`).join(',');
  const categoryQuery = `
    WITH
      positions AS (
        SELECT
          lower(wallet_address) AS wallet,
          condition_id,
          sum(abs(usdc_delta)) AS position_notional
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) IN (${walletList})
          AND event_time >= now() - INTERVAL 60 DAY
          AND source_type = 'CLOB'
        GROUP BY wallet, condition_id
      ),
      categories AS (
        SELECT condition_id, any(category) AS category
        FROM pm_token_to_condition_map_v5
        GROUP BY condition_id
      ),
      wallet_categories AS (
        SELECT
          p.wallet,
          coalesce(c.category, 'Unknown') AS category,
          sum(p.position_notional) AS category_notional
        FROM positions p
        LEFT JOIN categories c ON p.condition_id = c.condition_id
        GROUP BY p.wallet, category
      ),
      ranked AS (
        SELECT
          wallet,
          category,
          category_notional,
          row_number() OVER (PARTITION BY wallet ORDER BY category_notional DESC) AS rn
        FROM wallet_categories
      )
    SELECT wallet, category AS primary_category
    FROM ranked
    WHERE rn = 1
  `;

  console.log('Fetching primary categories...');
  const catResult = await ch.query({ query: categoryQuery, format: 'JSONEachRow' });
  const catData = await catResult.json() as any[];
  const categoryMap = new Map(catData.map(d => [d.wallet, d.primary_category]));

  // Classify each wallet
  const classified: ClassifiedWallet[] = [];
  const strategyCount: Record<StrategyType, number> = {
    'Value': 0,
    'Momentum': 0,
    'Event-Driven': 0,
    'Generalist': 0,
    'Scalper': 0,
    'Mixed': 0,
  };
  const riskCount: Record<RiskProfile, number> = {
    'conservative': 0,
    'balanced': 0,
    'aggressive': 0,
    'exclude': 0,
  };

  for (const c of candidates) {
    const strategy = classifyStrategy(c);
    const risk = classifyRisk(c);
    const primaryCategory = categoryMap.get(c.wallet) || 'Unknown';

    strategyCount[strategy]++;
    riskCount[risk]++;

    classified.push({
      ...c,
      strategy_type: strategy,
      risk_profile: risk,
      primary_category: primaryCategory,
    });
  }

  // Filter out 'exclude' risk profile
  const included = classified.filter(w => w.risk_profile !== 'exclude');
  console.log(`\nFiltered out ${classified.length - included.length} wallets with 'exclude' risk profile`);
  console.log(`Remaining: ${included.length} wallets\n`);

  // Display strategy breakdown
  console.log('Strategy Type Distribution:');
  for (const [strategy, count] of Object.entries(strategyCount)) {
    console.log(`  ${strategy.padEnd(14)}: ${count}`);
  }

  console.log('\nRisk Profile Distribution:');
  for (const [risk, count] of Object.entries(riskCount)) {
    console.log(`  ${risk.padEnd(12)}: ${count}`);
  }

  // Category distribution
  const categoryCount: Record<string, number> = {};
  for (const w of included) {
    categoryCount[w.primary_category] = (categoryCount[w.primary_category] || 0) + 1;
  }
  console.log('\nPrimary Category Distribution:');
  const sortedCategories = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCategories.slice(0, 10)) {
    console.log(`  ${cat.padEnd(20)}: ${count}`);
  }

  // Display top 30 with classifications
  console.log('\nTop 30 by Copyability (with classifications):');
  console.log('Wallet                                     | Strategy     | Risk        | Category     | Score');
  console.log('-------------------------------------------|--------------|-------------|--------------|------');

  // Sort by copyability
  included.sort((a, b) => b.copyability_score - a.copyability_score);

  for (const w of included.slice(0, 30)) {
    console.log(
      `${w.wallet} | ${w.strategy_type.padEnd(12)} | ${w.risk_profile.padEnd(11)} | ${w.primary_category.slice(0, 12).padEnd(12)} | ${w.copyability_score.toFixed(2)}`
    );
  }

  // Save output
  const outputPath = 'exports/copytrade/phase4_classified.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: 4,
    description: 'Strategy and risk classification',
    strategy_types: ['Value', 'Momentum', 'Event-Driven', 'Generalist', 'Scalper', 'Mixed'],
    risk_profiles: ['conservative', 'balanced', 'aggressive'],
    classification_rules: {
      strategy: {
        Scalper: 'avg_hold_hours < 1 AND n_trades > 100',
        Value: 'avg_entry < 0.40 AND win_pct > 60 AND avg_hold_hours > 24',
        'Event-Driven': 'category_hhi > 0.5',
        Generalist: 'category_hhi < 0.3 AND n_events > 20',
        Momentum: 'avg_entry 0.45-0.75 AND avg_hold_hours 2-48',
      },
      risk: {
        conservative: 'omega > 4 AND max_drawdown < 15%',
        balanced: 'omega > 2.5 AND max_drawdown < 25%',
        aggressive: 'omega > 1.5',
      },
    },
    distribution: {
      strategy: strategyCount,
      risk: riskCount,
      category: categoryCount,
    },
    input_count: candidates.length,
    output_count: included.length,
    wallets: included,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  await ch.close();
  return included;
}

async function main() {
  await classifyStrategies();
}

if (require.main === module) {
  main().catch(console.error);
}
