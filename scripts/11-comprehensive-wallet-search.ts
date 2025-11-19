import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

async function comprehensiveWalletSearch() {
  console.log('=== COMPREHENSIVE WALLET IDENTITY SEARCH ===\n');
  console.log('Known addresses:');
  console.log(`  EOA:   ${EOA}`);
  console.log(`  Proxy: ${PROXY}`);
  console.log('');
  console.log('Searching for ALL addresses that might contain this wallet\'s data...\n');

  const knownAddresses = new Set<string>([
    EOA.toLowerCase(),
    PROXY.toLowerCase(),
  ]);

  // Step 1: Check wallet identity mapping tables
  console.log('Step 1: Checking wallet identity mapping tables...\n');

  const identityTablesQuery = `
    SELECT name, engine, total_rows
    FROM system.tables
    WHERE database = currentDatabase()
      AND (
        name LIKE '%wallet%'
        OR name LIKE '%identity%'
        OR name LIKE '%mapping%'
        OR name LIKE '%proxy%'
      )
      AND total_rows > 0
    ORDER BY name
  `;

  const identityResult = await clickhouse.query({ query: identityTablesQuery, format: 'JSONEachRow' });
  const identityTables = await identityResult.json<any[]>();

  for (const table of identityTables) {
    console.log(`Checking ${table.name}...`);

    try {
      // Get schema first
      const schemaQuery = `DESCRIBE ${table.name}`;
      const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schema = await schemaResult.json<any[]>();

      const columns = schema.map(s => s.name);

      // Look for any column that might contain our addresses
      for (const col of columns) {
        if (!col.toLowerCase().includes('address') &&
            !col.toLowerCase().includes('wallet') &&
            !col.toLowerCase().includes('eoa') &&
            !col.toLowerCase().includes('proxy')) {
          continue;
        }

        const searchQuery = `
          SELECT *
          FROM ${table.name}
          WHERE lower(toString(${col})) IN (${Array.from(knownAddresses).map(a => `'${a}'`).join(',')})
          LIMIT 10
        `;

        try {
          const result = await clickhouse.query({ query: searchQuery, format: 'JSONEachRow' });
          const data = await result.json<any[]>();

          if (data.length > 0) {
            console.log(`  ✓ Found ${data.length} match(es) in column: ${col}`);

            // Extract any new addresses from the results
            data.forEach(row => {
              Object.keys(row).forEach(key => {
                const value = String(row[key]).toLowerCase();
                if (value.startsWith('0x') && value.length === 42) {
                  if (!knownAddresses.has(value)) {
                    console.log(`    → Found NEW address: ${value} (from column: ${key})`);
                    knownAddresses.add(value);
                  }
                }
              });
            });

            console.log('    Sample row:', JSON.stringify(data[0], null, 2).substring(0, 300));
          }
        } catch (error) {
          // Skip column
        }
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error instanceof Error ? error.message.substring(0, 100) : 'unknown'}`);
    }
    console.log('');
  }

  // Step 2: Search in ERC1155 transfers to find ALL addresses that interacted
  console.log('Step 2: Searching ERC1155 transfers for related addresses...\n');

  try {
    // Find transfers FROM our known addresses
    const fromQuery = `
      SELECT DISTINCT lower(to_address) AS related_address, count() AS transfer_count
      FROM erc1155_transfers
      WHERE lower(from_address) IN (${Array.from(knownAddresses).map(a => `'${a}'`).join(',')})
      GROUP BY related_address
      ORDER BY transfer_count DESC
      LIMIT 20
    `;

    const fromResult = await clickhouse.query({ query: fromQuery, format: 'JSONEachRow' });
    const fromData = await fromResult.json<any[]>();

    if (fromData.length > 0) {
      console.log('Addresses that received transfers FROM our wallet:');
      fromData.forEach((row, i) => {
        console.log(`  ${i + 1}. ${row.related_address} (${row.transfer_count} transfers)`);
        if (!knownAddresses.has(row.related_address) && row.related_address !== '0x0000000000000000000000000000000000000000') {
          console.log(`     → Potentially related address`);
          knownAddresses.add(row.related_address);
        }
      });
      console.log('');
    }

    // Find transfers TO our known addresses
    const toQuery = `
      SELECT DISTINCT lower(from_address) AS related_address, count() AS transfer_count
      FROM erc1155_transfers
      WHERE lower(to_address) IN (${Array.from(knownAddresses).map(a => `'${a}'`).join(',')})
        AND lower(from_address) != '0x0000000000000000000000000000000000000000'
      GROUP BY related_address
      ORDER BY transfer_count DESC
      LIMIT 20
    `;

    const toResult = await clickhouse.query({ query: toQuery, format: 'JSONEachRow' });
    const toData = await toResult.json<any[]>();

    if (toData.length > 0) {
      console.log('Addresses that sent transfers TO our wallet:');
      toData.forEach((row, i) => {
        console.log(`  ${i + 1}. ${row.related_address} (${row.transfer_count} transfers)`);
        if (!knownAddresses.has(row.related_address)) {
          console.log(`     → Potentially related address`);
          knownAddresses.add(row.related_address);
        }
      });
      console.log('');
    }
  } catch (error) {
    console.log('✗ Error searching ERC1155:', error instanceof Error ? error.message : 'unknown');
    console.log('');
  }

  // Step 3: Now search for trades under ALL discovered addresses
  console.log('Step 3: Searching for trades under ALL discovered addresses...\n');
  console.log(`Total addresses to check: ${knownAddresses.size}`);
  console.log('');

  const allAddresses = Array.from(knownAddresses);
  const addressList = allAddresses.map(a => `'${a}'`).join(',');

  // Search in canonical trades view
  const tradesQuery = `
    SELECT
      lower(wallet_address) AS wallet,
      count() AS trade_count,
      sum(usd_value) AS total_volume
    FROM vw_trades_canonical_current
    WHERE lower(wallet_address) IN (${addressList})
    GROUP BY wallet
    ORDER BY trade_count DESC
  `;

  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const tradesData = await tradesResult.json<any[]>();

  if (tradesData.length > 0) {
    console.log('Found trades under these addresses:');
    tradesData.forEach(row => {
      console.log(`  ${row.wallet}: ${row.trade_count} trades, $${Number(row.total_volume).toLocaleString()} volume`);
    });
    console.log('');
  } else {
    console.log('✗ No trades found under any discovered addresses!');
    console.log('');
  }

  // Step 4: Search in PnL tables
  console.log('Step 4: Searching PnL tables under ALL discovered addresses...\n');

  const pnlQuery = `
    SELECT
      lower(wallet_address) AS wallet,
      count() AS market_count,
      sum(total_pnl_usd) AS total_pnl
    FROM pm_wallet_market_pnl_v2
    WHERE lower(wallet_address) IN (${addressList})
    GROUP BY wallet
    ORDER BY abs(total_pnl) DESC
  `;

  try {
    const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
    const pnlData = await pnlResult.json<any[]>();

    if (pnlData.length > 0) {
      console.log('Found PnL data under these addresses:');
      pnlData.forEach(row => {
        console.log(`  ${row.wallet}: ${row.market_count} markets, PnL: $${Number(row.total_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      });
      console.log('');

      // Calculate total PnL across all addresses
      const totalPnL = pnlData.reduce((sum, row) => sum + Number(row.total_pnl), 0);
      console.log('═══════════════════════════════════════════════════════');
      console.log(`TOTAL PnL (all discovered addresses): $${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log('═══════════════════════════════════════════════════════');
      console.log('');

      const polymarketPnL = 87030.505;
      const difference = totalPnL - polymarketPnL;
      console.log('Comparison to Polymarket:');
      console.log(`  Polymarket: $${polymarketPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Our Total:  $${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Difference: $${difference.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log('');
    } else {
      console.log('✗ No PnL data found under any discovered addresses!');
      console.log('');
    }
  } catch (error) {
    console.log('✗ Error:', error instanceof Error ? error.message : 'unknown');
    console.log('');
  }

  // Step 5: Summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('SUMMARY OF DISCOVERED ADDRESSES:');
  console.log('═══════════════════════════════════════════════════════');
  allAddresses.forEach((addr, i) => {
    const isOriginal = addr === EOA.toLowerCase() || addr === PROXY.toLowerCase();
    console.log(`${i + 1}. ${addr} ${isOriginal ? '(original)' : '(discovered)'}`);
  });
  console.log('');

  return Array.from(knownAddresses);
}

comprehensiveWalletSearch().catch(console.error);
