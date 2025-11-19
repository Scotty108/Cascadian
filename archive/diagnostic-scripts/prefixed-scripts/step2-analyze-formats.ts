import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  console.log('Analyzing ID column formats...\n');

  const inventory = JSON.parse(readFileSync('./ID_COLUMNS_INVENTORY.json', 'utf-8'));
  const results = [];

  let processed = 0;
  for (const item of inventory.columns) {
    processed++;
    console.log(`[${processed}/${inventory.columns.length}] Analyzing ${item.table}.${item.column}...`);

    try {
      const sampleQuery = await clickhouse.query({
        query: `SELECT DISTINCT ${item.column} as val FROM ${item.table} WHERE ${item.column} IS NOT NULL AND ${item.column} != '' LIMIT 5`,
        format: 'JSONEachRow'
      });

      const samples = await sampleQuery.json();
      const sampleValues = samples.map(s => String(s.val));

      if (sampleValues.length === 0) {
        console.log('  No values found\n');
        continue;
      }

      const statsQuery = await clickhouse.query({
        query: `SELECT count() as total, countIf(${item.column} IS NULL OR ${item.column} = '') as nulls, uniq(${item.column}) as distinct_count FROM ${item.table}`,
        format: 'JSONEachRow'
      });

      const stats = await statsQuery.json();

      let formatStats = null;
      if (item.type.includes('String')) {
        const formatQuery = await clickhouse.query({
          query: `
            SELECT
              countIf(${item.column} LIKE '0x%') as with_0x,
              countIf(${item.column} NOT LIKE '0x%') as without_0x,
              length(${item.column}) as len,
              count() as count_per_len
            FROM ${item.table}
            WHERE ${item.column} IS NOT NULL AND ${item.column} != ''
            GROUP BY len
            ORDER BY count_per_len DESC
            LIMIT 5
          `,
          format: 'JSONEachRow'
        });

        formatStats = await formatQuery.json();
      }

      results.push({
        table: item.table,
        column: item.column,
        type: item.type,
        total_rows: stats[0].total,
        null_count: stats[0].nulls,
        distinct_count: stats[0].distinct_count,
        samples: sampleValues,
        format_stats: formatStats
      });

      const preview = sampleValues.slice(0, 2).join(', ').substring(0, 60);
      console.log(`  Total: ${stats[0].total}, Distinct: ${stats[0].distinct_count}\n`);

    } catch (error) {
      console.log(`  ERROR: ${error.message}\n`);
    }
  }

  writeFileSync('./ID_FORMAT_ANALYSIS.json', JSON.stringify({ analyzed_at: new Date().toISOString(), results }, null, 2));
  console.log(`\nDONE: Analyzed ${results.length} columns, saved to ID_FORMAT_ANALYSIS.json`);
}

main().catch(console.error);
