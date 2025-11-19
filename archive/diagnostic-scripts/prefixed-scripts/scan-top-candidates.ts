import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function scanTopCandidates() {
  console.log('Analyzing top candidate tables for condition_id mapping...\n');

  // Get top tables with condition_id
  const result = await clickhouse.query({
    query: `
      WITH relevant_tables AS (
        SELECT DISTINCT table
        FROM system.columns
        WHERE database = 'default'
          AND (
            lower(name) LIKE '%condition_id%'
          )
          AND table NOT LIKE '%pm_trades_canonical%'
          AND table NOT LIKE '%_inner%'
          AND table NOT LIKE '%backup%'
          AND table NOT LIKE '%broken%'
          AND table NOT LIKE '%old%'
      )
      SELECT
        t.name AS table_name,
        t.total_rows,
        formatReadableSize(t.total_bytes) AS size,
        groupArray(c.name) AS all_columns
      FROM system.tables t
      INNER JOIN relevant_tables r ON t.name = r.table
      LEFT JOIN system.columns c ON t.name = c.table AND c.database = 'default'
      WHERE t.database = 'default'
        AND t.total_rows > 0
      GROUP BY t.name, t.total_rows, t.total_bytes
      ORDER BY t.total_rows DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await result.json();

  console.log(`Found ${tables.length} non-empty tables with condition_id\n`);

  let report = `# Top Candidate Tables for Condition ID Mapping

**Objective:** Identify tables most likely to reduce the 32% orphan gap in pm_trades_canonical_v3_sandbox

**Current Coverage:** 68% (via original + trades_with_direction + erc1155_decode + clob_decode)

**Tables Analyzed:** ${tables.length} non-empty tables with condition_id fields

---

## High-Priority Candidates

Tables with high row counts and promising join keys:

`;

  for (const t of tables) {
    const hasJoinKey = t.all_columns.some((c: string) => {
      const lower = c.toLowerCase();
      return lower.includes('tx') || lower.includes('hash') ||
             lower.includes('wallet') || lower.includes('address');
    });

    const hasMarketId = t.all_columns.some((c: string) => c.toLowerCase().includes('market_id'));
    const hasTokenId = t.all_columns.some((c: string) => c.toLowerCase().includes('token_id'));
    const hasOutcome = t.all_columns.some((c: string) => c.toLowerCase().includes('outcome'));

    report += `### ${t.table_name}\n\n`;
    report += `- **Rows:** ${Number(t.total_rows).toLocaleString()}\n`;
    report += `- **Size:** ${t.size}\n`;
    report += `- **Key Columns:** ${t.all_columns.filter((c: string) => {
      const lower = c.toLowerCase();
      return lower.includes('condition') || lower.includes('market') ||
             lower.includes('token') || lower.includes('tx') ||
             lower.includes('hash') || lower.includes('wallet') ||
             lower.includes('address') || lower.includes('outcome');
    }).join(', ')}\n\n`;

    report += `**Features:**\n`;
    const features = [];
    if (hasJoinKey) features.push('✅ Can join to trades via tx_hash/wallet');
    else features.push('❌ No obvious join key to trades');

    if (hasMarketId) features.push('⚠️ Has market_id (can bridge via ctf_token_map)');
    if (hasTokenId) features.push('⚠️ Has token_id (can bridge via ctf_token_map)');
    if (hasOutcome) features.push('✅ Has outcome information');

    report += features.map(f => `- ${f}`).join('\n') + '\n\n';

    report += `**Next Step:** ${
      hasJoinKey
        ? `Test join: \`SELECT count() FROM pm_trades_canonical_v3_sandbox WHERE condition_id = '' AND EXISTS (SELECT 1 FROM ${t.table_name} WHERE ...)\``
        : hasMarketId || hasTokenId
        ? `Test bridge: \`SELECT count() FROM pm_trades_canonical_v3_sandbox o LEFT JOIN ${t.table_name} t ON ... LEFT JOIN ctf_token_map m ON ...\``
        : 'Analyze schema to find join path'
    }\n\n`;

    report += `---\n\n`;
  }

  report += `## Summary

**Total Candidates:** ${tables.length} tables with condition_id

**Breakdown by Row Count:**
- 1M+ rows: ${tables.filter(t => Number(t.total_rows) >= 1000000).length} tables
- 100K-1M rows: ${tables.filter(t => Number(t.total_rows) >= 100000 && Number(t.total_rows) < 1000000).length} tables
- 10K-100K rows: ${tables.filter(t => Number(t.total_rows) >= 10000 && Number(t.total_rows) < 100000).length} tables
- Under 10K rows: ${tables.filter(t => Number(t.total_rows) < 10000).length} tables

**Recommended Investigation Order:**

1. **clob_fills** - Likely already used, verify
2. **erc1155_condition_map** - High potential bridge table
3. **gamma_markets** - Alternative market data source
4. **external_trades_raw** - External trade data
5. **market_event_mapping** - Event-based resolution data

**Key Insight:**

Most promising tables will have:
1. condition_id field (normalized to 64-char lowercase hex)
2. Join key to trades (tx_hash, wallet_address) OR bridge via token_id/market_id
3. High row count (100K+)
4. Recent data (2023-2025)

---

*Agent: C2 - Data Coverage Scout*
*Report Generated: ${new Date().toISOString()}*
`;

  // Write report
  const fs = require('fs');
  fs.writeFileSync('/tmp/TOP_CANDIDATE_MAPPING_SOURCES.md', report);

  console.log('✅ Report written to /tmp/TOP_CANDIDATE_MAPPING_SOURCES.md');
  console.log(`\nTop 5 candidates by row count:`);
  tables.slice(0, 5).forEach((t, i) => {
    console.log(`${i + 1}. ${t.table_name} - ${Number(t.total_rows).toLocaleString()} rows`);
  });
}

scanTopCandidates().catch(console.error);
