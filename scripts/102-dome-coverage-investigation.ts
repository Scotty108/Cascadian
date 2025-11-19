#!/usr/bin/env tsx
/**
 * Dome Coverage Investigation - Task 1-4
 *
 * Investigate why Dome shows $87K realized P&L vs our $2K
 * Treat this as a COVERAGE BUG, not a scope difference.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

interface DomeTrade {
  token_id: string;
  side: 'BUY' | 'SELL';
  market_slug: string;
  condition_id: string;
  shares: number;
  shares_normalized: number;
  price: number;
  tx_hash: string;
  title: string;
  timestamp: number;
  order_hash: string;
  user: string;
}

interface MarketStats {
  condition_id: string;
  title: string;
  dome_trades: number;
  dome_shares: number;
  dome_avg_price: number;
  dome_buy_trades: number;
  dome_sell_trades: number;
}

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

async function main() {
  console.log('🔍 Dome Coverage Investigation');
  console.log('='.repeat(80));
  console.log('');
  console.log('Mission: Treat $87K vs $2K as COVERAGE BUG, not scope difference');
  console.log('Dome reports REALIZED P&L only - these markets MUST be resolved');
  console.log('');

  // ========================================================================
  // TASK 1: Extract 14 Dome condition_ids with stats
  // ========================================================================

  console.log('Task 1: Extracting Dome condition_ids with stats...');
  console.log('-'.repeat(80));
  console.log('');

  const domeFilePath = resolve(process.cwd(), 'docs/archive/agent-os-oct-2025/product/Wallet_trade_details.md');
  const domeDataRaw = readFileSync(domeFilePath, 'utf-8');
  const firstJsonEnd = domeDataRaw.indexOf('}\n\n');
  const ordersJson = domeDataRaw.substring(0, firstJsonEnd + 1);
  const domeData = JSON.parse(ordersJson);
  const domeTrades: DomeTrade[] = domeData.orders;

  // Group by condition_id
  const marketGroups = new Map<string, DomeTrade[]>();
  for (const trade of domeTrades) {
    if (!marketGroups.has(trade.condition_id)) {
      marketGroups.set(trade.condition_id, []);
    }
    marketGroups.get(trade.condition_id)!.push(trade);
  }

  const marketStats: MarketStats[] = [];
  for (const [conditionId, trades] of marketGroups) {
    const buyTrades = trades.filter(t => t.side === 'BUY');
    const sellTrades = trades.filter(t => t.side === 'SELL');
    const totalShares = trades.reduce((sum, t) => sum + t.shares_normalized, 0);
    const avgPrice = trades.reduce((sum, t) => sum + t.price, 0) / trades.length;

    marketStats.push({
      condition_id: conditionId,
      title: trades[0].title,
      dome_trades: trades.length,
      dome_shares: totalShares,
      dome_avg_price: avgPrice,
      dome_buy_trades: buyTrades.length,
      dome_sell_trades: sellTrades.length
    });
  }

  console.log(`Found ${marketStats.length} unique markets in Dome data`);
  console.log('');
  console.table(marketStats.map(m => ({
    condition_id: m.condition_id.substring(0, 10) + '...',
    title: m.title.substring(0, 40) + '...',
    trades: m.dome_trades,
    shares: m.dome_shares.toFixed(2),
    avg_price: m.dome_avg_price.toFixed(3),
    buy: m.dome_buy_trades,
    sell: m.dome_sell_trades
  })));
  console.log('');

  // ========================================================================
  // TASK 2 & 3: Check pm_markets and pm_trades for each market
  // ========================================================================

  console.log('Task 2 & 3: Checking pm_markets and pm_trades coverage...');
  console.log('-'.repeat(80));
  console.log('');

  interface MarketAnalysis {
    condition_id: string;
    title: string;
    dome_stats: MarketStats;
    pm_markets_status: string;
    pm_markets_resolved_at: string;
    pm_markets_winning_outcome: string;
    pm_markets_market_type: string;
    eoa_trades: number;
    eoa_shares: number;
    proxy_trades: number;
    proxy_shares: number;
    gamma_resolved_status?: string;
    market_resolutions_final_status?: string;
    classification: 'A' | 'B' | 'C' | 'Unknown';
    notes: string;
  }

  const analysis: MarketAnalysis[] = [];

  for (const market of marketStats) {
    console.log(`Analyzing: ${market.title.substring(0, 60)}...`);
    console.log(`  Condition ID: ${market.condition_id}`);

    // Check pm_markets
    const pmMarketsQuery = await clickhouse.query({
      query: `
        SELECT
          status,
          resolved_at,
          winning_outcome_index,
          market_type
        FROM pm_markets
        WHERE condition_id = '${market.condition_id}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const pmMarkets = await pmMarketsQuery.json();
    const pmStatus = pmMarkets[0]?.status || 'NOT_FOUND';
    const pmResolvedAt = pmMarkets[0]?.resolved_at || 'NULL';
    const pmWinningOutcome = pmMarkets[0]?.winning_outcome_index?.toString() || 'NULL';
    const pmMarketType = pmMarkets[0]?.market_type || 'NULL';

    console.log(`  pm_markets: status=${pmStatus}, resolved_at=${pmResolvedAt}, winning=${pmWinningOutcome}`);

    // Check pm_trades for EOA
    const eoaTradesQuery = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          SUM(shares) as total_shares
        FROM pm_trades
        WHERE condition_id = '${market.condition_id}'
          AND wallet_address = '${XCN_EOA}'
      `,
      format: 'JSONEachRow'
    });

    const eoaTrades = await eoaTradesQuery.json();
    const eoaCount = parseInt(eoaTrades[0]?.trade_count || '0');
    const eoaShares = parseFloat(eoaTrades[0]?.total_shares || '0');

    // Check pm_trades for proxy
    const proxyTradesQuery = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          SUM(shares) as total_shares
        FROM pm_trades
        WHERE condition_id = '${market.condition_id}'
          AND wallet_address = '${XCN_PROXY}'
      `,
      format: 'JSONEachRow'
    });

    const proxyTrades = await proxyTradesQuery.json();
    const proxyCount = parseInt(proxyTrades[0]?.trade_count || '0');
    const proxyShares = parseFloat(proxyTrades[0]?.total_shares || '0');

    console.log(`  pm_trades: EOA=${eoaCount} trades (${eoaShares.toFixed(2)} shares), Proxy=${proxyCount} trades (${proxyShares.toFixed(2)} shares)`);

    // Check underlying sources if not resolved
    let gammaStatus = 'N/A';
    let resolutionsStatus = 'N/A';

    if (pmStatus !== 'resolved') {
      console.log(`  Checking underlying sources (market not resolved in pm_markets)...`);

      // Check gamma_resolved
      try {
        const gammaQuery = await clickhouse.query({
          query: `
            SELECT
              winning_outcome_index,
              resolved_at
            FROM gamma_resolved
            WHERE condition_id = '${market.condition_id}'
            LIMIT 1
          `,
          format: 'JSONEachRow'
        });

        const gamma = await gammaQuery.json();
        if (gamma.length > 0) {
          gammaStatus = `FOUND: winning=${gamma[0].winning_outcome_index}, resolved_at=${gamma[0].resolved_at}`;
        } else {
          gammaStatus = 'NOT_FOUND';
        }
      } catch (e) {
        gammaStatus = 'TABLE_NOT_EXISTS';
      }

      // Check market_resolutions_final
      try {
        const resolutionsQuery = await clickhouse.query({
          query: `
            SELECT
              winning_outcome_index,
              resolved_at
            FROM market_resolutions_final
            WHERE condition_id = '${market.condition_id}'
            LIMIT 1
          `,
          format: 'JSONEachRow'
        });

        const resolutions = await resolutionsQuery.json();
        if (resolutions.length > 0) {
          resolutionsStatus = `FOUND: winning=${resolutions[0].winning_outcome_index}, resolved_at=${resolutions[0].resolved_at}`;
        } else {
          resolutionsStatus = 'NOT_FOUND';
        }
      } catch (e) {
        resolutionsStatus = 'TABLE_NOT_EXISTS';
      }

      console.log(`  gamma_resolved: ${gammaStatus}`);
      console.log(`  market_resolutions_final: ${resolutionsStatus}`);
    }

    // Classify
    let classification: 'A' | 'B' | 'C' | 'Unknown' = 'Unknown';
    let notes = '';

    if (eoaCount > 0 || proxyCount > 0) {
      // Trades present
      if (pmStatus === 'resolved' && pmWinningOutcome !== 'NULL') {
        classification = 'A';
        notes = 'Trades present and resolved correctly';
      } else {
        classification = 'B';
        notes = `Trades present but pm_markets shows status=${pmStatus}, winning=${pmWinningOutcome}`;
      }
    } else {
      // Trades missing
      classification = 'C';
      notes = 'Trades missing from pm_trades entirely';
    }

    analysis.push({
      condition_id: market.condition_id,
      title: market.title,
      dome_stats: market,
      pm_markets_status: pmStatus,
      pm_markets_resolved_at: pmResolvedAt,
      pm_markets_winning_outcome: pmWinningOutcome,
      pm_markets_market_type: pmMarketType,
      eoa_trades: eoaCount,
      eoa_shares: eoaShares,
      proxy_trades: proxyCount,
      proxy_shares: proxyShares,
      gamma_resolved_status: gammaStatus,
      market_resolutions_final_status: resolutionsStatus,
      classification,
      notes
    });

    console.log(`  Classification: ${classification} - ${notes}`);
    console.log('');
  }

  // ========================================================================
  // TASK 4: Generate classification report
  // ========================================================================

  console.log('='.repeat(80));
  console.log('Task 4: Classification Report');
  console.log('='.repeat(80));
  console.log('');

  const categoryA = analysis.filter(a => a.classification === 'A');
  const categoryB = analysis.filter(a => a.classification === 'B');
  const categoryC = analysis.filter(a => a.classification === 'C');

  console.log(`Category A (Trades present & resolved correctly): ${categoryA.length}`);
  console.log(`Category B (Trades present but unresolved/incomplete): ${categoryB.length}`);
  console.log(`Category C (Trades missing entirely): ${categoryC.length}`);
  console.log('');

  // Generate detailed report
  const report = `# Dome Coverage Investigation Report

**Date:** ${new Date().toISOString().split('T')[0]}
**Dome P&L:** $87,030.51 (realized)
**ClickHouse P&L:** $2,089.18 (resolved binary CLOB only)
**Discrepancy:** $84,941.33

## Summary

Dome shows **14 markets** with **100 trades** for xcnstrategy (EOA: ${XCN_EOA}).
These markets contributed to $87K in **REALIZED** P&L, meaning they are RESOLVED markets.

Our investigation reveals:
- **Category A (Correct):** ${categoryA.length} markets (${(categoryA.length / 14 * 100).toFixed(1)}%)
- **Category B (Missing Resolution):** ${categoryB.length} markets (${(categoryB.length / 14 * 100).toFixed(1)}%)
- **Category C (Missing Trades):** ${categoryC.length} markets (${(categoryC.length / 14 * 100).toFixed(1)}%)

---

## Category A: Trades Present & Resolved Correctly ✅

${categoryA.length === 0 ? '*None*' : categoryA.map(m => `
### ${m.title}

- **Condition ID:** \`${m.condition_id}\`
- **pm_markets:** status=\`${m.pm_markets_status}\`, winning_outcome=\`${m.pm_markets_winning_outcome}\`
- **pm_trades:** EOA=${m.eoa_trades} trades, Proxy=${m.proxy_trades} trades
- **Dome:** ${m.dome_stats.dome_trades} trades, ${m.dome_stats.dome_shares.toFixed(2)} shares

**Status:** ✅ Working correctly
`).join('\n')}

---

## Category B: Trades Present But Unresolved/Incomplete ⚠️

${categoryB.length === 0 ? '*None*' : categoryB.map(m => `
### ${m.title}

- **Condition ID:** \`${m.condition_id}\`
- **pm_markets:** status=\`${m.pm_markets_status}\`, winning_outcome=\`${m.pm_markets_winning_outcome}\`, resolved_at=\`${m.pm_markets_resolved_at}\`
- **pm_trades:** EOA=${m.eoa_trades} trades (${m.eoa_shares.toFixed(2)} shares), Proxy=${m.proxy_trades} trades (${m.proxy_shares.toFixed(2)} shares)
- **Dome:** ${m.dome_stats.dome_trades} trades, ${m.dome_stats.dome_shares.toFixed(2)} shares
- **gamma_resolved:** ${m.gamma_resolved_status}
- **market_resolutions_final:** ${m.market_resolutions_final_status}

**Problem:** ${m.notes}

**Proposed Fix:**
${m.gamma_resolved_status?.includes('FOUND') ? '- Resolution data exists in gamma_resolved - rebuild pm_markets from this source' : ''}
${m.market_resolutions_final_status?.includes('FOUND') ? '- Resolution data exists in market_resolutions_final - rebuild pm_markets from this source' : ''}
${!m.gamma_resolved_status?.includes('FOUND') && !m.market_resolutions_final_status?.includes('FOUND') ? '- No resolution found in underlying sources - need to backfill from Polymarket API or blockchain events' : ''}
`).join('\n')}

---

## Category C: Trades Missing Entirely ❌

${categoryC.length === 0 ? '*None*' : categoryC.map(m => `
### ${m.title}

- **Condition ID:** \`${m.condition_id}\`
- **pm_markets:** status=\`${m.pm_markets_status}\`, market_type=\`${m.pm_markets_market_type}\`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** ${m.dome_stats.dome_trades} trades, ${m.dome_stats.dome_shares.toFixed(2)} shares (avg price: ${m.dome_stats.dome_avg_price.toFixed(3)})
- **gamma_resolved:** ${m.gamma_resolved_status}
- **market_resolutions_final:** ${m.market_resolutions_final_status}

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates
`).join('\n')}

---

## Next Steps

### For Category B Markets (${categoryB.length} markets)
1. Rebuild pm_markets from underlying sources (gamma_resolved, market_resolutions_final)
2. Verify winning_outcome_index is populated correctly
3. Re-run P&L calculation to include these resolved markets

### For Category C Markets (${categoryC.length} markets)
1. **Immediate:** Check CLOB backfill coverage for date range (Sept-Oct 2025 per Dome)
2. **Data Sources:** Investigate AMM trades, ERC-1155 transfers for these condition_ids
3. **Attribution:** Check if proxy wallet trades exist but aren't attributed to xcnstrategy
4. **API Backfill:** Run targeted Polymarket CLOB API backfill for these markets

### Expected P&L Impact
- Category A contributes: (calculate from trades)
- Category B potential: (calculate if we fix resolutions)
- Category C potential: $84,941 - A - B = remaining gap

---

**Generated:** ${new Date().toISOString()}
**Script:** scripts/102-dome-coverage-investigation.ts
`;

  // Write report
  const reportPath = resolve(process.cwd(), 'DOME_COVERAGE_INVESTIGATION_REPORT.md');
  writeFileSync(reportPath, report);

  console.log('');
  console.log('='.repeat(80));
  console.log('✅ Report Generated');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Report saved to: ${reportPath}`);
  console.log('');
  console.log('Summary:');
  console.log(`  Category A: ${categoryA.length} markets (working correctly)`);
  console.log(`  Category B: ${categoryB.length} markets (missing resolution data)`);
  console.log(`  Category C: ${categoryC.length} markets (missing trades)`);
  console.log('');
  console.log('This is a DATA COVERAGE BUG, not a scope difference.');
  console.log('Dome shows $87K realized - these markets ARE resolved somewhere.');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Investigation failed:', error);
  process.exit(1);
});
