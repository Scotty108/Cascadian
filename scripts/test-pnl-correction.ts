/**
 * Test PnL correction calculations
 */

const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399

// Example values from the UI
const exampleRealizedRaw = -111.34  // Example raw Goldsky value
const exampleUnrealizedRaw = 84.73  // Example raw Polymarket value

console.log('\n📊 PnL Correction Test\n')
console.log('=' .repeat(60))

console.log('\n Realized PnL (from Goldsky closed positions):')
console.log(`  Raw value: ${exampleRealizedRaw}`)
const correctedRealized = exampleRealizedRaw / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
console.log(`  Corrected: $${correctedRealized.toFixed(2)}`)

console.log('\n Unrealized PnL (from Polymarket open positions):')
console.log(`  Raw value: ${exampleUnrealizedRaw}`)
const correctedUnrealized = exampleUnrealizedRaw / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
console.log(`  Corrected: $${correctedUnrealized.toFixed(2)}`)

console.log('\n Total PnL:')
const totalPnL = correctedRealized + correctedUnrealized
console.log(`  $${totalPnL.toFixed(2)}`)

console.log('\n Arrow Direction:')
console.log(`  Unrealized PnL: ${correctedUnrealized >= 0 ? '↑ UP (positive)' : '↓ DOWN (negative)'}`)

console.log('\n' + '='.repeat(60) + '\n')

// Now test with actual expected values
console.log('Expected Values from UI:')
console.log(`  Realized PnL: $-8.41`)
console.log(`  Total PnL: $-2`)
console.log(`  Therefore Unrealized should be: $${(-2 - (-8.41)).toFixed(2)}`)

// Reverse calculate what the raw values should be
const expectedRealized = -8.41
const expectedUnrealized = -2 - expectedRealized // $6.41

const rawRealizedNeeded = expectedRealized * GOLDSKY_PNL_CORRECTION_FACTOR * 1e6
const rawUnrealizedNeeded = expectedUnrealized * GOLDSKY_PNL_CORRECTION_FACTOR * 1e6

console.log(`\nRaw values needed to achieve this:`)
console.log(`  Raw Realized: ${rawRealizedNeeded.toFixed(2)}`)
console.log(`  Raw Unrealized: ${rawUnrealizedNeeded.toFixed(2)}`)

console.log('\n')
