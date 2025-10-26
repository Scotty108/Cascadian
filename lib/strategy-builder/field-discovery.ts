/**
 * FIELD DISCOVERY UTILITY
 *
 * Task Group 2.2: Dynamic field discovery from upstream node outputs
 * Extracts all available fields from data, detects types, and provides metadata
 *
 * Purpose: Automatically discover all available fields from upstream node output data
 * for use in filter conditions. Supports nested fields and type inference.
 */

import type { FieldType, FieldCategory, FieldDefinition } from './types';

/**
 * Discover all fields from upstream output data
 *
 * Algorithm:
 * 1. Sample first 10 items (or all if less than 10)
 * 2. Extract all field paths from each sample
 * 3. Detect field types by inspecting values
 * 4. Categorize fields for UI grouping
 * 5. Format sample values for display
 *
 * @param upstreamOutput - Array of data items from upstream node
 * @returns Array of field definitions with metadata
 */
export function discoverFields(upstreamOutput: any[]): FieldDefinition[] {
  // Handle empty or invalid input
  if (!upstreamOutput || upstreamOutput.length === 0) {
    return [];
  }

  // Sample up to 10 items to discover fields
  const sampleSize = Math.min(10, upstreamOutput.length);
  const samples = upstreamOutput.slice(0, sampleSize);

  // Map to track discovered fields (keyed by path)
  const fieldMap = new Map<string, FieldDefinition>();

  // Extract fields from each sample
  samples.forEach(item => {
    if (item && typeof item === 'object') {
      extractFieldsFromObject(item, '', fieldMap, item);
    }
  });

  // Convert map to array and return
  return Array.from(fieldMap.values());
}

/**
 * Recursively extract fields from an object
 *
 * @param obj - Object to extract fields from
 * @param prefix - Current path prefix (e.g., 'analytics')
 * @param fieldMap - Map to store discovered fields
 * @param sampleValue - Sample value for this field
 */
export function extractFieldsFromObject(
  obj: any,
  prefix: string,
  fieldMap: Map<string, FieldDefinition>,
  sampleValue: any
): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  Object.keys(obj).forEach(key => {
    // Build full path (e.g., 'analytics.roi')
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    const type = detectFieldType(value);

    // Count depth by number of segments in path (level1 = 1, level1.level2 = 2, etc.)
    const pathDepth = path.split('.').length;

    // Limit recursion to 3 levels deep
    // This means we can extract primitive fields at depth 4 (like level1.level2.level3.value)
    // but we won't recurse into objects at depth 3 (so no level1.level2.level3.objectField.deeperField)
    if (pathDepth > 3) {
      // At depth 4+, only add non-object fields (primitives like numbers, strings, etc.)
      // Don't add objects since we won't recurse into them anyway
      if (type !== 'object' && !fieldMap.has(path)) {
        fieldMap.set(path, {
          path,
          name: key,
          type,
          category: categorizeField(path),
          sampleValue: formatSampleValue(value, type),
        });
      }
      return;
    }

    // Add field to map if not already present (for depths 1-3)
    if (!fieldMap.has(path)) {
      fieldMap.set(path, {
        path,
        name: key,
        type,
        category: categorizeField(path),
        sampleValue: formatSampleValue(value, type),
      });
    }

    // Recurse for nested objects (but not beyond depth 3)
    // This allows extraction of depth 4 primitive fields, but prevents going deeper
    if (type === 'object' && pathDepth <= 3) {
      extractFieldsFromObject(value, path, fieldMap, value);
    }
  });
}

/**
 * Detect field type from a value
 *
 * @param value - Value to inspect
 * @returns Detected field type
 */
export function detectFieldType(value: any): FieldType {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return 'unknown';
  }

  // Check primitive types
  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  // Check for array (before object check since arrays are objects)
  if (Array.isArray(value)) {
    return 'array';
  }

  // Check for Date object or ISO date string
  if (value instanceof Date) {
    return 'date';
  }

  // Check if string looks like ISO date (YYYY-MM-DD format)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return 'date';
  }

  // Check for object
  if (typeof value === 'object') {
    return 'object';
  }

  // Default to string
  return 'string';
}

/**
 * Categorize a field based on its path
 *
 * Groups fields into categories for UI organization:
 * - Market Data: Core market fields (id, question, category, volume, etc.)
 * - Analytics: Analytical metrics (roi, sharpe ratio, omega ratio, etc.)
 * - Metadata: Everything else
 *
 * @param path - Field path (e.g., 'analytics.roi')
 * @returns Field category
 */
export function categorizeField(path: string): FieldCategory {
  // Market data fields (common Polymarket fields)
  const marketDataFields = [
    'id',
    'question',
    'category',
    'volume',
    'liquidity',
    'currentPrice',
    'price',
    'active',
    'endDate',
    'startDate',
    'createdAt',
    'updatedAt',
  ];

  // Check if it's a market data field
  if (marketDataFields.includes(path)) {
    return 'Market Data';
  }

  // Analytics fields (nested under analytics or ending with certain patterns)
  if (path.startsWith('analytics.')) {
    return 'Analytics';
  }

  // Common analytical metric patterns
  const analyticsPatterns = [
    '_ratio',
    '_score',
    'omega',
    'sharpe',
    'sortino',
    'roi',
    'pnl',
    'volatility',
    'momentum',
  ];

  if (analyticsPatterns.some(pattern => path.toLowerCase().includes(pattern))) {
    return 'Analytics';
  }

  // Default to metadata
  return 'Metadata';
}

/**
 * Format a sample value for display in UI
 *
 * @param value - Value to format
 * @param type - Field type
 * @returns Formatted string for display
 */
export function formatSampleValue(value: any, type: FieldType): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  switch (type) {
    case 'number':
      // Format numbers with max 2 decimal places
      if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(2);
      }
      return String(value);

    case 'string':
      // Wrap strings in quotes and truncate if too long
      const str = String(value);
      const maxLength = 50;
      if (str.length > maxLength) {
        return `"${str.substring(0, maxLength)}..."`;
      }
      return `"${str}"`;

    case 'boolean':
      return String(value);

    case 'array':
      // Show array length
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return '[empty]';
        }
        return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
      }
      return '[array]';

    case 'date':
      // Format date strings
      if (value instanceof Date) {
        return value.toISOString().split('T')[0]; // YYYY-MM-DD
      }
      if (typeof value === 'string') {
        // Extract date part from ISO string
        const dateMatch = value.match(/^\d{4}-\d{2}-\d{2}/);
        return dateMatch ? dateMatch[0] : value;
      }
      return String(value);

    case 'object':
      return '{object}';

    case 'unknown':
      return 'unknown';

    default:
      return String(value);
  }
}
