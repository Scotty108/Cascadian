import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const CHOSEN_VIEW = 'vw_trades_canonical_current';
const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

async function investigateProxyIssue() {
  console.log('=== Investigating Proxy Wallet Issue ===\n');
  console.log('EOA:   ', EOA);
  console.log('Proxy: ', PROXY);
  console.log('');

  // Step 1: Check if we have trades for both addresses
  console.log('Step 1: Checking trade counts for both addresses...\n');

  const eoaCountQuery = `
    SELECT count() AS total_trades
    FROM ${CHOSEN_VIEW}
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const proxyCountQuery = `
    SELECT count() AS total_trades
    FROM ${CHOSEN_VIEW}
    WHERE lower(wallet_address) = lower('${PROXY}')
  `;

  const eoaResult = await clickhouse.query({ query: eoaCountQuery, format: 'JSONEachRow' });
  const eoaData = await eoaResult.json<any[]>();

  const proxyResult = await clickhouse.query({ query: proxyCountQuery, format: 'JSONEachRow' });
  const proxyData = await proxyResult.json<any[]>();

  console.log('Trade counts:');
  console.log(`  EOA:   ${eoaData[0].total_trades} trades`);
  console.log(`  Proxy: ${proxyData[0].total_trades} trades`);
  console.log('');

  if (Number(proxyData[0].total_trades) === 0) {
    console.log('⚠️  WARNING: No trades found for proxy address!');
    console.log('   This is likely the problem - we need to aggregate BOTH addresses.');
    console.log('');
  }

  // Step 2: Check wallet_identity or proxy mapping tables
  console.log('Step 2: Checking for wallet identity/proxy mapping...\n');

  const identityTablesQuery = `
    SELECT name
    FROM system.tables
    WHERE database = currentDatabase()
      AND (
        name LIKE '%wallet%identity%'
        OR name LIKE '%proxy%map%'
        OR name LIKE '%safe%'
      )
    ORDER BY name
  `;

  const identityResult = await clickhouse.query({ query: identityTablesQuery, format: 'JSONEachRow' });
  const identityTables = await identityResult.json<any[]>();

  if (identityTables.length > 0) {
    console.log('Found wallet identity/proxy tables:');
    identityTables.forEach(t => console.log(`  - ${t.name}`));
    console.log('');

    // Check if our addresses are in any of these tables
    for (const table of identityTables) {
      console.log(`Checking ${table.name}...`);

      const checkQuery = `
        SELECT *
        FROM ${table.name}
        WHERE lower(toString(eoa)) = lower('${EOA}')
           OR lower(toString(proxy)) = lower('${PROXY}')
           OR lower(toString(wallet_address)) = lower('${EOA}')
           OR lower(toString(wallet_address)) = lower('${PROXY}')
        LIMIT 5
      `;

      try {
        const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
        const checkData = await checkResult.json<any[]>();

        if (checkData.length > 0) {
          console.log(`  ✓ Found ${checkData.length} row(s):`);
          checkData.forEach(row => console.log('   ', JSON.stringify(row)));
        } else {
          console.log('  ✗ No matches');
        }
      } catch (error) {
        console.log('  ✗ Error querying table');
      }
      console.log('');
    }
  } else {
    console.log('No wallet identity/proxy tables found.');
    console.log('');
  }

  // Step 3: Check if we should be aggregating both addresses for PnL
  console.log('Step 3: Calculating combined PnL for both addresses...\n');

  const combinedPnLQuery = `
    WITH
      positions AS (
        SELECT
          canonical_condition_id,
          canonical_outcome_index,
          sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
          sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost
        FROM ${CHOSEN_VIEW}
        WHERE lower(wallet_address) IN (lower('${EOA}'), lower('${PROXY}'))
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
          AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY canonical_condition_id, canonical_outcome_index
        HAVING abs(net_shares) > 0.001
      ),

      resolved_positions AS (
        SELECT
          p.canonical_condition_id,
          p.net_shares,
          p.net_cost,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          if(
            r.payout_denominator > 0,
            (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.canonical_outcome_index + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
            -toFloat64(p.net_cost)
          ) AS realized_pnl
        FROM positions p
        INNER JOIN market_resolutions_final r
          ON p.canonical_condition_id = r.condition_id_norm
        WHERE r.payout_denominator > 0
      )

    SELECT
      count() AS total_positions,
      sum(abs(net_cost)) AS total_volume,
      sumIf(realized_pnl, realized_pnl > 0) AS total_profit,
      sumIf(realized_pnl, realized_pnl < 0) AS total_loss,
      sum(realized_pnl) AS net_pnl,
      countIf(realized_pnl > 0) AS winning_positions,
      countIf(realized_pnl < 0) AS losing_positions
    FROM resolved_positions
  `;

  const combinedResult = await clickhouse.query({ query: combinedPnLQuery, format: 'JSONEachRow' });
  const combinedData = await combinedResult.json<any[]>();

  console.log('Combined PnL (EOA + Proxy):');
  console.log(`  Total Volume:      $${Number(combinedData[0].total_volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Total Profit:      $${Number(combinedData[0].total_profit).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Total Loss:        -$${Math.abs(Number(combinedData[0].total_loss)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  NET PnL:           $${Number(combinedData[0].net_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Positions:         ${combinedData[0].winning_positions} wins / ${combinedData[0].losing_positions} losses`);
  console.log('');

  const polymarketPnL = 87030.505;
  const ourCombinedPnL = Number(combinedData[0].net_pnl);
  const difference = ourCombinedPnL - polymarketPnL;

  console.log('Comparison to Polymarket Reality:');
  console.log(`  Polymarket PnL:    $${polymarketPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Our Combined PnL:  $${ourCombinedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Difference:        $${difference.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  % Error:           ${((Math.abs(difference) / polymarketPnL) * 100).toFixed(2)}%`);
  console.log('');

  if (Math.abs(difference) < 10000) {
    console.log('✅ Our calculation is within $10k of Polymarket reality!');
  } else if (Math.abs(difference) < 50000) {
    console.log('⚠️  Our calculation is within $50k of Polymarket reality.');
    console.log('   This is close but needs investigation.');
  } else {
    console.log('❌ Our calculation is still significantly off from Polymarket reality.');
    console.log('   Further investigation needed.');
  }
  console.log('');

  // Step 4: Debug a specific winning position to see the math
  console.log('Step 4: Debugging a sample winning position...\n');

  const sampleQuery = `
    WITH
      positions AS (
        SELECT
          canonical_condition_id,
          canonical_outcome_index,
          sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
          sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost,
          count() AS trade_count
        FROM ${CHOSEN_VIEW}
        WHERE lower(wallet_address) IN (lower('${EOA}'), lower('${PROXY}'))
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
          AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY canonical_condition_id, canonical_outcome_index
        HAVING abs(net_shares) > 0.001
      ),

      resolved_positions AS (
        SELECT
          p.canonical_condition_id,
          p.canonical_outcome_index,
          p.net_shares,
          p.net_cost,
          p.trade_count,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          arrayElement(r.payout_numerators, p.canonical_outcome_index + 1) AS payout_num,
          if(
            r.payout_denominator > 0,
            toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.canonical_outcome_index + 1)) / toFloat64(r.payout_denominator)),
            0
          ) AS payout_value,
          if(
            r.payout_denominator > 0,
            (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.canonical_outcome_index + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
            -toFloat64(p.net_cost)
          ) AS realized_pnl
        FROM positions p
        INNER JOIN market_resolutions_final r
          ON p.canonical_condition_id = r.condition_id_norm
        WHERE r.payout_denominator > 0
      )

    SELECT *
    FROM resolved_positions
    WHERE realized_pnl > 0
    ORDER BY realized_pnl DESC
    LIMIT 1
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json<any[]>();

  if (sampleData.length > 0) {
    const pos = sampleData[0];
    console.log('Sample WINNING Position:');
    console.log(`  Condition ID:      ${pos.canonical_condition_id.substring(0, 16)}...`);
    console.log(`  Outcome Index:     ${pos.canonical_outcome_index}`);
    console.log(`  Winning Index:     ${pos.winning_index}`);
    console.log(`  Trade Count:       ${pos.trade_count}`);
    console.log(`  Net Shares:        ${Number(pos.net_shares).toFixed(2)}`);
    console.log(`  Net Cost:          $${Number(pos.net_cost).toFixed(2)}`);
    console.log(`  Payout Numerator:  ${pos.payout_num}`);
    console.log(`  Payout Denominator: ${pos.payout_denominator}`);
    console.log(`  Payout Value:      $${Number(pos.payout_value).toFixed(2)}`);
    console.log(`  Realized PnL:      $${Number(pos.realized_pnl).toFixed(2)}`);
    console.log('');
    console.log('Math check:');
    console.log(`  ${Number(pos.net_shares).toFixed(2)} shares * (${pos.payout_num}/${pos.payout_denominator}) = $${Number(pos.payout_value).toFixed(2)}`);
    console.log(`  $${Number(pos.payout_value).toFixed(2)} - $${Number(pos.net_cost).toFixed(2)} = $${Number(pos.realized_pnl).toFixed(2)}`);
  }
}

investigateProxyIssue().catch(console.error);
