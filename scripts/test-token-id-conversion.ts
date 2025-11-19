import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("Testing token_id conversion from hex to decimal...\n");

  // Get a sample token_id from erc1155_transfers
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT token_id as hex_token
      FROM erc1155_transfers
      WHERE lower(to_address) = lower('${testWallet}')
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const hexToken = (await sampleQuery.json())[0].hex_token;

  console.log(`Sample hex token_id: ${hexToken}\n`);

  // Try different conversion methods
  console.log("Testing conversion methods:");
  console.log("─".repeat(60));

  try {
    const convertQuery = await clickhouse.query({
      query: `
        SELECT
          '${hexToken}' as original,
          toString(reinterpretAsUInt256(reverse(unhex(substring('${hexToken}', 3))))) as decimal_string
      `,
      format: 'JSONEachRow'
    });
    const result = await convertQuery.json();
    console.log("✅ Conversion successful:");
    console.table(result);

    // Now try to find this in ctf_token_map
    const decimalToken = result[0].decimal_string;
    console.log(`\nLooking for decimal token in ctf_token_map: ${decimalToken}`);

    const findQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM ctf_token_map
        WHERE token_id = '${decimalToken}'
      `,
      format: 'JSONEachRow'
    });
    const found = await findQuery.json();

    if (found.length > 0) {
      console.log("✅ Found matching entry in ctf_token_map!");
      console.table(found);
    } else {
      console.log("❌ No matching entry found in ctf_token_map");
    }
  } catch (error: any) {
    console.log(`❌ Conversion failed: ${error.message}`);
  }
}

main().catch(console.error);
