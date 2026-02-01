#!/usr/bin/env npx tsx
/**
 * Example: Get Unrealized Value for Open Positions
 * 
 * Shows how to calculate current value of open positions
 * using mark prices (updated every 15 min)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function getUnrealizedValue() {
  console.log('📊 Unrealized Value Example\n');
  
  // Sample: Top 10 wallets by unrealized value
  const result = await clickhouse.query({
    query: `
      SELECT
        u.wallet,
        count(*) as open_positions,
        sum(u.cost_usd) as total_cost,
        sum(u.tokens_held * coalesce(p.mark_price, 0)) as current_value,
        sum(u.tokens_held * coalesce(p.mark_price, 0)) - sum(u.cost_usd) as unrealized_pnl,
        (sum(u.tokens_held * coalesce(p.mark_price, 0)) - sum(u.cost_usd)) / sum(u.cost_usd) * 100 as unrealized_roi_pct
      FROM pm_trade_fifo_roi_v3_mat_unified u
      LEFT JOIN pm_latest_mark_price_v1 p 
        ON u.condition_id = p.condition_id 
        AND u.outcome_index = p.outcome_index
      WHERE u.resolved_at IS NULL 
        AND u.is_closed = 0
        AND u.tokens_held > 0.01
      GROUP BY u.wallet
      HAVING unrealized_pnl IS NOT NULL
      ORDER BY unrealized_pnl DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const wallets = await result.json();
  
  console.log('Top 10 Wallets by Unrealized PnL:\n');
  for (const w of wallets) {
    console.log(`${w.wallet.substring(0, 12)}...`);
    console.log(`  Open positions: ${w.open_positions}`);
    console.log(`  Cost: $${w.total_cost.toFixed(2)}`);
    console.log(`  Current value: $${w.current_value.toFixed(2)}`);
    console.log(`  Unrealized PnL: $${w.unrealized_pnl.toFixed(2)} (${w.unrealized_roi_pct.toFixed(1)}%)`);
    console.log('');
  }
  
  console.log('💡 Usage:');
  console.log('  - For realized PnL: WHERE is_closed = 1 OR resolved_at IS NOT NULL');
  console.log('  - For unrealized PnL: JOIN with pm_latest_mark_price_v1');
  console.log('  - Both available from same table!\n');
}

getUnrealizedValue().catch(console.error);
