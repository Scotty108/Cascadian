/**
 * Phase 8: Final Export
 *
 * Generates final deliverables:
 * 1. CSV: optimal_portfolio_YYYY-MM-DD.csv
 * 2. JSON: watchlist_YYYY-MM-DD.json
 * 3. Report: COPYTRADE_PORTFOLIO_VALIDATION_YYYY-MM-DD.md
 */
import * as fs from 'fs';
import { ValidationResult } from './07-playwright-validation';

const TOTAL_CAPITAL = 1000;

export async function exportPortfolio(): Promise<void> {
  console.log('=== Phase 8: Final Export ===\n');

  // Load Phase 7 output
  const phase7Path = 'exports/copytrade/phase7_validation.json';
  if (!fs.existsSync(phase7Path)) {
    throw new Error('Phase 7 output not found. Run 07-playwright-validation.ts first.');
  }
  const phase7 = JSON.parse(fs.readFileSync(phase7Path, 'utf-8'));
  const validated: ValidationResult[] = phase7.final_selected;

  console.log(`Loaded ${validated.length} validated wallets from Phase 7\n`);

  const dateStr = new Date().toISOString().slice(0, 10);

  // 1. CSV Export
  const csvPath = `exports/copytrade/optimal_portfolio_${dateStr}.csv`;
  const csvHeader = [
    'wallet',
    'tier',
    'strategy',
    'category_focus',
    'omega',
    'shadow_omega',
    'win_pct',
    'pnl_60d',
    'ui_pnl',
    'allocation_usd',
    'copyability_score',
    'execution_drag',
    'avg_entry_price',
    'avg_hold_hours',
    'profile_url',
  ].join(',');

  const csvRows = validated.map(w => [
    w.wallet,
    w.portfolio_tier,
    w.strategy_type,
    w.primary_category,
    w.omega,
    w.shadow_omega,
    w.win_pct,
    w.pnl_60d,
    w.ui_pnl || '',
    w.allocation_usd,
    w.copyability_score,
    w.execution_drag,
    w.avg_entry_price,
    w.avg_hold_hours,
    `https://polymarket.com/profile/${w.wallet}`,
  ].join(','));

  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));
  console.log(`CSV exported to: ${csvPath}`);

  // 2. JSON Watchlist
  const jsonPath = `exports/copytrade/watchlist_${dateStr}.json`;

  // Calculate diversification summary
  const strategySummary: Record<string, number> = {};
  const categorySummary: Record<string, number> = {};
  for (const w of validated) {
    strategySummary[w.strategy_type] = (strategySummary[w.strategy_type] || 0) + 1;
    categorySummary[w.primary_category] = (categorySummary[w.primary_category] || 0) + 1;
  }

  const tierBreakdown = {
    conservative: { wallets: 0, allocation: 0 },
    balanced: { wallets: 0, allocation: 0 },
    aggressive: { wallets: 0, allocation: 0 },
  };
  for (const w of validated) {
    tierBreakdown[w.portfolio_tier].wallets++;
    tierBreakdown[w.portfolio_tier].allocation += w.allocation_usd;
  }

  const watchlist = {
    generated_at: new Date().toISOString(),
    methodology: 'v2-shadow-simulation',
    total_capital: TOTAL_CAPITAL,
    actual_allocated: validated.reduce((sum, w) => sum + w.allocation_usd, 0),
    tier_breakdown: tierBreakdown,
    diversification_summary: {
      strategies: strategySummary,
      categories: categorySummary,
    },
    wallets: validated.map(w => ({
      wallet: w.wallet,
      allocation_usd: w.allocation_usd,
      tier: w.portfolio_tier,
      strategy: w.strategy_type,
      category: w.primary_category,
      metrics: {
        omega: w.omega,
        shadow_omega: w.shadow_omega,
        win_pct: w.win_pct,
        pnl_60d: w.pnl_60d,
        execution_drag: w.execution_drag,
        copyability: w.copyability_score,
        avg_entry_price: w.avg_entry_price,
        avg_hold_hours: w.avg_hold_hours,
      },
      validation: {
        ui_pnl: w.ui_pnl,
        passed: w.validation_passed,
        notes: w.validation_notes,
      },
      why_selected: w.selection_reason,
      profile_url: `https://polymarket.com/profile/${w.wallet}`,
    })),
  };

  fs.writeFileSync(jsonPath, JSON.stringify(watchlist, null, 2));
  console.log(`JSON exported to: ${jsonPath}`);

  // 3. Markdown Report
  const reportPath = `docs/reports/COPYTRADE_PORTFOLIO_VALIDATION_${dateStr}.md`;
  const report = generateMarkdownReport(validated, watchlist);
  fs.mkdirSync('docs/reports', { recursive: true });
  fs.writeFileSync(reportPath, report);
  console.log(`Report exported to: ${reportPath}`);

  // Summary
  console.log('\n=== Export Complete ===\n');
  console.log('Files generated:');
  console.log(`  1. ${csvPath}`);
  console.log(`  2. ${jsonPath}`);
  console.log(`  3. ${reportPath}`);

  console.log('\nPortfolio Summary:');
  console.log(`  Total wallets: ${validated.length}`);
  console.log(`  Total allocated: $${watchlist.actual_allocated}`);
  console.log(`  Avg shadow omega: ${(validated.reduce((s, w) => s + w.shadow_omega, 0) / validated.length).toFixed(2)}x`);
  console.log(`  Avg execution drag: ${(validated.reduce((s, w) => s + w.execution_drag, 0) / validated.length * 100).toFixed(1)}%`);
}

