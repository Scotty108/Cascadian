/**
 * 37: BUILD TRACK A FIXTURE (V2 - Efficient)
 *
 * Build 15-row fixture with efficient queries using candidate_conditions CTE
 * to avoid massive table scans
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

// Snapshot timestamp for determining open vs resolved
const SNAPSHOT_TS = '2025-10-15 00:00:00';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('37: BUILD TRACK A FIXTURE (V2 - Efficient)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Snapshot timestamp: ${SNAPSHOT_TS}\n`);
  console.log('Mission: Build 15-row fixture for Track A P&L validation\n');

  const fixture: any[] = [];

  // Step 1: Find 5 WINNING positions
  console.log('📊 Step 1: Find 5 winning positions...\n');

  const query1 = await clickhouse.query({
    query: `
      WITH candidate_conditions AS (
        SELECT
          condition_id_norm,
          winning_index,
          resolved_at,
          payout_numerators
        FROM market_resolutions_final
        WHERE resolved_at BETWEEN '2025-08-01' AND '2025-10-15'
          AND length(payout_numerators) > 0
        ORDER BY rand()
        LIMIT 2000
      ),
      fills AS (
        SELECT
          user_eoa AS wallet,
          asset_id,
          side,
          size,
          price,
          timestamp AS fill_timestamp
        FROM clob_fills
        WHERE timestamp BETWEEN '2025-08-01' AND '2025-10-15'
      )
      SELECT
        f.wallet,
        f.asset_id,
        ctm.condition_id_norm,
        ctm.question,
        ctm.outcome AS outcome_label,
        cc.winning_index,
        cc.payout_numerators,
        cc.resolved_at,
        sum(CASE WHEN f.side = 'BUY' THEN f.size ELSE -f.size END) AS net_size,
        sum(CASE WHEN f.side = 'BUY' THEN f.size * f.price ELSE -f.size * f.price END) AS cost_basis,
        -- PnL = net_size * payout - cost_basis (simplified)
        sum(CASE WHEN f.side = 'BUY' THEN f.size ELSE -f.size END) * arrayElement(cc.payout_numerators,
          CASE WHEN ctm.outcome = 'Yes' THEN 1
               WHEN ctm.outcome = 'No' THEN 2
               WHEN ctm.outcome = 'Up' THEN 1
               WHEN ctm.outcome = 'Down' THEN 2
               ELSE 1 END
        ) - sum(CASE WHEN f.side = 'BUY' THEN f.size * f.price ELSE -f.size * f.price END) AS realized_pnl
      FROM fills f
      INNER JOIN ctf_token_map ctm ON ctm.token_id = f.asset_id
      INNER JOIN candidate_conditions cc ON cc.condition_id_norm = ctm.condition_id_norm
      WHERE
        -- Match winning outcomes
        (
          (ctm.outcome = 'Yes' AND cc.winning_index = 0)
          OR (ctm.outcome = 'No' AND cc.winning_index = 1)
          OR (ctm.outcome = 'Up' AND cc.winning_index = 0)
          OR (ctm.outcome = 'Down' AND cc.winning_index = 1)
        )
        AND cc.resolved_at <= '${SNAPSHOT_TS}'
      GROUP BY f.wallet, f.asset_id, ctm.condition_id_norm, ctm.question, ctm.outcome, cc.winning_index, cc.payout_numerators, cc.resolved_at
      HAVING net_size > 0  -- Net long position
        AND realized_pnl > 0  -- Actually profitable
      ORDER BY realized_pnl DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const winners: any[] = await query1.json();
  console.log(`Found ${winners.length} winning positions\n`);

  winners.forEach(w => {
    fixture.push({
      wallet: w.wallet,
      asset_id: w.asset_id,
      condition_id_norm: w.condition_id_norm,
      question: w.question,
      outcome_label: w.outcome_label,
      winning_index: w.winning_index,
      resolved_at: w.resolved_at,
      net_size: parseFloat(w.net_size),
      cost_basis: parseFloat(w.cost_basis),
      realized_pnl: parseFloat(w.realized_pnl),
      status: 'WON'
    });
  });

  // Step 2: Find 5 LOSING positions
  console.log('📊 Step 2: Find 5 losing positions...\n');

  const query2 = await clickhouse.query({
    query: `
      WITH candidate_conditions AS (
        SELECT
          condition_id_norm,
          winning_index,
          resolved_at,
          payout_numerators
        FROM market_resolutions_final
        WHERE resolved_at BETWEEN '2025-08-01' AND '2025-10-15'
          AND length(payout_numerators) > 0
        ORDER BY rand()
        LIMIT 2000
      ),
      fills AS (
        SELECT
          user_eoa AS wallet,
          asset_id,
          side,
          size,
          price,
          timestamp AS fill_timestamp
        FROM clob_fills
        WHERE timestamp BETWEEN '2025-08-01' AND '2025-10-15'
      )
      SELECT
        f.wallet,
        f.asset_id,
        ctm.condition_id_norm,
        ctm.question,
        ctm.outcome AS outcome_label,
        cc.winning_index,
        cc.payout_numerators,
        cc.resolved_at,
        sum(CASE WHEN f.side = 'BUY' THEN f.size ELSE -f.size END) AS net_size,
        sum(CASE WHEN f.side = 'BUY' THEN f.size * f.price ELSE -f.size * f.price END) AS cost_basis,
        -- PnL = 0 for losers - cost_basis (simplified)
        0 - sum(CASE WHEN f.side = 'BUY' THEN f.size * f.price ELSE -f.size * f.price END) AS realized_pnl
      FROM fills f
      INNER JOIN ctf_token_map ctm ON ctm.token_id = f.asset_id
      INNER JOIN candidate_conditions cc ON cc.condition_id_norm = ctm.condition_id_norm
      WHERE
        -- Match losing outcomes
        (
          (ctm.outcome = 'Yes' AND cc.winning_index != 0)
          OR (ctm.outcome = 'No' AND cc.winning_index != 1)
          OR (ctm.outcome = 'Up' AND cc.winning_index != 0)
          OR (ctm.outcome = 'Down' AND cc.winning_index != 1)
        )
        AND cc.resolved_at <= '${SNAPSHOT_TS}'
      GROUP BY f.wallet, f.asset_id, ctm.condition_id_norm, ctm.question, ctm.outcome, cc.winning_index, cc.payout_numerators, cc.resolved_at
      HAVING net_size > 0  -- Net long position
        AND realized_pnl < 0  -- Actually a loss
      ORDER BY realized_pnl ASC  -- Most negative first
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const losers: any[] = await query2.json();
  console.log(`Found ${losers.length} losing positions\n`);

  losers.forEach(l => {
    fixture.push({
      wallet: l.wallet,
      asset_id: l.asset_id,
      condition_id_norm: l.condition_id_norm,
      question: l.question,
      outcome_label: l.outcome_label,
      winning_index: l.winning_index,
      resolved_at: l.resolved_at,
      net_size: parseFloat(l.net_size),
      cost_basis: parseFloat(l.cost_basis),
      realized_pnl: parseFloat(l.realized_pnl),
      status: 'LOST'
    });
  });

  // Step 3: Find 5 OPEN positions
  console.log('📊 Step 3: Find 5 open positions...\n');

  const query3 = await clickhouse.query({
    query: `
      WITH candidate_markets AS (
        SELECT DISTINCT
          ctm.condition_id_norm,
          ctm.question,
          ctm.outcome
        FROM ctf_token_map ctm
        LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = ctm.condition_id_norm
        WHERE mr.condition_id_norm IS NULL  -- Not resolved
          OR mr.resolved_at > '${SNAPSHOT_TS}'  -- Resolved after snapshot
        LIMIT 2000
      ),
      fills AS (
        SELECT
          user_eoa AS wallet,
          asset_id,
          side,
          size,
          price,
          timestamp AS fill_timestamp
        FROM clob_fills
        WHERE timestamp BETWEEN '2025-08-01' AND '2025-10-15'
      )
      SELECT
        f.wallet,
        f.asset_id,
        ctm.condition_id_norm,
        ctm.question,
        ctm.outcome AS outcome_label,
        sum(CASE WHEN f.side = 'BUY' THEN f.size ELSE -f.size END) AS net_size,
        sum(CASE WHEN f.side = 'BUY' THEN f.size * f.price ELSE -f.size * f.price END) AS cost_basis
      FROM fills f
      INNER JOIN ctf_token_map ctm ON ctm.token_id = f.asset_id
      INNER JOIN candidate_markets cm ON cm.condition_id_norm = ctm.condition_id_norm
      GROUP BY f.wallet, f.asset_id, ctm.condition_id_norm, ctm.question, ctm.outcome
      HAVING net_size > 0  -- Net long position
      ORDER BY cost_basis DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const open: any[] = await query3.json();
  console.log(`Found ${open.length} open positions\n`);

  open.forEach(o => {
    fixture.push({
      wallet: o.wallet,
      asset_id: o.asset_id,
      condition_id_norm: o.condition_id_norm,
      question: o.question,
      outcome_label: o.outcome_label,
      winning_index: null,
      resolved_at: null,
      net_size: parseFloat(o.net_size),
      cost_basis: parseFloat(o.cost_basis),
      realized_pnl: null,
      status: 'OPEN'
    });
  });

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE SUMMARY:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Total rows: ${fixture.length}`);
  console.log(`  Winners: ${fixture.filter(f => f.status === 'WON').length}`);
  console.log(`  Losers: ${fixture.filter(f => f.status === 'LOST').length}`);
  console.log(`  Open: ${fixture.filter(f => f.status === 'OPEN').length}`);
  console.log('');

  // Sample display
  console.log('Sample fixture rows:');
  console.table(fixture.slice(0, 5).map(f => ({
    wallet: f.wallet.substring(0, 10) + '...',
    status: f.status,
    question: f.question.substring(0, 40) + '...',
    outcome: f.outcome_label,
    net_size: f.net_size.toLocaleString(),
    pnl: f.realized_pnl ? f.realized_pnl.toFixed(2) : 'null'
  })));

  // Write to JSON file
  const outputPath = resolve(process.cwd(), 'fixture_track_a_final.json');
  writeFileSync(outputPath, JSON.stringify(fixture, null, 2));
  console.log(`\n✅ Fixture written to: ${outputPath}\n`);

  if (fixture.length >= 10) {
    console.log('✅ SUCCESS: Track A fixture created!\n');
  } else {
    console.log('⚠️  WARNING: Fixture incomplete (fewer than 15 rows)\n');
  }
}

main().catch(console.error);
