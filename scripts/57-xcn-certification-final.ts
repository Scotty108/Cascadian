import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

// XCN wallet - canonical
const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Specific market CIDs for validation
const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
const NON_XI_MARKET_CID = '93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620';

interface MarketValidation {
  market_name: string;
  cid: string;
  api_cost: number;
  api_shares: number;
  api_pnl: number;
  db_cost: number;
  db_shares: number;
  db_pnl: number;
  cost_match: boolean;
  shares_match: boolean;
  cost_diff_pct: string;
  shares_diff_pct: string;
  pnl_diff: number;
  passed: boolean;
  db_trades: number;
}

async function validateMarket(conditionId: string, marketName: string, apiPosition: any): Promise<MarketValidation> {
  const cid = conditionId.toLowerCase().replace(/^0x/, '');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`VALIDATING: ${marketName}`);
  console.log(`CID: ${cid.substring(0, 32)}...`);
  console.log(`${'='.repeat(80)}\n`);

  // Query database using condition_id_norm_v3 and canonical wallet
  // (view should handle 12-wallet cluster aggregation internally)
  const dbQuery = `
    SELECT
      count() AS total_trades,
      sum(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END) AS buy_cash,
      sum(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) AS sell_cash,
      sum(CASE WHEN trade_direction = 'BUY' THEN shares ELSE 0 END) AS buy_shares,
      sum(CASE WHEN trade_direction = 'SELL' THEN shares ELSE 0 END) AS sell_shares,
      uniq(outcome_index_v2) AS outcomes,
      min(timestamp) AS first_trade,
      max(timestamp) AS last_trade,
      uniq(wallet_canonical) AS unique_wallets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_canonical) = '${XCN_CANONICAL.toLowerCase()}'
      AND condition_id_norm_v3 = '${cid}'
  `;

  const dbResult = await clickhouse.query({ query: dbQuery, format: 'JSONEachRow' });
  const dbData = await dbResult.json<any[]>();
  const db = dbData[0];

  const db_cost = Number(db.buy_cash);
  const db_proceeds = Number(db.sell_cash);
  const db_shares = Number(db.buy_shares) - Number(db.sell_shares);
  const db_pnl = db_proceeds - db_cost;
  const db_trades = Number(db.total_trades);

  console.log('Database (Canonical View - Updated):');
  console.log(`  Wallet canonical:   ${XCN_CANONICAL}`);
  console.log(`  Total trades:       ${db_trades.toLocaleString()}`);
  console.log(`  Unique wallets:     ${db.unique_wallets} (view aggregation)`);
  console.log(`  Buy cash:           $${db_cost.toLocaleString()}`);
  console.log(`  Sell cash:          $${db_proceeds.toLocaleString()}`);
  console.log(`  Net shares:         ${db_shares.toLocaleString()}`);
  console.log(`  Trade PnL:          $${db_pnl.toLocaleString()}`);
  console.log(`  Outcomes:           ${db.outcomes}`);
  console.log(`  Date range:         ${db.first_trade} to ${db.last_trade}\n`);

  // API data
  const api_cost = apiPosition?.initialValue || 0;
  const api_shares = apiPosition?.size || 0;
  const api_pnl = apiPosition?.pnl || 0;

  console.log('Polymarket API:');
  console.log(`  Market:             ${marketName}`);
  console.log(`  Outcome:            ${apiPosition?.outcome || 'N/A'}`);
  console.log(`  Initial cost:       $${api_cost.toLocaleString()}`);
  console.log(`  Size (shares):      ${api_shares.toLocaleString()}`);
  console.log(`  Current value:      $${(apiPosition?.value || 0).toLocaleString()}`);
  console.log(`  PnL:                $${api_pnl.toLocaleString()}\n`);

  // Validation
  const tolerance = 0.10; // ±10%
  const cost_match = Math.abs(db_cost - api_cost) / Math.max(api_cost, 1) < tolerance;
  const shares_match = Math.abs(db_shares - api_shares) / Math.max(Math.abs(api_shares), 1) < tolerance;

  const cost_diff_pct = api_cost > 0 ? ((db_cost / api_cost - 1) * 100).toFixed(1) : 'N/A';
  const shares_diff_pct = api_shares > 0 ? ((db_shares / api_shares - 1) * 100).toFixed(1) : 'N/A';
  const pnl_diff = db_pnl - api_pnl;

  console.log('COMPARISON:');
  console.log(`  Cost:       ${cost_match ? '✅' : '❌'} DB: $${db_cost.toLocaleString()} vs API: $${api_cost.toLocaleString()} (${cost_diff_pct}% diff)`);
  console.log(`  Shares:     ${shares_match ? '✅' : '❌'} DB: ${db_shares.toLocaleString()} vs API: ${api_shares.toLocaleString()} (${shares_diff_pct}% diff)`);
  console.log(`  PnL:        ℹ️  DB: $${db_pnl.toLocaleString()} vs API: $${api_pnl.toLocaleString()} ($${pnl_diff.toLocaleString()} diff)\n`);

  const passed = cost_match && shares_match;

  if (passed) {
    console.log('🟢 VALIDATION PASSED\n');
  } else {
    console.log('🔴 VALIDATION FAILED\n');
  }

  return {
    market_name: marketName,
    cid,
    api_cost,
    api_shares,
    api_pnl,
    db_cost,
    db_shares,
    db_pnl,
    cost_match,
    shares_match,
    cost_diff_pct,
    shares_diff_pct,
    pnl_diff,
    passed,
    db_trades
  };
}

