/**
 * Test Trade Enrichment Logic
 *
 * Tests the enrichment calculations with example data to ensure:
 * - Outcome calculation is correct
 * - P&L formulas are accurate
 * - Edge cases are handled properly
 *
 * Run this to verify enrichment logic before running on real data:
 *   npx tsx scripts/test-enrichment-logic.ts
 */

interface TestCase {
  name: string
  trade: {
    side: 'YES' | 'NO'
    entry_price: number
    shares: number
    usd_value: number
  }
  market: {
    resolved_outcome: number // 0 = NO won, 1 = YES won
    final_price: number
  }
  expected: {
    outcome: number // 0 = lost, 1 = won
    pnl_gross: number
    pnl_net: number
    fee_usd: number
    return_pct: number
  }
}

const FEE_RATE = 0.02

// ============================================================================
// Enrichment Logic (Same as enrich-trades.ts)
// ============================================================================

function calculateOutcome(
  marketOutcome: number,
  tradeSide: 'YES' | 'NO'
): number {
  // Market outcome: 0 = NO won, 1 = YES won
  if (marketOutcome === 1) {
    return tradeSide === 'YES' ? 1 : 0
  } else {
    return tradeSide === 'NO' ? 1 : 0
  }
}

function calculatePnL(
  side: 'YES' | 'NO',
  outcome: number,
  shares: number,
  entryPrice: number,
  usdValue: number
): {
  pnl_gross: number
  pnl_net: number
  fee_usd: number
  return_pct: number
} {
  let pnl_gross = 0

  if (outcome === 1) {
    // Trade won - get $1 per share
    pnl_gross = shares - usdValue
  } else {
    // Trade lost - lose entire investment
    pnl_gross = -usdValue
  }

  // Calculate fees
  const fee_usd = usdValue * FEE_RATE

  // Net P&L after fees
  const pnl_net = pnl_gross - fee_usd

  // Return percentage
  const return_pct = usdValue > 0 ? (pnl_net / usdValue) * 100 : 0

  return {
    pnl_gross,
    pnl_net,
    fee_usd,
    return_pct,
  }
}

// ============================================================================
// Test Cases
// ============================================================================

