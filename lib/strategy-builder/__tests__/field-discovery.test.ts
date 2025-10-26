/**
 * FIELD DISCOVERY TESTS
 *
 * Task Group 2.1: Tests for field discovery system
 * Testing field extraction, nested paths, and type detection
 */

import { discoverFields, extractFieldsFromObject, detectFieldType, categorizeField, formatSampleValue } from '../field-discovery';
import type { FieldDefinition } from '../types';

describe('Field Discovery', () => {
  // Test 1: Extract flat fields from sample data
  test('extracts all flat fields from sample market data', () => {
    const sampleData = [
      {
        id: 'market-1',
        question: 'Will Bitcoin reach $100k?',
        category: 'Crypto',
        volume: 250000,
        liquidity: 50000,
        currentPrice: 0.65,
        active: true
      },
      {
        id: 'market-2',
        question: 'Will Trump win 2024?',
        category: 'Politics',
        volume: 500000,
        liquidity: 100000,
        currentPrice: 0.45,
        active: true
      }
    ];

    const fields = discoverFields(sampleData);

    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some(f => f.path === 'id')).toBe(true);
    expect(fields.some(f => f.path === 'question')).toBe(true);
    expect(fields.some(f => f.path === 'category')).toBe(true);
    expect(fields.some(f => f.path === 'volume')).toBe(true);
    expect(fields.some(f => f.path === 'liquidity')).toBe(true);
    expect(fields.some(f => f.path === 'currentPrice')).toBe(true);
    expect(fields.some(f => f.path === 'active')).toBe(true);
  });

  // Test 2: Extract nested fields with dot notation
  test('extracts nested fields with correct path notation', () => {
    const sampleData = [
      {
        id: 'market-1',
        question: 'Test market',
        analytics: {
          roi: 1.23,
          sharpeRatio: 2.5,
          volatility: 0.15
        },
        market: {
          volume_24h: 100000,
          trades_24h: 450
        }
      }
    ];

    const fields = discoverFields(sampleData);

    // Check for nested paths
    expect(fields.some(f => f.path === 'analytics.roi')).toBe(true);
    expect(fields.some(f => f.path === 'analytics.sharpeRatio')).toBe(true);
    expect(fields.some(f => f.path === 'analytics.volatility')).toBe(true);
    expect(fields.some(f => f.path === 'market.volume_24h')).toBe(true);
    expect(fields.some(f => f.path === 'market.trades_24h')).toBe(true);
  });

  // Test 3: Detect number field type
  test('correctly identifies number field types', () => {
    const sampleData = [
      {
        volume: 250000,
        price: 0.65,
        count: 42
      }
    ];

    const fields = discoverFields(sampleData);

    const volumeField = fields.find(f => f.path === 'volume');
    const priceField = fields.find(f => f.path === 'price');
    const countField = fields.find(f => f.path === 'count');

    expect(volumeField?.type).toBe('number');
    expect(priceField?.type).toBe('number');
    expect(countField?.type).toBe('number');
  });

  // Test 4: Detect string field type
  test('correctly identifies string field types', () => {
    const sampleData = [
      {
        id: 'market-123',
        question: 'Will Bitcoin reach $100k?',
        category: 'Crypto',
        description: 'A test market about Bitcoin'
      }
    ];

    const fields = discoverFields(sampleData);

    const idField = fields.find(f => f.path === 'id');
    const questionField = fields.find(f => f.path === 'question');
    const categoryField = fields.find(f => f.path === 'category');
    const descriptionField = fields.find(f => f.path === 'description');

    expect(idField?.type).toBe('string');
    expect(questionField?.type).toBe('string');
    expect(categoryField?.type).toBe('string');
    expect(descriptionField?.type).toBe('string');
  });

  // Test 5: Detect array and boolean field types
  test('correctly identifies array and boolean field types', () => {
    const sampleData = [
      {
        tags: ['crypto', 'bitcoin', 'prediction'],
        active: true,
        featured: false,
        participants: [
          { address: '0x123', amount: 100 },
          { address: '0x456', amount: 200 }
        ]
      }
    ];

    const fields = discoverFields(sampleData);

    const tagsField = fields.find(f => f.path === 'tags');
    const activeField = fields.find(f => f.path === 'active');
    const featuredField = fields.find(f => f.path === 'featured');
    const participantsField = fields.find(f => f.path === 'participants');

    expect(tagsField?.type).toBe('array');
    expect(activeField?.type).toBe('boolean');
    expect(featuredField?.type).toBe('boolean');
    expect(participantsField?.type).toBe('array');
  });

  // Test 6: Detect date field type
  test('correctly identifies date field types', () => {
    const sampleData = [
      {
        createdAt: '2024-01-15T10:30:00Z',
        endDate: '2024-12-31T23:59:59Z',
        timestamp: new Date('2024-06-01')
      }
    ];

    const fields = discoverFields(sampleData);

    const createdAtField = fields.find(f => f.path === 'createdAt');
    const endDateField = fields.find(f => f.path === 'endDate');
    const timestampField = fields.find(f => f.path === 'timestamp');

    expect(createdAtField?.type).toBe('date');
    expect(endDateField?.type).toBe('date');
    expect(timestampField?.type).toBe('date');
  });

  // Test 7: Handle empty data gracefully
  test('returns empty array for empty input', () => {
    const emptyData: any[] = [];
    const fields = discoverFields(emptyData);

    expect(fields).toEqual([]);
  });

  // Test 8: Handle deeply nested objects with depth limit
  test('limits nested field extraction to 3 levels deep', () => {
    const sampleData = [
      {
        level1: {
          level2: {
            level3: {
              level4: {
                tooDeep: 'should not appear'
              },
              value: 42
            }
          }
        }
      }
    ];

    const fields = discoverFields(sampleData);

    // Should find level3.value but not level3.level4.tooDeep
    expect(fields.some(f => f.path === 'level1.level2.level3.value')).toBe(true);
    expect(fields.some(f => f.path.includes('level4'))).toBe(false);
    expect(fields.some(f => f.path.includes('tooDeep'))).toBe(false);
  });
});

