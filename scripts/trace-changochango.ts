/**
 * Trace ChangoChango wallet - closest to UI (-5% error)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28';

  console.log('='.repeat(70));
  console.log('TRACE: ChangoChango wallet (closest to UI)');
  console.log('='.repeat(70));
  console.log('UI PnL: $37,682');
  console.log('V12 PnL: $35,703 (-5% error)');

  // Get dedup stats
  const dupQ = await clickhouse.query({
    query: `
      SELECT count() as total_rows, countDistinct(event_id) as unique_events
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const dups = (await dupQ.json()) as any[];
  console.log('\n1. Deduplication:');
  console.log('   Total rows:', Number(dups[0].total_rows).toLocaleString());
  console.log('   Unique events:', Number(dups[0].unique_events).toLocaleString());
  console.log(
    '   Duplication factor:',
    (Number(dups[0].total_rows) / Number(dups[0].unique_events)).toFixed(2) + 'x'
  );

  // Get aggregate stats
  const statsQ = await clickhouse.query({
    query: `
      SELECT
        count() as positions,
        sum(buy_usdc) as total_buy,
        sum(sell_usdc) as total_sell,
        sum(net_cash) as net_cash,
        sum(net_tokens) as net_tokens
      FROM (
        SELECT
          token_id,
          sum(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as buy_usdc,
          sum(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) as sell_usdc,
          sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash,
          sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
        FROM (
          SELECT
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount) / 1e6 as usdc,
            any(token_amount) / 1e6 as tokens
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsQ.json()) as any[];
  console.log('\n2. Aggregates (deduped):');
  console.log('   Positions:', stats[0].positions);
  console.log('   Total buy:', '$' + Number(stats[0].total_buy).toFixed(0));
  console.log('   Total sell:', '$' + Number(stats[0].total_sell).toFixed(0));
  console.log('   Net cash:', '$' + Number(stats[0].net_cash).toFixed(0));
  console.log('   Net tokens:', Number(stats[0].net_tokens).toFixed(0));

  // Check position types
  const posTypesQ = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          token_id,
          sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash,
          sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
        FROM (
          SELECT
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount) / 1e6 as usdc,
            any(token_amount) / 1e6 as tokens
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
      SELECT
        countIf(net_tokens > 0) as long_positions,
        countIf(net_tokens < 0) as short_positions,
        countIf(net_tokens = 0) as flat_positions,
        sumIf(net_cash, net_tokens > 0) as long_net_cash,
        sumIf(net_cash, net_tokens < 0) as short_net_cash,
        sumIf(net_tokens, net_tokens > 0) as long_net_tokens,
        sumIf(net_tokens, net_tokens < 0) as short_net_tokens
      FROM positions
    `,
    format: 'JSONEachRow',
  });
  const posTypes = (await posTypesQ.json()) as any[];
  console.log('\n3. Position breakdown:');
  console.log('   Long positions:', posTypes[0].long_positions);
  console.log('   Short positions:', posTypes[0].short_positions);
  console.log('   Flat positions:', posTypes[0].flat_positions);
  console.log('   Long net_cash:', '$' + Number(posTypes[0].long_net_cash).toFixed(0));
  console.log('   Short net_cash:', '$' + Number(posTypes[0].short_net_cash).toFixed(0));

  // Sample positions with PnL breakdown
  const sampleQ = await clickhouse.query({
    query: `
      WITH unified_map AS (
        SELECT token_id_dec, condition_id, outcome_index
        FROM pm_token_to_condition_patch WHERE token_id_dec != ''
        UNION ALL
        SELECT token_id_dec, condition_id, toInt64(outcome_index) as outcome_index
        FROM pm_token_to_condition_map_v5
        WHERE token_id_dec NOT IN (SELECT token_id_dec FROM pm_token_to_condition_patch)
      ),
      positions AS (
        SELECT
          token_id,
          sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash,
          sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
        FROM (
          SELECT
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount) / 1e6 as usdc,
            any(token_amount) / 1e6 as tokens
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
      SELECT
        p.token_id,
        p.net_cash,
        p.net_tokens,
        r.outcome_index,
        res.payout_numerators,
        CASE
          WHEN res.payout_numerators IS NULL THEN 'unresolved'
          ELSE 'resolved'
        END as status
      FROM positions p
      LEFT JOIN unified_map r ON p.token_id = r.token_id_dec
      LEFT JOIN pm_condition_resolutions res ON lower(r.condition_id) = lower(res.condition_id)
      ORDER BY abs(p.net_cash) + abs(p.net_tokens) DESC
      LIMIT 15
    `,
    format: 'JSONEachRow',
  });
  const samples = (await sampleQ.json()) as any[];

  console.log('\n4. Sample positions:');
  let totalPnl = 0;
  for (const s of samples) {
    let payout = 0.5; // unresolved
    let payoutLabel = 'unresolved (0.5)';
    if (s.payout_numerators) {
      try {
        const payouts = JSON.parse(s.payout_numerators.replace(/'/g, '"'));
        payout = payouts[s.outcome_index] > 0 ? 1.0 : 0.0;
        payoutLabel = payout === 1 ? 'WIN (1.0)' : 'LOSS (0.0)';
      } catch {}
    }
    const positionPnl = Number(s.net_cash) + Number(s.net_tokens) * payout;
    totalPnl += positionPnl;
    console.log(
      `   ${s.token_id.slice(0, 15)}... | cash: $${Number(s.net_cash).toFixed(0).padStart(6)} | tokens: ${Number(s.net_tokens).toFixed(0).padStart(6)} | ${payoutLabel.padEnd(12)} | PnL: $${positionPnl.toFixed(0)}`
    );
  }
  console.log('\n   Sample total PnL: $' + totalPnl.toFixed(0));
}

main().catch(console.error);
