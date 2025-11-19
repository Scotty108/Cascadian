#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import https from 'https';

async function executeQuery(query: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.CLICKHOUSE_URL || '');
    
    const options = {
      hostname: url.hostname,
      port: url.port || 8443,
      path: `/?send_progress_in_http_headers=0`,  // Disable progress headers!
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.CLICKHOUSE_USER}:${process.env.CLICKHOUSE_PASSWORD}`).toString('base64')}`,
        'Content-Type': 'text/plain',
        'X-ClickHouse-Format': 'JSON'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(query);
    req.end();
  });
}

async function queryJson(query: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.CLICKHOUSE_URL || '');
    
    const options = {
      hostname: url.hostname,
      port: url.port || 8443,
      path: `/?send_progress_in_http_headers=0`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.CLICKHOUSE_USER}:${process.env.CLICKHOUSE_PASSWORD}`).toString('base64')}`,
        'Content-Type': 'text/plain'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(query + ' FORMAT JSON');
    req.end();
  });
}

async function main() {
  console.log('=== TASK 2: REPAIR CONDITION IDs (No Progress Headers) ===\n');
  
  console.log('Creating trades_with_direction_repaired...');
  console.log('(This will take 3-7 minutes, please wait)\n');
  
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS default.trades_with_direction_repaired
    ENGINE = ReplacingMergeTree()
    ORDER BY (tx_hash, wallet_address, outcome_index)
    SETTINGS max_execution_time = 600
    AS
    SELECT
      twd.tx_hash,
      twd.wallet_address,
      lower(replaceAll(tr.condition_id, '0x', '')) as condition_id_norm,
      twd.market_id,
      twd.outcome_index,
      twd.side_token,
      twd.direction_from_transfers,
      twd.shares,
      twd.price,
      twd.usd_value,
      twd.usdc_delta,
      twd.token_delta,
      twd.confidence,
      twd.reason,
      twd.recovery_status,
      twd.data_source,
      now() as computed_at
    FROM default.trades_with_direction twd
    INNER JOIN default.trades_raw tr
      ON twd.tx_hash = tr.tx_hash
    WHERE length(replaceAll(tr.condition_id, '0x', '')) = 64
  `;
  
  try {
    await executeQuery(createTableQuery);
    console.log('✓ Table created successfully\n');
  } catch (e: any) {
    if (e.message.includes('already exists')) {
      console.log('⚠️  Table already exists\n');
    } else {
      console.error('Error:', e.message);
      throw e;
    }
  }
  
  // Verify
  console.log('Verifying repair...\n');
  
  const result: any = await queryJson(`
    SELECT
      countIf(length(condition_id_norm) = 64) as valid_64char,
      countIf(length(condition_id_norm) != 64) as invalid,
      countIf(condition_id_norm LIKE '0x%') as has_prefix,
      count() as total
    FROM default.trades_with_direction_repaired
  `);
  
  const row = result.data[0];
  console.log(`Validation Results:`);
  console.log(`  Valid (64-char):  ${parseInt(row.valid_64char).toLocaleString()}`);
  console.log(`  Invalid length:   ${parseInt(row.invalid).toLocaleString()}`);
  console.log(`  Has 0x prefix:    ${parseInt(row.has_prefix).toLocaleString()}`);
  console.log(`  Total rows:       ${parseInt(row.total).toLocaleString()}\n`);
  
  if (parseInt(row.has_prefix) === 0 && parseInt(row.valid_64char) === parseInt(row.total)) {
    console.log('✅ SUCCESS: All condition IDs properly normalized!\n');
  } else {
    console.log('❌ Some rows still have issues\n');
  }
  
  console.log('✅ Task 2 Complete\n');
}

main().catch(console.error);
