/**
 * Spot Check P&L Calculator (Economic Parity)
 *
 * Canonical formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
 *
 * Usage: npx tsx scripts/copytrade/spot-check-pnl.ts <wallet_address>
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { computeEconomicParityPnl } from '@/lib/pnl/economicParityPnl';

const WALLET = process.argv[2]?.toLowerCase() || '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== SPOT CHECK P&L ===');
  console.log(`Wallet: ${WALLET}\n`);

  const econ = await computeEconomicParityPnl(WALLET);
  console.log('ECONOMIC PARITY SUMMARY:');
  console.log(`  Buys:        -$${econ.buys.toFixed(2)}`);
  console.log(`  Sells:       +$${econ.sells.toFixed(2)}`);
  console.log(`  SplitCost:   -$${econ.splitCost.toFixed(2)}`);
  console.log(`  Redemptions: +$${econ.redemptions.toFixed(2)}`);
  console.log(`  HeldValue:   +$${econ.heldValue.toFixed(2)}`);
  console.log(`  Net:         $${econ.realizedPnl.toFixed(2)}\n`);

  // 1. CLOB trades (deduped)
  const clobQ = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      count() as trade_count,
      countDistinct(token_id) as unique_tokens,
      sum(if(side = 'buy', usdc, 0)) as buys,
      sum(if(side = 'sell', usdc, 0)) as sells
    FROM deduped
  `;
  const clobR = await (await clickhouse.query({ query: clobQ, format: 'JSONEachRow' })).json() as any[];
  const { trade_count, unique_tokens, buys, sells } = clobR[0];

  console.log('CLOB TRADES:');
  console.log(`  Trade count: ${trade_count}`);
  console.log(`  Unique tokens: ${unique_tokens}`);
  console.log(`  Buys:  -$${parseFloat(buys).toFixed(2)}`);
  console.log(`  Sells: +$${parseFloat(sells).toFixed(2)}`);

  // 2. Redemptions (direct user_address)
  const redQ = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemptions
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption' AND is_deleted = 0
  `;
  const redR = await (await clickhouse.query({ query: redQ, format: 'JSONEachRow' })).json() as any[];
  const redemptions = parseFloat(redR[0].redemptions) || 0;
  console.log(`  Redemptions: +$${redemptions.toFixed(2)}`);

  // 3. Splits and Merges via tx_hash
  const ctfQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT
      event_type,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs) AND is_deleted = 0
    GROUP BY event_type
  `;
  const ctfR = await (await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' })).json() as any[];

  let splits = 0;
  let merges = 0;
  for (const r of ctfR) {
    if (r.event_type === 'PositionSplit') splits = parseFloat(r.total);
    if (r.event_type === 'PositionsMerge') merges = parseFloat(r.total);
  }
  console.log(`  Splits: -$${splits.toFixed(2)}`);
  console.log(`  Merges: +$${merges.toFixed(2)}`);

  // 4. Token mapping coverage
  const coverageQ = `
    WITH wallet_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    ),
    gamma_mapped AS (
      SELECT token_id_dec as token_id FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (SELECT token_id FROM wallet_tokens)
    ),
    patch_mapped AS (
      SELECT token_id_dec as token_id FROM pm_token_to_condition_patch
      WHERE token_id_dec IN (SELECT token_id FROM wallet_tokens)
    )
    SELECT
      (SELECT count() FROM wallet_tokens) as total_tokens,
      (SELECT count() FROM gamma_mapped) as gamma_mapped,
      (SELECT count() FROM patch_mapped) as patch_mapped
  `;
  const coverageR = await (await clickhouse.query({ query: coverageQ, format: 'JSONEachRow' })).json() as any[];
  const { total_tokens, gamma_mapped, patch_mapped } = coverageR[0];
  const mapped = Number(gamma_mapped) + Number(patch_mapped);
  const unmapped = Number(total_tokens) - mapped;
  const coverage = ((mapped / Number(total_tokens)) * 100).toFixed(1);

  console.log('\nTOKEN MAPPING:');
  console.log(`  Total tokens: ${total_tokens}`);
  console.log(`  Gamma mapped: ${gamma_mapped}`);
  console.log(`  Patch mapped: ${patch_mapped}`);
  console.log(`  Unmapped: ${unmapped}`);
  console.log(`  Coverage: ${coverage}%`);

  // 5. Calculate held value for MAPPED tokens only
  const heldQ = `
    WITH wallet_positions AS (
      SELECT
        token_id,
        sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_position
      FROM (
        SELECT event_id, any(token_id) as token_id, any(side) as side, any(token_amount) as token_amount
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY token_id
      HAVING net_position > 0
    ),
    with_mapping AS (
      SELECT
        wp.token_id,
        wp.net_position,
        -- NULLIF handles ClickHouse empty strings (not NULL)
        COALESCE(NULLIF(g.condition_id, ''), p.condition_id) as condition_id,
        COALESCE(if(g.condition_id != '', g.outcome_index, NULL), p.outcome_index) as outcome_index
      FROM wallet_positions wp
      LEFT JOIN pm_token_to_condition_map_v5 g ON wp.token_id = g.token_id_dec
      LEFT JOIN pm_token_to_condition_patch p ON wp.token_id = p.token_id_dec
    ),
    with_resolution AS (
      SELECT
        wm.*,
        r.resolved_price
      FROM with_mapping wm
      LEFT JOIN vw_pm_resolution_prices r
        ON wm.condition_id = r.condition_id
        AND wm.outcome_index = r.outcome_index
    )
    SELECT
      sum(if(condition_id != '', net_position * coalesce(resolved_price, 0), 0)) as held_value_mapped,
      sum(if(condition_id = '', net_position, 0)) as held_value_unmapped_tokens,
      count(if(condition_id != '' AND resolved_price = 1, 1, NULL)) as winner_positions,
      count(if(condition_id != '' AND resolved_price = 0, 1, NULL)) as loser_positions,
      count(if(condition_id != '' AND resolved_price IS NULL, 1, NULL)) as unresolved_positions,
      count(if(condition_id = '', 1, NULL)) as unmapped_positions
    FROM with_resolution
  `;
  const heldR = await (await clickhouse.query({ query: heldQ, format: 'JSONEachRow' })).json() as any[];
  const {
    held_value_mapped,
    held_value_unmapped_tokens,
    winner_positions,
    loser_positions,
    unresolved_positions,
    unmapped_positions
  } = heldR[0];

  const heldValue = parseFloat(held_value_mapped) || 0;

  console.log('\nHELD VALUE:');
  console.log(`  Winner positions: ${winner_positions}`);
  console.log(`  Loser positions: ${loser_positions}`);
  console.log(`  Unresolved positions: ${unresolved_positions}`);
  console.log(`  Unmapped positions: ${unmapped_positions}`);
  console.log(`  Held value (mapped): $${heldValue.toFixed(2)}`);

  // 6. Calculate P&L
  const netCash = parseFloat(sells) + redemptions + merges - parseFloat(buys) - splits;
  const pnl = netCash + heldValue;

  console.log('\n' + '='.repeat(50));
  console.log('P&L CALCULATION');
  console.log('='.repeat(50));
  console.log(`\n  Sells:       +$${parseFloat(sells).toFixed(2)}`);
  console.log(`  Redemptions: +$${redemptions.toFixed(2)}`);
  console.log(`  Merges:      +$${merges.toFixed(2)}`);
  console.log(`  Buys:        -$${parseFloat(buys).toFixed(2)}`);
  console.log(`  Splits:      -$${splits.toFixed(2)}`);
  console.log(`  ─────────────────────`);
  console.log(`  Net Cash:    $${netCash.toFixed(2)}`);
  console.log(`  Held Value:  $${heldValue.toFixed(2)}`);
  console.log(`  ─────────────────────`);
  console.log(`  TOTAL P&L:   $${pnl.toFixed(2)}`);

  if (unmapped > 0) {
    console.log(`\n⚠️  WARNING: ${unmapped} tokens unmapped (${(100 - parseFloat(coverage)).toFixed(1)}%)`);
    console.log(`   P&L may be inaccurate. Check Polymarket UI for comparison.`);
  } else {
    console.log(`\n✅ 100% token coverage - P&L should be accurate`);
  }
}

main().catch(console.error);
