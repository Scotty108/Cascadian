/**
 * Trace Latina wallet to understand PnL discrepancy
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

  console.log('='.repeat(70));
  console.log('TRACE: Latina wallet PnL analysis');
  console.log('='.repeat(70));

  // Check for duplicate event_ids
  const dupQ = await clickhouse.query({
    query: `
      SELECT count() as total_rows, countDistinct(event_id) as unique_events
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const dups = (await dupQ.json()) as any[];
  console.log('\n1. Event deduplication check:');
  console.log('   Total rows:', Number(dups[0].total_rows).toLocaleString());
  console.log('   Unique events:', Number(dups[0].unique_events).toLocaleString());
  console.log(
    '   Duplication factor:',
    (Number(dups[0].total_rows) / Number(dups[0].unique_events)).toFixed(2) + 'x'
  );

  // Get actual trade stats with proper dedup
  const statsQ = await clickhouse.query({
    query: `
      SELECT
        count() as positions,
        sum(buy_usdc) as total_buy_usdc,
        sum(sell_usdc) as total_sell_usdc,
        sum(buy_tokens) as total_buy_tokens,
        sum(sell_tokens) as total_sell_tokens,
        sum(net_cash) as total_net_cash,
        sum(net_tokens) as total_net_tokens
      FROM (
        SELECT
          token_id,
          sum(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as buy_usdc,
          sum(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) as sell_usdc,
          sum(CASE WHEN side = 'buy' THEN tokens ELSE 0 END) as buy_tokens,
          sum(CASE WHEN side = 'sell' THEN tokens ELSE 0 END) as sell_tokens,
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
  console.log('\n2. Trade stats (DEDUPED by event_id):');
  console.log('   Positions:', Number(stats[0].positions).toLocaleString());
  console.log('   Total buy USDC:', '$' + Number(stats[0].total_buy_usdc).toLocaleString());
  console.log('   Total sell USDC:', '$' + Number(stats[0].total_sell_usdc).toLocaleString());
  console.log('   Net cash:', '$' + Number(stats[0].total_net_cash).toLocaleString());
  console.log('   Net tokens:', Number(stats[0].total_net_tokens).toLocaleString());

  // Compare with non-deduped
  const rawQ = await clickhouse.query({
    query: `
      SELECT
        count() as row_count,
        sum(CASE WHEN side = 'buy' THEN usdc_amount/1e6 ELSE 0 END) as raw_buy_usdc,
        sum(CASE WHEN side = 'sell' THEN usdc_amount/1e6 ELSE 0 END) as raw_sell_usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const raw = (await rawQ.json()) as any[];
  console.log('\n3. Trade stats (RAW, no dedup):');
  console.log('   Row count:', Number(raw[0].row_count).toLocaleString());
  console.log('   Raw buy USDC:', '$' + Number(raw[0].raw_buy_usdc).toLocaleString());
  console.log('   Raw sell USDC:', '$' + Number(raw[0].raw_sell_usdc).toLocaleString());

  // Check resolution breakdown
  const resQ = await clickhouse.query({
    query: `
      WITH unified_map AS (
        SELECT token_id_dec, condition_id, outcome_index
        FROM pm_token_to_condition_patch WHERE token_id_dec != ''
        UNION ALL
        SELECT token_id_dec, condition_id, toInt64(outcome_index) as outcome_index
        FROM pm_token_to_condition_map_v5 WHERE token_id_dec NOT IN (SELECT token_id_dec FROM pm_token_to_condition_patch)
      )
      SELECT
        countIf(r.condition_id IS NULL OR r.condition_id = '') as unmapped,
        countIf(r.condition_id != '' AND res.payout_numerators IS NULL) as unresolved,
        countIf(res.payout_numerators IS NOT NULL) as resolved
      FROM (
        SELECT DISTINCT token_id FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      ) t
      LEFT JOIN unified_map r ON t.token_id = r.token_id_dec
      LEFT JOIN pm_condition_resolutions res ON lower(r.condition_id) = lower(res.condition_id)
    `,
    format: 'JSONEachRow',
  });
  const res = (await resQ.json()) as any[];
  console.log('\n4. Token resolution status:');
  console.log('   Unmapped tokens:', res[0].unmapped);
  console.log('   Unresolved tokens:', res[0].unresolved);
  console.log('   Resolved tokens:', res[0].resolved);

  // Sample some resolved positions
  const sampleQ = await clickhouse.query({
    query: `
      WITH unified_map AS (
        SELECT token_id_dec, condition_id, outcome_index
        FROM pm_token_to_condition_patch WHERE token_id_dec != ''
        UNION ALL
        SELECT token_id_dec, condition_id, toInt64(outcome_index) as outcome_index
        FROM pm_token_to_condition_map_v5 WHERE token_id_dec NOT IN (SELECT token_id_dec FROM pm_token_to_condition_patch)
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
        HAVING abs(net_cash) > 1000 OR abs(net_tokens) > 1000
      )
      SELECT
        p.token_id,
        p.net_cash,
        p.net_tokens,
        r.condition_id,
        r.outcome_index,
        res.payout_numerators
      FROM positions p
      LEFT JOIN unified_map r ON p.token_id = r.token_id_dec
      LEFT JOIN pm_condition_resolutions res ON lower(r.condition_id) = lower(res.condition_id)
      ORDER BY abs(p.net_cash) + abs(p.net_tokens) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const samples = (await sampleQ.json()) as any[];
  console.log('\n5. Sample positions (top 10 by size):');
  for (const s of samples) {
    let payout = 'unmapped';
    if (s.payout_numerators) {
      try {
        const payouts = JSON.parse(s.payout_numerators.replace(/'/g, '"'));
        payout = payouts[s.outcome_index] > 0 ? 'WIN (1.0)' : 'LOSS (0.0)';
      } catch {}
    } else if (s.condition_id) {
      payout = 'unresolved';
    }
    console.log(
      `   ${s.token_id.slice(0, 20)}... | net_cash: $${Number(s.net_cash).toFixed(0)} | net_tokens: ${Number(s.net_tokens).toFixed(0)} | ${payout}`
    );
  }

  // Calculate expected UI PnL for comparison
  console.log('\n6. UI PnL Reference: $465,721');
  console.log('   V12 Total: $3,515,385 (655% error)');
}

main().catch(console.error);
