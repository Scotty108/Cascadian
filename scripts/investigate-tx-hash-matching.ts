#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function investigate() {
  console.log('=== CRITICAL DEBUG: TX_HASH MATCHING INVESTIGATION ===\n');
  console.log('Goal: Find why only 1% of 77.4M missing trades match on tx_hash\n');

  try {
    console.log('=== PHASE 1: Understanding Data Structure ===\n');

    // 1. Check if trades_raw has transaction_hash values
    console.log('1. Checking transaction_hash presence in trades_raw (missing condition_id):');
    const txHashPresence = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_missing,
          COUNT(transaction_hash) as with_tx_hash,
          COUNT(DISTINCT transaction_hash) as unique_tx_hashes,
          ROUND(COUNT(transaction_hash) / COUNT(*) * 100, 2) as pct_with_txhash
        FROM trades_raw
        WHERE condition_id = '' OR condition_id IS NULL
      `,
      format: 'JSONEachRow'
    });
    const txHashData = await txHashPresence.json();
    console.log(JSON.stringify(txHashData, null, 2));
    console.log('');

    // 2. Sample transaction_hash values from trades_raw
    console.log('2. Sample transaction_hash values from trades_raw (missing condition_id):');
    const sampleTrades = await clickhouse.query({
      query: `
        SELECT DISTINCT
          transaction_hash,
          LENGTH(transaction_hash) as hash_length,
          substring(transaction_hash, 1, 20) as prefix,
          substring(transaction_hash, 1, 2) as first_two
        FROM trades_raw
        WHERE (condition_id = '' OR condition_id IS NULL)
          AND transaction_hash IS NOT NULL
          AND transaction_hash != ''
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const tradesData = await sampleTrades.json();
    console.log(JSON.stringify(tradesData, null, 2));
    console.log('');

    // 3. Sample tx_hash values from erc1155_transfers
    console.log('3. Sample tx_hash values from erc1155_transfers:');
    const sampleTransfers = await clickhouse.query({
      query: `
        SELECT DISTINCT
          tx_hash,
          LENGTH(tx_hash) as hash_length,
          substring(tx_hash, 1, 20) as prefix,
          substring(tx_hash, 1, 2) as first_two
        FROM erc1155_transfers
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const transfersData = await sampleTransfers.json();
    console.log(JSON.stringify(transfersData, null, 2));
    console.log('');

    console.log('=== PHASE 2: Diagnosing JOIN Failure ===\n');

    // 4. Check case sensitivity in erc1155_transfers
    console.log('4. Checking tx_hash format consistency in erc1155_transfers:');
    const caseCheck = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT tx_hash) as unique_hashes,
          COUNT(DISTINCT lower(tx_hash)) as unique_lower_hashes,
          COUNT(DISTINCT upper(tx_hash)) as unique_upper_hashes,
          COUNT(DISTINCT replaceAll(tx_hash, '0x', '')) as unique_no_0x
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow'
    });
    const caseData = await caseCheck.json();
    console.log(JSON.stringify(caseData, null, 2));
    console.log('');

    // 5. Test multiple JOIN strategies
    console.log('5. Testing JOIN strategies:\n');

    console.log('   Strategy A: Exact match (as-is)');
    const exactMatch = await clickhouse.query({
      query: `
        SELECT COUNT(*) as match_exact
        FROM trades_raw t
        JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
        WHERE t.condition_id = '' OR t.condition_id IS NULL
      `,
      format: 'JSONEachRow'
    });
    const exactData = await exactMatch.json();
    console.log('   Result:', JSON.stringify(exactData));

    console.log('   Strategy B: Case-insensitive (lower)');
    const lowerMatch = await clickhouse.query({
      query: `
        SELECT COUNT(*) as match_lower
        FROM trades_raw t
        JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
        WHERE t.condition_id = '' OR t.condition_id IS NULL
      `,
      format: 'JSONEachRow'
    });
    const lowerData = await lowerMatch.json();
    console.log('   Result:', JSON.stringify(lowerData));

    console.log('   Strategy C: Strip 0x prefix + lower');
    const no0xMatch = await clickhouse.query({
      query: `
        SELECT COUNT(*) as match_no_0x
        FROM trades_raw t
        JOIN erc1155_transfers e
          ON replaceAll(lower(t.transaction_hash), '0x', '') = replaceAll(lower(e.tx_hash), '0x', '')
        WHERE t.condition_id = '' OR t.condition_id IS NULL
      `,
      format: 'JSONEachRow'
    });
    const no0xData = await no0xMatch.json();
    console.log('   Result:', JSON.stringify(no0xData));
    console.log('');

    console.log('=== PHASE 3: Alternative Strategies ===\n');

    // 6. Check proximity matching potential (limited sample)
    console.log('6. Testing wallet + timestamp proximity (sample 1000 rows):');
    try {
      const proximityMatch = await clickhouse.query({
        query: `
          SELECT COUNT(*) as proximity_matches
          FROM (
            SELECT 1
            FROM trades_raw t
            JOIN erc1155_transfers e
              ON (e.from_address = t.wallet_address OR e.to_address = t.wallet_address)
              AND e.block_timestamp BETWEEN t.trade_timestamp - INTERVAL 120 SECOND AND t.trade_timestamp + INTERVAL 120 SECOND
            WHERE (t.condition_id = '' OR t.condition_id IS NULL)
            LIMIT 1000
          )
        `,
        format: 'JSONEachRow'
      });
      const proximityData = await proximityMatch.json();
      console.log('   Result:', JSON.stringify(proximityData));
    } catch (err) {
      console.log('   Error (expected if slow):', (err as Error).message);
    }
    console.log('');

    // 7. Check available columns in trades_raw
    console.log('7. Available columns in trades_raw:');
    const tradesColumns = await clickhouse.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE table = 'trades_raw'
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const columnsData = await tradesColumns.json();
    const cols = columnsData as Array<{ name: string; type: string }>;
    console.log('   Total columns:', cols.length);
    console.log('   Key columns:', cols.filter(c =>
      c.name.includes('hash') ||
      c.name.includes('block') ||
      c.name.includes('order') ||
      c.name.includes('market')
    ).map(c => c.name).join(', '));
    console.log('');

    // Additional diagnostic: Check if transaction_hash exists in both tables
    console.log('8. Cross-checking specific transaction_hash existence (sample 100):');
    const crossCheck = await clickhouse.query({
      query: `
        WITH sample_trades AS (
          SELECT DISTINCT transaction_hash
          FROM trades_raw
          WHERE (condition_id = '' OR condition_id IS NULL)
            AND transaction_hash != ''
          LIMIT 100
        )
        SELECT
          COUNT(*) as sample_size,
          COUNT(e.tx_hash) as found_in_transfers,
          ROUND(COUNT(e.tx_hash) / COUNT(*) * 100, 2) as match_pct
        FROM sample_trades t
        LEFT JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
      `,
      format: 'JSONEachRow'
    });
    const crossData = await crossCheck.json();
    console.log('   Result:', JSON.stringify(crossData));
    console.log('');

    // Check if trades have block_number we can use
    console.log('9. Checking if trades_raw has block_number:');
    try {
      const blockCheck = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as total,
            COUNT(block_number) as with_block,
            COUNT(DISTINCT block_number) as unique_blocks
          FROM trades_raw
          WHERE (condition_id = '' OR condition_id IS NULL)
        `,
        format: 'JSONEachRow'
      });
      const blockData = await blockCheck.json();
      console.log('   Result:', JSON.stringify(blockData));
    } catch (err) {
      console.log('   No block_number column (expected)');
    }
    console.log('');

    // 10. Check what percentage of erc1155_transfers have matching transaction_hashes in trades_raw
    console.log('10. Reverse check - how many erc1155 tx_hashes exist in trades_raw?');
    const reverseCheck = await clickhouse.query({
      query: `
        WITH erc_sample AS (
          SELECT DISTINCT tx_hash
          FROM erc1155_transfers
          LIMIT 100
        )
        SELECT
          COUNT(*) as sample_size,
          COUNT(t.transaction_hash) as found_in_trades,
          ROUND(COUNT(t.transaction_hash) / COUNT(*) * 100, 2) as match_pct
        FROM erc_sample e
        LEFT JOIN trades_raw t ON lower(e.tx_hash) = lower(t.transaction_hash)
      `,
      format: 'JSONEachRow'
    });
    const reverseData = await reverseCheck.json();
    console.log('   Result:', JSON.stringify(reverseData));
    console.log('');

    console.log('=== SUMMARY ===\n');
    console.log('Investigation complete. Key findings will help determine:');
    console.log('1. Whether trades_raw actually has tx_hash values');
    console.log('2. What format tx_hash is stored in (0x prefix, case, length)');
    console.log('3. Which JOIN strategy works best');
    console.log('4. Whether we need alternative matching strategies');
    console.log('5. What other columns could be used for linking');

  } catch (error) {
    console.error('Investigation failed:', error);
    throw error;
  }
}

investigate().catch(console.error);
