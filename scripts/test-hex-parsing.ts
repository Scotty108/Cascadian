import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("Testing hex string parsing methods...\n");

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Test different conversion methods
  const methods = [
    {
      name: "Method 1: Direct reinterpretAsUInt64",
      sql: `reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) as converted`
    },
    {
      name: "Method 2: toUInt64 with base 16",
      sql: `if(value = '0x0', 0, toUInt64(substring(value, 3), 16)) as converted`
    }
  ];

  for (const method of methods) {
    console.log(`${method.name}:`);
    console.log("─".repeat(60));

    try {
      const query = await clickhouse.query({
        query: `
          SELECT
            value as original,
            ${method.sql}
          FROM erc1155_transfers
          WHERE lower(to_address) = lower('${testWallet}')
          LIMIT 3
        `,
        format: 'JSONEachRow'
      });
      const data = await query.json();

      console.table(data);
      console.log("✅ Success\n");
    } catch (error: any) {
      console.log(`❌ Failed: ${error.message}\n`);
    }
  }
}

main().catch(console.error);
