import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== ERC1155 TRANSFERS FOR ${wallet} ===\n`);

  // Check ERC1155 transfers TO this wallet
  const result = await clickhouse.query({
    query: `
      SELECT
        from_address,
        count() as transfer_count,
        sum(toFloat64OrZero(value))/1e6 as total_tokens
      FROM pm_erc1155_transfers
      WHERE lower(to_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
      GROUP BY from_address
      ORDER BY total_tokens DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];
  console.log('Tokens received FROM:');
  for (const row of rows) {
    console.log(`  ${row.from_address.substring(0, 20)}...: ${row.transfer_count} transfers, ${row.total_tokens.toFixed(2)} tokens`);
  }

  // Check ERC1155 transfers FROM this wallet
  const result2 = await clickhouse.query({
    query: `
      SELECT
        to_address,
        count() as transfer_count,
        sum(toFloat64OrZero(value))/1e6 as total_tokens
      FROM pm_erc1155_transfers
      WHERE lower(from_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
      GROUP BY to_address
      ORDER BY total_tokens DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const rows2 = await result2.json() as any[];
  console.log('\nTokens sent TO:');
  for (const row of rows2) {
    console.log(`  ${row.to_address.substring(0, 20)}...: ${row.transfer_count} transfers, ${row.total_tokens.toFixed(2)} tokens`);
  }

  // Check net flow by token_id
  const result3 = await clickhouse.query({
    query: `
      SELECT
        token_id,
        sumIf(toFloat64OrZero(value), lower(to_address) = '${wallet.toLowerCase()}')/1e6 as tokens_in,
        sumIf(toFloat64OrZero(value), lower(from_address) = '${wallet.toLowerCase()}')/1e6 as tokens_out,
        (tokens_in - tokens_out) as net_tokens
      FROM pm_erc1155_transfers
      WHERE (lower(to_address) = '${wallet.toLowerCase()}' OR lower(from_address) = '${wallet.toLowerCase()}')
        AND is_deleted = 0
      GROUP BY token_id
      HAVING abs(net_tokens) > 0.1
      ORDER BY abs(net_tokens) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const rows3 = await result3.json() as any[];
  console.log('\nNet token positions (ERC1155):');
  for (const row of rows3) {
    console.log(`  Token ${row.token_id.substring(0, 16)}...: in=${row.tokens_in.toFixed(2)}, out=${row.tokens_out.toFixed(2)}, net=${row.net_tokens.toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