const testCases: TestCase[] = [
  // -------------------------------------------------------------------------
  // Test Case 1: YES trade wins
  // -------------------------------------------------------------------------
  {
    name: 'YES trade wins (bought at $0.65, market resolves YES)',
    trade: {
      side: 'YES',
      entry_price: 0.65,
      shares: 100,
      usd_value: 65.0,
    },
    market: {
      resolved_outcome: 1, // YES won
      final_price: 1.0,
    },
    expected: {
      outcome: 1, // Trade won
      pnl_gross: 35.0, // 100 shares * $1 - $65 cost = $35
      pnl_net: 33.7, // $35 - (2% of $65) = $35 - $1.30 = $33.70
      fee_usd: 1.3, // 2% of $65
      return_pct: 51.85, // ($33.70 / $65) * 100 = 51.85%
    },
  },

  // -------------------------------------------------------------------------
  // Test Case 2: YES trade loses
  // -------------------------------------------------------------------------
  {
    name: 'YES trade loses (bought at $0.65, market resolves NO)',
    trade: {
      side: 'YES',
      entry_price: 0.65,
      shares: 100,
      usd_value: 65.0,
    },
    market: {
      resolved_outcome: 0, // NO won
      final_price: 0.0,
    },
    expected: {
      outcome: 0, // Trade lost
      pnl_gross: -65.0, // Lost entire investment
      pnl_net: -66.3, // -$65 - $1.30 fees = -$66.30
      fee_usd: 1.3,
      return_pct: -102.0, // (-$66.30 / $65) * 100 = -102%
    },
  },

  // -------------------------------------------------------------------------
  // Test Case 3: NO trade wins
  // -------------------------------------------------------------------------
  {
    name: 'NO trade wins (bought at $0.35, market resolves NO)',
    trade: {
      side: 'NO',
      entry_price: 0.35,
      shares: 100,
      usd_value: 35.0,
    },
    market: {
      resolved_outcome: 0, // NO won
      final_price: 0.0,
    },
    expected: {
      outcome: 1, // Trade won
      pnl_gross: 65.0, // 100 shares * $1 - $35 cost = $65
      pnl_net: 64.3, // $65 - (2% of $35) = $65 - $0.70 = $64.30
      fee_usd: 0.7,
      return_pct: 183.71, // ($64.30 / $35) * 100 = 183.71%
    },
  },

  // -------------------------------------------------------------------------
  // Test Case 4: NO trade loses
  // -------------------------------------------------------------------------
  {
    name: 'NO trade loses (bought at $0.35, market resolves YES)',
    trade: {
      side: 'NO',
      entry_price: 0.35,
      shares: 100,
      usd_value: 35.0,
    },
    market: {
      resolved_outcome: 1, // YES won
      final_price: 1.0,
    },
    expected: {
      outcome: 0, // Trade lost
      pnl_gross: -35.0, // Lost entire investment
      pnl_net: -35.7, // -$35 - $0.70 fees = -$35.70
      fee_usd: 0.7,
      return_pct: -102.0, // (-$35.70 / $35) * 100 = -102%
    },
  },

  // -------------------------------------------------------------------------
  // Test Case 5: High conviction YES trade wins
  // -------------------------------------------------------------------------
  {
    name: 'High conviction YES trade wins (bought at $0.90)',
    trade: {
      side: 'YES',
      entry_price: 0.90,
      shares: 100,
      usd_value: 90.0,
    },
    market: {
      resolved_outcome: 1, // YES won
      final_price: 1.0,
    },
    expected: {
      outcome: 1, // Trade won
      pnl_gross: 10.0, // 100 * $1 - $90 = $10
      pnl_net: 8.2, // $10 - (2% of $90) = $10 - $1.80 = $8.20
      fee_usd: 1.8,
      return_pct: 9.11, // ($8.20 / $90) * 100 = 9.11%
    },
  },

  // -------------------------------------------------------------------------
  // Test Case 6: Contrarian NO trade wins
  // -------------------------------------------------------------------------
  {
    name: 'Contrarian NO trade wins (bought at $0.10)',
    trade: {
      side: 'NO',
      entry_price: 0.10,
      shares: 100,
      usd_value: 10.0,
    },
    market: {
      resolved_outcome: 0, // NO won
      final_price: 0.0,
    },
    expected: {
      outcome: 1, // Trade won
      pnl_gross: 90.0, // 100 * $1 - $10 = $90
      pnl_net: 89.8, // $90 - (2% of $10) = $90 - $0.20 = $89.80
      fee_usd: 0.2,
      return_pct: 898.0, // ($89.80 / $10) * 100 = 898%
    },
  },

  // -------------------------------------------------------------------------
  // Test Case 7: Large trade
  // -------------------------------------------------------------------------
  {
    name: 'Large YES trade wins (1000 shares)',
    trade: {
      side: 'YES',
      entry_price: 0.52,
      shares: 1000,
      usd_value: 520.0,
    },
    market: {
      resolved_outcome: 1, // YES won
      final_price: 1.0,
    },
    expected: {
      outcome: 1, // Trade won
      pnl_gross: 480.0, // 1000 * $1 - $520 = $480
      pnl_net: 469.6, // $480 - (2% of $520) = $480 - $10.40 = $469.60
      fee_usd: 10.4,
      return_pct: 90.31, // ($469.60 / $520) * 100 = 90.31%
    },
  },

  // -------------------------------------------------------------------------
  // Test Case 8: Small trade
  // -------------------------------------------------------------------------
  {
    name: 'Small NO trade wins (10 shares)',
    trade: {
      side: 'NO',
      entry_price: 0.25,
      shares: 10,
      usd_value: 2.5,
    },
    market: {
      resolved_outcome: 0, // NO won
      final_price: 0.0,
    },
    expected: {
      outcome: 1, // Trade won
      pnl_gross: 7.5, // 10 * $1 - $2.5 = $7.50
      pnl_net: 7.45, // $7.50 - (2% of $2.50) = $7.50 - $0.05 = $7.45
      fee_usd: 0.05,
      return_pct: 298.0, // ($7.45 / $2.50) * 100 = 298%
    },
  },
]

// ============================================================================
// Test Runner
// ============================================================================

