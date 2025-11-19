#!/usr/bin/env tsx
/**
 * Debug Conversion Method
 *
 * Test different conversion approaches to find the correct one
 */

// Sample data from validation
const hexFromERC1155 = '0x178498138ed7a64427675d152d46c6d4b97a181f7d1d4178f5756ca353009359';
const decimalFromCTFMap = '100000293804690815023609597660894660801582658691499546225810764430851148723524';

console.log('Sample Data:');
console.log(`HEX (from erc1155_transfers): ${hexFromERC1155}`);
console.log(`DECIMAL (from ctf_token_map):  ${decimalFromCTFMap}`);
console.log('');

// Method 1: Direct big-endian (no reversal)
const directBigInt = BigInt(hexFromERC1155);
console.log('Method 1 - Direct big-endian (no reversal):');
console.log(`Result: ${directBigInt.toString()}`);
console.log(`Match:  ${directBigInt.toString() === decimalFromCTFMap ? '✅ YES' : '❌ NO'}`);
console.log('');

// Method 2: Reverse bytes (little-endian)
function hexToDecimalReversed(hex: string): string {
  const cleanHex = hex.toLowerCase().replace('0x', '');
  const paddedHex = cleanHex.padStart(64, '0');

  const bytes: number[] = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
  }

  bytes.reverse();

  let decimal = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    decimal = decimal + (BigInt(bytes[i]) << BigInt(i * 8));
  }

  return decimal.toString();
}

const reversedResult = hexToDecimalReversed(hexFromERC1155);
console.log('Method 2 - Reversed bytes (little-endian):');
console.log(`Result: ${reversedResult}`);
console.log(`Match:  ${reversedResult === decimalFromCTFMap ? '✅ YES' : '❌ NO'}`);
console.log('');

// Method 3: Just reverse hex string pairs
const reversedHexPairs = hexFromERC1155.replace('0x', '').match(/.{2}/g)!.reverse().join('');
const reversedHexBigInt = BigInt('0x' + reversedHexPairs);
console.log('Method 3 - Reversed hex pairs:');
console.log(`Result: ${reversedHexBigInt.toString()}`);
console.log(`Match:  ${reversedHexBigInt.toString() === decimalFromCTFMap ? '✅ YES' : '❌ NO'}`);
console.log('');

// Test converting ctf_token_map decimal back to hex
console.log('---');
console.log('Reverse Test: Convert ctf_token_map decimal to hex');
console.log('');

const ctfDecimal = BigInt(decimalFromCTFMap);
const ctfHex = ctfDecimal.toString(16).padStart(64, '0');
console.log(`CTF Decimal → HEX (direct):   0x${ctfHex}`);
console.log(`Original HEX from ERC1155:    ${hexFromERC1155.toLowerCase()}`);
console.log(`Match: ${('0x' + ctfHex) === hexFromERC1155.toLowerCase() ? '✅ YES' : '❌ NO'}`);
