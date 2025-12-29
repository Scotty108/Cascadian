/**
 * Find Wallets with Low External Sell Percentage
 *
 * Identifies wallets with low external_sell_pct for V21 validation.
 * These are "CLOB-pure" wallets where sells come from CLOB-acquired positions.
 *
 * Usage:
 *   npx tsx scripts/pnl/find-low-external-wallets.ts
 *   npx tsx scripts/pnl/find-low-external-wallets.ts --limit 100
 *   npx tsx scripts/pnl/find-low-external-wallets.ts --maxExternalPct 0.5 --startIndex 50
 *   npx tsx scripts/pnl/find-low-external-wallets.ts --fromEnd   # Process from end (smallest wallets)
 *
 * CLI Args:
 *   --limit N           Process N wallets (default: 50)
 *   --maxExternalPct X  Filter for ext_sell <= X% (default: 0.5)
 *   --startIndex K      Start at index K in candidate pool (default: 0)
 *   --fromEnd           Process from end of list (smallest wallets first)
 *   --minMapped X       Minimum mapped_ratio % (default: 99.9)
 *
 * Output:
 *   - data/low-external-wallets.<timestamp>.json (versioned)
 *   - data/low-external-wallets.json (stable pointer)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV21PnL } from '../../lib/pnl/v21SyntheticEngine';
import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------------
// CLI Args Parser
// -----------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 50;
  let maxExternalPct = 0.5;
  let startIndex = 0;
  let fromEnd = false;
  let minMapped = 99.9;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
    }
    if (args[i] === '--maxExternalPct' && args[i + 1]) {
      maxExternalPct = parseFloat(args[i + 1]);
    }
    if (args[i] === '--startIndex' && args[i + 1]) {
      startIndex = parseInt(args[i + 1]);
    }
    if (args[i] === '--fromEnd') {
      fromEnd = true;
    }
    if (args[i] === '--minMapped' && args[i + 1]) {
      minMapped = parseFloat(args[i + 1]);
    }
  }

  return { limit, maxExternalPct, startIndex, fromEnd, minMapped };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

const candidatesPath = path.join(process.cwd(), 'data', 'candidate-wallets.json');

async function main() {
  const config = parseArgs();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               FIND LOW EXTERNAL SELL WALLETS                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  --limit:          ${config.limit}`);
  console.log(`  --maxExternalPct: ${config.maxExternalPct}%`);
  console.log(`  --startIndex:     ${config.startIndex}`);
  console.log(`  --fromEnd:        ${config.fromEnd}`);
  console.log(`  --minMapped:      ${config.minMapped}%`);
  console.log('');

  // Load candidates
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8')) as any[];

  // Select slice based on args
  let toTest: any[];
  if (config.fromEnd) {
    // Process from end (smallest wallets)
    const endSlice = candidates.slice(-config.limit - config.startIndex);
    toTest = endSlice.slice(0, config.limit);
  } else {
    // Process from start (largest wallets)
    toTest = candidates.slice(config.startIndex, config.startIndex + config.limit);
  }

  console.log(`Loaded ${candidates.length} candidates, testing ${toTest.length} (indices ${config.startIndex}-${config.startIndex + toTest.length - 1})\n`);

  console.log(`Testing ${toTest.length} wallets from candidate pool...\n`);

  const results: any[] = [];

  for (let i = 0; i < toTest.length; i++) {
    const c = toTest[i];
    try {
      const result = await calculateV21PnL(c.wallet_address);
      results.push({
        wallet: c.wallet_address,
        net: result.net,
        gain: result.gain,
        loss: result.loss,
        external_sell_pct: result.external_sell_pct,
        mapped_ratio: result.mapped_ratio,
        is_eligible: result.is_eligible,
        clob_rows: result.clob_rows,
        markets: result.markets,
      });

      const status = result.external_sell_pct <= 0.5 ? '✅' : result.external_sell_pct <= 2 ? '⚠️' : '❌';
      const netStr = result.net >= 0
        ? `+$${result.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : `-$${Math.abs(result.net).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

      console.log(
        `${status} [${i + 1}/${toTest.length}] ${c.wallet_address.slice(0, 12)}... | ` +
        `ext: ${result.external_sell_pct.toFixed(2)}% | net: ${netStr.padStart(12)}`
      );
    } catch (e: any) {
      console.log(`❌ [${i + 1}/${toTest.length}] ${c.wallet_address.slice(0, 12)}... | ERROR: ${e.message.slice(0, 40)}`);
    }
  }

  // Sort by external_sell_pct
  results.sort((a, b) => a.external_sell_pct - b.external_sell_pct);

  // Filter based on config
  const eligible = results.filter(r =>
    r.external_sell_pct <= config.maxExternalPct &&
    r.mapped_ratio >= config.minMapped
  );
  const warning = results.filter(r =>
    r.external_sell_pct > config.maxExternalPct &&
    r.external_sell_pct <= 2
  );
  const high = results.filter(r => r.external_sell_pct > 2);

  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              SUMMARY                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`  Eligible (≤${config.maxExternalPct}% ext, ≥${config.minMapped}% mapped):  ${eligible.length}`);
  console.log(`  Warning (${config.maxExternalPct}-2%):  ${warning.length}`);
  console.log(`  High (>2%):        ${high.length}`);

  if (eligible.length > 0) {
    console.log('\n🏆 Top 10 CLOB-Pure Wallets (lowest external_sell_pct):');
    console.log('┌────┬──────────────────────────────────────────────┬───────────────┬────────────────┐');
    console.log('│ #  │ Wallet                                       │ Ext Sell Pct  │ Net PnL        │');
    console.log('├────┼──────────────────────────────────────────────┼───────────────┼────────────────┤');

    eligible.slice(0, 10).forEach((r, i) => {
      const netStr = r.net >= 0
        ? `+$${r.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : `-$${Math.abs(r.net).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      console.log(
        `│ ${String(i + 1).padStart(2)} │ ${r.wallet.padEnd(44)} │ ${(r.external_sell_pct.toFixed(3) + '%').padStart(13)} │ ${netStr.padStart(14)} │`
      );
    });

    console.log('└────┴──────────────────────────────────────────────┴───────────────┴────────────────┘');
  } else {
    console.log('\n⚠️  No wallets found matching criteria. Try:');
    console.log('    - Increasing --maxExternalPct (e.g., --maxExternalPct 1.0)');
    console.log('    - Decreasing --minMapped (e.g., --minMapped 99.0)');
    console.log('    - Processing more wallets (--limit 100)');
  }

  // Write results (versioned + stable pointer)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const versionedPath = path.join(process.cwd(), 'data', `low-external-wallets.${timestamp}.json`);
  const stablePath = path.join(process.cwd(), 'data', 'low-external-wallets.json');

  const output = {
    generated_at: new Date().toISOString(),
    config,
    summary: {
      total_tested: results.length,
      eligible: eligible.length,
      warning: warning.length,
      high_external: high.length,
    },
    all_results: results,
    eligible_wallets: eligible,
  };

  fs.writeFileSync(versionedPath, JSON.stringify(output, null, 2));
  fs.writeFileSync(stablePath, JSON.stringify(output, null, 2));

  console.log(`\n✅ Versioned output: ${versionedPath}`);
  console.log(`✅ Stable pointer:   ${stablePath}`);

  // Show next steps
  if (eligible.length < 50) {
    const remaining = 50 - eligible.length;
    const nextStartIndex = config.startIndex + config.limit;
    console.log(`\n📋 Need ${remaining} more eligible wallets. Run:`);
    console.log(`   npx tsx scripts/pnl/find-low-external-wallets.ts --startIndex ${nextStartIndex} --limit ${config.limit}${config.fromEnd ? ' --fromEnd' : ''}`);
  }
}

main().catch(console.error);
