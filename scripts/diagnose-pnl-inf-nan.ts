#!/usr/bin/env tsx
/**
 * Diagnose inf/NaN in P&L calculations
 * 
 * Find which wallet/condition combinations produce infinite or NaN avg prices
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('🔍 Diagnosing inf/NaN in P&L calculations...');
  console.log('='.repeat(80));
  console.log('');

  // Find positions with inf/NaN avg_entry_price
  console.log('Finding positions with inf/NaN avg_entry_price...');
  console.log('-'.repeat(80));
  
  const query = `
    SELECT 
      wallet_address,
      condition_id_norm_v2 AS condition_id,
      outcome_index_v2 AS outcome_index,
      
      COUNT(*) AS total_trades,
      SUM(CASE WHEN trade_direction = 'BUY' THEN 1 ELSE 0 END) AS buy_trades,
      SUM(CASE WHEN trade_direction = 'SELL' THEN 1 ELSE 0 END) AS sell_trades,
      
      SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END) AS buy_shares,
      SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END) AS buy_value,
      
      SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END) AS sell_shares,
      SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) AS sell_value,
      
      -- Calculate avg prices
      CASE
        WHEN SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END) > 0.0
        THEN SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END) /
             SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END)
        ELSE NULL
      END AS avg_entry_price,
      
      CASE
        WHEN SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END) > 0.0
        THEN SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) /
             SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END)
        ELSE NULL
      END AS avg_exit_price
      
    FROM pm_trades_canonical_v2
    WHERE 
      is_orphan = 0
      AND condition_id_norm_v2 IS NOT NULL
      AND condition_id_norm_v2 != ''
    GROUP BY wallet_address, condition_id_norm_v2, outcome_index_v2
    HAVING NOT isFinite(avg_entry_price) OR NOT isFinite(avg_exit_price)
    LIMIT 20
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  if (rows.length === 0) {
    console.log('✅ No positions with inf/NaN avg prices found!');
    console.log('');
    console.log('This suggests the issue is in the CAST operation itself, not the data.');
    console.log('');
    
    // Let's check total positions
    const countQuery = `
      SELECT COUNT(*) AS total_positions
      FROM (
        SELECT 
          wallet_address,
          condition_id_norm_v2,
          outcome_index_v2
        FROM pm_trades_canonical_v2
        WHERE 
          is_orphan = 0
          AND condition_id_norm_v2 IS NOT NULL
          AND condition_id_norm_v2 != ''
        GROUP BY wallet_address, condition_id_norm_v2, outcome_index_v2
      )
    `;
    
    const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
    const countData = (await countResult.json())[0];
    console.log(`Total positions to process: ${parseInt(countData.total_positions).toLocaleString()}`);
    
  } else {
    console.log(`❌ Found ${rows.length} positions with inf/NaN values:`);
    console.log('');
    
    for (const row of rows) {
      console.log(`Wallet: ${row.wallet_address.slice(0, 10)}...`);
      console.log(`  Condition: ${row.condition_id.slice(0, 16)}...`);
      console.log(`  Outcome: ${row.outcome_index}`);
      console.log(`  Trades: ${row.total_trades} (${row.buy_trades} buys, ${row.sell_trades} sells)`);
      console.log(`  Buy shares: ${row.buy_shares}, Buy value: $${row.buy_value}`);
      console.log(`  Sell shares: ${row.sell_shares}, Sell value: $${row.sell_value}`);
      console.log(`  Avg entry: ${row.avg_entry_price} (finite: ${isFinite(row.avg_entry_price)})`);
      console.log(`  Avg exit: ${row.avg_exit_price} (finite: ${isFinite(row.avg_exit_price)})`);
      console.log('');
    }
  }
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
