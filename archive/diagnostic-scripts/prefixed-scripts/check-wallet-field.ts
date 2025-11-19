import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('Checking wallet field differences...\n');

  // Check user_eoa
  const eoaQuery = await clickhouse.query({
    query: `
      SELECT count() as trades, count(DISTINCT asset_id) as tokens
      FROM clob_fills
      WHERE lower(user_eoa) = lower('${wallet}')
        AND asset_id != 'asset'
    `,
    format: 'JSONEachRow'
  });
  const eoa = await eoaQuery.json();
  console.log(`user_eoa: ${eoa[0].trades} trades, ${eoa[0].tokens} tokens`);

  // Check proxy_wallet
  const proxyQuery = await clickhouse.query({
    query: `
      SELECT count() as trades, count(DISTINCT asset_id) as tokens
      FROM clob_fills
      WHERE lower(proxy_wallet) = lower('${wallet}')
        AND asset_id != 'asset'
    `,
    format: 'JSONEachRow'
  });
  const proxy = await proxyQuery.json();
  console.log(`proxy_wallet: ${proxy[0].trades} trades, ${proxy[0].tokens} tokens\n`);

  console.log('Which field should we use?');
  console.log('user_eoa is typically the EOA (externally owned account) - the actual user wallet');
  console.log('proxy_wallet is typically the smart contract proxy used by Polymarket');
  console.log('\nDome probably uses EOA addresses, so user_eoa is correct.\n');
}

main().catch(console.error);
