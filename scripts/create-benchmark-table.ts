import { clickhouse } from '../lib/clickhouse/client';

async function createTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS pm_ui_pnl_benchmarks_v1
    (
      wallet String,
      pnl_value Float64,
      benchmark_set String,
      captured_at DateTime,
      note String
    )
    ENGINE = MergeTree()
    ORDER BY (benchmark_set, wallet);
  `;

  try {
    await clickhouse.exec({ query: createTableQuery });
    console.log('Successfully created table pm_ui_pnl_benchmarks_v1');
  } catch (error) {
    console.error('Error creating table:', error);
    process.exit(1);
  }
}

createTable();