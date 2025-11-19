/**
 * Token Conversion Tests (TDD - Write First!)
 *
 * Purpose: Test ERC-1155 token ID conversion between HEX and DECIMAL formats
 *
 * Background:
 * - erc1155_transfers uses HEX: "0x + 64 chars"
 * - gamma_markets.tokens[] uses DECIMAL: "77-78 char strings"
 * - These represent the SAME token in different encodings
 *
 * Conversion Formula (from PM_CANONICAL_SCHEMA_C1.md):
 * - HEX → DECIMAL: reinterpretAsUInt256(reverse(unhex(replaceAll(token_id, '0x', ''))))
 * - DECIMAL → HEX: lower(hex(reverse(reinterpretAsFixedString(token_id_decimal))))
 * - Why reverse()? ERC-1155 uses big-endian, ClickHouse UInt256 is little-endian
 */

import { describe, it, expect } from '@jest/globals';
import { hexToDecimal, decimalToHex, normalizeTokenId } from './token-conversion';
import tokenPairs from '../../__tests__/fixtures/token-pairs.json';

describe('Token ID Conversion', () => {
  describe('hexToDecimal', () => {
    it('should convert hex to decimal correctly', () => {
      // From PM_CANONICAL_SCHEMA_C1.md example (corrected decimal value)
      const hex = '0xde52e5e3ca0f8b3510e2662a5cbb03f5c8d83ef5b0cbd48ba5b0cbd48ba5b0c1';
      const expected = '100559920485897751472833403699186872860193780726587063239310708857967854596289';

      const result = hexToDecimal(hex);
      expect(result).toBe(expected);
    });

    it('should handle hex without 0x prefix', () => {
      const hex = 'de52e5e3ca0f8b3510e2662a5cbb03f5c8d83ef5b0cbd48ba5b0cbd48ba5b0c1';
      const expected = '100559920485897751472833403699186872860193780726587063239310708857967854596289';

      const result = hexToDecimal(hex);
      expect(result).toBe(expected);
    });

    it('should handle leading zeros', () => {
      const hex = '0x0000000000000000000000000000000000000000000000000000000000000001';
      const expected = '1';

      const result = hexToDecimal(hex);
      expect(result).toBe(expected);
    });

    it('should handle zero', () => {
      const hex = '0x0000000000000000000000000000000000000000000000000000000000000000';
      const expected = '0';

      const result = hexToDecimal(hex);
      expect(result).toBe(expected);
    });

    it('should handle max single byte', () => {
      const hex = '0x00000000000000000000000000000000000000000000000000000000000000ff';
      const expected = '255';

      const result = hexToDecimal(hex);
      expect(result).toBe(expected);
    });

    it('should throw on invalid hex', () => {
      expect(() => hexToDecimal('not-hex')).toThrow();
      expect(() => hexToDecimal('0xGGG')).toThrow();
    });

    it('should match all test fixtures', () => {
      tokenPairs.forEach((pair) => {
        const hexWith0x = '0x' + pair.token_id_hex;
        const result = hexToDecimal(hexWith0x);
        expect(result).toBe(pair.token_id_decimal);
      });
    });
  });

  describe('decimalToHex', () => {
    it('should convert decimal to hex correctly', () => {
      const decimal = '100559920485897751472833403699186872860193780726587063239310708857967854596289';
      const expected = 'de52e5e3ca0f8b3510e2662a5cbb03f5c8d83ef5b0cbd48ba5b0cbd48ba5b0c1';

      const result = decimalToHex(decimal);
      expect(result).toBe(expected);
    });

    it('should pad to 64 characters', () => {
      const decimal = '1';
      const result = decimalToHex(decimal);

      expect(result).toHaveLength(64);
      expect(result).toBe('0000000000000000000000000000000000000000000000000000000000000001');
    });

    it('should handle zero', () => {
      const decimal = '0';
      const result = decimalToHex(decimal);

      expect(result).toHaveLength(64);
      expect(result).toBe('0000000000000000000000000000000000000000000000000000000000000000');
    });

    it('should be lowercase', () => {
      const decimal = '255';
      const result = decimalToHex(decimal);

      expect(result).toBe(result.toLowerCase());
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('should throw on invalid decimal', () => {
      expect(() => decimalToHex('not-a-number')).toThrow();
      expect(() => decimalToHex('-1')).toThrow();
    });

    it('should match all test fixtures', () => {
      tokenPairs.forEach((pair) => {
        const result = decimalToHex(pair.token_id_decimal);
        expect(result).toBe(pair.token_id_hex);
      });
    });
  });

  describe('Round-trip conversion', () => {
    it('should be reversible: hex → decimal → hex', () => {
      const originalHex = '0xde52e5e3ca0f8b3510e2662a5cbb03f5c8d83ef5b0cbd48ba5b0cbd48ba5b0c1';
      const decimal = hexToDecimal(originalHex);
      const backToHex = decimalToHex(decimal);

      expect(backToHex).toBe(originalHex.replace('0x', '').toLowerCase());
    });

    it('should be reversible: decimal → hex → decimal', () => {
      const originalDecimal = '11304366886957861967018187540784784850127506228521765623170300457759143250423';
      const hex = decimalToHex(originalDecimal);
      const backToDecimal = hexToDecimal('0x' + hex);

      expect(backToDecimal).toBe(originalDecimal);
    });

    it('should work for all test fixtures', () => {
      tokenPairs.forEach((pair) => {
        // decimal → hex → decimal
        const hex = decimalToHex(pair.token_id_decimal);
        const backToDecimal = hexToDecimal('0x' + hex);
        expect(backToDecimal).toBe(pair.token_id_decimal);

        // hex → decimal → hex
        const decimal = hexToDecimal('0x' + pair.token_id_hex);
        const backToHex = decimalToHex(decimal);
        expect(backToHex).toBe(pair.token_id_hex);
      });
    });

    it('should preserve precision for large numbers', () => {
      const largeDecimals = [
        '115792089237316195423570985008687907853269984665640564039457584007913129639935', // max uint256
        '1000000000000000000000000000000000000000000000000000000000000000000000000',
        '99999999999999999999999999999999999999999999999999999999999999999999999999',
      ];

      largeDecimals.forEach((decimal) => {
        const hex = decimalToHex(decimal);
        const backToDecimal = hexToDecimal('0x' + hex);
        expect(backToDecimal).toBe(decimal);
      });
    });
  });

  describe('normalizeTokenId', () => {
    it('should remove 0x prefix', () => {
      const input = '0xde52e5e3ca0f8b35';
      const result = normalizeTokenId(input);
      expect(result).toBe('de52e5e3ca0f8b35');
    });

    it('should convert to lowercase', () => {
      const input = '0xDE52E5E3CA0F8B35';
      const result = normalizeTokenId(input);
      expect(result).toBe('de52e5e3ca0f8b35');
    });

    it('should handle already normalized input', () => {
      const input = 'de52e5e3ca0f8b35';
      const result = normalizeTokenId(input);
      expect(result).toBe('de52e5e3ca0f8b35');
    });

    it('should throw on invalid format', () => {
      expect(() => normalizeTokenId('not-hex')).toThrow();
      expect(() => normalizeTokenId('')).toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle very small numbers', () => {
      for (let i = 0; i < 256; i++) {
        const decimal = i.toString();
        const hex = decimalToHex(decimal);
        const backToDecimal = hexToDecimal('0x' + hex);
        expect(backToDecimal).toBe(decimal);
      }
    });

    it('should handle powers of 2', () => {
      const powersOf2 = [1, 2, 4, 8, 16, 32, 64, 128, 200];
      powersOf2.forEach((power) => {
        // Use BigInt for large powers to avoid scientific notation
        const decimal = (BigInt(1) << BigInt(power)).toString();
        const hex = decimalToHex(decimal);
        const backToDecimal = hexToDecimal('0x' + hex);
        expect(backToDecimal).toBe(decimal);
      });
    });

    it('should handle hex with uppercase', () => {
      const hexUpper = '0xDE52E5E3CA0F8B35';
      const hexLower = '0xde52e5e3ca0f8b35';

      const decimalUpper = hexToDecimal(hexUpper);
      const decimalLower = hexToDecimal(hexLower);

      expect(decimalUpper).toBe(decimalLower);
    });
  });

  describe('Performance', () => {
    it('should convert 1000 tokens in under 100ms', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        const decimal = (BigInt(i) * BigInt(1000000000000)).toString();
        const hex = decimalToHex(decimal);
        hexToDecimal('0x' + hex);
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });
});
