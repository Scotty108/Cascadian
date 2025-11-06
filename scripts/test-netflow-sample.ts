#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 180000, // 3 minutes
});

// Helper to extract wallet from 32-byte padded topic (Ethereum address format)
function topicToAddress(topic: string): string {
  if (!topic) return '0x0000000000000000000000000000000000000000';
  // Remove '0x' prefix and take last 40 chars (20 bytes = 40 hex chars)
  const addr = topic.slice(-40);
  return '0x' + addr;
}

// Helper to decode uint256 from hex string
function hexToUint256(hex: string): bigint {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

(async () => {
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('   TEST DRIVEN DEVELOPMENT: NET FLOW CALCULATION (TDD)');
  console.log('   Selecting 10 most active wallets and calculating USDC flows');
  console.log('════════════════════════════════════════════════════════════════════\n');

  console.log('⏳ Fetching all USDC transfer logs from ClickHouse...');

  // Step 1: Fetch a large sample of USDC transfers
  // We query a sample to identify active wallets without loading all 387M rows
  // NOTE: Filtering out records starting with 0xff (56M corrupted records ~14.5%)
  const logsQuery = await ch.query({
    query: `
      SELECT
        tx_hash,
        topics,
        data,
        block_number
      FROM erc20_transfers_staging
      WHERE address = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' -- USDC
        AND token_type = 'ERC20'
        AND NOT startsWith(data, '0xff') -- Filter out corrupted/invalid values
      LIMIT 50000 -- Sample of recent activity
    `,
    format: 'JSON',
  });

  const allLogs = JSON.parse(await logsQuery.text()).data;
  console.log(`✅ Loaded ${allLogs.length.toLocaleString()} transfer logs\n`);

  // Step 2: Decode logs and build per-wallet flow statistics
  const walletFlows = new Map<
    string,
    {
      usdc_in: bigint;
      usdc_out: bigint;
      transfer_count: number;
    }
  >();

  for (const log of allLogs) {
    try {
      const topics = log.topics || [];
      if (topics.length >= 3) {
        const from = topicToAddress(topics[1]).toLowerCase();
        const to = topicToAddress(topics[2]).toLowerCase();
        const amount = hexToUint256(log.data);

        // Sanity check: filter out unreasonably large amounts (> 100B USDC)
        const MAX_REASONABLE_AMOUNT = 100_000_000_000n * 1_000_000n; // 100B USDC in wei
        if (amount > MAX_REASONABLE_AMOUNT) {
          continue;
        }

        // Record outflow from sender
        if (from !== '0x0000000000000000000000000000000000000000') {
          const fromStats = walletFlows.get(from) || {
            usdc_in: 0n,
            usdc_out: 0n,
            transfer_count: 0,
          };
          fromStats.usdc_out += amount;
          fromStats.transfer_count += 1;
          walletFlows.set(from, fromStats);
        }

        // Record inflow to recipient
        if (to !== '0x0000000000000000000000000000000000000000') {
          const toStats = walletFlows.get(to) || {
            usdc_in: 0n,
            usdc_out: 0n,
            transfer_count: 0,
          };
          toStats.usdc_in += amount;
          toStats.transfer_count += 1;
          walletFlows.set(to, toStats);
        }
      }
    } catch (e) {
      // Skip malformed logs
    }
  }

  console.log(`📊 Decoded flows for ${walletFlows.size.toLocaleString()} unique wallets\n`);

  // Step 3: Select top 10 wallets by transaction count
  const topWallets = Array.from(walletFlows.entries())
    .filter(([addr]) => addr !== '0x0000000000000000000000000000000000000000')
    .sort((a, b) => b[1].transfer_count - a[1].transfer_count)
    .slice(0, 10)
    .map(([addr, flows]) => ({ address: addr, ...flows }));

  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('📋 TOP 10 MOST ACTIVE WALLETS - USDC FLOWS:\n');

  for (let i = 0; i < topWallets.length; i++) {
    const wallet = topWallets[i];
    const net = wallet.usdc_out - wallet.usdc_in;
    const direction = net > 0n ? 'SOLD' : net < 0n ? 'BOUGHT' : 'NEUTRAL';

    console.log(`${i + 1}. Wallet: ${wallet.address}`);
    console.log(`   USDC In:      ${(wallet.usdc_in / 1000000n).toString()} USDC`);
    console.log(`   USDC Out:     ${(wallet.usdc_out / 1000000n).toString()} USDC`);
    console.log(`   Net Flow:     ${(net / 1000000n).toString()} USDC (${direction})`);
    console.log(`   Transactions: ${wallet.transfer_count}`);
    console.log(`   🔗 Verify:    https://polymarket.com/profile/${wallet.address}`);
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('📋 NEXT STEPS:\n');
  console.log('1. Visit each wallet link above');
  console.log('2. Check total USDC bought/sold on their Polymarket profile');
  console.log('3. Verify the net flow direction matches (BOUGHT vs SOLD)');
  console.log('4. Once verified, we\'ll apply this logic at scale to all wallets\n');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  await ch.close();
})();
