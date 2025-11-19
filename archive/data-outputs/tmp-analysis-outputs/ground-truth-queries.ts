import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });
import { clickhouse } from '../lib/clickhouse/client';

async function runQuery(label: string, query: string) {
  try {
    const res = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await res.json<any[]>();
    console.log(`\n=== ${label} ===`);
    data.forEach(row => console.log(row));
  } catch (error: any) {
    console.error(`Error in ${label}:`, error.message || error);
  }
}

async function main() {
  await runQuery('ERC1155 overview', `SELECT count() AS total, min(block_number) AS min_block, max(block_number) AS max_block FROM default.erc1155_transfers`);

  const buckets: Array<[number, number]> = [];
  for (let start = 0; start <= 80_000_000; start += 5_000_000) {
    const end = start + 4_999_999;
    buckets.push([start, end]);
  }
  console.log('\n=== ERC1155 buckets (5M blocks) ===');
  for (const [start, end] of buckets) {
    try {
      const res = await clickhouse.query({
        query: `SELECT count() AS c FROM default.erc1155_transfers WHERE block_number BETWEEN ${start} AND ${end}`,
        format: 'JSONEachRow'
      });
      const [{ c }] = await res.json<any[]>();
      console.log(`${start.toLocaleString()}-${end.toLocaleString()}: ${c}`);
    } catch (error: any) {
      console.error(`Bucket ${start}-${end} error:`, error.message || error);
    }
  }

  const wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad'.toLowerCase();
  await runQuery('ERC1155 test wallet', `SELECT count() AS transfers, min(block_number) AS min_block, max(block_number) AS max_block FROM default.erc1155_transfers WHERE lower(from_address)='${wallet}' OR lower(to_address)='${wallet}'`);
  await runQuery('trades_raw test wallet', `SELECT count() AS trades, min(block_time) AS min_time, max(block_time) AS max_time FROM default.trades_raw WHERE lower(wallet)='${wallet}'`);

  const tables = [
    { name: 'default.trades_raw', timeCol: 'created_at' },
    { name: 'default.vw_trades_canonical', timeCol: 'computed_at' },
    { name: 'default.trade_direction_assignments', timeCol: 'computed_at' },
    { name: 'default.trades_with_direction', timeCol: 'computed_at' },
    { name: 'cascadian_clean.fact_trades_clean', timeCol: 'created_at' },
    { name: 'default.trades_canonical', timeCol: 'created_at' }
  ];

  for (const { name, timeCol } of tables) {
    await runQuery(`${name} count`, `SELECT count() AS c${timeCol ? `, max(${timeCol}) AS max_time` : ''} FROM ${name}`);
  }

  await runQuery('Direction loss - trades_raw', 'SELECT count() AS c FROM default.trades_raw');
  await runQuery('Direction loss - trade_direction_assignments', 'SELECT count() AS c FROM default.trade_direction_assignments');
  await runQuery('Direction loss - trades_with_direction', 'SELECT count() AS c FROM default.trades_with_direction');
  await runQuery('trades_with_direction missing direction', `SELECT count() AS c FROM default.trades_with_direction WHERE direction_from_transfers IS NULL OR direction_from_transfers = ''`);
}

main().finally(() => process.exit(0));
