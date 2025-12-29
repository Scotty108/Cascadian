/**
 * V17 Per-Condition PnL Decomposition
 *
 * For Smart Money 1 and Smart Money 2, breaks down PnL by condition_id
 * to identify which markets contribute most to the 15% gap vs UI.
 */

import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const TEST_WALLETS = [
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, name: 'Smart Money 1' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, name: 'Smart Money 2' },
];

interface ConditionAgg {
  condition_id: string;
  category: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  final_notional: number;
  outcome_count: number;
  is_resolved: boolean;
}

async function main() {
  const engine = createV17Engine();

  for (const w of TEST_WALLETS) {
    console.log('');
    console.log('='.repeat(140));
    console.log(`${w.name}: ${w.wallet}`);
    console.log(`UI PnL: $${w.ui_pnl.toLocaleString()}`);
    console.log('='.repeat(140));

    const result = await engine.compute(w.wallet);

    console.log(`V17 Realized:   $${result.realized_pnl.toLocaleString()}`);
    console.log(`V17 Unrealized: $${result.unrealized_pnl.toLocaleString()}`);
    console.log(`V17 Total:      $${result.total_pnl.toLocaleString()}`);
    console.log(`Gap to UI:      $${(w.ui_pnl - result.realized_pnl).toLocaleString()} (${(((w.ui_pnl - result.realized_pnl) / Math.abs(w.ui_pnl)) * 100).toFixed(1)}%)`);
    console.log(`Positions:      ${result.positions.length}`);
    console.log(`Markets:        ${result.markets_traded}`);
    console.log(`Resolutions:    ${result.resolutions}`);

    // Aggregate by condition_id
    const conditionMap = new Map<string, ConditionAgg>();

    for (const pos of result.positions) {
      const key = pos.condition_id;
      const existing = conditionMap.get(key);

      if (existing) {
        existing.realized_pnl += pos.realized_pnl;
        existing.unrealized_pnl += pos.unrealized_pnl;
        existing.total_pnl += pos.realized_pnl + pos.unrealized_pnl;
        existing.final_notional += Math.abs(pos.final_shares);
        existing.outcome_count += 1;
        existing.is_resolved = existing.is_resolved || pos.is_resolved;
      } else {
        conditionMap.set(key, {
          condition_id: pos.condition_id,
          category: pos.category,
          realized_pnl: pos.realized_pnl,
          unrealized_pnl: pos.unrealized_pnl,
          total_pnl: pos.realized_pnl + pos.unrealized_pnl,
          final_notional: Math.abs(pos.final_shares),
          outcome_count: 1,
          is_resolved: pos.is_resolved,
        });
      }
    }

    // Sort by abs(realized_pnl) descending
    const conditions = Array.from(conditionMap.values()).sort(
      (a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl)
    );

    console.log('');
    console.log('-'.repeat(140));
    console.log('TOP 20 CONDITIONS BY |REALIZED PNL|');
    console.log('-'.repeat(140));
    console.log(
      'Condition (first 16)  | Category       | Realized PnL     | Unrealized PnL   | Final Notional   | Resolved | Outcomes'
    );
    console.log('-'.repeat(140));

    let runningTotal = 0;
    for (const c of conditions.slice(0, 20)) {
      runningTotal += c.realized_pnl;
      const condShort = c.condition_id.substring(0, 16);
      const catShort = c.category.substring(0, 14);
      console.log(
        `${condShort.padEnd(21)} | ${catShort.padEnd(14)} | $${c.realized_pnl.toLocaleString().padStart(14)} | $${c.unrealized_pnl.toLocaleString().padStart(14)} | ${c.final_notional.toLocaleString().padStart(16)} | ${c.is_resolved ? 'YES' : 'NO '.padEnd(3)}      | ${c.outcome_count}`
      );
    }

    console.log('-'.repeat(140));
    console.log(`Top 20 sum: $${runningTotal.toLocaleString()}`);
    console.log(`Pct of total realized: ${((runningTotal / result.realized_pnl) * 100).toFixed(1)}%`);

    // Show unresolved breakdown
    const unresolved = conditions.filter((c) => !c.is_resolved);
    const resolved = conditions.filter((c) => c.is_resolved);

    console.log('');
    console.log('-'.repeat(140));
    console.log('RESOLUTION BREAKDOWN');
    console.log('-'.repeat(140));
    console.log(`Resolved conditions:   ${resolved.length} (realized: $${resolved.reduce((s, c) => s + c.realized_pnl, 0).toLocaleString()})`);
    console.log(`Unresolved conditions: ${unresolved.length} (unrealized: $${unresolved.reduce((s, c) => s + c.unrealized_pnl, 0).toLocaleString()})`);

    // Category breakdown
    const categoryMap = new Map<string, { realized: number; unrealized: number; count: number }>();
    for (const c of conditions) {
      const cat = c.category;
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.realized += c.realized_pnl;
        existing.unrealized += c.unrealized_pnl;
        existing.count += 1;
      } else {
        categoryMap.set(cat, { realized: c.realized_pnl, unrealized: c.unrealized_pnl, count: 1 });
      }
    }

    const categories = Array.from(categoryMap.entries()).sort(
      (a, b) => Math.abs(b[1].realized) - Math.abs(a[1].realized)
    );

    console.log('');
    console.log('-'.repeat(140));
    console.log('CATEGORY BREAKDOWN');
    console.log('-'.repeat(140));
    console.log('Category         | Conditions | Realized PnL     | Unrealized PnL');
    console.log('-'.repeat(140));

    for (const [cat, data] of categories.slice(0, 10)) {
      console.log(
        `${cat.substring(0, 16).padEnd(16)} | ${data.count.toString().padStart(10)} | $${data.realized.toLocaleString().padStart(14)} | $${data.unrealized.toLocaleString().padStart(14)}`
      );
    }
  }

  console.log('');
  console.log('='.repeat(140));
  console.log('DECOMPOSITION COMPLETE');
  console.log('='.repeat(140));
}

main().catch(console.error);
