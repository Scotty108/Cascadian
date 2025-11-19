import { getClickHouseClient } from './lib/clickhouse/client';

interface ColumnInfo {
  database: string;
  table: string;
  name: string;
  type: string;
}

async function main() {
  try {
    const client = getClickHouseClient();

    console.log('=== PHASE 2: FINDING ALL CONDITION_ID TABLES ===\n');

    const databases = ['default', 'cascadian_clean', 'sandbox', 'staging'];

    const conditionIdTables: { [key: string]: string[] } = {};
    const txHashTables: { [key: string]: string[] } = {};
    const bothTables: string[] = [];

    for (const db of databases) {
      console.log(`\n📁 Scanning database: ${db}`);

      // Find all tables with condition_id-like columns
      const conditionIdResult = await client.query({
        query: `
          SELECT
            database,
            table,
            name,
            type
          FROM system.columns
          WHERE database = '${db}'
            AND (
              name LIKE '%condition_id%'
              OR name LIKE '%cid%'
              OR name = 'condition'
            )
          ORDER BY table, name
        `,
        format: 'JSONEachRow'
      });

      const conditionIdCols = await conditionIdResult.json() as ColumnInfo[];

      // Find all tables with tx_hash-like columns
      const txHashResult = await client.query({
        query: `
          SELECT
            database,
            table,
            name,
            type
          FROM system.columns
          WHERE database = '${db}'
            AND (
              name LIKE '%tx_hash%'
              OR name LIKE '%transaction_hash%'
              OR name = 'hash'
            )
          ORDER BY table, name
        `,
        format: 'JSONEachRow'
      });

      const txHashCols = await txHashResult.json() as ColumnInfo[];

      // Group by table
      const conditionIdTableSet = new Set<string>();
      conditionIdCols.forEach(col => {
        const fullName = `${col.database}.${col.table}`;
        conditionIdTableSet.add(fullName);
        if (!conditionIdTables[fullName]) {
          conditionIdTables[fullName] = [];
        }
        conditionIdTables[fullName].push(`${col.name} (${col.type})`);
      });

      const txHashTableSet = new Set<string>();
      txHashCols.forEach(col => {
        const fullName = `${col.database}.${col.table}`;
        txHashTableSet.add(fullName);
        if (!txHashTables[fullName]) {
          txHashTables[fullName] = [];
        }
        txHashTables[fullName].push(`${col.name} (${col.type})`);
      });

      // Find intersection
      for (const table of conditionIdTableSet) {
        if (txHashTableSet.has(table)) {
          bothTables.push(table);
        }
      }

      console.log(`   Found ${conditionIdTableSet.size} tables with condition_id columns`);
      console.log(`   Found ${txHashTableSet.size} tables with tx_hash columns`);
    }

    console.log(`\n\n=== SUMMARY ===`);
    console.log(`Total tables with condition_id columns: ${Object.keys(conditionIdTables).length}`);
    console.log(`Total tables with tx_hash columns: ${Object.keys(txHashTables).length}`);
    console.log(`Tables with BOTH (high-value candidates): ${bothTables.length}`);

    console.log(`\n\n=== HIGH-VALUE CANDIDATES (have both condition_id AND tx_hash) ===`);
    bothTables.forEach((table, i) => {
      console.log(`\n${i + 1}. ${table}`);
      console.log(`   Condition ID columns: ${conditionIdTables[table].join(', ')}`);
      console.log(`   TX Hash columns: ${txHashTables[table].join(', ')}`);
    });

    // Write detailed report
    const report = generateCandidateReport(conditionIdTables, txHashTables, bothTables);
    const fs = require('fs');
    fs.writeFileSync('/tmp/CONDITION_ID_CANDIDATE_TABLES.md', report);
    console.log(`\n✅ Written to /tmp/CONDITION_ID_CANDIDATE_TABLES.md`);

    // Return the high-value candidates for testing
    return bothTables;

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function generateCandidateReport(
  conditionIdTables: { [key: string]: string[] },
  txHashTables: { [key: string]: string[] },
  bothTables: string[]
): string {
  let report = `# Condition ID Candidate Tables\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n\n`;
  report += `## Summary\n\n`;
  report += `- **Tables with condition_id columns:** ${Object.keys(conditionIdTables).length}\n`;
  report += `- **Tables with tx_hash columns:** ${Object.keys(txHashTables).length}\n`;
  report += `- **High-value candidates (both):** ${bothTables.length}\n\n`;

  report += `---\n\n`;

  report += `## High-Value Candidates (Have Both Columns)\n\n`;
  report += `These tables have both condition_id AND tx_hash columns, making them ideal for orphan repair.\n\n`;

  bothTables.forEach((table, i) => {
    report += `### ${i + 1}. \`${table}\`\n\n`;
    report += `**Condition ID columns:**\n`;
    conditionIdTables[table].forEach(col => {
      report += `- ${col}\n`;
    });
    report += `\n**TX Hash columns:**\n`;
    txHashTables[table].forEach(col => {
      report += `- ${col}\n`;
    });
    report += `\n---\n\n`;
  });

  report += `## All Tables with Condition ID Columns\n\n`;
  Object.entries(conditionIdTables).forEach(([table, cols]) => {
    if (!bothTables.includes(table)) {
      report += `### \`${table}\`\n\n`;
      cols.forEach(col => {
        report += `- ${col}\n`;
      });
      report += `\n`;
    }
  });

  return report;
}

main().catch(console.error);
