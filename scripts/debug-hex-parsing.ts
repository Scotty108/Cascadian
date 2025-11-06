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

(async () => {
  try {
    const result = await ch.query({
      query: `
        SELECT topics, data
        FROM erc20_transfers_staging
        WHERE address = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
          AND token_type = 'ERC20'
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const logs = await result.json();

    console.log('\n=== HEX PARSING DEBUG ===\n');

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const topics = log.topics || [];
      const from = topicToAddress(topics[1]);
      const to = topicToAddress(topics[2]);
      const amount = BigInt(log.data);

      console.log(`Transfer ${i + 1}:`);
      console.log(`  Raw hex data:  ${log.data}`);
      console.log(`  Hex length:    ${log.data.length}`);
      console.log(`  Parsed amount: ${amount.toString()}`);
      console.log(`  In USDC (÷1M): ${(amount / 1000000n).toString()}`);
      console.log(`  From: ${from}`);
      console.log(`  To:   ${to}`);
      console.log('');
    }
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await ch.close();
  }
})();