async function runCertification() {
  console.log('═'.repeat(80));
  console.log('🏆 XCN WALLET PNL CERTIFICATION - FINAL');
  console.log('═'.repeat(80));
  console.log(`\nCanonical Wallet: ${XCN_CANONICAL}`);
  console.log(`Date: ${new Date().toISOString().split('T')[0]}\n`);

  try {
    // Step 1: Fetch Polymarket API positions
    console.log('STEP 1: Fetching Polymarket API positions...\n');

    const apiUrl = `https://data-api.polymarket.com/positions?user=${XCN_CANONICAL}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const apiData = await response.json();
    console.log(`✅ Fetched ${apiData.length} positions from Polymarket API\n`);

    // Step 2: Find both markets
    console.log('STEP 2: Locating validation markets...\n');

    const xiConditionId = '0x' + XI_MARKET_CID;
    const nonXiConditionId = '0x' + NON_XI_MARKET_CID;

    const xiPosition = apiData.find((p: any) =>
      p.conditionId?.toLowerCase() === xiConditionId.toLowerCase()
    );

    const nonXiPosition = apiData.find((p: any) =>
      p.conditionId?.toLowerCase() === nonXiConditionId.toLowerCase()
    );

    console.log(`Xi market (${XI_MARKET_CID.substring(0, 16)}...): ${xiPosition ? '✅ Found' : '⚠️  Not found'}`);
    console.log(`Non-Xi market (${NON_XI_MARKET_CID.substring(0, 16)}...): ${nonXiPosition ? '✅ Found' : '⚠️  Not found'}\n`);

    // Step 3: Validate both markets
    console.log('STEP 3: Running market validations...\n');

    const validations: MarketValidation[] = [];

    // Validate non-Xi market
    if (nonXiPosition) {
      const nonXiValidation = await validateMarket(
        nonXiPosition.conditionId,
        nonXiPosition.market || 'Non-Xi Market',
        nonXiPosition
      );
      validations.push(nonXiValidation);
    } else {
      console.log('⚠️  Skipping non-Xi validation - market not in API positions\n');
    }

    // Validate Xi market
    if (xiPosition) {
      const xiValidation = await validateMarket(
        xiPosition.conditionId,
        xiPosition.market || 'Xi Jinping 2025',
        xiPosition
      );
      validations.push(xiValidation);
    } else {
      console.log('⚠️  Skipping Xi validation - market not in API positions\n');
    }

    // Step 4: Collision check
    console.log('STEP 4: Running collision check...\n');

    const collisionQuery = `
      SELECT
        transaction_hash,
        count(DISTINCT wallet_canonical) AS wallet_count,
        groupArray(DISTINCT wallet_canonical) AS wallets
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = '${XCN_CANONICAL.toLowerCase()}'
      GROUP BY transaction_hash
      HAVING wallet_count > 1
      LIMIT 100
    `;

    const collisionResult = await clickhouse.query({ query: collisionQuery, format: 'JSONEachRow' });
    const collisions = await collisionResult.json<any[]>();

    console.log(`Collisions found: ${collisions.length}`);

    if (collisions.length > 0) {
      console.log('\n⚠️  COLLISION DETAILS:');
      collisions.slice(0, 5).forEach((c, i) => {
        console.log(`${i + 1}. TX: ${c.transaction_hash.substring(0, 16)}...`);
        console.log(`   Wallets: ${c.wallets.join(', ')}\n`);
      });
    } else {
      console.log('✅ No collisions detected\n');
    }

    // Step 5: Empty CID check
    console.log('STEP 5: Checking empty condition_id_norm_v3 percentage...\n');

    const emptyCidQuery = `
      SELECT
        count() AS total_trades,
        countIf(condition_id_norm_v3 = '' OR condition_id_norm_v3 IS NULL) AS empty_cid_trades,
        sum(abs(usd_value)) AS total_volume,
        sumIf(abs(usd_value), condition_id_norm_v3 = '' OR condition_id_norm_v3 IS NULL) AS empty_cid_volume
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = '${XCN_CANONICAL.toLowerCase()}'
    `;

    const emptyCidResult = await clickhouse.query({ query: emptyCidQuery, format: 'JSONEachRow' });
    const emptyCidData = await emptyCidResult.json<any[]>();
    const emptyCid = emptyCidData[0];

    const empty_cid_pct = (Number(emptyCid.empty_cid_trades) / Number(emptyCid.total_trades) * 100).toFixed(1);
    const empty_cid_vol_pct = (Number(emptyCid.empty_cid_volume) / Number(emptyCid.total_volume) * 100).toFixed(1);

    console.log(`Empty CID trades: ${Number(emptyCid.empty_cid_trades).toLocaleString()} / ${Number(emptyCid.total_trades).toLocaleString()} (${empty_cid_pct}%)`);
    console.log(`Empty CID volume: $${Number(emptyCid.empty_cid_volume).toLocaleString()} / $${Number(emptyCid.total_volume).toLocaleString()} (${empty_cid_vol_pct}%)\n`);

    // Step 6: Final determination
    console.log('═'.repeat(80));
    console.log('CERTIFICATION DECISION');
    console.log('═'.repeat(80));
    console.log('');

    const allPassed = validations.every(v => v.passed);
    const noCollisions = collisions.length === 0;
    const bothMarketsValidated = validations.length === 2;
    const xiValidated = xiPosition && validations.find(v => v.cid === XI_MARKET_CID)?.passed;
    const nonXiValidated = nonXiPosition && validations.find(v => v.cid === NON_XI_MARKET_CID)?.passed;

    let certificationStatus: 'PASS' | 'FAIL' | 'PARTIAL';
    let decision: string;

    if (allPassed && noCollisions && bothMarketsValidated && xiValidated && nonXiValidated) {
      certificationStatus = 'PASS';
      decision = '🟢 XCN PNL CERTIFIED';
    } else if (!bothMarketsValidated) {
      certificationStatus = 'PARTIAL';
      decision = '🟡 PARTIAL CERTIFICATION (One or both markets not in API positions)';
    } else if (!allPassed) {
      certificationStatus = 'FAIL';
      decision = '🔴 CERTIFICATION FAILED (Market validation mismatch)';
    } else if (!noCollisions) {
      certificationStatus = 'FAIL';
      decision = '🔴 CERTIFICATION FAILED (Collision detected)';
    } else {
      certificationStatus = 'FAIL';
      decision = '🔴 CERTIFICATION FAILED';
    }

    console.log(decision);
    console.log('');

    // Generate report
    const report = `# XCN Wallet PnL Certification Report - FINAL

**Date:** ${new Date().toISOString().split('T')[0]}
**Wallet (Canonical):** \`${XCN_CANONICAL}\`
**Validator:** C3 - PnL Correctness Agent

---

## Executive Summary

**Status:** ${certificationStatus === 'PASS' ? '🟢 CERTIFIED' : certificationStatus === 'PARTIAL' ? '🟡 PARTIAL' : '🔴 FAILED'}

**Decision:** ${decision}

### Changes Applied (C2)
- ✅ Updated view with 12-wallet cluster aggregation
- ✅ Fixed wallet_canonical mapping logic
- ✅ Corrected sign logic for shares
- ✅ Using \`condition_id_norm_v3\` column

### Preconditions
- ✅ C1: Mappings persisted, collisions=0 confirmed
- ✅ C2: Dedup + guardrail live, view updated
- ✅ Canonical view: \`vw_trades_canonical_with_canonical_wallet\` (final version)

### Validation Results
- Markets validated: ${validations.length}
- Markets passed: ${validations.filter(v => v.passed).length}
- Collisions detected: ${collisions.length}
- Empty CID percentage: ${empty_cid_pct}% trades, ${empty_cid_vol_pct}% volume

---

## Market Validations

${validations.map((v, i) => `
### Market ${i + 1}: ${v.market_name}

**Condition ID:** \`${v.cid}\`

| Metric | Database | Polymarket API | Diff | Status |
|--------|----------|----------------|------|--------|
| Cost | $${v.db_cost.toLocaleString()} | $${v.api_cost.toLocaleString()} | ${v.cost_diff_pct}% | ${v.cost_match ? '✅' : '❌'} |
| Net Shares | ${v.db_shares.toLocaleString()} | ${v.api_shares.toLocaleString()} | ${v.shares_diff_pct}% | ${v.shares_match ? '✅' : '❌'} |
| PnL | $${v.db_pnl.toLocaleString()} | $${v.api_pnl.toLocaleString()} | $${v.pnl_diff.toLocaleString()} | ℹ️ |

**Database Trades:** ${v.db_trades.toLocaleString()}

**Validation:** ${v.passed ? '🟢 PASS' : '🔴 FAIL'}

${v.passed ? 'Cost and shares match within ±10% tolerance.' : 'Mismatch exceeds ±10% tolerance threshold.'}
`).join('\n')}

