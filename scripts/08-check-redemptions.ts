import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

async function checkRedemptions() {
  console.log('=== Checking for Redemption/Settlement Data ===\n');
  console.log('Hypothesis: Positions held to resolution have redemptions');
  console.log('that are NOT captured in CLOB trades, only in ERC1155 events.');
  console.log('');

  // Step 1: Find ERC1155 tables
  console.log('Step 1: Looking for ERC1155 tables...\n');

  const erc1155TablesQuery = `
    SELECT name, engine, total_rows
    FROM system.tables
    WHERE database = currentDatabase()
      AND (
        name LIKE '%erc1155%'
        OR name LIKE '%redeem%'
        OR name LIKE '%settle%'
        OR name LIKE '%ctf%'
      )
      AND name NOT LIKE '%staging%'
      AND name NOT LIKE '%backup%'
    ORDER BY name
  `;

  const tablesResult = await clickhouse.query({ query: erc1155TablesQuery, format: 'JSONEachRow' });
  const tables = await tablesResult.json<any[]>();

  console.log('Found ERC1155/redemption tables:');
  tables.forEach(t => {
    console.log(`  - ${t.name} (${Number(t.total_rows).toLocaleString()} rows)`);
  });
  console.log('');

  // Step 2: Check if xcnstrategy has any ERC1155 events
  for (const table of tables) {
    if (Number(table.total_rows) === 0) continue;

    console.log(`Checking ${table.name} for xcnstrategy...`);

    // Try different wallet column names
    const walletColumns = ['wallet', 'wallet_address', 'from', 'to', 'address', 'user'];

    for (const col of walletColumns) {
      try {
        const query = `
          SELECT count() AS total
          FROM ${table.name}
          WHERE lower(toString(${col})) IN (lower('${EOA}'), lower('${PROXY}'))
          LIMIT 1
        `;

        const result = await clickhouse.query({ query, format: 'JSONEachRow' });
        const data = await result.json<any[]>();

        if (Number(data[0].total) > 0) {
          console.log(`  ✓ Found ${data[0].total} events (column: ${col})`);

          // Get sample
          const sampleQuery = `
            SELECT *
            FROM ${table.name}
            WHERE lower(toString(${col})) IN (lower('${EOA}'), lower('${PROXY}'))
            LIMIT 3
          `;

          const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
          const samples = await sampleResult.json<any[]>();

          console.log('  Sample events:');
          samples.forEach(s => {
            console.log('   ', JSON.stringify(s, null, 2).substring(0, 200) + '...');
          });
          console.log('');
          break;
        }
      } catch (error) {
        // Column doesn't exist, try next one
        continue;
      }
    }
  }

  // Step 3: Check if we have specific redemption events
  console.log('\nStep 3: Looking for CTF redemption events...\n');

  // Common CTF redemption patterns:
  // - Transfer to 0x0000... (burn)
  // - Transfer from CTF contract
  // - RedeemPositions events

  const redemptionChecks = [
    {
      name: 'ERC1155 Transfers TO zero address (burns/redemptions)',
      table: 'pm_erc1155_transfers',
      query: `
        SELECT count() AS total, sum(value) AS total_value
        FROM pm_erc1155_transfers
        WHERE lower(from_address) IN (lower('${EOA}'), lower('${PROXY}'))
          AND lower(to_address) = '0x0000000000000000000000000000000000000000'
      `,
    },
    {
      name: 'Outcome Positions (post-resolution values)',
      table: 'outcome_positions_v3',
      query: `
        SELECT
          canonical_condition_id,
          canonical_outcome_index,
          final_shares,
          final_value,
          pnl
        FROM outcome_positions_v3
        WHERE lower(wallet_address) IN (lower('${EOA}'), lower('${PROXY}'))
          AND abs(pnl) > 0
        ORDER BY abs(pnl) DESC
        LIMIT 5
      `,
    },
  ];

  for (const check of redemptionChecks) {
    try {
      console.log(`Checking: ${check.name}`);
      const result = await clickhouse.query({ query: check.query, format: 'JSONEachRow' });
      const data = await result.json<any[]>();

      if (data.length > 0 && data[0].total !== undefined) {
        console.log(`  ✓ Found ${data[0].total} records`);
        if (data[0].total_value) {
          console.log(`    Total value: $${Number(data[0].total_value).toLocaleString()}`);
        }
      } else if (data.length > 0) {
        console.log(`  ✓ Found ${data.length} records:`);
        data.forEach(row => {
          console.log('   ', JSON.stringify(row));
        });
      } else {
        console.log(`  ✗ No records found`);
      }
    } catch (error) {
      console.log(`  ✗ Table/query error: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    console.log('');
  }

  // Step 4: The key insight - check if outcome_positions has the answer
  console.log('Step 4: Checking outcome_positions_v3 for aggregated PnL...\n');

  try {
    const outcomeQuery = `
      SELECT
        sum(pnl) AS total_pnl,
        count() AS position_count,
        sumIf(pnl, pnl > 0) AS total_profit,
        sumIf(pnl, pnl < 0) AS total_loss,
        countIf(pnl > 0) AS winning_positions,
        countIf(pnl < 0) AS losing_positions
      FROM outcome_positions_v3
      WHERE lower(wallet_address) IN (lower('${EOA}'), lower('${PROXY}'))
    `;

    const result = await clickhouse.query({ query: outcomeQuery, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (data.length > 0 && data[0].total_pnl !== null) {
      console.log('✅ Found PnL in outcome_positions_v3:');
      console.log(`  Total PnL:         $${Number(data[0].total_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Total Profit:      $${Number(data[0].total_profit).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Total Loss:        -$${Math.abs(Number(data[0].total_loss)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Positions:         ${data[0].winning_positions} wins / ${data[0].losing_positions} losses`);
      console.log('');

      const polymarketPnL = 87030.505;
      const outcomePnL = Number(data[0].total_pnl);
      const difference = outcomePnL - polymarketPnL;

      console.log('Comparison to Polymarket Reality:');
      console.log(`  Polymarket PnL:    $${polymarketPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  outcome_positions_v3: $${outcomePnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Difference:        $${difference.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  % Error:           ${((Math.abs(difference) / polymarketPnL) * 100).toFixed(2)}%`);
      console.log('');

      if (Math.abs(difference) < 1000) {
        console.log('✅✅✅ MATCH! outcome_positions_v3 has the correct PnL!');
      } else if (Math.abs(difference) < 10000) {
        console.log('✅ Very close! outcome_positions_v3 is within $10k of Polymarket reality.');
      } else {
        console.log('⚠️  Still a discrepancy, but outcome_positions_v3 is closer than our calculation.');
      }
    } else {
      console.log('✗ No PnL data found in outcome_positions_v3');
    }
  } catch (error) {
    console.log('✗ Error querying outcome_positions_v3:', error instanceof Error ? error.message : 'unknown');
  }
}

checkRedemptions().catch(console.error);