describe('Field Type Detection', () => {
  // Test detectFieldType utility function
  test('detectFieldType handles all type cases', () => {
    expect(detectFieldType(null)).toBe('unknown');
    expect(detectFieldType(undefined)).toBe('unknown');
    expect(detectFieldType(42)).toBe('number');
    expect(detectFieldType(3.14)).toBe('number');
    expect(detectFieldType('hello')).toBe('string');
    expect(detectFieldType(true)).toBe('boolean');
    expect(detectFieldType(false)).toBe('boolean');
    expect(detectFieldType([1, 2, 3])).toBe('array');
    expect(detectFieldType([])).toBe('array');
    expect(detectFieldType(new Date())).toBe('date');
    expect(detectFieldType('2024-01-15T10:30:00Z')).toBe('date');
    expect(detectFieldType({ nested: 'object' })).toBe('object');
  });
});

describe('Field Categorization', () => {
  // Test categorizeField utility function
  test('categorizes market data fields correctly', () => {
    expect(categorizeField('id')).toBe('Market Data');
    expect(categorizeField('question')).toBe('Market Data');
    expect(categorizeField('category')).toBe('Market Data');
    expect(categorizeField('volume')).toBe('Market Data');
    expect(categorizeField('liquidity')).toBe('Market Data');
    expect(categorizeField('currentPrice')).toBe('Market Data');
  });

  test('categorizes analytics fields correctly', () => {
    expect(categorizeField('analytics.roi')).toBe('Analytics');
    expect(categorizeField('analytics.sharpeRatio')).toBe('Analytics');
    expect(categorizeField('omega_ratio')).toBe('Analytics');
    expect(categorizeField('sharpe_ratio')).toBe('Analytics');
  });

  test('categorizes other fields as metadata', () => {
    expect(categorizeField('customField')).toBe('Metadata');
    expect(categorizeField('tags')).toBe('Metadata');
    expect(categorizeField('description')).toBe('Metadata');
  });
});

describe('Sample Value Formatting', () => {
  // Test formatSampleValue utility function
  test('formats sample values for display', () => {
    expect(formatSampleValue(42, 'number')).toBe('42');
    expect(formatSampleValue(3.14159, 'number')).toBe('3.14');
    expect(formatSampleValue('Hello World', 'string')).toBe('"Hello World"');
    expect(formatSampleValue(true, 'boolean')).toBe('true');
    expect(formatSampleValue(false, 'boolean')).toBe('false');
    expect(formatSampleValue([1, 2, 3], 'array')).toBe('[3 items]');
    expect(formatSampleValue(['a', 'b'], 'array')).toBe('[2 items]');
    expect(formatSampleValue([], 'array')).toBe('[empty]');
    expect(formatSampleValue('2024-01-15T10:30:00Z', 'date')).toContain('2024');
  });
});
