/**
 * Build Candidate Pool for PnL Testing
 *
 * Identifies wallets with high CLOB mapping quality for V17 PnL validation.
 *
 * Criteria:
 * - mapped_clob_rows >= 2000 (sufficient activity)
 * - mapping_pct >= 99.5% (high data quality)
 *
 * Output: data/candidate-wallets.json
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { getClickHouseClient } from '../../lib/clickhouse/client';

// Load environment variables
dotenv.config({ path: '.env.local' });

interface CandidateWallet {
  wallet_address: string;
  clob_rows: number;
  mapped_clob_rows: number;
  mapping_pct: number;
  markets: number;
}

async function buildCandidatePool() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               CLOB-ELIGIBLE WALLET CANDIDATE POOL BUILDER                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const client = getClickHouseClient();

  // Query for high-quality CLOB wallets
  const query = `
    SELECT
      wallet_address,
      count() AS clob_rows,
      countIf(condition_id IS NOT NULL AND condition_id != '') AS mapped_clob_rows,
      uniqExact(condition_id) AS markets
    FROM pm_unified_ledger_v9_clob_tbl
    WHERE source_type = 'CLOB'
    GROUP BY wallet_address
    HAVING mapped_clob_rows >= 2000
       AND mapped_clob_rows / clob_rows >= 0.995
    ORDER BY mapped_clob_rows DESC
    LIMIT 500
  `;

  console.log('Querying ClickHouse for CLOB-eligible wallets...\n');
  console.log('Criteria:');
  console.log('  • mapped_clob_rows >= 2000');
  console.log('  • mapping_pct >= 99.5%\n');

  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow',
    });

    const rows = await result.json() as Array<{
      wallet_address: string;
      clob_rows: string;
      mapped_clob_rows: string;
      markets: string;
    }>;

    if (rows.length === 0) {
      console.log('⚠ No wallets found matching criteria');
      return;
    }

    // Transform and enrich data
    const candidates: CandidateWallet[] = rows.map(row => {
      const clob_rows = parseInt(row.clob_rows);
      const mapped_clob_rows = parseInt(row.mapped_clob_rows);
      const mapping_pct = (mapped_clob_rows / clob_rows) * 100;

      return {
        wallet_address: row.wallet_address,
        clob_rows,
        mapped_clob_rows,
        mapping_pct: Math.round(mapping_pct * 100) / 100, // Round to 2 decimals
        markets: parseInt(row.markets),
      };
    });

    // Display summary
    console.log('┌────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ QUERY RESULTS                                                              │');
    console.log('├────────────────────────────────────────────────────────────────────────────┤');
    console.log(`│ Total wallets found: ${String(candidates.length).padStart(4)}                                                   │`);
    console.log('└────────────────────────────────────────────────────────────────────────────┘\n');

    // Show top 20 candidates
    console.log('┌────┬──────────────┬────────────┬────────────┬──────────┬─────────┐');
    console.log('│ #  │ Wallet       │ CLOB Rows  │ Mapped     │ Map %    │ Markets │');
    console.log('├────┼──────────────┼────────────┼────────────┼──────────┼─────────┤');

    candidates.slice(0, 20).forEach((c, idx) => {
      const shortAddr = c.wallet_address.substring(0, 12);
      const clobStr = String(c.clob_rows).padStart(10);
      const mappedStr = String(c.mapped_clob_rows).padStart(10);
      const pctStr = c.mapping_pct.toFixed(2).padStart(7);
      const marketsStr = String(c.markets).padStart(7);

      console.log(
        `│ ${String(idx + 1).padStart(2)} │ ${shortAddr} │ ${clobStr} │ ${mappedStr} │ ${pctStr}% │ ${marketsStr} │`
      );
    });

    console.log('└────┴──────────────┴────────────┴────────────┴──────────┴─────────┘');

    if (candidates.length > 20) {
      console.log(`\n... and ${candidates.length - 20} more wallets\n`);
    }

    // Statistics
    const avgClob = Math.round(candidates.reduce((sum, c) => sum + c.clob_rows, 0) / candidates.length);
    const avgMapped = Math.round(candidates.reduce((sum, c) => sum + c.mapped_clob_rows, 0) / candidates.length);
    const avgPct = candidates.reduce((sum, c) => sum + c.mapping_pct, 0) / candidates.length;
    const avgMarkets = Math.round(candidates.reduce((sum, c) => sum + c.markets, 0) / candidates.length);

    console.log('┌────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ STATISTICS                                                                 │');
    console.log('├────────────────────────────────────────────────────────────────────────────┤');
    console.log(`│ Average CLOB rows:    ${String(avgClob).padStart(10)}                                        │`);
    console.log(`│ Average mapped rows:  ${String(avgMapped).padStart(10)}                                        │`);
    console.log(`│ Average mapping %:    ${avgPct.toFixed(2).padStart(10)}%                                       │`);
    console.log(`│ Average markets:      ${String(avgMarkets).padStart(10)}                                        │`);
    console.log('└────────────────────────────────────────────────────────────────────────────┘\n');

    // Write to versioned file (prevent overwrites)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const versionedPath = path.join(process.cwd(), 'data', `candidate-wallets.${timestamp}.json`);
    const latestPath = path.join(process.cwd(), 'data', 'candidate-wallets.json');
    const outputDir = path.dirname(versionedPath);

    // Ensure data directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write versioned file
    fs.writeFileSync(versionedPath, JSON.stringify(candidates, null, 2));
    console.log(`✅ Wrote ${candidates.length} candidate wallets to: ${versionedPath}`);

    // Also write to stable "latest" path for convenience
    fs.writeFileSync(latestPath, JSON.stringify(candidates, null, 2));
    console.log(`✅ Updated latest pointer: ${latestPath}\n`);

    // Distribution analysis
    const by_clob = {
      '2K-5K': candidates.filter(c => c.clob_rows >= 2000 && c.clob_rows < 5000).length,
      '5K-10K': candidates.filter(c => c.clob_rows >= 5000 && c.clob_rows < 10000).length,
      '10K-20K': candidates.filter(c => c.clob_rows >= 10000 && c.clob_rows < 20000).length,
      '20K-50K': candidates.filter(c => c.clob_rows >= 20000 && c.clob_rows < 50000).length,
      '50K+': candidates.filter(c => c.clob_rows >= 50000).length,
    };

    const by_markets = {
      '0-50': candidates.filter(c => c.markets < 50).length,
      '50-100': candidates.filter(c => c.markets >= 50 && c.markets < 100).length,
      '100-200': candidates.filter(c => c.markets >= 100 && c.markets < 200).length,
      '200-500': candidates.filter(c => c.markets >= 200 && c.markets < 500).length,
      '500+': candidates.filter(c => c.markets >= 500).length,
    };

    console.log('┌────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ DISTRIBUTION ANALYSIS                                                      │');
    console.log('├────────────────────────────────────────────────────────────────────────────┤');
    console.log('│ By CLOB Activity:                                                          │');
    Object.entries(by_clob).forEach(([range, count]) => {
      const pct = ((count / candidates.length) * 100).toFixed(1);
      console.log(`│   ${range.padEnd(10)}: ${String(count).padStart(4)} wallets (${pct.padStart(5)}%)                              │`);
    });
    console.log('│                                                                            │');
    console.log('│ By Market Diversity:                                                       │');
    Object.entries(by_markets).forEach(([range, count]) => {
      const pct = ((count / candidates.length) * 100).toFixed(1);
      console.log(`│   ${range.padEnd(10)}: ${String(count).padStart(4)} wallets (${pct.padStart(5)}%)                              │`);
    });
    console.log('└────────────────────────────────────────────────────────────────────────────┘\n');

    console.log('╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                       ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
    console.log(`  ✓ Identified ${candidates.length} high-quality CLOB wallets`);
    console.log('  ✓ All wallets have >= 2000 mapped CLOB rows');
    console.log('  ✓ All wallets have >= 99.5% mapping quality');
    console.log(`  ✓ Data written to: data/candidate-wallets.json\n`);

  } catch (error) {
    console.error('❌ Error querying ClickHouse:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
    }
    process.exit(1);
  }
}

// Run the script
buildCandidatePool()
  .then(() => {
    console.log('Done!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
