import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function scanForMappingSources() {
  console.log('Scanning for condition_id mapping sources...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        database,
        table,
        groupArray(name) as columns,
        groupArray(type) as types
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
      GROUP BY database, table
      ORDER BY table
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await result.json();

  console.log(`\nFound ${tables.length} candidate tables with relevant columns\n`);
  console.log('Generating report...\n');

  let report = `# Potential Mapping Sources Scan

**Objective:** Find additional condition_id mapping sources to close the 32% orphan gap

**Scan Date:** ${new Date().toISOString()}

**Tables Found:** ${tables.length}

---

## All Candidate Tables

`;

  for (const t of tables) {
    report += `### ${t.table}\n\n`;
    report += `**Columns:** ${t.columns.join(', ')}\n\n`;

    // Highlight key columns
    const hasConditionId = t.columns.some((c: string) => c.toLowerCase().includes('condition_id'));
    const hasMarketId = t.columns.some((c: string) => c.toLowerCase().includes('market_id'));
    const hasTokenId = t.columns.some((c: string) => c.toLowerCase().includes('token_id'));
    const hasJoinKey = t.columns.some((c: string) => {
      const lower = c.toLowerCase();
      return lower.includes('tx') || lower.includes('hash') ||
             lower.includes('wallet') || lower.includes('address');
    });

    const features = [];
    if (hasConditionId) features.push('✅ Has condition_id');
    if (hasMarketId) features.push('⚠️ Has market_id');
    if (hasTokenId) features.push('⚠️ Has token_id');
    if (hasJoinKey) features.push('✅ Has join keys');

    if (features.length > 0) {
      report += features.join(' | ') + '\n';
    }

    report += '\n---\n\n';
  }

  report += `\n## Summary\n\n`;
  report += `- Total tables scanned: ${tables.length}\n`;
  report += `- Tables with condition_id: ${tables.filter((t: any) => t.columns.some((c: string) => c.toLowerCase().includes('condition_id'))).length}\n`;
  report += `- Tables with market_id: ${tables.filter((t: any) => t.columns.some((c: string) => c.toLowerCase().includes('market_id'))).length}\n`;
  report += `- Tables with token_id: ${tables.filter((t: any) => t.columns.some((c: string) => c.toLowerCase().includes('token_id'))).length}\n`;

  report += `\n---\n\n*Agent: C2 - Data Coverage Scout*\n`;

  // Write report
  const fs = require('fs');
  fs.writeFileSync('/tmp/POTENTIAL_MAPPING_SOURCES_SCAN.md', report);

  console.log('✅ Report written to /tmp/POTENTIAL_MAPPING_SOURCES_SCAN.md');
  console.log(`\nFound ${tables.length} candidate tables`);
}

scanForMappingSources().catch(console.error);
