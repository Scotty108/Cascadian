#!/usr/bin/env npx tsx
/**
 * Trace money flow between wallets
 * Find where a successful trader's profits went
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function traceMoneyFlow(walletAddress: string) {
  const ch = getClickHouseClient();
  const normalized = walletAddress.toLowerCase();

  console.log('\n' + '═'.repeat(100));
  console.log(`MONEY FLOW ANALYSIS: ${walletAddress}`);
  console.log('═'.repeat(100) + '\n');

  // Step 1: Find all USDC movements FROM this wallet
  console.log('1️⃣  USDC sent OUT from this wallet:');
  try {
    const result = await ch.query({
      query: `
        SELECT
          to_address,
          SUM(amount_usdc) as usdc_amount,
          COUNT(*) as transaction_count,
          MAX(block_time) as latest_transfer
        FROM default.erc20_transfers_decoded
        WHERE from_address = '${normalized}'
        GROUP BY to_address
        ORDER BY usdc_amount DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const data = await result.json<any[]>();
    if (data.length > 0) {
      for (const row of data) {
        const toAddr = row.to_address;
        console.log(`
   → ${toAddr}
     Amount: $${parseFloat(row.usdc_amount).toLocaleString('en-US', {maximumFractionDigits: 2})}
     Transactions: ${row.transaction_count}
     Latest: ${row.latest_transfer}`);
      }
    } else {
      console.log('   (No outgoing transfers found)');
    }
  } catch (e: any) {
    console.log(`   Error: ${e.message.substring(0, 100)}`);
  }

  // Step 2: Check if any of those recipients are also trading on Polymarket
  console.log('\n2️⃣  Checking if recipients are also Polymarket traders:');
  try {
    const result = await ch.query({
      query: `
        SELECT
          t.wallet_address_norm,
          COUNT(*) as trade_count,
          SUM(t.usd_value) as total_volume,
          MIN(t.timestamp) as first_trade,
          MAX(t.timestamp) as last_trade
        FROM default.vw_trades_canonical t
        INNER JOIN (
          SELECT DISTINCT to_address
          FROM default.erc20_transfers_decoded
          WHERE from_address = '${normalized}'
        ) recipients
          ON LOWER(t.wallet_address_norm) = LOWER(recipients.to_address)
        GROUP BY t.wallet_address_norm
        ORDER BY trade_count DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const data = await result.json<any[]>();
    if (data.length > 0) {
      for (const row of data) {
        console.log(`
   → ${row.wallet_address_norm}
     Trades: ${row.trade_count}
     Volume: $${parseFloat(row.total_volume).toLocaleString('en-US', {maximumFractionDigits: 2})}
     Active: ${row.first_trade} to ${row.last_trade}`);
      }
    } else {
      console.log('   (No transfers to Polymarket traders detected)');
    }
  } catch (e: any) {
    console.log(`   Error: ${e.message.substring(0, 100)}`);
  }

  // Step 3: Check incoming transfers (money coming TO this wallet)
  console.log('\n3️⃣  USDC received INTO this wallet:');
  try {
    const result = await ch.query({
      query: `
        SELECT
          from_address,
          SUM(amount_usdc) as usdc_amount,
          COUNT(*) as transaction_count,
          MAX(block_time) as latest_transfer
        FROM default.erc20_transfers_decoded
        WHERE to_address = '${normalized}'
        GROUP BY from_address
        ORDER BY usdc_amount DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const data = await result.json<any[]>();
    if (data.length > 0) {
      for (const row of data) {
        const fromAddr = row.from_address;
        console.log(`
   ← ${fromAddr}
     Amount: $${parseFloat(row.usdc_amount).toLocaleString('en-US', {maximumFractionDigits: 2})}
     Transactions: ${row.transaction_count}
     Latest: ${row.latest_transfer}`);
      }
    } else {
      console.log('   (No incoming transfers found)');
    }
  } catch (e: any) {
    console.log(`   Error: ${e.message.substring(0, 100)}`);
  }

  // Step 4: Network analysis - find wallets that are "connected" through money flow
  console.log('\n4️⃣  Wallet network (money flow connections):');
  try {
    const result = await ch.query({
      query: `
        WITH outgoing AS (
          SELECT DISTINCT to_address as connected_wallet
          FROM default.usdc_transfers
          WHERE from_address = '${normalized}'
        ),
        incoming AS (
          SELECT DISTINCT from_address as connected_wallet
          FROM default.usdc_transfers
          WHERE to_address = '${normalized}'
        )
        SELECT
          connected_wallet,
          (SELECT COUNT(*) FROM outgoing WHERE connected_wallet = o.connected_wallet) as is_recipient,
          (SELECT COUNT(*) FROM incoming WHERE connected_wallet = i.connected_wallet) as is_sender
        FROM (
          SELECT connected_wallet FROM outgoing
          UNION
          SELECT connected_wallet FROM incoming
        ) combined
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });
    const data = await result.json<any[]>();
    console.log(`   ${data.length} directly connected wallets found`);
  } catch (e: any) {
    // This query might be complex, skip on error
  }

  console.log('\n' + '═'.repeat(100));
  console.log('WHAT THIS TELLS US');
  console.log('═'.repeat(100));
  console.log(`
✓ Money flow OUT: Shows where this wallet sent their profits
✓ Recipients on Polymarket: Shows if they're copy trading via new wallets
✓ Money flow IN: Shows who funded this wallet (could be proxy, bridge, or original source)
✓ Wallet network: Identifies coordinated wallets moving money between them

Use cases:
• Smart money tracking: Follow where top traders move their funds
• Copy trading detection: See if successful traders spawn new accounts
• Wallet coordination: Find teams moving money between coordinated accounts
  `);

  await ch.close();
}

// Example usage
const targetWallet = process.argv[2] || '0x4ce7a8f6f556a5c053a8a62b891a6e1dc33e1f4f';
traceMoneyFlow(targetWallet).catch(console.error);
