/**
 * BUILD FIXTURE - DIRECT DECODE
 *
 * Decode token_id directly from asset_id (no joins needed)
 * We confirmed earlier that asset_id IS the token_id (as decimal)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE BUILDER (DIRECT DECODE)');
  console.log(`Wallet: ${TARGET_WALLET}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get fills and decode token_id directly from asset_id
  console.log('📊 Loading fills with direct token decode...\n');

  const query = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        timestamp,
        asset_id,
        market_slug,
        side,
        size / 1000000.0 as shares,
        price,
        fee_rate_bps,
        asset_id as token_id_decimal,
        concat('0x', lpad(lower(hex(toUInt256(asset_id))), 64, '0')) as token_id,
        lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') as condition_id_norm,
        toUInt8(bitAnd(toUInt256(asset_id), 255)) as outcome_index
      FROM clob_fills
      WHERE proxy_wallet = '${TARGET_WALLET}'
      ORDER BY timestamp DESC
    `,
    format: 'JSONEachRow'
  });

  const fills: any[] = await query.json();
  console.log(`✅ Loaded ${fills.length} fills with decoded tokens\n`);

  if (fills.length === 0) {
    console.log('❌ NO FILLS FOUND\n');
    return;
  }

  // Show sample decode
  console.log('📊 Sample decode:\n');
  const sample = fills[0];
  console.log(`  Asset ID: ${sample.asset_id}`);
  console.log(`  Token ID: ${sample.token_id}`);
  console.log(`  Condition ID: ${sample.condition_id_norm}`);
  console.log(`  Outcome Index: ${sample.outcome_index}\n`);

  // Group by token_id
  console.log('🔍 Classifying positions...\n');

  const positions = new Map<string, any>();

  for (const fill of fills) {
    if (!positions.has(fill.token_id)) {
      positions.set(fill.token_id, {
        token_id: fill.token_id,
        condition_id_norm: fill.condition_id_norm,
        outcome_index: fill.outcome_index,
        market_slug: fill.market_slug,
        fills: [],
        resolution: null,
        net_shares: 0,
      });
    }

    const pos = positions.get(fill.token_id)!;
    pos.fills.push(fill);

    if (fill.side === 'BUY') {
      pos.net_shares += fill.shares;
    } else {
      pos.net_shares -= fill.shares;
    }
  }

  console.log(`Total unique tokens: ${positions.size}\n`);

  // Now check resolutions for ALL positions
  console.log('📊 Checking resolutions...\n');

  for (const pos of positions.values()) {
    const resQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          payout_numerators,
          resolved_at,
          outcome_count
        FROM market_resolutions_final
        WHERE condition_id_norm = '${pos.condition_id_norm}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const res: any[] = await resQuery.json();
    if (res.length > 0) {
      pos.resolution = res[0];
    }
  }

  // Classify
  const winners: any[] = [];
  const losers: any[] = [];
  const open: any[] = [];

  for (const pos of positions.values()) {
    if (Math.abs(pos.net_shares) < 0.01) continue; // Skip closed

    if (pos.resolution) {
      if (pos.resolution.winning_index === pos.outcome_index) {
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

  // Select fixture
  const fixture = [
    ...winners.slice(0, Math.min(5, winners.length)),
    ...losers.slice(0, Math.min(5, losers.length)),
    ...open.slice(0, Math.min(5, open.length)),
  ];

  if (fixture.length === 0) {
    console.log('❌ NO POSITIONS FOUND (all closed)\n');
    return;
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.table(fixture.map(p => ({
    token_id: p.token_id.substring(0, 20) + '...',
    condition_id: p.condition_id_norm.substring(0, 16) + '...',
    outcome_idx: p.outcome_index,
    status: p.resolution
      ? (p.resolution.winning_index === p.outcome_index ? '🏆 WIN' : '❌ LOSE')
      : '⏳ OPEN',
    winning_idx: p.resolution?.winning_index ?? 'N/A',
    outcome_count: p.resolution?.outcome_count ?? 'N/A',
    net_shares: p.net_shares.toFixed(2),
    fills: p.fills.length,
  })));

  // Export fixture fills
  const fixture_token_ids = new Set(fixture.map(p => p.token_id));
  const fixture_fills = fills.filter(f => fixture_token_ids.has(f.token_id));

  console.log(`\n💾 Exporting ${fixture_fills.length} fills for fixture...\n`);

  const csv = [
    'tx_hash,timestamp,asset_id,market_slug,side,shares,price,fee_rate_bps,token_id,condition_id_norm,outcome_index',
    ...fixture_fills.map(f =>
      `${f.tx_hash},${f.timestamp},${f.asset_id},${f.market_slug},${f.side},${f.shares},${f.price},${f.fee_rate_bps},${f.token_id},${f.condition_id_norm},${f.outcome_index}`
    )
  ].join('\n');

  fs.writeFileSync('fills_fixture.csv', csv);
  console.log('  ✅ fills_fixture.csv\n');

  console.log('✅ FIXTURE BUILD COMPLETE\n');
  console.log(`Selected: ${winners.slice(0, 5).length} winners, ${losers.slice(0, 5).length} losers, ${open.slice(0, 5).length} open\n`);
  console.log('Next: Run Checkpoint A\n');
}

main().catch(console.error);