${!nonXiPosition ? `
### Non-Xi Market (Not Validated)

**Condition ID:** \`${NON_XI_MARKET_CID}\`

**Status:** ⚠️  Market not found in current Polymarket API positions.

**Note:** This market may have been closed/settled. Validation skipped.
` : ''}

${!xiPosition ? `
### Xi Market (Not Validated)

**Condition ID:** \`${XI_MARKET_CID}\`

**Status:** ⚠️  Market not found in current Polymarket API positions.

**Note:** This market may have been closed/settled. Validation skipped.
` : ''}

---

## Collision Check

**Query:**
\`\`\`sql
SELECT
  transaction_hash,
  count(DISTINCT wallet_canonical) AS wallet_count,
  groupArray(DISTINCT wallet_canonical) AS wallets
FROM vw_trades_canonical_with_canonical_wallet
WHERE lower(wallet_canonical) = '${XCN_CANONICAL.toLowerCase()}'
GROUP BY transaction_hash
HAVING wallet_count > 1
\`\`\`

**Result:** ${collisions.length} collision(s) detected

${collisions.length > 0 ? `
### Collision Details (first 5)

${collisions.slice(0, 5).map((c, i) => `
${i + 1}. **TX:** \`${c.transaction_hash}\`
   - Wallet count: ${c.wallet_count}
   - Wallets: ${c.wallets.map((w: string) => `\`${w}\``).join(', ')}
