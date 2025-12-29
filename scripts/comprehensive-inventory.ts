import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
});

async function main() {
  try {
    console.log('=== COMPREHENSIVE CLICKHOUSE DATABASE INVENTORY ===\n');

    // Step 1: Get all tables
    console.log('📊 STEP 1: Discovering all tables...\n');
    const tablesResult = await client.query({
      query: `
        SELECT
          database,
          name as table_name,
          engine,
          total_rows,
          total_bytes
        FROM system.tables
        WHERE database IN ('default', 'pm_archive')
        ORDER BY database, name
      `,
      format: 'JSONEachRow',
    });

    const tables = await tablesResult.json() as any[];
    console.log(`Found ${tables.length} tables\n`);
    console.log('TABLE LIST:');
    console.log('─'.repeat(100));
    tables.forEach(t => {
      const rows = t.total_rows ? t.total_rows.toLocaleString() : 'N/A';
      console.log(`${t.database}.${t.table_name} | Engine: ${t.engine} | Rows: ${rows}`);
    });
    console.log('\n');

    // Step 2: For each table, get detailed info
    console.log('📋 STEP 2: Detailed analysis of each table...\n');
    console.log('='.repeat(120));

    for (const table of tables) {
      const fullName = `${table.database}.${table.table_name}`;
      const isView = table.engine === 'View';

      console.log(`\n### TABLE: ${fullName} ${isView ? '(VIEW)' : ''}`);
      console.log('─'.repeat(120));

      try {
        // Get column info
        const columnsResult = await client.query({
          query: `DESCRIBE TABLE ${fullName}`,
          format: 'JSONEachRow',
        });
        const columns = await columnsResult.json() as any[];

        console.log(`\n📐 SCHEMA (${columns.length} columns):`);
        columns.forEach(col => {
          console.log(`  - ${col.name}: ${col.type}${col.default_expression ? ` (default: ${col.default_expression})` : ''}`);
        });

        // Get row count (skip for views with dependency issues)
        let rowCount = 0;
        try {
          const countResult = await client.query({
            query: `SELECT count() as cnt FROM ${fullName}`,
            format: 'JSONEachRow',
          });
          const countData = await countResult.json() as any[];
          rowCount = countData[0]?.cnt || 0;
          console.log(`\n📊 ROW COUNT: ${rowCount.toLocaleString()}`);
        } catch (countErr: any) {
          console.log(`\n📊 ROW COUNT: Unable to query (view dependency issue)`);
          console.log(`   Error: ${countErr.message.substring(0, 100)}...`);
        }

        // Get sample rows (if table has data)
        if (rowCount > 0) {
          try {
            const sampleResult = await client.query({
              query: `SELECT * FROM ${fullName} LIMIT 3`,
              format: 'JSONEachRow',
            });
            const samples = await sampleResult.json() as any[];

            console.log(`\n🔍 SAMPLE DATA (${samples.length} rows):`);
            samples.forEach((row, idx) => {
              console.log(`\n  Row ${idx + 1}:`);
              Object.entries(row).forEach(([key, value]) => {
                let displayValue = value;
                if (typeof value === 'string' && value.length > 80) {
                  displayValue = value.substring(0, 77) + '...';
                }
                console.log(`    ${key}: ${JSON.stringify(displayValue)}`);
              });
            });
          } catch (sampleErr: any) {
            console.log(`\n🔍 SAMPLE DATA: Unable to query`);
          }
        }
      } catch (err: any) {
        console.log(`\n⚠️  Error analyzing table: ${err.message.substring(0, 100)}...`);
      }

      console.log('\n' + '='.repeat(120));
    }

    // Step 3: Look for specific patterns
    console.log('\n\n🔎 STEP 3: Pattern-based analysis...\n');
    console.log('='.repeat(120));

    const patterns = {
      'CTF-related': tables.filter(t => t.table_name.toLowerCase().includes('ctf')),
      'Position-related': tables.filter(t => t.table_name.toLowerCase().includes('position')),
      'Resolution-related': tables.filter(t => t.table_name.toLowerCase().includes('resolution')),
      'Payout-related': tables.filter(t => t.table_name.toLowerCase().includes('payout')),
      'PnL-related': tables.filter(t => t.table_name.toLowerCase().includes('pnl')),
      'Archive data': tables.filter(t => t.database === 'pm_archive'),
      'FPMM/AMM': tables.filter(t => t.table_name.toLowerCase().includes('fpmm') || t.table_name.toLowerCase().includes('amm')),
      'Split/Merge': tables.filter(t =>
        t.table_name.toLowerCase().includes('split') ||
        t.table_name.toLowerCase().includes('merge')
      ),
      'Redeem': tables.filter(t => t.table_name.toLowerCase().includes('redeem')),
    };

    console.log('\n📂 TABLES BY CATEGORY:\n');
    Object.entries(patterns).forEach(([category, matches]) => {
      console.log(`\n${category}: ${matches.length} tables`);
      if (matches.length > 0) {
        matches.forEach(t => {
          const rows = t.total_rows ? t.total_rows.toLocaleString() : '0';
          console.log(`  - ${t.database}.${t.table_name} (${rows} rows)`);
        });
      } else {
        console.log('  (none found)');
      }
    });

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
