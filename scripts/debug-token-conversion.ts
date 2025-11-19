#!/usr/bin/env tsx
/**
 * Debug Token Conversion
 *
 * Manually verify the conversion formula
 */

// Test the conversion both ways
const hex = 'de52e5e3ca0f8b3510e2662a5cbb03f5c8d83ef5b0cbd48ba5b0cbd48ba5b0c1';
const expectedDecimal = '11304366886957861967018187540784784850127506228521765623170300457759143250423';

console.log('Testing conversion:');
console.log(`Hex input: ${hex}`);
console.log(`Expected decimal: ${expectedDecimal}\n`);

// Method 1: Direct big-endian interpretation (no reversal)
const directBigInt = BigInt('0x' + hex);
console.log(`Method 1 (direct, no reverse): ${directBigInt.toString()}`);
console.log(`Match? ${directBigInt.toString() === expectedDecimal}\n`);

// Method 2: Reverse bytes then interpret
const bytes = [];
for (let i = 0; i < hex.length; i += 2) {
  bytes.push(parseInt(hex.substring(i, i + 2), 16));
}
console.log(`Original bytes (${bytes.length}): [${bytes.slice(0, 4).join(', ')}...]`);

bytes.reverse();
console.log(`Reversed bytes: [${bytes.slice(0, 4).join(', ')}...]`);

// Interpret reversed bytes as little-endian number
let reversedValue = BigInt(0);
for (let i = 0; i < bytes.length; i++) {
  reversedValue = reversedValue + (BigInt(bytes[i]) << BigInt(i * 8));
}
console.log(`Method 2 (reversed, little-endian): ${reversedValue.toString()}`);
console.log(`Match? ${reversedValue.toString() === expectedDecimal}\n`);

// Method 3: Just reverse hex string
const reversedHex = hex.match(/.{2}/g)!.reverse().join('');
const reversedBigInt = BigInt('0x' + reversedHex);
console.log(`Method 3 (reversed hex string): ${reversedBigInt.toString()}`);
console.log(`Match? ${reversedBigInt.toString() === expectedDecimal}\n`);

console.log('\n--- Summary ---');
console.log(`Expected: ${expectedDecimal}`);
console.log(`Method 1:  ${directBigInt.toString()}`);
console.log(`Method 2:  ${reversedValue.toString()}`);
console.log(`Method 3:  ${reversedBigInt.toString()}`);
