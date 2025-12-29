import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

/**
 * SUPERFORECASTER DETECTION via Roundtrip Edge
 * 
 * Formula: For each (wallet, condition, outcome), compute:
 *   - VWAP_buy = sum(buy_usdc) / sum(buy_tokens)  
 *   - VWAP_sell = sum(sell_usdc) / sum(sell_tokens)
 *   - realized_edge = VWAP_sell - VWAP_buy
 * 
 * A superforecaster buys low and sells high consistently.
 * Edge > 0.30 means they avg 30+ cent profit per share traded.
 */

async function main() {
  console.log('=== SUPERFORECASTER DETECTION ===');
  console.log('Finding wallets that buy low, sell high consistently\n');

  // Query: roundtrip edge per wallet
  const query = `
    WITH 
      -- Step 1: Get all mapped trades with buy/sell amounts
      trades AS (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          -- Buy side: negative usdc_delta, positive token_delta
          IF(usdc_delta < 0, abs(usdc_delta), 0) as buy_usdc,
          IF(usdc_delta < 0, token_delta, 0) as buy_tokens,
          -- Sell side: positive usdc_delta, negative token_delta  
          IF(usdc_delta > 0, usdc_delta, 0) as sell_usdc,
          IF(usdc_delta > 0, abs(token_delta), 0) as sell_tokens
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
      ),
      
      -- Step 2: Aggregate per (wallet, condition, outcome)
      position_agg AS (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(buy_usdc) as total_buy_usdc,
          sum(buy_tokens) as total_buy_tokens,
          sum(sell_usdc) as total_sell_usdc,
          sum(sell_tokens) as total_sell_tokens,
          count() as trade_count
        FROM trades
        GROUP BY wallet_address, condition_id, outcome_index
        -- Only positions with both buys AND sells (roundtrips)
        HAVING total_buy_tokens > 10 AND total_sell_tokens > 10
      ),
      
      -- Step 3: Compute VWAP and edge
      roundtrip_edge AS (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          total_buy_usdc / total_buy_tokens as vwap_buy,
          total_sell_usdc / total_sell_tokens as vwap_sell,
          (total_sell_usdc / total_sell_tokens) - (total_buy_usdc / total_buy_tokens) as edge_per_share,
          least(total_buy_tokens, total_sell_tokens) as matched_size,
          trade_count
        FROM position_agg
        WHERE total_buy_tokens > 0 AND total_sell_tokens > 0
      )
    
    -- Step 4: Aggregate to wallet level
    SELECT
      wallet_address,
      count() as num_roundtrips,
      round(avg(edge_per_share), 4) as avg_edge,
      round(median(edge_per_share), 4) as median_edge,
      countIf(edge_per_share > 0) / count() as hit_rate,
      sum(matched_size * edge_per_share) as total_pnl_from_roundtrips,
      sum(matched_size) as total_volume_matched
    FROM roundtrip_edge
    GROUP BY wallet_address
    HAVING num_roundtrips >= 10  -- At least 10 completed roundtrips
      AND hit_rate >= 0.6        -- Win 60%+ of roundtrips
      AND avg_edge > 0.10        -- At least 10 cent avg edge
    ORDER BY total_pnl_from_roundtrips DESC
    LIMIT 50
  `;

  console.log('Running query on 534M row ledger...\n');
  
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  
  console.log('=== TOP 50 SUPERFORECASTERS ===');
  console.log('Criteria: 10+ roundtrips, 60%+ hit rate, 10+ cent avg edge\n');
  console.log('Rank | Wallet                                     | Trips | Hit%  | Avg Edge | PnL');
  console.log('-----|--------------------------------------------+-------+-------+----------+--------');
  
  rows.forEach((r: any, i: number) => {
    const rank = String(i + 1).padStart(4);
    const wallet = r.wallet_address;
    const trips = String(r.num_roundtrips).padStart(5);
    const hit = (r.hit_rate * 100).toFixed(0).padStart(4) + '%';
    const edge = ('$' + r.avg_edge.toFixed(2)).padStart(6);
    const pnl = ('$' + Math.round(r.total_pnl_from_roundtrips).toLocaleString()).padStart(12);
    console.log(rank + ' | ' + wallet + ' | ' + trips + ' | ' + hit + ' | ' + edge + ' | ' + pnl);
  });
  
  console.log('\n' + rows.length + ' superforecasters found.');
}

main().catch(console.error);