function generateMarkdownReport(wallets: ValidationResult[], watchlist: any): string {
  const dateStr = new Date().toISOString().slice(0, 10);

  let md = `# Copy-Trading Portfolio Validation Report

**Generated:** ${new Date().toISOString()}
**Methodology:** V2 Shadow Simulation Pipeline

---

## Executive Summary

This report documents the systematic selection of ${wallets.length} wallets for copy-trading $${watchlist.total_capital} on Polymarket.

| Metric | Value |
|--------|-------|
| Total Wallets | ${wallets.length} |
| Total Allocated | $${watchlist.actual_allocated} |
| Unique Strategies | ${Object.keys(watchlist.diversification_summary.strategies).length} |
| Unique Categories | ${Object.keys(watchlist.diversification_summary.categories).length} |

---

## Methodology

### 8-Phase Pipeline

1. **Candidate Universe** - Unbiased pull from pm_unified_ledger_v6
2. **Core Metrics** - V19s P&L calculation with calibrated gates
3. **Copyability Scoring** - Entry price, hold time, concentration analysis
4. **Strategy Classification** - Value, Momentum, Event-Driven, Generalist
5. **Shadow Simulation** - 30s delay, 0.5% slippage, skip rules
6. **Portfolio Construction** - Capped tiers (60/30/10 split)
7. **Playwright Validation** - UI verification
8. **Final Export** - This report

### Selection Criteria

- **Omega > 1.5** (profitable)
- **Shadow Omega > 1.2** (still profitable after friction)
- **Execution Drag < 40%** (edge survives copy delay)
- **Avg Entry < 85%** (not safe-bet grinding)
- **Active in last 14 days**

---

## Tier Allocation

| Tier | Wallets | Allocation | Purpose |
|------|---------|------------|---------|
| Conservative | ${watchlist.tier_breakdown.conservative.wallets} | $${watchlist.tier_breakdown.conservative.allocation} (60%) | High omega, low drawdown |
| Balanced | ${watchlist.tier_breakdown.balanced.wallets} | $${watchlist.tier_breakdown.balanced.allocation} (30%) | Good returns, moderate risk |
| Aggressive | ${watchlist.tier_breakdown.aggressive.wallets} | $${watchlist.tier_breakdown.aggressive.allocation} (10%) | Higher risk/reward |

---

## Diversification

### By Strategy
| Strategy | Count |
|----------|-------|
${Object.entries(watchlist.diversification_summary.strategies).map(([s, c]) => `| ${s} | ${c} |`).join('\n')}

### By Category
| Category | Count |
|----------|-------|
${Object.entries(watchlist.diversification_summary.categories).slice(0, 8).map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

---

## Selected Wallets

`;

  for (const w of wallets) {
    md += `### ${w.selection_rank}. ${w.wallet.slice(0, 16)}...

| Attribute | Value |
|-----------|-------|
| **Tier** | ${w.portfolio_tier} |
| **Strategy** | ${w.strategy_type} |
| **Category** | ${w.primary_category} |
| **Allocation** | $${w.allocation_usd} |
| **Omega** | ${w.omega}x |
| **Shadow Omega** | ${w.shadow_omega}x |
| **Execution Drag** | ${(w.execution_drag * 100).toFixed(1)}% |
| **Win Rate** | ${w.win_pct}% |
| **P&L (60d)** | $${w.pnl_60d.toLocaleString()} |
| **UI P&L** | ${w.ui_pnl ? '$' + w.ui_pnl.toLocaleString() : 'N/A'} |
| **Avg Entry Price** | ${(w.avg_entry_price * 100).toFixed(1)}% |
| **Avg Hold Time** | ${w.avg_hold_hours.toFixed(1)} hours |
| **Profile** | [View](https://polymarket.com/profile/${w.wallet}) |

**Why Selected:** ${w.selection_reason}

---

`;
  }

  md += `## Risk Assessment

### Execution Risks
- **Slippage**: Simulated at 0.5% entry, 0.3% exit
- **Delay**: 30-second detection and execution lag
- **Skip Rate**: Trades skipped when price moves >5%

### Portfolio Risks
- **Concentration**: Max 2 wallets per strategy, 3 per category
- **Tier Balance**: 60% conservative, 30% balanced, 10% aggressive

### Validation Notes
${wallets.filter(w => w.validation_notes).map(w => `- ${w.wallet.slice(0, 10)}...: ${w.validation_notes}`).join('\n')}

---

## Appendix: Full Wallet List

| Wallet | Tier | Strategy | Omega | Shadow Ω | Alloc |
|--------|------|----------|-------|----------|-------|
${wallets.map(w => `| ${w.wallet.slice(0, 14)}... | ${w.portfolio_tier} | ${w.strategy_type} | ${w.omega}x | ${w.shadow_omega}x | $${w.allocation_usd} |`).join('\n')}

---

*Generated by Cascadian Copy-Trading Pipeline v2*
`;

  return md;
}

async function main() {
  await exportPortfolio();
}

if (require.main === module) {
  main().catch(console.error);
}
