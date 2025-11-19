/**
 * TRACK A2: Build Fixture for Control Wallet
 *
 * Build 15-row fixture: 5 winners, 5 losers, 5 open (or best available)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TRACK A2: BUILD FIXTURE');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load control wallet
  const CONTROL_WALLET = fs.readFileSync('CONTROL_WALLET.txt', 'utf-8').trim();
  console.log(`Control Wallet: ${CONTROL_WALLET}\n`);

  // Get fills with decoded tokens
  console.log('📊 Loading fills with token decode...\n');

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
        concat('0x', lpad(lower(hex(CAST(asset_id AS UInt256))), 64, '0')) as token_id,
        lpad(lower(hex(bitShiftRight(CAST(asset_id AS UInt256), 8))), 64, '0') as condition_id_norm,
        toUInt8(bitAnd(CAST(asset_id AS UInt256), 255)) as outcome_index
      FROM clob_fills
      WHERE proxy_wallet = '${CONTROL_WALLET}'
      ORDER BY timestamp DESC
    `,
    format: 'JSONEachRow'
  });

  const fills: any[] = await query.json();
  console.log(`✅ Loaded ${fills.length.toLocaleString()} fills\n`);

  // Group by token_id
  console.log('🔍 Classifying positions...\n');

  const positions = new Map<string, any>();

  for (const fill of fills) {
    if (!positions.has(fill.token_id)) {
      positions.set(fill.token_id, {
        token_id: fill.token_id,
        asset_id: fill.asset_id,
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

  console.log(`Total unique tokens: ${positions.size.toLocaleString()}\n`);

  // Check resolutions
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

  console.log(`Winners: ${winners.length.toLocaleString()}`);
  console.log(`Losers: ${losers.length.toLocaleString()}`);
  console.log(`Open: ${open.length.toLocaleString()}\n`);

  // Select fixture: 5 winners, 5 losers, 5 open (or best available)
  const fixtureWinners = winners.slice(0, 5);
  const fixtureLosers = losers.slice(0, 5);
  const fixtureOpen = open.slice(0, 5);

  const fixture = [...fixtureWinners, ...fixtureLosers, ...fixtureOpen];

  if (fixture.length === 0) {
    console.log('❌ NO POSITIONS FOR FIXTURE\n');
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

  console.log(`\nFixture composition: ${fixtureWinners.length} winners, ${fixtureLosers.length} losers, ${fixtureOpen.length} open\n`);

  // Export fixture fills
  const fixture_token_ids = new Set(fixture.map(p => p.token_id));
  const fixture_fills = fills.filter(f => fixture_token_ids.has(f.token_id));

  console.log(`💾 Exporting ${fixture_fills.length} fills for fixture...\n`);

  const csv = [
    'tx_hash,timestamp,asset_id,market_slug,side,shares,price,fee_rate_bps,token_id,condition_id_norm,outcome_index',
    ...fixture_fills.map(f =>
      `${f.tx_hash},${f.timestamp},${f.asset_id},${f.market_slug},${f.side},${f.shares},${f.price},${f.fee_rate_bps},${f.token_id},${f.condition_id_norm},${f.outcome_index}`
    )
  ].join('\n');

  fs.writeFileSync('fills_fixture_control.csv', csv);
  console.log('  ✅ fills_fixture_control.csv\n');

  // Export resolution data for fixture
  const resolutions: any[] = [];
  for (const pos of fixture) {
    if (pos.resolution) {
      resolutions.push({
        condition_id_norm: pos.condition_id_norm,
        outcome_index: pos.outcome_index,
        winning_index: pos.resolution.winning_index,
        outcome_count: pos.resolution.outcome_count,
        payout_numerators: JSON.stringify(pos.resolution.payout_numerators),
        resolved_at: pos.resolution.resolved_at,
      });
    }
  }

  const resCsv = [
    'condition_id_norm,outcome_index,winning_index,outcome_count,payout_numerators,resolved_at',
    ...resolutions.map(r =>
      `${r.condition_id_norm},${r.outcome_index},${r.winning_index},${r.outcome_count},"${r.payout_numerators}",${r.resolved_at}`
    )
  ].join('\n');

  fs.writeFileSync('resolutions_fixture_control.csv', resCsv);
  console.log('  ✅ resolutions_fixture_control.csv\n');

  console.log('✅ FIXTURE BUILD COMPLETE\n');
  console.log('Next: Run Checkpoint A (track-a-checkpoint-a.ts)\n');
}

main().catch(console.error);
