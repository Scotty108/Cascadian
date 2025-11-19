#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function investigate() {
  console.log('\n🚨 CRITICAL: Checking wallet address corruption');
  console.log('='.repeat(80));
  
  // Check trades_dedup_mat_new wallet uniqueness
  const dedupCheck = await client.query({
    query: `
      SELECT
        count(DISTINCT wallet_address) as unique_wallets,
        count() as total_rows,
        any(wallet_address) as sample_wallet
      FROM trades_dedup_mat_new
    `,
    format: 'JSONEachRow',
  });
  console.log('trades_dedup_mat_new:', await dedupCheck.json());

  // Check trades_raw wallet uniqueness
  const rawCheck = await client.query({
    query: `
      SELECT
        count(DISTINCT wallet_address) as unique_wallets,
        count() as total_rows,
        any(wallet_address) as sample_wallet
      FROM trades_raw
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  console.log('trades_raw:', await rawCheck.json());

  console.log('\n🔍 NEW SMOKING GUN: trade_direction_assignments');
  console.log('='.repeat(80));
  
  const dirAssign = await client.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT wallet_address) as unique_wallets,
        count(DISTINCT tx_hash) as unique_tx_hashes,
        countIf(condition_id != '' AND length(condition_id) >= 64) as has_condition_id,
        countIf(tokens_in > 0 AND tokens_out > 0) as has_both_flows,
        min(block_time) as earliest,
        max(block_time) as latest
      FROM trade_direction_assignments
    `,
    format: 'JSONEachRow',
  });
  console.log(await dirAssign.json());

  console.log('\n📊 Sample from trade_direction_assignments:');
  const dirSample = await client.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        tx_hash,
        tokens_in,
        tokens_out,
        usdc_in,
        usdc_out
      FROM trade_direction_assignments
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  console.log(await dirSample.json());

  console.log('\n🔍 Checking trade_cashflows_v3:');
  console.log('='.repeat(80));
  
  const cashflows = await client.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT wallet_address) as unique_wallets,
        count(DISTINCT tx_hash) as unique_tx_hashes
      FROM trade_cashflows_v3
    `,
    format: 'JSONEachRow',
  });
  console.log(await cashflows.json());

  console.log('\n📋 Getting schema for trade_direction_assignments:');
  const schema = await client.query({
    query: `DESCRIBE TABLE trade_direction_assignments`,
    format: 'JSONEachRow',
  });
  const cols = await schema.json();
  console.log('Columns:', cols.map((c: any) => `${c.name} (${c.type})`).join(', '));

  console.log('\n🔍 Checking vw_trades_canonical (view):');
  try {
    const viewCheck = await client.query({
      query: `
        SELECT
          count() as total_rows,
          count(DISTINCT wallet_address) as unique_wallets
        FROM vw_trades_canonical
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    console.log('vw_trades_canonical:', await viewCheck.json());
  } catch (e: any) {
    console.log('Error querying view:', e.message);
  }

  await client.close();
}

investigate().catch(console.error);
