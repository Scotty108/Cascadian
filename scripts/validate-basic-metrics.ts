import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x92d8a88f0a9fef812bdf5628770d6a0ecee39762';

async function main() {
  console.log(`\n=== Basic Trade Stats for ${wallet.slice(0,10)}... ===\n`);

  // Query 1: Basic counts and volume (with dedup by event_id)
  const basicStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_fills,
        countIf(side = 'buy') as buy_fills,
        countIf(side = 'sell') as sell_fills,
        round(sum(usdc_amount) / 1e6, 2) as total_volume,
        round(sumIf(usdc_amount, side = 'buy') / 1e6, 2) as total_usdc_spent,
        round(sumIf(usdc_amount, side = 'sell') / 1e6, 2) as total_usdc_received,
        round(sum(token_amount) / 1e6, 2) as total_tokens,
        round(sumIf(token_amount, side = 'buy') / 1e6, 2) as tokens_bought,
        round(sumIf(token_amount, side = 'sell') / 1e6, 2) as tokens_sold,
        count(DISTINCT token_id) as unique_tokens,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade,
        count(DISTINCT toDate(trade_time)) as active_days
      FROM (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount,
          any(token_id) as token_id,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
          AND role = 'maker'
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });

  const stats = await basicStats.json() as any[];
  const s = stats[0];

  console.log('📊 TRADE COUNTS:');
  console.log(`   Total fills: ${s.total_fills}`);
  console.log(`   Buy fills: ${s.buy_fills}`);
  console.log(`   Sell fills: ${s.sell_fills}`);

  console.log('\n💰 VOLUME:');
  console.log(`   Total volume: $${Number(s.total_volume).toLocaleString()}`);
  console.log(`   USDC spent (buys): $${Number(s.total_usdc_spent).toLocaleString()}`);
  console.log(`   USDC received (sells): $${Number(s.total_usdc_received).toLocaleString()}`);
  console.log(`   Net cash flow: $${(Number(s.total_usdc_received) - Number(s.total_usdc_spent)).toLocaleString()}`);

  console.log('\n🪙 TOKENS:');
  console.log(`   Total tokens: ${Number(s.total_tokens).toLocaleString()}`);
  console.log(`   Tokens bought: ${Number(s.tokens_bought).toLocaleString()}`);
  console.log(`   Tokens sold: ${Number(s.tokens_sold).toLocaleString()}`);
  console.log(`   Net tokens: ${(Number(s.tokens_bought) - Number(s.tokens_sold)).toLocaleString()}`);

  console.log('\n📈 ACTIVITY:');
  console.log(`   Unique tokens: ${s.unique_tokens}`);
  console.log(`   First trade: ${s.first_trade}`);
  console.log(`   Last trade: ${s.last_trade}`);
  console.log(`   Active days: ${s.active_days}`);

  console.log('\n📐 DERIVED:');
  console.log(`   Avg trade size: $${(Number(s.total_volume) / Number(s.total_fills)).toFixed(2)}`);
  console.log(`   Avg buy size: $${(Number(s.total_usdc_spent) / Number(s.buy_fills)).toFixed(2)}`);
  console.log(`   Avg sell size: $${(Number(s.total_usdc_received) / Number(s.sell_fills)).toFixed(2)}`);

  // Query 2: Unique conditions (markets)
  const conditionStats = await clickhouse.query({
    query: `
      SELECT count(DISTINCT m.condition_id) as unique_conditions
      FROM (
        SELECT any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
          AND role = 'maker'
        GROUP BY event_id
      ) t
      INNER JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    `,
    format: 'JSONEachRow'
  });

  const conds = await conditionStats.json() as any[];
  console.log(`   Unique markets: ${conds[0].unique_conditions}`);

  // Summary table for verification
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('METRICS TO VERIFY AGAINST POLYMARKET UI:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`
| Metric               | Our Value                    | UI Value | Match? |
|----------------------|------------------------------|----------|--------|
| Total fills          | ${s.total_fills.toString().padEnd(28)} | ???      |        |
| Buy fills            | ${s.buy_fills.toString().padEnd(28)} | ???      |        |
| Sell fills           | ${s.sell_fills.toString().padEnd(28)} | ???      |        |
| Total volume         | $${Number(s.total_volume).toLocaleString().padEnd(27)} | ???      |        |
| USDC spent (buys)    | $${Number(s.total_usdc_spent).toLocaleString().padEnd(27)} | ???      |        |
| USDC received (sells)| $${Number(s.total_usdc_received).toLocaleString().padEnd(27)} | ???      |        |
| Unique tokens        | ${s.unique_tokens.toString().padEnd(28)} | ???      |        |
| Unique markets       | ${conds[0].unique_conditions.toString().padEnd(28)} | ???      |        |
| First trade          | ${s.first_trade.toString().padEnd(28)} | ???      |        |
| Last trade           | ${s.last_trade.toString().padEnd(28)} | ???      |        |
| Active days          | ${s.active_days.toString().padEnd(28)} | ???      |        |
`);
}

main().catch(console.error);
