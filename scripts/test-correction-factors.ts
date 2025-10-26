/**
 * Test different correction factor approaches
 */

// Expected values from Polymarket UI
const expectedTotalPnL = -113.66
const expectedUnrealizedPnL = -2.34  // sum of individual position P/Ls
const expectedRealizedPnL = expectedTotalPnL - expectedUnrealizedPnL  // -111.32

console.log('\n📊 Testing Correction Factor Approaches\n')
console.log('=' .repeat(80))

console.log('\nExpected Values from Polymarket:')
console.log(`  Total P/L: ${expectedTotalPnL.toFixed(2)}`)
console.log(`  Unrealized P/L: ${expectedUnrealizedPnL.toFixed(2)}`)
console.log(`  Realized P/L: ${expectedRealizedPnL.toFixed(2)}`)

console.log('\n\nApproach 1: Divide by BOTH (13.2399 * 1e6)')
console.log('-'.repeat(80))
const factor1 = 13.2399 * 1e6
const rawValue1 = expectedRealizedPnL * factor1
console.log(`  If realized P/L = ${expectedRealizedPnL.toFixed(2)}`)
console.log(`  Raw Goldsky value would be: ${rawValue1.toFixed(0)}`)
console.log(`  Correction: ${rawValue1.toFixed(0)} / ${factor1} = ${(rawValue1 / factor1).toFixed(2)}`)

console.log('\n\nApproach 2: Divide by ONLY 13.2399')
console.log('-'.repeat(80))
const factor2 = 13.2399
const rawValue2 = expectedRealizedPnL * factor2
console.log(`  If realized P/L = ${expectedRealizedPnL.toFixed(2)}`)
console.log(`  Raw Goldsky value would be: ${rawValue2.toFixed(2)}`)
console.log(`  Correction: ${rawValue2.toFixed(2)} / ${factor2.toFixed(4)} = ${(rawValue2 / factor2).toFixed(2)}`)

console.log('\n\nApproach 3: Divide by ONLY 1e6')
console.log('-'.repeat(80))
const factor3 = 1e6
const rawValue3 = expectedRealizedPnL * factor3
console.log(`  If realized P/L = ${expectedRealizedPnL.toFixed(2)}`)
console.log(`  Raw Goldsky value would be: ${rawValue3.toFixed(0)}`)
console.log(`  Correction: ${rawValue3.toFixed(0)} / ${factor3} = ${(rawValue3 / factor3).toFixed(2)}`)

console.log('\n\nApproach 4: NO correction (use raw values)')
console.log('-'.repeat(80))
console.log(`  If realized P/L = ${expectedRealizedPnL.toFixed(2)}`)
console.log(`  Raw Goldsky value would be: ${expectedRealizedPnL.toFixed(2)}`)
console.log(`  Correction: None needed`)

console.log('\n\n💡 Which approach gives us the Omega Score value of -$8.41?')
console.log('-'.repeat(80))

// From Omega Score, we get -$8.41
const omegaPnL = -8.41

console.log(`\nOmega Score shows: -$8.41`)
console.log(`\nReverse engineering:`)
console.log(`  If we divided by (13.2399 * 1e6): raw = ${(omegaPnL * 13.2399 * 1e6).toFixed(0)}`)
console.log(`  If we divided by 13.2399: raw = ${(omegaPnL * 13.2399).toFixed(2)}`)
console.log(`  If we divided by 1e6: raw = ${(omegaPnL * 1e6).toFixed(0)}`)
console.log(`  If no division: raw = -8.41`)

console.log('\n' + '='.repeat(80) + '\n')
