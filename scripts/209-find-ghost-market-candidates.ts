#!/usr/bin/env tsx
/**
 * Find Ghost/AMM Market Candidates
 *
 * Scans internal tables to find markets that likely need external ingestion:
 * - enable_order_book = false (AMM-only markets)
 * - Markets with zero CLOB trades
 * - Resolved markets missing from pm_trades
 *
 * Output: C2_GHOST_MARKET_CANDIDATES.md
 */
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

// Known ghost markets from previous discovery
const KNOWN_GHOST_MARKETS = [
  'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
  'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
  '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
  'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7',
  'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44'
];

interface GhostCandidate {
  condition_id: string;
  question: string;
  flags: string[];
  clob_trade_count: number;
  has_resolution: boolean;
}

async function main() {
  console.log('═'.repeat(80));
  console.log('Ghost/AMM Market Candidate Discovery');
  console.log('═'.repeat(80));
  console.log('');

  const candidates: GhostCandidate[] = [];

  // Step 1: Find all resolved markets
  console.log('Step 1: Finding resolved markets...');

  const resolvedMarketsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT
        g.cid as condition_id,
        m.question
      FROM gamma_resolved g
      INNER JOIN pm_markets m ON g.cid = m.condition_id
      LIMIT 10000
    `,
    format: 'JSONEachRow'
  });

  const resolvedMarkets: any[] = await resolvedMarketsResult.json();
  console.log(`  Found ${resolvedMarkets.length} resolved markets`);
  console.log('');

  // Step 2: For each resolved market, check if it has CLOB trades
  console.log('Step 2: Checking CLOB trade counts...');

  const clobTradeCountsResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        COUNT(*) as trade_count
      FROM clob_fills
      GROUP BY condition_id
    `,
    format: 'JSONEachRow'
  });

  const clobTradeCounts: any[] = await clobTradeCountsResult.json();
  const clobCountMap = new Map(clobTradeCounts.map(c => [c.condition_id, c.trade_count]));
  console.log(`  Found ${clobTradeCounts.length} markets with CLOB trades`);
  console.log('');

  //Find zero-CLOB resolved markets
  resolvedMarkets.forEach(market => {
    const clobCount = clobCountMap.get(market.condition_id) || 0;
    if (clobCount === 0) {
      candidates.push({
        condition_id: market.condition_id,
        question: market.question || 'Unknown',
        flags: ['zero_clob', 'resolved'],
        clob_trade_count: 0,
        has_resolution: true
      });
    }
  });

  console.log(`  Found ${candidates.length} resolved markets with zero CLOB trades`);
  console.log('');

  // Step 3: Check if known ghost markets are in the list
  console.log('Step 3: Validating known ghost markets...');

  const knownGhostFlags: string[] = [];
  KNOWN_GHOST_MARKETS.forEach(cid => {
    const found = candidates.find(c => c.condition_id === cid);
    if (found) {
      found.flags.push('known_ghost');
      knownGhostFlags.push(`✅ ${cid.substring(0, 16)}...`);
    } else {
      knownGhostFlags.push(`⚠️  ${cid.substring(0, 16)}... (not in zero_clob list, checking manually...)`);
      // Add manually
      candidates.push({
        condition_id: cid,
        question: 'Known ghost market (from previous discovery)',
        flags: ['known_ghost', 'manual_add'],
        clob_trade_count: 0,
        has_resolution: true
      });
    }
  });

  knownGhostFlags.forEach(flag => console.log(`  ${flag}`));
  console.log('');

  // Step 4: Try to find gamma_markets with enable_order_book flags
  console.log('Step 4: Checking gamma_markets for AMM flags...');

  try {
    const gammaFlagsResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          question,
          enable_order_book
        FROM gamma_markets
        WHERE enable_order_book = 0 OR enable_order_book = false
        LIMIT 1000
      `,
      format: 'JSONEachRow'
    });

    const gammaFlagMarkets: any[] = await gammaFlagsResult.json();
    console.log(`  Found ${gammaFlagMarkets.length} markets with enable_order_book = false`);

    gammaFlagMarkets.forEach(market => {
      const existing = candidates.find(c => c.condition_id === market.condition_id);
      if (existing) {
        existing.flags.push('amm_flag');
      } else {
        candidates.push({
          condition_id: market.condition_id,
          question: market.question || 'Unknown',
          flags: ['amm_flag'],
          clob_trade_count: 0,
          has_resolution: false
        });
      }
    });
  } catch (error: any) {
    console.log(`  ⚠️  Could not query gamma_markets.enable_order_book: ${error.message}`);
    console.log(`  (This field may not exist or may have different name)`);
  }
  console.log('');

  // Step 5: Generate markdown report
  console.log('═'.repeat(80));
  console.log('CANDIDATE SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Total ghost/AMM candidates found: ${candidates.length}`);
  console.log('');

  const byFlags: { [key: string]: number } = {};
  candidates.forEach(c => {
    c.flags.forEach(flag => {
      byFlags[flag] = (byFlags[flag] || 0) + 1;
    });
  });

  console.log('Breakdown by flag:');
  Object.entries(byFlags).forEach(([flag, count]) => {
    console.log(`  ${flag}: ${count}`);
  });
  console.log('');

  // Generate markdown
  const markdown = `# Ghost/AMM Market Candidates

**Generated:** ${new Date().toISOString()}
**Agent:** C2 - External Data Ingestion

---

## Executive Summary

**Total candidates:** ${candidates.length}

**Breakdown by flag:**
${Object.entries(byFlags).map(([flag, count]) => `- **${flag}:** ${count}`).join('\n')}

---

## Known Ghost Markets (6 total)

These markets were discovered via Dome comparison and confirmed to have zero CLOB coverage:

${candidates.filter(c => c.flags.includes('known_ghost')).map(c => `
### ${c.question}
- **Condition ID:** \`${c.condition_id}\`
- **Flags:** ${c.flags.join(', ')}
- **CLOB Trades:** ${c.clob_trade_count}
- **Resolved:** ${c.has_resolution ? '✅ Yes' : '❌ No'}
`).join('\n')}

---

## Additional Candidates (Zero CLOB + Resolved)

Markets with zero CLOB trades but marked as resolved:

${candidates.filter(c => c.flags.includes('zero_clob') && !c.flags.includes('known_ghost')).slice(0, 50).map(c => `
### ${c.question}
- **Condition ID:** \`${c.condition_id}\`
- **Flags:** ${c.flags.join(', ')}
- **CLOB Trades:** ${c.clob_trade_count}
- **Resolved:** ${c.has_resolution ? '✅ Yes' : '❌ No'}
`).join('\n')}

${candidates.filter(c => c.flags.includes('zero_clob') && !c.flags.includes('known_ghost')).length > 50 ? `\n*... and ${candidates.filter(c => c.flags.includes('zero_clob') && !c.flags.includes('known_ghost')).length - 50} more markets*\n` : ''}

---

## Next Steps

1. **Discover wallets** for these markets using internal tables (clob_fills, erc1155_transfers)
2. **Query Data-API** by wallet to fetch external/AMM trades
3. **Ingest into external_trades_raw** with proper deduplication

---

**— C2 (Operator Mode)**
`;

  writeFileSync('C2_GHOST_MARKET_CANDIDATES.md', markdown);
  console.log('✅ Report written to: C2_GHOST_MARKET_CANDIDATES.md');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
