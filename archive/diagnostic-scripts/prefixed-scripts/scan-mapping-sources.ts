import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

interface ColumnInfo {
  database: string;
  table: string;
  column_name: string;
  type: string;
}

interface TableStats {
  table: string;
  row_count: number;
  min_timestamp?: string;
  max_timestamp?: string;
  key_columns: string[];
  sample_data: any[];
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

async function scanForMappingSources() {
  console.log('Step 1: Finding candidate tables with relevant columns...\n');

  const candidateColumns = await clickhouse.query({
    query: `
      SELECT
        database,
        table,
        name as column_name,
        type
      FROM system.columns
      WHERE (
        lower(name) LIKE '%condition%' OR
        lower(name) LIKE '%market%' OR
        lower(name) LIKE '%token%' OR
        lower(name) LIKE '%outcome%' OR
        lower(name) LIKE '%winning%' OR
        lower(name) LIKE '%resolution%' OR
        lower(name) LIKE '%payout%' OR
        lower(name) LIKE '%ctf%'
      )
      AND database = 'default'
      AND table NOT LIKE '%pm_trades_canonical%'
      AND table NOT LIKE '%_inner%'
      ORDER BY table, name
    `,
    format: 'JSONEachRow'
  });

  const columns: ColumnInfo[] = await candidateColumns.json();

  // Group by table
  const tableColumns = new Map<string, ColumnInfo[]>();
  for (const col of columns) {
    if (!tableColumns.has(col.table)) {
      tableColumns.set(col.table, []);
    }
    tableColumns.get(col.table)!.push(col);
  }

  console.log(`Found ${tableColumns.size} candidate tables\n`);

  const tableStats: TableStats[] = [];

  console.log('Step 2: Analyzing each candidate table...\n');

  for (const [tableName, cols] of tableColumns) {
    console.log(`Analyzing: ${tableName}`);

    try {
      // Get row count
      const countResult = await clickhouse.query({
        query: `SELECT count() as cnt FROM ${tableName}`,
        format: 'JSONEachRow'
      });
      const countData: any[] = await countResult.json();
      const rowCount = Number(countData[0]?.cnt || 0);

      if (rowCount === 0) {
        console.log(`  ⚠️  Empty table, skipping\n`);
        continue;
      }

      // Check for timestamp column
      const timestampCol = cols.find(c =>
        c.column_name.toLowerCase().includes('timestamp') ||
        c.column_name.toLowerCase().includes('time') ||
        c.column_name.toLowerCase().includes('date')
      );

      let minTime, maxTime;
      if (timestampCol) {
        try {
          const timeResult = await clickhouse.query({
            query: `SELECT min(${timestampCol.column_name}) as min_t, max(${timestampCol.column_name}) as max_t FROM ${tableName}`,
            format: 'JSONEachRow'
          });
          const timeData: any[] = await timeResult.json();
          minTime = timeData[0]?.min_t;
          maxTime = timeData[0]?.max_t;
        } catch (e) {
          // Timestamp query failed, continue without it
        }
      }

      // Get sample data
      const sampleResult = await clickhouse.query({
        query: `SELECT * FROM ${tableName} LIMIT 5`,
        format: 'JSONEachRow'
      });
      const sampleData: any[] = await sampleResult.json();

      // Identify key columns
      const keyColumns = cols
        .map(c => c.column_name)
        .filter(name => {
          const lower = name.toLowerCase();
          return lower.includes('condition') ||
                 lower.includes('market') ||
                 lower.includes('token') ||
                 lower.includes('tx') ||
                 lower.includes('hash') ||
                 lower.includes('wallet') ||
                 lower.includes('address') ||
                 lower.includes('outcome') ||
                 lower.includes('winning') ||
                 lower.includes('resolution');
        });

      // Prioritize
      let priority: 'high' | 'medium' | 'low' = 'low';
      let reason = '';

      const hasConditionId = cols.some(c => c.column_name.toLowerCase().includes('condition_id'));
      const hasMarketId = cols.some(c => c.column_name.toLowerCase().includes('market_id'));
      const hasTokenId = cols.some(c => c.column_name.toLowerCase().includes('token_id'));
      const hasJoinKey = cols.some(c => {
        const lower = c.column_name.toLowerCase();
        return lower.includes('tx') || lower.includes('hash') ||
               lower.includes('wallet') || lower.includes('address');
      });
      const hasResolutionData = cols.some(c => {
        const lower = c.column_name.toLowerCase();
        return lower.includes('winning') || lower.includes('resolution') ||
               lower.includes('payout') || lower.includes('outcome');
      });

      if (hasConditionId && hasJoinKey && rowCount > 100000) {
        priority = 'high';
        reason = `Has condition_id, join keys, and ${(rowCount / 1000000).toFixed(1)}M rows`;
      } else if (hasConditionId && rowCount > 10000) {
        priority = 'high';
        reason = `Has condition_id with ${(rowCount / 1000).toFixed(0)}K rows`;
      } else if ((hasMarketId || hasTokenId) && hasJoinKey && rowCount > 100000) {
        priority = 'medium';
        reason = `Has ${hasMarketId ? 'market_id' : 'token_id'} and join keys (${(rowCount / 1000000).toFixed(1)}M rows)`;
      } else if (hasResolutionData && rowCount > 1000) {
        priority = 'medium';
        reason = `Has resolution data (${(rowCount / 1000).toFixed(0)}K rows)`;
      } else {
        reason = `Limited join potential (${rowCount} rows)`;
      }

      tableStats.push({
        table: tableName,
        row_count: rowCount,
        min_timestamp: minTime,
        max_timestamp: maxTime,
        key_columns: keyColumns,
        sample_data: sampleData,
        priority,
        reason
      });

      console.log(`  ✓ ${rowCount.toLocaleString()} rows, Priority: ${priority.toUpperCase()}`);
      console.log(`    ${reason}\n`);

    } catch (error) {
      console.log(`  ⚠️  Error analyzing: ${error}\n`);
    }
  }

  console.log('\nStep 3: Generating report...\n');

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  tableStats.sort((a, b) => {
    if (a.priority !== b.priority) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.row_count - a.row_count;
  });

  // Generate markdown report
  let report = `# Potential Mapping Sources Scan

**Objective:** Find additional condition_id mapping sources to close the 32% orphan gap in pm_trades_canonical_v3_sandbox

**Current Coverage:** 68% (via original + trades_with_direction + erc1155_decode + clob_decode)

**Scan Results:** ${tableStats.length} candidate tables analyzed

---

`;

  // High priority tables
  const highPriority = tableStats.filter(t => t.priority === 'high');
  if (highPriority.length > 0) {
    report += `## 🔥 HIGHLY PROMISING (${highPriority.length} tables)\n\n`;
    for (const stat of highPriority) {
      report += `### ${stat.table}\n\n`;
      report += `**Row Count:** ${stat.row_count.toLocaleString()}\n`;
      report += `**Reason:** ${stat.reason}\n`;
      if (stat.min_timestamp && stat.max_timestamp) {
        report += `**Time Range:** ${stat.min_timestamp} → ${stat.max_timestamp}\n`;
      }
      report += `**Key Columns:** ${stat.key_columns.join(', ')}\n\n`;
      report += `**Sample Data:**\n\`\`\`json\n${JSON.stringify(stat.sample_data[0] || {}, null, 2)}\n\`\`\`\n\n`;
      report += `**Join Potential:**\n`;

      // Analyze join potential
      const sample = stat.sample_data[0] || {};
      const joins = [];
      if (sample.condition_id) joins.push('✅ Direct condition_id join');
      if (sample.tx_hash || sample.transaction_hash || sample.hash) joins.push('✅ Can join via tx_hash');
      if (sample.wallet || sample.wallet_address || sample.address) joins.push('✅ Can join via wallet');
      if (sample.market_id) joins.push('⚠️ Can bridge via market_id');
      if (sample.token_id || sample.asset_id) joins.push('⚠️ Can bridge via token_id');

      report += joins.map(j => `- ${j}`).join('\n') + '\n\n';
      report += `---\n\n`;
    }
  }

  // Medium priority tables
  const mediumPriority = tableStats.filter(t => t.priority === 'medium');
  if (mediumPriority.length > 0) {
    report += `## 🔸 MAYBE USEFUL (${mediumPriority.length} tables)\n\n`;
    for (const stat of mediumPriority) {
      report += `### ${stat.table}\n\n`;
      report += `**Row Count:** ${stat.row_count.toLocaleString()}\n`;
      report += `**Reason:** ${stat.reason}\n`;
      report += `**Key Columns:** ${stat.key_columns.join(', ')}\n`;
      if (stat.min_timestamp && stat.max_timestamp) {
        report += ` | Time Range: ${stat.min_timestamp} → ${stat.max_timestamp}`;
      }
      report += `\n\n`;
    }
  }

  // Low priority tables
  const lowPriority = tableStats.filter(t => t.priority === 'low');
  if (lowPriority.length > 0) {
    report += `## ⚪ UNLIKELY (${lowPriority.length} tables)\n\n`;
    report += `<details>\n<summary>Click to expand low-priority tables</summary>\n\n`;
    for (const stat of lowPriority) {
      report += `- **${stat.table}**: ${stat.reason} | ${stat.key_columns.join(', ')}\n`;
    }
    report += `\n</details>\n\n`;
  }

  // Summary and recommendations
  report += `---

## Summary & Recommendations

**Total Candidates:** ${tableStats.length} tables scanned

**Priority Breakdown:**
- 🔥 High Priority: ${highPriority.length} tables
- 🔸 Medium Priority: ${mediumPriority.length} tables
- ⚪ Low Priority: ${lowPriority.length} tables

**Next Steps:**

1. **Investigate High Priority tables first** - These have the best potential for immediate coverage gains
2. **For each promising table:**
   - Test join success rate with pm_trades_canonical_v3_sandbox orphans
   - Check condition_id format compatibility (64-char hex lowercase)
   - Measure coverage improvement: \`SELECT count(*) FROM orphans WHERE EXISTS (SELECT 1 FROM candidate_table WHERE ...)\`
3. **Build incremental mapping queries** - Add promising sources to v4 query
4. **Measure cumulative coverage** - Track orphan reduction with each new source

**Known Sources Already Used by C1:**
- trades_with_direction (original)
- erc1155_decode
- clob_decode

**Comparison to C1's Approach:**
[To be filled in after analyzing which of these tables C1 already uses]

---

*Scan completed: ${new Date().toISOString()}*
*Agent: C2 - Data Coverage Scout*
`;

  // Write report
  const fs = require('fs');
  fs.writeFileSync('/tmp/POTENTIAL_MAPPING_SOURCES_SCAN.md', report);

  console.log('✅ Report written to /tmp/POTENTIAL_MAPPING_SOURCES_SCAN.md');
  console.log(`\nSummary: ${highPriority.length} high priority, ${mediumPriority.length} medium priority, ${lowPriority.length} low priority tables`);
}

scanForMappingSources().catch(console.error);
