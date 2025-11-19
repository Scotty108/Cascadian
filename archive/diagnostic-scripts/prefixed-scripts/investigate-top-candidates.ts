import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  try {
    const client = getClickHouseClient();

    console.log('=== SCHEMA INVESTIGATION FOR TOP 3 CANDIDATES ===\n');

    const candidates = [
      { table: 'pm_trades_complete', database: 'default' },
      { table: 'pm_trades', database: 'default' },
      { table: 'trades_with_direction', database: 'default' }
    ];

    for (const candidate of candidates) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`TABLE: ${candidate.database}.${candidate.table}`);
      console.log('='.repeat(80));

      // Get schema
      const schemaResult = await client.query({
        query: `DESCRIBE TABLE ${candidate.database}.${candidate.table}`,
        format: 'JSONEachRow'
      });
      const schema = await schemaResult.json() as { name: string; type: string; default_type: string }[];

      console.log('\n📋 SCHEMA:\n');
      schema.forEach(col => {
        console.log(`  ${col.name.padEnd(30)} ${col.type}`);
      });

      // Check if it's a view
      const viewCheckResult = await client.query({
        query: `
          SELECT engine
          FROM system.tables
          WHERE database = '${candidate.database}' AND name = '${candidate.table}'
        `,
        format: 'JSONEachRow'
      });
      const engineInfo = await viewCheckResult.json() as { engine: string }[];

      console.log(`\n📊 ENGINE: ${engineInfo[0].engine}`);

      // If it's a view, get the definition
      if (engineInfo[0].engine === 'View') {
        const viewDefResult = await client.query({
          query: `SHOW CREATE TABLE ${candidate.database}.${candidate.table}`,
          format: 'TabSeparated'
        });
        const viewDef = await viewDefResult.text();
        console.log(`\n📝 VIEW DEFINITION:\n`);
        console.log(viewDef);
      }

      // Get sample data with condition_id populated
      console.log(`\n📦 SAMPLE DATA (with condition_id):\n`);

      let cidColumn = 'condition_id';
      let txColumn = 'tx_hash';

      if (candidate.table === 'trades_with_direction') {
        cidColumn = 'condition_id_norm';
      }

      try {
        const sampleResult = await client.query({
          query: `
            SELECT
              ${txColumn},
              ${cidColumn},
              wallet_address,
              timestamp,
              market_id,
              side
            FROM ${candidate.database}.${candidate.table}
            WHERE length(${cidColumn}) = 64
            LIMIT 3
          `,
          format: 'JSONEachRow'
        });

        const samples = await sampleResult.json();
        console.log(JSON.stringify(samples, null, 2));
      } catch (error: any) {
        console.error(`  Error getting sample: ${error.message}`);
      }

      // Count total rows
      const countResult = await client.query({
        query: `SELECT count() as count FROM ${candidate.database}.${candidate.table}`,
        format: 'JSONEachRow'
      });
      const count = await countResult.json() as { count: string }[];
      console.log(`\n📊 TOTAL ROWS: ${parseInt(count[0].count).toLocaleString()}`);

      // Check condition_id coverage
      const coverageResult = await client.query({
        query: `
          SELECT
            countIf(length(${cidColumn}) = 64) as has_cid,
            count() as total,
            round(100.0 * has_cid / total, 2) as coverage_pct
          FROM ${candidate.database}.${candidate.table}
        `,
        format: 'JSONEachRow'
      });
      const coverage = await coverageResult.json() as { has_cid: string; total: string; coverage_pct: string }[];
      console.log(`\n📈 CONDITION_ID COVERAGE: ${coverage[0].coverage_pct}% (${parseInt(coverage[0].has_cid).toLocaleString()} of ${parseInt(coverage[0].total).toLocaleString()})`);
    }

    console.log(`\n\n${'='.repeat(80)}`);
    console.log('SUMMARY & INTEGRATION ANALYSIS');
    console.log('='.repeat(80));

    console.log(`
Key Findings:

1. **pm_trades_complete**
   - 23.29% safe 1:1 coverage
   - Need to check if it's a view or table
   - If view, need to understand source tables

2. **pm_trades**
   - 23.28% safe 1:1 coverage
   - Similar to pm_trades_complete
   - Likely a view combining multiple sources

3. **trades_with_direction**
   - 22.05% safe 1:1 coverage
   - Uses condition_id_norm instead of condition_id
   - May have different normalization logic

Next Steps:

A. **Immediate Action (if tables are views):**
   - Extract the underlying SELECT logic
   - Apply to orphan tx_hashes only
   - Merge results into pm_trades_canonical_v3

B. **Immediate Action (if tables are materialized):**
   - Direct LEFT JOIN on tx_hash
   - Take condition_id where 1:1 match
   - Update pm_trades_canonical_v3.condition_id_norm_v3

C. **Handle Ambiguity:**
   - For fanout cases (multiple condition_ids per tx_hash)
   - Add tie-breaker logic (e.g., pick most common market_id)
   - Or skip ambiguous cases (conservative approach)

D. **Validation:**
   - Test on 10k sample first
   - Verify condition_id format (64 chars, lowercase, no 0x)
   - Check that repaired trades have valid market_id matches
`);

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);