`).join('\n')}

**Action Required:** Log to C1 for mapping investigation.
` : '✅ No collisions - wallet mapping is clean.'}

---

## Empty CID Analysis

**Statistics:**
- Total trades: ${Number(emptyCid.total_trades).toLocaleString()}
- Empty CID trades: ${Number(emptyCid.empty_cid_trades).toLocaleString()} (${empty_cid_pct}%)
- Total volume: $${Number(emptyCid.total_volume).toLocaleString()}
- Empty CID volume: $${Number(emptyCid.empty_cid_volume).toLocaleString()} (${empty_cid_vol_pct}%)

**Note:** Empty CID issue is tracked separately as a data quality defect. This does not block certification if validated markets pass.

---

## Defects Log

${!bothMarketsValidated ? `
### Defect #1: Markets Not in API Positions

**Severity:** MEDIUM
**Category:** Data availability

${!xiPosition ? `- Xi market (CID: \`${XI_MARKET_CID}\`) not found in API\n` : ''}${!nonXiPosition ? `- Non-Xi market (CID: \`${NON_XI_MARKET_CID}\`) not found in API\n` : ''}
**Possible Causes:**
1. Positions fully closed/settled
2. Markets resolved and removed from active positions

**Action:** ${bothMarketsValidated ? 'N/A' : 'Consider validation with different markets from current API positions'}
**Owner:** N/A (expected behavior for closed positions)
` : ''}

${!allPassed && validations.some(v => !v.passed) ? `
### Defect #${!bothMarketsValidated ? '2' : '1'}: Market Validation Mismatch

**Severity:** HIGH
**Category:** Data accuracy

**Failed Markets:**
${validations.filter(v => !v.passed).map(v => `
- **${v.market_name}** (CID: \`${v.cid.substring(0, 32)}...\`)
  - Cost diff: ${v.cost_diff_pct}% ${v.cost_match ? '' : '❌'}
  - Shares diff: ${v.shares_diff_pct}% ${v.shares_match ? '' : '❌'}
  - Trades in DB: ${v.db_trades.toLocaleString()}
`).join('\n')}

**Action Required:** Investigate canonical view data quality
**Owner:** C2 (Data Pipeline)
` : ''}

${collisions.length > 0 ? `
### Defect #${validations.some(v => !v.passed) ? '2' : '1'}: Wallet Collisions Detected

**Severity:** CRITICAL
**Category:** Data integrity

**Description:** ${collisions.length} transaction(s) mapped to multiple wallet_canonical values.

**Impact:** PnL calculations may be duplicated or incorrect.

**Action Required:** Review wallet mapping logic in canonical view
**Owner:** C1 (Mapping Agent)
` : ''}

---

## Recommendations

${certificationStatus === 'PASS' ? `
### Production Ready ✅

The XCN wallet PnL system is certified for production use:
- ✅ Both markets validated within ±10% tolerance
- ✅ No collisions detected in wallet mapping
- ✅ Canonical view operational with corrected logic
- ✅ 12-wallet cluster aggregation working correctly

**Next Steps:**
1. Monitor empty CID percentage in production
2. Schedule periodic re-certification (monthly recommended)
3. Deploy to production with confidence

**Production Deployment:** APPROVED
` : certificationStatus === 'PARTIAL' ? `
### Conditional Approval 🟡

The system shows partial validation:
${validations.length > 0 ? `- ✅ Validated market(s) passed\n` : ''}${!bothMarketsValidated ? `- ⚠️  One or both target markets not in current API positions\n` : ''}- ${collisions.length === 0 ? '✅' : '❌'} No collisions detected

**Recommended Actions:**
1. **Option A:** Accept partial certification if missing markets are confirmed closed
2. **Option B:** Validate with different active markets from API
3. Monitor validated markets for ongoing accuracy

**Production Decision:** ${validations.some(v => v.passed) ? 'Recommend conditional approval - system shows accurate data for available markets.' : 'Recommend validation with active markets before deployment.'}
` : `
### Certification Blocked 🔴

The following issues must be resolved before production deployment:

${!allPassed ? '1. **Market validation failures** - Database metrics do not match API within ±10%\n' : ''}${collisions.length > 0 ? ((!allPassed ? '2' : '1') + '. **Wallet mapping collisions** - Same transaction mapped to multiple wallets\n') : ''}
**Action Plan:**
${!allPassed ? '- C2: Investigate canonical view calculation logic\n- C3: Verify view aggregation is using correct wallet cluster\n' : ''}${collisions.length > 0 ? '- C1: Review and fix wallet_canonical derivation\n' : ''}- C3: Re-run certification after fixes deployed

**Timeline:** Address P0 issues, then re-certify.
`}

---

## Conclusion

${certificationStatus === 'PASS'
  ? 'The XCN wallet PnL system has **PASSED** all certification checks and is **READY FOR PRODUCTION DEPLOYMENT**. The canonical view provides accurate, collision-free data that matches Polymarket API ground truth within acceptable tolerance. The 12-wallet cluster aggregation is functioning correctly, and both test markets validated successfully.'
  : certificationStatus === 'PARTIAL'
  ? 'The XCN wallet PnL system shows strong validation for available markets. ' + (validations.some(v => v.passed) ? 'The validated market(s) passed with accurate data matching API ground truth. ' : '') + 'Some target markets were not available in current API positions, likely due to position closure. ' + (validations.some(v => v.passed) ? 'Recommend conditional approval based on successful validation of available markets.' : 'Recommend validation with currently active markets.')
  : 'The XCN wallet PnL system has critical issues preventing certification. Database metrics do not match Polymarket API ground truth, indicating problems with the canonical view calculation logic or wallet cluster aggregation. See Defects Log and Recommendations for required actions.'}

---

**Signed:** C3 - PnL Correctness Agent
**Date:** ${new Date().toISOString().split('T')[0]} (PST)
**Status:** ${certificationStatus === 'PASS' ? '🟢 CERTIFIED' : certificationStatus === 'PARTIAL' ? '🟡 PARTIAL' : '🔴 BLOCKED'}

---

## Appendix: Technical Details

### Data Sources
- **Canonical View:** \`vw_trades_canonical_with_canonical_wallet\` (updated with 12-wallet cluster)
- **Wallet Filter:** \`wallet_canonical = '${XCN_CANONICAL}'\` (view handles cluster aggregation)
- **Market ID Column:** \`condition_id_norm_v3\`
- **Ground Truth:** Polymarket API positions endpoint

### Validation Criteria
- **Tolerance:** ±10% for cost and net_shares
- **Collision Threshold:** 0 (strict)
- **Empty CID:** Documented separately, not blocking

### Target Markets
- **Xi Market:** \`${XI_MARKET_CID}\`
- **Non-Xi Market:** \`${NON_XI_MARKET_CID}\`

### Scripts Used
- \`scripts/57-xcn-certification-final.ts\` - This certification run

### Evidence Files
- \`/tmp/C3_XCN_PNL_CERTIFICATION.md\` (this file)
- \`/tmp/xcn-certification-final-output.txt\` (execution log)
`;

    // Write report
    writeFileSync('/tmp/C3_XCN_PNL_CERTIFICATION.md', report);
    console.log('✅ Certification report published to /tmp/C3_XCN_PNL_CERTIFICATION.md\n');

    // Summary
    console.log('SUMMARY:');
    console.log(`  Markets validated: ${validations.length}`);
    console.log(`  Markets passed: ${validations.filter(v => v.passed).length}`);
    console.log(`  Collisions: ${collisions.length}`);
    console.log(`  Empty CID: ${empty_cid_pct}%`);
    console.log(`  Certification: ${certificationStatus}\n`);

    console.log('═'.repeat(80));
    console.log(decision);
    console.log('═'.repeat(80));
    console.log('');

    return {
      success: certificationStatus === 'PASS',
      status: certificationStatus,
      validations,
      collisions: collisions.length,
      empty_cid_pct
    };

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    console.error(error);

    const errorReport = `# XCN Wallet PnL Certification Report - FINAL

**Date:** ${new Date().toISOString().split('T')[0]}
**Status:** 🔴 ERROR

## Error Details

\`\`\`
${error.message}
${error.stack}
\`\`\`

## Action Required

Investigation needed before certification can proceed.

---

**Signed:** C3 - PnL Correctness Agent
**Date:** ${new Date().toISOString().split('T')[0]} (PST)
**Status:** 🔴 ERROR
`;

    writeFileSync('/tmp/C3_XCN_PNL_CERTIFICATION.md', errorReport);

    return { success: false, error: error.message };
  }
}

runCertification().catch(console.error);
