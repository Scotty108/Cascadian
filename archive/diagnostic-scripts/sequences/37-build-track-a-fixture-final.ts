/**
 * 37: BUILD TRACK A FIXTURE (FINAL)
 *
 * Now that ctf_token_map has correct mappings from gamma_markets,
 * build the 15-row fixture for Track A P&L validation:
 * - 5 winning positions (resolved, profit)
 * - 5 losing positions (resolved, loss)
 * - 5 open positions (not yet resolved)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('37: BUILD TRACK A FIXTURE (FINAL)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Build 15-row fixture for Track A P&L validation\n');
  console.log('Target composition:');
  console.log('  - 5 winning positions (resolved, profitable)');
  console.log('  - 5 losing positions (resolved, loss)');
  console.log('  - 5 open positions (not yet resolved)\n');

  // Step 1: Find 5 winning positions
  console.log('📊 Step 1: Find 5 winning positions...\n');

  const query1 = await clickhouse.query({
    query: `
      WITH fills AS (
        SELECT
          user_eoa AS wallet,
          asset_id,
          side,
          size,
          price,
          timestamp,
          fill_id
        FROM clob_fills
        WHERE timestamp >= '2024-01-01'
      )
      SELECT DISTINCT
        f.wallet,
        f.asset_id,
        ctm.condition_id_norm,
        ctm.question,
        ctm.outcome AS position_outcome,
        mr.winning_outcome,
        mr.payout_numerators,
        f.side,
        f.size,
        f.price,
        f.timestamp,
        'winner' AS category
      FROM fills f
      JOIN ctf_token_map ctm ON ctm.token_id = f.asset_id
      JOIN market_resolutions_final mr ON mr.condition_id_norm = ctm.condition_id_norm
      WHERE
        -- Position outcome matches winning outcome
        (
          (ctm.outcome = 'Yes' AND mr.winning_outcome = 'Yes' AND arrayElement(mr.payout_numerators, 1) = 1)
          OR (ctm.outcome = 'No' AND mr.winning_outcome = 'No' AND arrayElement(mr.payout_numerators, 2) = 1)
          OR (ctm.outcome = mr.winning_outcome)
        )
        -- Buy side (net positive position)
        AND f.side = 'BUY'
      ORDER BY f.timestamp DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const winners: any[] = await query1.json();

  console.log(`Found ${winners.length} winning positions:`);
  if (winners.length > 0) {
    console.table(winners.map(w => ({
      wallet: w.wallet.substring(0, 10) + '...',
      question: w.question.substring(0, 40) + '...',
      position: w.position_outcome,
      winning: w.winning_outcome,
      side: w.side,
      size: w.size,
      price: w.price
    })));
  } else {
    console.log('  ⚠️  No winning positions found\n');
  }

  // Step 2: Find 5 losing positions
  console.log('\n📊 Step 2: Find 5 losing positions...\n');

  const query2 = await clickhouse.query({
    query: `
      WITH fills AS (
        SELECT
          user_eoa AS wallet,
          asset_id,
          side,
          size,
          price,
          timestamp,
          fill_id
        FROM clob_fills
        WHERE timestamp >= '2024-01-01'
      )
      SELECT DISTINCT
        f.wallet,
        f.asset_id,
        ctm.condition_id_norm,
        ctm.question,
        ctm.outcome AS position_outcome,
        mr.winning_outcome,
        mr.payout_numerators,
        f.side,
        f.size,
        f.price,
        f.timestamp,
        'loser' AS category
      FROM fills f
      JOIN ctf_token_map ctm ON ctm.token_id = f.asset_id
      JOIN market_resolutions_final mr ON mr.condition_id_norm = ctm.condition_id_norm
      WHERE
        -- Position outcome does NOT match winning outcome
        (
          (ctm.outcome = 'Yes' AND mr.winning_outcome != 'Yes' AND arrayElement(mr.payout_numerators, 1) = 0)
          OR (ctm.outcome = 'No' AND mr.winning_outcome != 'No' AND arrayElement(mr.payout_numerators, 2) = 0)
          OR (ctm.outcome != mr.winning_outcome AND mr.winning_outcome NOT IN ('Yes', 'No'))
        )
        -- Buy side (net positive position that lost)
        AND f.side = 'BUY'
      ORDER BY f.timestamp DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const losers: any[] = await query2.json();

  console.log(`Found ${losers.length} losing positions:`);
  if (losers.length > 0) {
    console.table(losers.map(l => ({
      wallet: l.wallet.substring(0, 10) + '...',
      question: l.question.substring(0, 40) + '...',
      position: l.position_outcome,
      winning: l.winning_outcome,
      side: l.side,
      size: l.size,
      price: l.price
    })));
  } else {
    console.log('  ⚠️  No losing positions found\n');
  }

  // Step 3: Find 5 open positions
  console.log('\n📊 Step 3: Find 5 open positions...\n');

  const query3 = await clickhouse.query({
    query: `
      WITH fills AS (
        SELECT
          user_eoa AS wallet,
          asset_id,
          side,
          size,
          price,
          timestamp,
          fill_id
        FROM clob_fills
        WHERE timestamp >= '2024-01-01'
      )
      SELECT DISTINCT
        f.wallet,
        f.asset_id,
        ctm.condition_id_norm,
        ctm.question,
        ctm.outcome AS position_outcome,
        f.side,
        f.size,
        f.price,
        f.timestamp,
        'open' AS category
      FROM fills f
      JOIN ctf_token_map ctm ON ctm.token_id = f.asset_id
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = ctm.condition_id_norm
      WHERE mr.condition_id_norm IS NULL  -- Not resolved
        AND f.side = 'BUY'
      ORDER BY f.timestamp DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const open: any[] = await query3.json();

  console.log(`Found ${open.length} open positions:`);
  if (open.length > 0) {
    console.table(open.map(o => ({
      wallet: o.wallet.substring(0, 10) + '...',
      question: o.question.substring(0, 40) + '...',
      position: o.position_outcome,
      side: o.side,
      size: o.size,
      price: o.price
    })));
  } else {
    console.log('  ⚠️  No open positions found\n');
  }

  // Step 4: Combine and create fixture table
  console.log('\n📊 Step 4: Create fixture table...\n');

  const allRows = [...winners, ...losers, ...open];

  console.log(`Total fixture rows: ${allRows.length}`);
  console.log(`  Winners: ${winners.length}`);
  console.log(`  Losers: ${losers.length}`);
  console.log(`  Open: ${open.length}\n`);

  if (allRows.length === 0) {
    console.log('❌ No data found for fixture. Cannot proceed.\n');
    return;
  }

  // Drop old fixture
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS track_a_fixture'
  });

  // Create fixture table
  await clickhouse.command({
    query: `
      CREATE TABLE track_a_fixture (
        wallet String,
        asset_id String,
        condition_id_norm FixedString(64),
        question String,
        position_outcome String,
        winning_outcome String,
        payout_numerators Array(UInt8),
        side String,
        size String,
        price String,
        timestamp DateTime,
        category String
      ) ENGINE = MergeTree()
      ORDER BY (wallet, asset_id, timestamp)
    `
  });

  console.log('  ✅ Created track_a_fixture table\n');

  // Insert data
  if (allRows.length > 0) {
    const values = allRows.map(row => {
      // Handle missing fields for open positions
      const winning = row.winning_outcome || '';
      const payout = row.payout_numerators || [];

      return `(
        '${row.wallet}',
        '${row.asset_id}',
        '${row.condition_id_norm}',
        '${row.question.replace(/'/g, "''")}',
        '${row.position_outcome}',
        '${winning}',
        [${payout.join(',')}],
        '${row.side}',
        '${row.size}',
        '${row.price}',
        '${row.timestamp}',
        '${row.category}'
      )`;
    }).join(',\n      ');

    await clickhouse.command({
      query: `
        INSERT INTO track_a_fixture VALUES
        ${values}
      `
    });

    console.log(`  ✅ Inserted ${allRows.length} rows into track_a_fixture\n`);
  }

  // Step 5: Verify fixture
  console.log('📊 Step 5: Verify fixture...\n');

  const query5 = await clickhouse.query({
    query: `
      SELECT
        category,
        count() AS row_count
      FROM track_a_fixture
      GROUP BY category
      ORDER BY category
    `,
    format: 'JSONEachRow'
  });

  const categoryCounts: any[] = await query5.json();

  console.log('Fixture composition:');
  console.table(categoryCounts);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('RESULT:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (allRows.length >= 10) {
    console.log('✅ SUCCESS: Track A fixture created!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run Track A Checkpoint B: Position tracking');
    console.log('  2. Run Track A Checkpoint C: Resolution matching');
    console.log('  3. Run Track A Checkpoint D: P&L calculation');
    console.log('  4. Validate results against expectations');
  } else {
    console.log('⚠️  WARNING: Fixture incomplete (fewer than 15 rows)');
    console.log('');
    console.log('Proceed with caution:');
    console.log('  - Some categories may have gaps');
    console.log('  - Validation may be limited');
  }

  console.log('');
}

main().catch(console.error);
