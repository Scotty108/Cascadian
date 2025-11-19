import { writeFileSync } from 'fs';

const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Our database calculations
const ourNumbers = {
  total_volume: 420564.32,
  total_profit: 7330.84,
  total_loss: 413973.48,
  net_pnl: -406642.64,
  winning_positions: 6,
  losing_positions: 72,
  total_positions: 78,
  win_rate: 7.69,
  resolved_trades: 347,
};

function generateReport() {
  console.log('=== Generating PnL Comparison Report ===\n');

  const report = `# xcnstrategy Wallet PnL Analysis

**Analysis Date:** ${new Date().toISOString().split('T')[0]}
**Wallet Address:** \`${XCNSTRATEGY_WALLET}\`
**Data Source:** Cascadian Database (vw_trades_canonical_current + market_resolutions_final)

---

## 📊 Our Database Numbers

### Volume & Activity
- **Total Volume (absolute):** $${ourNumbers.total_volume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- **Resolved Trades:** ${ourNumbers.resolved_trades.toLocaleString()}
- **Resolved Positions:** ${ourNumbers.total_positions}

### Profit & Loss
- **Total Profit:** $${ourNumbers.total_profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- **Total Loss:** -$${Math.abs(ourNumbers.total_loss).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- **NET PnL:** ${ourNumbers.net_pnl >= 0 ? '✅' : '❌'} **$${ourNumbers.net_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**

### Win Rate & Performance
- **Winning Positions:** ${ourNumbers.winning_positions} (${((ourNumbers.winning_positions / ourNumbers.total_positions) * 100).toFixed(1)}%)
- **Losing Positions:** ${ourNumbers.losing_positions} (${((ourNumbers.losing_positions / ourNumbers.total_positions) * 100).toFixed(1)}%)
- **Win Rate:** ${ourNumbers.win_rate.toFixed(2)}%
- **Average Win:** $${(ourNumbers.total_profit / ourNumbers.winning_positions).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- **Average Loss:** -$${(Math.abs(ourNumbers.total_loss) / ourNumbers.losing_positions).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

---

## 🌐 Polymarket "Reality" Numbers

**Status:** ❌ **Not Available via Public API**

We attempted to fetch official PnL data from Polymarket via multiple API endpoints:
- \`https://clob.polymarket.com/users/{address}\` - 404
- \`https://data-api.polymarket.com/profile/{address}\` - 404
- \`https://gamma-api.polymarket.com/users/{address}\` - 405
- \`https://strapi-matic.poly.market/users\` - Connection failed

### Manual Verification Required

To verify our calculations against Polymarket's official numbers, please:

1. **Visit the wallet's public profile:**
   - URL: https://polymarket.com/${XCNSTRATEGY_WALLET}
   - Or search for "xcnstrategy" username if that's the profile name

2. **Look for these metrics on the profile:**
   - Total PnL (realized + unrealized)
   - Total Volume
   - Win Rate
   - Number of trades/positions

3. **Compare with our numbers above**

---

## 🔍 Calculation Methodology

### Our Approach

We calculate realized PnL using the following formula:

\`\`\`
For each position (condition_id + outcome_index):
  1. Aggregate all trades: net_shares = Σ(BUY shares - SELL shares)
  2. Aggregate all costs: net_cost = Σ(BUY value - SELL value)
  3. Join with market_resolutions_final on condition_id
  4. Calculate payout: payout_value = net_shares * (payout_numerators[outcome] / payout_denominator)
  5. Calculate realized_pnl = payout_value - net_cost
  6. Aggregate across all resolved positions
\`\`\`

### Data Sources

- **Trades:** \`vw_trades_canonical_current\` (v3 canonical trades view)
- **Resolutions:** \`market_resolutions_final\` (resolution and payout data)

### Coverage

- **Total positions for this wallet:** 164 unique (condition_id, outcome_index) pairs
- **Positions with resolution data:** 164 (100% coverage)
- **Positions with valid payout data:** 78 (47.6%)
- **Positions included in PnL:** 78 resolved positions

**Note:** The remaining ~47% of positions either:
- Have not yet resolved
- Are still open positions (unrealized PnL)
- Have invalid/missing payout data

---

## ⚠️  Important Notes

### 1. Realized vs Unrealized PnL

The numbers above represent **REALIZED PnL only** - positions that have been resolved and paid out.

**Not included:**
- Unrealized PnL from open positions
- Positions that haven't resolved yet

To get total PnL, you would need to add unrealized PnL from open positions.

### 2. Data Quality Considerations

${ourNumbers.net_pnl < -400000 ? `
**🚨 Large Loss Alert:** The wallet shows a realized loss of over $400k with only a 7.69% win rate.

This could indicate:
- Legitimate trading losses (bad performance)
- Data quality issues in our calculation
- Missing profit-taking trades or redemptions
- Incorrect cost basis calculations

**Recommended Actions:**
1. Manual spot-check: Pick 2-3 large losing positions and verify calculations
2. Check for missing "winning" redemptions in our data
3. Verify cost basis calculations are correct
4. Compare with Polymarket's official PnL numbers (see Manual Verification above)
` : ''}

### 3. Fee Handling

Current calculation **does not** include trading fees. If Polymarket's PnL includes fees, our numbers may be slightly different.

### 4. Timestamp Considerations

All resolved positions are grouped in the monthly breakdown, but many have \`null\` resolved_at timestamps. This doesn't affect PnL calculations but may affect temporal analysis.

---

## 📋 Next Steps

1. **Manual Verification:** Visit https://polymarket.com/${XCNSTRATEGY_WALLET} and compare official stats
2. **Spot Check:** Manually verify 2-3 large positions to ensure calculation accuracy
3. **Unrealized PnL:** Calculate unrealized PnL for open positions to get total PnL
4. **Deep Dive:** If discrepancies exist, investigate specific positions to find root cause

---

**Generated by:** C3 - xcnstrategy Wallet Validator
**Report Type:** PnL Comparison & Analysis
`;

  writeFileSync('/tmp/XCNSTRATEGY_PNL_COMPARISON.md', report);

  console.log('✅ Report written to: /tmp/XCNSTRATEGY_PNL_COMPARISON.md');
  console.log('');

  // Also print summary to console
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                   PNL COMPARISON SUMMARY                      ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('OUR DATABASE NUMBERS:');
  console.log('  Total Volume:        $' + ourNumbers.total_volume.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Total Profit:        $' + ourNumbers.total_profit.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Total Loss:          -$' + Math.abs(ourNumbers.total_loss).toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  NET PnL:             ' + (ourNumbers.net_pnl >= 0 ? '✅' : '❌') + ' $' + ourNumbers.net_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Win Rate:            ' + ourNumbers.win_rate.toFixed(2) + '%');
  console.log('  Winning Positions:   ' + ourNumbers.winning_positions);
  console.log('  Losing Positions:    ' + ourNumbers.losing_positions);
  console.log('');
  console.log('POLYMARKET REALITY:');
  console.log('  ❌ Not available via public API');
  console.log('  ℹ️  Manual verification required');
  console.log('  📱 Visit: https://polymarket.com/' + XCNSTRATEGY_WALLET);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  ALERT: Large realized loss detected (-$406k, 7.69% win rate)');
  console.log('   → Recommend manual spot-check of calculations');
  console.log('   → Verify against Polymarket official numbers');
  console.log('');
  console.log('📄 Full report: /tmp/XCNSTRATEGY_PNL_COMPARISON.md');
  console.log('');
}

generateReport();
