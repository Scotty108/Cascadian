import { getClickHouseClient } from './lib/clickhouse/client';

interface Database {
  name: string;
}

interface Table {
  name: string;
}

interface TableDetail {
  database: string;
  name: string;
  engine: string;
  total_rows: string;
  total_bytes: string;
  size: string;
}

async function main() {
  try {
    const client = getClickHouseClient();

    console.log('=== PHASE 1: COMPLETE DATABASE INVENTORY ===\n');

    // Get all databases
    const dbResult = await client.query({
      query: 'SHOW DATABASES',
      format: 'JSONEachRow'
    });
    const databases = await dbResult.json() as Database[];

    console.log(`Found ${databases.length} databases:\n`);

    const allTables: { [db: string]: TableDetail[] } = {};
    let totalTableCount = 0;

    // For each database, get all tables with details
    for (const db of databases) {
      const dbName = db.name;

      // Skip system databases for initial count
      if (dbName === 'INFORMATION_SCHEMA' || dbName === 'information_schema' || dbName === 'system') {
        console.log(`⏭️  Skipping system database: ${dbName}`);
        continue;
      }

      console.log(`\n📁 Database: ${dbName}`);

      try {
        const tableResult = await client.query({
          query: `
            SELECT
              database,
              name,
              engine,
              total_rows,
              formatReadableSize(total_bytes) as size
            FROM system.tables
            WHERE database = '${dbName}'
            ORDER BY total_bytes DESC
          `,
          format: 'JSONEachRow'
        });

        const tables = await tableResult.json() as TableDetail[];
        allTables[dbName] = tables;
        totalTableCount += tables.length;

        console.log(`   Found ${tables.length} tables`);

        // Show top 5 largest tables
        if (tables.length > 0) {
          console.log('   Largest tables:');
          tables.slice(0, 5).forEach((t, i) => {
            console.log(`     ${i + 1}. ${t.name} (${t.engine}) - ${t.total_rows} rows, ${t.size}`);
          });
        }
      } catch (error: any) {
        console.error(`   ❌ Error querying database ${dbName}:`, error.message);
      }
    }

    console.log(`\n\n=== SUMMARY ===`);
    console.log(`Total databases (excluding system): ${Object.keys(allTables).length}`);
    console.log(`Total tables: ${totalTableCount}`);
    console.log(`Expected tables: 92+`);

    if (totalTableCount < 92) {
      console.log(`\n⚠️  WARNING: Found fewer tables than expected (${totalTableCount} < 92)`);
    } else if (totalTableCount > 92) {
      console.log(`\n✅ Found MORE tables than documented (${totalTableCount} > 92)`);
    } else {
      console.log(`\n✅ Table count matches expected (${totalTableCount} = 92)`);
    }

    // Write detailed inventory to file
    const inventoryContent = generateInventoryReport(allTables, totalTableCount);
    const fs = require('fs');
    fs.writeFileSync('/tmp/COMPLETE_DATABASE_INVENTORY.md', inventoryContent);
    console.log('\n✅ Written to /tmp/COMPLETE_DATABASE_INVENTORY.md');

    // Return table list for next phase
    return allTables;

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function generateInventoryReport(allTables: { [db: string]: TableDetail[] }, totalCount: number): string {
  let report = `# Complete ClickHouse Database Inventory\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Total Databases:** ${Object.keys(allTables).length}\n`;
  report += `**Total Tables:** ${totalCount}\n`;
  report += `**Expected:** 92+ tables\n\n`;

  report += `---\n\n`;

  for (const [dbName, tables] of Object.entries(allTables)) {
    report += `## Database: \`${dbName}\`\n\n`;
    report += `**Table Count:** ${tables.length}\n\n`;

    if (tables.length > 0) {
      report += `| Table Name | Engine | Rows | Size |\n`;
      report += `|------------|--------|------|------|\n`;

      tables.forEach(t => {
        report += `| ${t.name} | ${t.engine} | ${t.total_rows} | ${t.size} |\n`;
      });

      report += `\n`;
    }

    report += `---\n\n`;
  }

  return report;
}

main().catch(console.error);
