#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 180000,
});

function topicToAddress(topic: string): string {
  if (!topic) return '0x0000000000000000000000000000000000000000';
  const addr = topic.slice(-40);
  return '0x' + addr;
}

function hexToUint256(hex: string): bigint {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

const KNOWN_WALLETS = [
  { addr: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', name: 'Wallet 1' },
  { addr: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', name: 'niggemon (1087 trades, $24.4M volume)' },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'Wallet 3' },
];

(async () => {
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('   VALIDATING NET FLOW ALGORITHM ON KNOWN WALLETS');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // Process each wallet
  for (const wallet of KNOWN_WALLETS) {
    const walletLower = wallet.addr.toLowerCase();

    try {
      // Query ClickHouse for transfers involving this wallet
      // We can't extract 'from' and 'to' from topics easily in SQL, so we'll fetch and decode
      const logsQuery = await ch.query({
        query: `
          SELECT
            topics,
            data
          FROM erc20_transfers_staging
          WHERE address = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' -- USDC
            AND token_type = 'ERC20'
            AND NOT startsWith(data, '0xff') -- Filter corrupted data
            AND (
              topics[2] LIKE '%${walletLower.slice(-40)}%' OR
              topics[3] LIKE '%${walletLower.slice(-40)}%'
            )
          LIMIT 10000
        `,
        format: 'JSON',
      });

      const logs = JSON.parse(await logsQuery.text()).data;

      // Decode logs for this wallet
      let usdc_in = 0n;
      let usdc_out = 0n;
      let transfer_count = 0;

      for (const log of logs) {
        try {
          const topics = log.topics || [];
          if (topics.length >= 3) {
            const from = topicToAddress(topics[1]).toLowerCase();
            const to = topicToAddress(topics[2]).toLowerCase();
            const amount = hexToUint256(log.data);

            // Sanity check
            const MAX_REASONABLE_AMOUNT = 100_000_000_000n * 1_000_000n;
            if (amount > MAX_REASONABLE_AMOUNT) {
              continue;
            }

            if (from === walletLower) {
              usdc_out += amount;
              transfer_count++;
            }
            if (to === walletLower) {
              usdc_in += amount;
              transfer_count++;
            }
          }
        } catch (e) {
          // Skip malformed logs
        }
      }

      const net = usdc_out - usdc_in;
      const direction = net > 0n ? 'SOLD' : net < 0n ? 'BOUGHT' : 'NEUTRAL';

      console.log(`\n📊 ${wallet.name}`);
      console.log(`   Address:      ${wallet.addr}`);
      console.log(`   USDC In:      ${(usdc_in / 1000000n).toString().padStart(15)} USDC`);
      console.log(`   USDC Out:     ${(usdc_out / 1000000n).toString().padStart(15)} USDC`);
      console.log(`   Net Flow:     ${(net / 1000000n).toString().padStart(15)} USDC (${direction})`);
      console.log(`   Transfers:    ${transfer_count}`);
      console.log(`   🔗 Profile:   https://polymarket.com/profile/${wallet.addr}`);
    } catch (error) {
      console.log(`\n❌ Error querying ${wallet.addr}:`, error);
    }
  }

  console.log('\n════════════════════════════════════════════════════════════════════\n');

  await ch.close();
})();
