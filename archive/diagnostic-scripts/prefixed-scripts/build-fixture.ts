/**
 * BUILD FIXTURE - Extract 15-row test set
 *
 * 5 resolved winners
 * 5 resolved losers
 * 5 still open
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE BUILDER');
  console.log(`Wallet: ${TARGET_WALLET}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Get ALL fills for this wallet with ERC1155 token_ids
  console.log('📊 Loading fills with token_ids...\n');

  const fillsQuery = await clickhouse.query({
    query: `
      SELECT
        f.tx_hash,
        f.timestamp,
        f.asset_id,
        f.market_slug,
        f.side,
        f.size / 1000000.0 as shares,
        f.price,
        f.fee_rate_bps,
        e.token_id,
        lpad(lower(hex(bitShiftRight(toUInt256(e.token_id), 8))), 64, '0') as condition_id_norm,
        toUInt8(bitAnd(toUInt256(e.token_id), 255)) as outcome_index
      FROM clob_fills f
      INNER JOIN erc1155_transfers e
        ON f.tx_hash = e.tx_hash
        AND abs(toUnixTimestamp(f.timestamp) - toUnixTimestamp(e.block_timestamp)) < 5
      WHERE f.proxy_wallet = '${TARGET_WALLET}'
      ORDER BY f.timestamp DESC
    `,
    format: 'JSONEachRow'
  });

  const fills: any[] = await fillsQuery.json();
  console.log(`✅ Loaded ${fills.length} fills with token_ids\n`);

  // Step 2: Join with resolutions to classify
  console.log('🔍 Classifying positions...\n');

  const positions = new Map<string, any>();

  for (const fill of fills) {
    const key = fill.token_id;

    if (!positions.has(key)) {
      // Check resolution status
      const resQuery = await clickhouse.query({
        query: `
          SELECT
            condition_id_norm,
            winning_index,
            payout_numerators,
            resolved_at,
            outcome_count
          FROM market_resolutions_final
          WHERE condition_id_norm = '${fill.condition_id_norm}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const res: any[] = await resQuery.json();
      const resolution = res.length > 0 ? res[0] : null;

      positions.set(key, {
        token_id: fill.token_id,
        asset_id: fill.asset_id,
        condition_id_norm: fill.condition_id_norm,
        outcome_index: fill.outcome_index,
        market_slug: fill.market_slug,
        fills: [],
        resolution,
        net_shares: 0,
        cost_basis: 0,
      });
    }

    const pos = positions.get(key)!;
    pos.fills.push(fill);

    // Update position
    if (fill.side === 'BUY') {
      const fee = fill.shares * fill.price * (fill.fee_rate_bps / 10000);
      pos.cost_basis += (fill.shares * fill.price) + fee;
      pos.net_shares += fill.shares;
    } else {
      const fee = fill.shares * fill.price * (fill.fee_rate_bps / 10000);
      const avg_cost = pos.cost_basis / pos.net_shares;
      const cost = avg_cost * fill.shares;
      const revenue = (fill.shares * fill.price) - fee;

      pos.net_shares -= fill.shares;
      pos.cost_basis = avg_cost * pos.net_shares;
    }
  }

  // Step 3: Classify into winners, losers, open
  const winners: any[] = [];
  const losers: any[] = [];
  const open: any[] = [];

  for (const pos of positions.values()) {
    if (pos.net_shares === 0) continue; // Skip fully closed

    if (pos.resolution) {
      const is_winner = pos.resolution.winning_index === pos.outcome_index;

      if (is_winner) {
        winners.push(pos);
      } else {
        losers.push(pos);
      }
    } else {
      open.push(pos);
    }
  }

  console.log(`Winners: ${winners.length}`);
  console.log(`Losers: ${losers.length}`);
  console.log(`Open: ${open.length}\n`);

  // Step 4: Select 5 of each
  const fixture_winners = winners.slice(0, 5);
  const fixture_losers = losers.slice(0, 5);
  const fixture_open = open.slice(0, 5);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE SELECTED');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`✅ 5 Winners`);
  console.log(`✅ 5 Losers`);
  console.log(`✅ 5 Open\n`);

  // Step 5: Export fills for fixture
  const fixture_token_ids = new Set([
    ...fixture_winners.map(p => p.token_id),
    ...fixture_losers.map(p => p.token_id),
    ...fixture_open.map(p => p.token_id),
  ]);

  const fixture_fills: any[] = [];
  for (const fill of fills) {
    if (fixture_token_ids.has(fill.token_id)) {
      fixture_fills.push(fill);
    }
  }

  console.log(`Total fills for fixture: ${fixture_fills.length}\n`);

  // Step 6: Export ERC1155 transfers for fixture
  console.log('📊 Loading ERC1155 transfers...\n');

  const transfersQuery = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        log_index,
        block_number,
        block_timestamp,
        contract,
        token_id,
        from_address,
        to_address,
        value
      FROM erc1155_transfers
      WHERE token_id IN (${Array.from(fixture_token_ids).map(t => `'${t}'`).join(',')})
        AND (from_address = '${TARGET_WALLET}' OR to_address = '${TARGET_WALLET}')
      ORDER BY block_timestamp ASC
    `,
    format: 'JSONEachRow'
  });

  const transfers: any[] = await transfersQuery.json();
  console.log(`✅ Loaded ${transfers.length} ERC1155 transfers\n`);

  // Step 7: Export resolutions for fixture
  const fixture_condition_ids = new Set([
    ...fixture_winners.map(p => p.condition_id_norm),
    ...fixture_losers.map(p => p.condition_id_norm),
    ...fixture_open.map(p => p.condition_id_norm),
  ]);

  const resolutionsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        outcome_count,
        winning_outcome,
        winning_index,
        resolved_at,
        source
      FROM market_resolutions_final
      WHERE condition_id_norm IN (${Array.from(fixture_condition_ids).map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });

  const resolutions: any[] = await resolutionsQuery.json();
  console.log(`✅ Loaded ${resolutions.length} resolutions\n`);

  // Step 8: Save CSVs
  console.log('💾 Saving fixture CSVs...\n');

  // fills_fixture.csv
  const fills_csv = [
    'tx_hash,timestamp,asset_id,market_slug,side,shares,price,fee_rate_bps,token_id,condition_id_norm,outcome_index',
    ...fixture_fills.map(f =>
      `${f.tx_hash},${f.timestamp},${f.asset_id},${f.market_slug},${f.side},${f.shares},${f.price},${f.fee_rate_bps},${f.token_id},${f.condition_id_norm},${f.outcome_index}`
    )
  ].join('\n');
  fs.writeFileSync('fills_fixture.csv', fills_csv);
  console.log(`  ✅ fills_fixture.csv (${fixture_fills.length} rows)`);

  // erc1155_fixture.csv
  const erc1155_csv = [
    'tx_hash,log_index,block_number,block_timestamp,contract,token_id,from_address,to_address,value',
    ...transfers.map(t =>
      `${t.tx_hash},${t.log_index},${t.block_number},${t.block_timestamp},${t.contract},${t.token_id},${t.from_address},${t.to_address},${t.value}`
    )
  ].join('\n');
  fs.writeFileSync('erc1155_fixture.csv', erc1155_csv);
  console.log(`  ✅ erc1155_fixture.csv (${transfers.length} rows)`);

  // resolutions_fixture.csv
  const resolutions_csv = [
    'condition_id_norm,payout_numerators,payout_denominator,outcome_count,winning_outcome,winning_index,resolved_at,source',
    ...resolutions.map(r =>
      `${r.condition_id_norm},"${JSON.stringify(r.payout_numerators)}",${r.payout_denominator},${r.outcome_count},${r.winning_outcome},${r.winning_index},${r.resolved_at},${r.source}`
    )
  ].join('\n');
  fs.writeFileSync('resolutions_fixture.csv', resolutions_csv);
  console.log(`  ✅ resolutions_fixture.csv (${resolutions.length} rows)\n`);

  // Step 9: Print summary table
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const all_fixture = [...fixture_winners, ...fixture_losers, ...fixture_open];

  console.table(all_fixture.map(p => ({
    token_id: p.token_id.substring(0, 20) + '...',
    outcome_idx: p.outcome_index,
    status: p.resolution
      ? (p.resolution.winning_index === p.outcome_index ? '🏆 WIN' : '❌ LOSE')
      : '⏳ OPEN',
    winning_idx: p.resolution?.winning_index ?? 'N/A',
    net_shares: p.net_shares.toFixed(2),
    cost_basis: `$${p.cost_basis.toFixed(2)}`,
    fills: p.fills.length,
  })));

  console.log('\n✅ FIXTURE BUILD COMPLETE\n');
  console.log('Next: Run checkpoint A (token decode and joins)\n');
}

main().catch(console.error);
