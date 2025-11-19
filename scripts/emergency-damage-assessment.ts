import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function assessDamage() {
  console.log('🚨 EMERGENCY DAMAGE ASSESSMENT 🚨');
  console.log('='.repeat(80), '\n');
  
  // Check trades_raw
  console.log('1. TRADES_RAW TABLE:');
  console.log('-'.repeat(80));
  try {
    const tradesRaw = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT lower(wallet)) as unique_wallets,
          COUNT(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as unique_markets,
          MIN(block_time) as earliest_trade,
          MAX(block_time) as latest_trade,
          COUNT(CASE WHEN block_time IS NULL THEN 1 END) as rows_missing_timestamp
        FROM default.trades_raw
      `,
      format: 'JSONEachRow',
    });
    const data = await tradesRaw.json();
    console.log(JSON.stringify(data, null, 2));
    
    if (data[0]?.total_rows === '0') {
      console.log('❌ CRITICAL: trades_raw is EMPTY!\n');
    } else {
      console.log(`✅ trades_raw has ${data[0]?.total_rows} rows\n`);
    }
  } catch (e: any) {
    console.log(`❌ ERROR querying trades_raw: ${e.message}\n`);
  }
  
  // Check trade_cashflows_v3
  console.log('2. TRADE_CASHFLOWS_V3 TABLE:');
  console.log('-'.repeat(80));
  try {
    const cashflows = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT lower(wallet)) as unique_wallets,
          MIN(timestamp) as earliest,
          MAX(timestamp) as latest
        FROM default.trade_cashflows_v3
      `,
      format: 'JSONEachRow',
    });
    const data = await cashflows.json();
    console.log(JSON.stringify(data, null, 2));
    
    if (data[0]?.total_rows === '0') {
      console.log('❌ CRITICAL: trade_cashflows_v3 is EMPTY!\n');
    } else {
      console.log(`✅ trade_cashflows_v3 has ${data[0]?.total_rows} rows\n`);
    }
  } catch (e: any) {
    console.log(`❌ ERROR querying trade_cashflows_v3: ${e.message}\n`);
  }
  
  // Check usdc_transfers
  console.log('3. USDC_TRANSFERS TABLE:');
  console.log('-'.repeat(80));
  try {
    const usdc = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          MIN(block_time) as earliest,
          MAX(block_time) as latest
        FROM default.usdc_transfers
      `,
      format: 'JSONEachRow',
    });
    const data = await usdc.json();
    console.log(JSON.stringify(data, null, 2));
    
    if (data[0]?.total_rows === '0') {
      console.log('❌ CRITICAL: usdc_transfers is EMPTY!\n');
    } else {
      console.log(`✅ usdc_transfers has ${data[0]?.total_rows} rows\n`);
    }
  } catch (e: any) {
    console.log(`❌ ERROR querying usdc_transfers: ${e.message}\n`);
  }
  
  // Check erc1155_transfers
  console.log('4. ERC1155_TRANSFERS TABLE:');
  console.log('-'.repeat(80));
  try {
    const erc1155 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          MIN(block_time) as earliest,
          MAX(block_time) as latest
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    const data = await erc1155.json();
    console.log(JSON.stringify(data, null, 2));
    
    if (data[0]?.total_rows === '0') {
      console.log('❌ CRITICAL: erc1155_transfers is EMPTY!\n');
    } else {
      console.log(`✅ erc1155_transfers has ${data[0]?.total_rows} rows\n`);
    }
  } catch (e: any) {
    console.log(`❌ ERROR querying erc1155_transfers: ${e.message}\n`);
  }
  
  // Check clob_fills
  console.log('5. CLOB_FILLS TABLE:');
  console.log('-'.repeat(80));
  try {
    const clob = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          MIN(timestamp) as earliest,
          MAX(timestamp) as latest
        FROM default.clob_fills
      `,
      format: 'JSONEachRow',
    });
    const data = await clob.json();
    console.log(JSON.stringify(data, null, 2));
    
    if (data[0]?.total_rows === '0') {
      console.log('⚠️  clob_fills is EMPTY\n');
    } else {
      console.log(`✅ clob_fills has ${data[0]?.total_rows} rows\n`);
    }
  } catch (e: any) {
    console.log(`❌ ERROR querying clob_fills: ${e.message}\n`);
  }
  
  // Check wallet_metrics
  console.log('6. WALLET_METRICS TABLE:');
  console.log('-'.repeat(80));
  try {
    const metrics = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT wallet_address) as unique_wallets
        FROM default.wallet_metrics
      `,
      format: 'JSONEachRow',
    });
    const data = await metrics.json();
    console.log(JSON.stringify(data, null, 2));
    
    if (data[0]?.total_rows === '0') {
      console.log('⚠️  wallet_metrics is EMPTY\n');
    } else {
      console.log(`✅ wallet_metrics has ${data[0]?.total_rows} rows\n`);
    }
  } catch (e: any) {
    console.log(`❌ ERROR querying wallet_metrics: ${e.message}\n`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('DAMAGE SUMMARY');
  console.log('='.repeat(80));
  console.log('Check each table above for ❌ CRITICAL or ⚠️  warnings');
  console.log('If trades_raw is intact, we can rebuild everything else');
  console.log('If trades_raw is gone, we need to restore from backup or re-ingest');
}

assessDamage().catch(console.error);
