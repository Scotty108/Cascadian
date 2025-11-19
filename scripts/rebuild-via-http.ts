#!/usr/bin/env npx tsx
/**
 * REBUILD via HTTP interface with longer timeout
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import https from 'https';
import { URL } from 'url';

async function executeQuery(query: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.CLICKHOUSE_HOST!);
    const isHttps = url.protocol === 'https:';

    const auth = `${process.env.CLICKHOUSE_USER}:${process.env.CLICKHOUSE_PASSWORD}`;
    const authHeader = 'Basic ' + Buffer.from(auth).toString('base64');

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 8123),
      path: '/',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'text/plain',
      },
      // No timeout - let it run as long as needed
      timeout: 0,
    };

    const req = (isHttps ? https : require('http')).request(options, (res: any) => {
      let data = '';

      res.on('data', (chunk: any) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error: Error) => {
      reject(error);
    });

    req.write(query);
    req.end();
  });
}

async function main() {
  console.log('═'.repeat(80));
  console.log('REBUILD fact_trades_clean VIA HTTP (80M rows)');
  console.log('═'.repeat(80));
  console.log();

  console.log('Starting table creation...');
  console.log('This will take 2-5 minutes. Please wait...');
  console.log();

  const startTime = Date.now();

  try {
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS cascadian_clean.fact_trades_clean
      ENGINE = ReplacingMergeTree()
      ORDER BY (tx_hash, cid_hex, wallet_address)
      AS
      SELECT
        transaction_hash AS tx_hash,
        toDateTime(timestamp) AS block_time,
        lower(condition_id_norm) AS cid_hex,
        outcome_index,
        wallet_address_norm AS wallet_address,
        trade_direction AS direction,
        shares,
        entry_price AS price,
        usd_value AS usdc_amount,
        'VW_CANONICAL' AS source
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Table created successfully! (${elapsed}s)`);
    console.log();

    console.log('Verifying row count...');
    const count = await executeQuery('SELECT count() FROM cascadian_clean.fact_trades_clean FORMAT TabSeparated');
    console.log(`Row count: ${count}`);

  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  console.log();
  console.log('═'.repeat(80));
  console.log('NEXT: Run verify-join-coverage.ts to check if the fix worked');
  console.log('═'.repeat(80));
}

main();
