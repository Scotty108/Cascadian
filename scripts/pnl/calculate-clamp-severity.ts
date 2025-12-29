#!/usr/bin/env tsx
/**
 * ============================================================================
 * CLAMP SEVERITY CALCULATOR
 * ============================================================================
 *
 * Measures the dollar impact of the "external inventory clamp" for each wallet.
 *
 * WHAT IT DOES:
 *   - Uses V20b dedupe + window function logic
 *   - For SELL rows only (token_delta < 0), compares:
 *     - raw_proceeds = sum(usdc_delta) for sells (unclamped)
 *     - effective_proceeds = sum(usdc_delta_eff) for sells (after clamp)
 *     - clamp_usdc_impact = raw_proceeds - effective_proceeds
 *     - clamp_pct = clamp_usdc_impact / raw_proceeds
 *
 * WHY IT MATTERS:
 *   - High clamp_pct means wallet is selling tokens they didn't acquire via CLOB
 *   - These are "phantom profits" from external inventory (airdrops, transfers, etc.)
 *   - Wallets with clamp_pct <= 2% are good candidates for V20b validation
 *
 * USAGE:
 *   tsx scripts/pnl/calculate-clamp-severity.ts
 *   tsx scripts/pnl/calculate-clamp-severity.ts --wallet 0x1234...
 *   tsx scripts/pnl/calculate-clamp-severity.ts --wallets data/candidate-wallets.json
 *
 * OUTPUT:
 *   data/wallet-clamp-severity.json
 *
 * ============================================================================
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import fs from 'fs/promises';
import path from 'path';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ClampSeverity {
  wallet_address: string;
  raw_sell_proceeds: number;
  effective_sell_proceeds: number;
  clamp_usdc_impact: number;
  clamp_pct: number;
  sell_trade_count: number;
  clamped_trade_count: number;
}

// -----------------------------------------------------------------------------
// Calculate Clamp Severity for a Single Wallet
// -----------------------------------------------------------------------------

async function calculateWalletClampSeverity(wallet: string): Promise<ClampSeverity> {
  // Use V20b dedupe + window function logic to calculate clamp severity
  // We need to compare raw usdc_delta vs clamped usdc_delta_eff for SELL trades only
  const query = `
    WITH
      -- Step 1: Wallet-scoped dedupe by event_id
      dedup AS (
        SELECT
          event_id,
          any(condition_id) AS cid,
          any(outcome_index) AS oidx,
          any(usdc_delta) AS usdc,
          any(token_delta) AS tokens,
          any(event_time) AS etime
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY event_id
      ),
      -- Step 2: Track position before each trade using window function
      ordered AS (
        SELECT
          cid,
          oidx,
          usdc,
          tokens,
          etime,
          event_id,
          coalesce(sum(tokens) OVER (
            PARTITION BY cid, oidx
            ORDER BY etime, event_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS pos_before
        FROM dedup
      ),
      -- Step 3: Calculate clamp for sells
      sell_analysis AS (
        SELECT
          usdc AS raw_usdc,
          tokens,
          pos_before,
          -- Clamp sells: can't sell more than we have
          if(tokens < 0,
            greatest(tokens, -greatest(pos_before, 0)),
            tokens
          ) AS token_delta_eff,
          -- Scale proceeds proportionally to clamped amount
          if(tokens < 0 AND tokens != 0,
            usdc * (greatest(tokens, -greatest(pos_before, 0)) / tokens),
            usdc
          ) AS usdc_delta_eff,
          -- Flag if this trade was clamped
          if(tokens < 0 AND greatest(tokens, -greatest(pos_before, 0)) != tokens, 1, 0) AS is_clamped
        FROM ordered
        WHERE tokens < 0  -- SELL trades only
      )
    SELECT
      sum(raw_usdc) AS raw_sell_proceeds,
      sum(usdc_delta_eff) AS effective_sell_proceeds,
      count() AS sell_trade_count,
      sum(is_clamped) AS clamped_trade_count
    FROM sell_analysis
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0 || !rows[0].sell_trade_count) {
    return {
      wallet_address: wallet.toLowerCase(),
      raw_sell_proceeds: 0,
      effective_sell_proceeds: 0,
      clamp_usdc_impact: 0,
      clamp_pct: 0,
      sell_trade_count: 0,
      clamped_trade_count: 0,
    };
  }

  const raw_sell_proceeds = Number(rows[0].raw_sell_proceeds) || 0;
  const effective_sell_proceeds = Number(rows[0].effective_sell_proceeds) || 0;
  const clamp_usdc_impact = raw_sell_proceeds - effective_sell_proceeds;
  const clamp_pct = raw_sell_proceeds !== 0
    ? Math.abs((clamp_usdc_impact / raw_sell_proceeds) * 100)
    : 0;

  return {
    wallet_address: wallet.toLowerCase(),
    raw_sell_proceeds,
    effective_sell_proceeds,
    clamp_usdc_impact,
    clamp_pct,
    sell_trade_count: Number(rows[0].sell_trade_count) || 0,
    clamped_trade_count: Number(rows[0].clamped_trade_count) || 0,
  };
}

// -----------------------------------------------------------------------------
// Load Wallets from File
// -----------------------------------------------------------------------------

async function loadWalletsFromFile(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  // Handle different file formats
  if (Array.isArray(data)) {
    // Array of wallet addresses
    if (typeof data[0] === 'string') {
      return data;
    }
    // Array of objects with wallet field
    if (data[0].wallet || data[0].wallet_address) {
      return data.map(item => item.wallet || item.wallet_address);
    }
  }

  // Object with classifications array (like wallet-classification-report.json)
  if (data.classifications && Array.isArray(data.classifications)) {
    return data.classifications.map((item: any) => item.wallet);
  }

  throw new Error(`Unsupported wallet file format: ${filePath}`);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  let wallets: string[] = [];

  // Parse arguments
  if (args.includes('--wallet')) {
    const idx = args.indexOf('--wallet');
    wallets = [args[idx + 1]];
  } else if (args.includes('--wallets')) {
    const idx = args.indexOf('--wallets');
    const filePath = args[idx + 1];
    wallets = await loadWalletsFromFile(filePath);
  } else {
    // Default: load from wallet-classification-report.json
    const defaultPath = path.join(
      process.cwd(),
      'data',
      'wallet-classification-report.json'
    );
    console.log(`Loading wallets from: ${defaultPath}`);
    wallets = await loadWalletsFromFile(defaultPath);
  }

  console.log(`\n📊 Calculating clamp severity for ${wallets.length} wallets...\n`);

  const results: ClampSeverity[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const severity = await calculateWalletClampSeverity(wallet);
    results.push(severity);

    const symbol = severity.clamp_pct <= 2 ? '✅' : severity.clamp_pct <= 5 ? '⚠️' : '❌';
    console.log(
      `${symbol} [${i + 1}/${wallets.length}] ${wallet.slice(0, 10)}... ` +
      `clamp: ${severity.clamp_pct.toFixed(2)}% ` +
      `(${severity.clamped_trade_count}/${severity.sell_trade_count} sells clamped, ` +
      `$${severity.clamp_usdc_impact.toFixed(2)} impact)`
    );
  }

  // Sort by clamp_pct ascending (best candidates first)
  results.sort((a, b) => a.clamp_pct - b.clamp_pct);

  // Filter to wallets with clamp_pct <= 2%
  const goodCandidates = results.filter(r => r.clamp_pct <= 2);

  // Write full results
  const outputPath = path.join(process.cwd(), 'data', 'wallet-clamp-severity.json');
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));

  // Write filtered candidates
  const candidatesPath = path.join(process.cwd(), 'data', 'candidate-wallets.json');
  await fs.writeFile(
    candidatesPath,
    JSON.stringify(goodCandidates.map(r => r.wallet_address), null, 2)
  );

  console.log(`\n✅ Results written to: ${outputPath}`);
  console.log(`✅ Candidates (≤2% clamp) written to: ${candidatesPath}`);
  console.log(`\n📈 Summary:`);
  console.log(`   Total wallets analyzed: ${results.length}`);
  console.log(`   Good candidates (≤2% clamp): ${goodCandidates.length}`);
  console.log(`   Warning range (2-5% clamp): ${results.filter(r => r.clamp_pct > 2 && r.clamp_pct <= 5).length}`);
  console.log(`   High clamp (>5%): ${results.filter(r => r.clamp_pct > 5).length}`);

  // Show top 10 candidates
  console.log(`\n🏆 Top 10 Candidates (lowest clamp %):`);
  goodCandidates.slice(0, 10).forEach((r, i) => {
    console.log(
      `   ${i + 1}. ${r.wallet_address.slice(0, 10)}... ` +
      `clamp: ${r.clamp_pct.toFixed(3)}% ` +
      `($${r.clamp_usdc_impact.toFixed(2)} impact, ` +
      `${r.clamped_trade_count}/${r.sell_trade_count} sells clamped)`
    );
  });
}

main().catch(console.error);