function runTests(): void {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('           TRADE ENRICHMENT LOGIC TESTS                    ')
  console.log('═══════════════════════════════════════════════════════════\n')

  let passed = 0
  let failed = 0

  for (const test of testCases) {
    console.log(`\n📝 Test: ${test.name}`)
    console.log(`   Trade: ${test.trade.side} ${test.trade.shares} shares @ $${test.trade.entry_price}`)
    console.log(`   Market: Resolved ${test.market.resolved_outcome === 1 ? 'YES' : 'NO'}`)

    // Calculate outcome
    const outcome = calculateOutcome(test.market.resolved_outcome, test.trade.side)

    // Calculate P&L
    const { pnl_gross, pnl_net, fee_usd, return_pct } = calculatePnL(
      test.trade.side,
      outcome,
      test.trade.shares,
      test.trade.entry_price,
      test.trade.usd_value
    )

    // Verify results
    const tolerance = 0.01 // 1 cent tolerance for rounding

    const outcomeMatch = outcome === test.expected.outcome
    const pnlGrossMatch = Math.abs(pnl_gross - test.expected.pnl_gross) < tolerance
    const pnlNetMatch = Math.abs(pnl_net - test.expected.pnl_net) < tolerance
    const feeMatch = Math.abs(fee_usd - test.expected.fee_usd) < tolerance
    const returnMatch = Math.abs(return_pct - test.expected.return_pct) < tolerance

    const allMatch = outcomeMatch && pnlGrossMatch && pnlNetMatch && feeMatch && returnMatch

    if (allMatch) {
      console.log('   ✅ PASS')
      console.log(`      Outcome: ${outcome} (${outcome === 1 ? 'won' : 'lost'})`)
      console.log(`      P&L Gross: $${pnl_gross.toFixed(2)}`)
      console.log(`      P&L Net: $${pnl_net.toFixed(2)}`)
      console.log(`      Fees: $${fee_usd.toFixed(2)}`)
      console.log(`      Return: ${return_pct.toFixed(2)}%`)
      passed++
    } else {
      console.log('   ❌ FAIL')
      failed++

      if (!outcomeMatch) {
        console.log(`      ❌ Outcome: expected ${test.expected.outcome}, got ${outcome}`)
      }
      if (!pnlGrossMatch) {
        console.log(`      ❌ P&L Gross: expected $${test.expected.pnl_gross.toFixed(2)}, got $${pnl_gross.toFixed(2)}`)
      }
      if (!pnlNetMatch) {
        console.log(`      ❌ P&L Net: expected $${test.expected.pnl_net.toFixed(2)}, got $${pnl_net.toFixed(2)}`)
      }
      if (!feeMatch) {
        console.log(`      ❌ Fee: expected $${test.expected.fee_usd.toFixed(2)}, got $${fee_usd.toFixed(2)}`)
      }
      if (!returnMatch) {
        console.log(`      ❌ Return: expected ${test.expected.return_pct.toFixed(2)}%, got ${return_pct.toFixed(2)}%`)
      }
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                        SUMMARY                            ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log(`✅ Passed: ${passed}/${testCases.length} tests`)
  console.log(`❌ Failed: ${failed}/${testCases.length} tests\n`)

  if (failed === 0) {
    console.log('🎉 All tests passed! Enrichment logic is working correctly.\n')
    console.log('You can now safely run:')
    console.log('  npx tsx scripts/enrich-trades.ts\n')
  } else {
    console.log('❌ Some tests failed. Fix the enrichment logic before running on real data.\n')
    process.exit(1)
  }
}

// ============================================================================
// Example Output for Documentation
// ============================================================================

function showExample(): void {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                   ENRICHMENT EXAMPLE                      ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const example = testCases[0] // Use first test case

  console.log('BEFORE ENRICHMENT:')
  console.log('─────────────────────────────────────────────────────────')
  console.log(
    JSON.stringify(
      {
        trade_id: '0x123...',
        wallet_address: '0xabc...',
        market_id: 'market_123',
        side: example.trade.side,
        entry_price: example.trade.entry_price,
        shares: example.trade.shares,
        usd_value: example.trade.usd_value,
        outcome: null,
        pnl_gross: 0,
        pnl_net: 0,
        fee_usd: 0,
        return_pct: 0,
        is_closed: false,
      },
      null,
      2
    )
  )

  console.log('\nMARKET RESOLUTION:')
  console.log('─────────────────────────────────────────────────────────')
  console.log(
    JSON.stringify(
      {
        market_id: 'market_123',
        closed: true,
        resolved_outcome: example.market.resolved_outcome,
        final_price: example.market.final_price,
      },
      null,
      2
    )
  )

  const outcome = calculateOutcome(example.market.resolved_outcome, example.trade.side)
  const { pnl_gross, pnl_net, fee_usd, return_pct } = calculatePnL(
    example.trade.side,
    outcome,
    example.trade.shares,
    example.trade.entry_price,
    example.trade.usd_value
  )

  console.log('\nAFTER ENRICHMENT:')
  console.log('─────────────────────────────────────────────────────────')
  console.log(
    JSON.stringify(
      {
        trade_id: '0x123...',
        wallet_address: '0xabc...',
        market_id: 'market_123',
        side: example.trade.side,
        entry_price: example.trade.entry_price,
        shares: example.trade.shares,
        usd_value: example.trade.usd_value,
        outcome: outcome,
        pnl_gross: pnl_gross,
        pnl_net: pnl_net,
        fee_usd: fee_usd,
        return_pct: return_pct,
        is_closed: true,
        close_price: example.market.final_price,
      },
      null,
      2
    )
  )

  console.log('\n')
}

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2)

if (args.includes('--example')) {
  showExample()
} else {
  runTests()
}
