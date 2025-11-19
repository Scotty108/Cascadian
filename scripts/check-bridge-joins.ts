#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

config({ path: resolve(__dirname, '../.env.local') });

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  // Get sample wallet flows
  const flows = await clickhouse.query({
    query: `
      SELECT condition_id_ctf
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const flowData = await flows.json<{ condition_id_ctf: string }>();
  console.log('Sample CTF IDs from wallet_token_flows:');
  flowData.forEach(f => console.log(`  ${f.condition_id_ctf}`));

  // Check if they exist in bridge
  for (const flow of flowData) {
    const bridge = await clickhouse.query({
      query: `
        SELECT *
        FROM ctf_to_market_bridge_mat
        WHERE condition_id_ctf = '${flow.condition_id_ctf}'
      `,
      format: 'JSONEachRow',
    });
    const bridgeData = await bridge.json();
    console.log(`\nBridge entry for ${flow.condition_id_ctf}:`);
    console.log(JSON.stringify(bridgeData, null, 2));

    if (bridgeData.length > 0) {
      // Check if this market is resolved
      const marketId = (bridgeData[0] as any).condition_id_market;
      const resolution = await clickhouse.query({
        query: `
          SELECT *
          FROM market_resolutions_final
          WHERE condition_id_norm = '${marketId}'
        `,
        format: 'JSONEachRow',
      });
      const resolutionData = await resolution.json();
      console.log(`Resolution for market ${marketId}:`);
      console.log(JSON.stringify(resolutionData, null, 2));
    }
  }

  await clickhouse.close();
}

main();
