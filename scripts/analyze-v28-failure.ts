import 'dotenv/config';
import { clickhouse } from '../lib/clickhouse/client';

async function analyze() {
  const wallet = '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
  
  // Get all trades grouped by condition/outcome
  const result = await clickhouse.query({
    query: `
      WITH deduped AS (
        SELECT 
          tx_hash,
          condition_id,
          outcome_index,
          side,
          max(usdc_amount) / 1000000.0 as usdc,
          max(token_amount) / 1000000.0 as tokens,
          max(trade_time) as trade_time
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet}'
        GROUP BY tx_hash, condition_id, outcome_index, side
      )
      SELECT 
        condition_id,
        outcome_index,
        count() as trade_count,
        sum(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as total_buy_usdc,
        sum(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) as total_sell_usdc,
        sum(CASE WHEN side = 'buy' THEN tokens ELSE 0 END) as tokens_bought,
        sum(CASE WHEN side = 'sell' THEN tokens ELSE 0 END) as tokens_sold,
        sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
        sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash
      FROM deduped
      GROUP BY condition_id, outcome_index
      ORDER BY abs(net_cash) DESC
    `,
    format: 'JSONEachRow',
  });
  
  const rows = await result.json() as any[];
  console.log('=== WALLET 0x1f31... POSITIONS ===\n');
  console.log('condition_id         | idx | trades | buy_usdc | sell_usdc | net_tokens | net_cash');
  console.log('-'.repeat(100));
  
  let totalNetCash = 0;
  for (const row of rows.slice(0, 20)) {
    totalNetCash += row.net_cash;
    const cid = row.condition_id.substring(0, 16) + '...';
    console.log(cid.padEnd(20) + ' | ' + String(row.outcome_index).padStart(3) + ' | ' + String(row.trade_count).padStart(6) + ' | $' + row.total_buy_usdc.toFixed(2).padStart(8) + ' | $' + row.total_sell_usdc.toFixed(2).padStart(8) + ' | ' + row.net_tokens.toFixed(2).padStart(10) + ' | $' + row.net_cash.toFixed(2).padStart(8));
  }
  console.log('\nTotal positions:', rows.length);
  console.log('Total net cash:', totalNetCash.toFixed(2));
}

analyze().catch(console.error);
