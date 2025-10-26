/**
 * Enhanced Filter Executor V2
 *
 * Task Group 6: Filter Executor Logic
 * Implements multi-condition filtering with AND/OR logic, all new operators,
 * category/tag filtering, text search, and filter failure tracking.
 *
 * Features:
 * - Multi-condition AND/OR logic
 * - All operators: EQUALS, NOT_EQUALS, GREATER_THAN, LESS_THAN, BETWEEN, IN, etc.
 * - Text search: CONTAINS, STARTS_WITH, ENDS_WITH (with case-sensitive option)
 * - Category filtering (case-insensitive)
 * - Tag filtering (array support)
 * - Filter failure tracking for debugging
 * - Performance optimized for 1000+ items
 */

import type { FilterCondition, FilterLogic, FilterOperator } from '@/lib/strategy-builder/types';

/**
 * Filter failures map: item ID -> failure reason
 * Example: { "market-123": "volume (45000) < 100000" }
 */
export type FilterFailures = Record<string, string>;

/**
 * Filter execution result
 */
export interface FilterExecutionResult {
  filtered: any[];
  count: number;
  originalCount: number;
  filterFailures: FilterFailures;
}

/**
 * Execute enhanced filter with multi-condition AND/OR logic
 *
 * @param data - Array of items to filter
 * @param conditions - Array of filter conditions
 * @param logic - AND or OR logic
 * @returns Filtered data with failure tracking
 */
export function executeFilterV2(
  data: any[],
  conditions: FilterCondition[],
  logic: FilterLogic = 'AND'
): FilterExecutionResult {
  // Handle edge cases
  if (!Array.isArray(data)) {
    data = data ? [data] : [];
  }

  if (!conditions || conditions.length === 0) {
    return {
      filtered: data,
      count: data.length,
      originalCount: data.length,
      filterFailures: {},
    };
  }

  const filterFailures: FilterFailures = {};
  const filtered: any[] = [];

  // Process each item
  for (const item of data) {
    const itemId = item.id || item.market_id || item.marketId || String(item);
    const { passes, failureReason } = evaluateConditions(item, conditions, logic);

    if (passes) {
      filtered.push(item);
    } else if (failureReason) {
      filterFailures[itemId] = failureReason;
    }
  }

  return {
    filtered,
    count: filtered.length,
    originalCount: data.length,
    filterFailures,
  };
}

/**
 * Evaluate all conditions against an item with AND/OR logic
 */
function evaluateConditions(
  item: any,
  conditions: FilterCondition[],
  logic: FilterLogic
): { passes: boolean; failureReason?: string } {
  if (logic === 'AND') {
    // ALL conditions must pass
    for (const condition of conditions) {
      const { passes, reason } = evaluateCondition(item, condition);
      if (!passes) {
        return { passes: false, failureReason: reason };
      }
    }
    return { passes: true };
  } else {
    // OR logic: ANY condition must pass
    let anyPassed = false;
    const failureReasons: string[] = [];

    for (const condition of conditions) {
      const { passes, reason } = evaluateCondition(item, condition);
      if (passes) {
        anyPassed = true;
        break;
      } else if (reason) {
        failureReasons.push(reason);
      }
    }

    if (anyPassed) {
      return { passes: true };
    } else {
      return {
        passes: false,
        failureReason: failureReasons.join(' AND '), // Show all failed conditions for OR
      };
    }
  }
}

/**
 * Evaluate a single condition against an item
 */
function evaluateCondition(
  item: any,
  condition: FilterCondition
): { passes: boolean; reason?: string } {
  const { field, operator, value, fieldType, caseSensitive } = condition;

  // Get field value from item (supports nested paths like 'analytics.roi')
  const itemValue = getFieldValue(item, field);

  // Evaluate based on operator
  const passes = evaluateOperator(itemValue, operator, value, fieldType, caseSensitive);

  // Generate failure reason if not passed
  if (!passes) {
    const reason = generateFailureReason(field, operator, itemValue, value);
    return { passes: false, reason };
  }

  return { passes: true };
}

/**
 * Get field value from item, supporting nested paths
 * Example: 'analytics.roi' -> item.analytics.roi
 */
function getFieldValue(item: any, fieldPath: string): any {
  const parts = fieldPath.split('.');
  let value = item;

  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[part];
  }

  return value;
}

/**
 * Evaluate an operator against item value and condition value
 */
function evaluateOperator(
  itemValue: any,
  operator: FilterOperator,
  conditionValue: any,
  fieldType?: string,
  caseSensitive?: boolean
): boolean {
  // Handle null/undefined
  if (operator === 'IS_NULL') {
    return itemValue === null || itemValue === undefined;
  }
  if (operator === 'IS_NOT_NULL') {
    return itemValue !== null && itemValue !== undefined;
  }

  // If item value is null/undefined and operator is not IS_NULL/IS_NOT_NULL, fail
  if (itemValue === null || itemValue === undefined) {
    return false;
  }

  switch (operator) {
    // Equality operators
    case 'EQUALS':
      return compareValues(itemValue, conditionValue, caseSensitive);

    case 'NOT_EQUALS':
      return !compareValues(itemValue, conditionValue, caseSensitive);

    // Comparison operators (numeric)
    case 'GREATER_THAN':
      return Number(itemValue) > Number(conditionValue);

    case 'GREATER_THAN_OR_EQUAL':
      return Number(itemValue) >= Number(conditionValue);

    case 'LESS_THAN':
      return Number(itemValue) < Number(conditionValue);

    case 'LESS_THAN_OR_EQUAL':
      return Number(itemValue) <= Number(conditionValue);

    // Range operator
    case 'BETWEEN':
      if (!Array.isArray(conditionValue) || conditionValue.length !== 2) {
        return false;
      }
      const numValue = Number(itemValue);
      return numValue >= Number(conditionValue[0]) && numValue <= Number(conditionValue[1]);

    // Set operators
    case 'IN':
      return evaluateInOperator(itemValue, conditionValue, fieldType, caseSensitive);

    case 'NOT_IN':
      return !evaluateInOperator(itemValue, conditionValue, fieldType, caseSensitive);

    // Text search operators
    case 'CONTAINS':
      return evaluateTextOperator(itemValue, conditionValue, 'contains', caseSensitive);

    case 'DOES_NOT_CONTAIN':
      return !evaluateTextOperator(itemValue, conditionValue, 'contains', caseSensitive);

    case 'STARTS_WITH':
      return evaluateTextOperator(itemValue, conditionValue, 'starts', caseSensitive);

    case 'ENDS_WITH':
      return evaluateTextOperator(itemValue, conditionValue, 'ends', caseSensitive);

    // Percentile operators (for advanced use cases)
    case 'IN_PERCENTILE':
    case 'NOT_IN_PERCENTILE':
      // TODO: Implement percentile logic (requires dataset context)
      console.warn('Percentile operators not yet implemented');
      return true;

    default:
      console.warn(`Unknown operator: ${operator}`);
      return true;
  }
}

/**
 * Compare two values with optional case sensitivity
 */
function compareValues(a: any, b: any, caseSensitive: boolean = false): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    if (caseSensitive) {
      return a === b;
    } else {
      return a.toLowerCase() === b.toLowerCase();
    }
  }
  return a === b;
}

/**
 * Evaluate IN operator with support for arrays and case sensitivity
 */
function evaluateInOperator(
  itemValue: any,
  conditionValue: any,
  fieldType?: string,
  caseSensitive?: boolean
): boolean {
  if (!Array.isArray(conditionValue)) {
    conditionValue = [conditionValue];
  }

  // If item value is an array (e.g., tags), check if any element is in condition value
  if (Array.isArray(itemValue)) {
    return itemValue.some(val =>
      conditionValue.some((condVal: any) => compareValues(val, condVal, caseSensitive))
    );
  }

  // Otherwise, check if item value is in condition value array
  return conditionValue.some((condVal: any) => compareValues(itemValue, condVal, caseSensitive));
}

/**
 * Evaluate text search operators (CONTAINS, STARTS_WITH, ENDS_WITH)
 */
function evaluateTextOperator(
  itemValue: any,
  conditionValue: any,
  mode: 'contains' | 'starts' | 'ends',
  caseSensitive: boolean = false
): boolean {
  const itemStr = String(itemValue);
  const condStr = String(conditionValue);

  const item = caseSensitive ? itemStr : itemStr.toLowerCase();
  const cond = caseSensitive ? condStr : condStr.toLowerCase();

  switch (mode) {
    case 'contains':
      return item.includes(cond);
    case 'starts':
      return item.startsWith(cond);
    case 'ends':
      return item.endsWith(cond);
    default:
      return false;
  }
}

/**
 * Generate human-readable failure reason for debugging
 */
function generateFailureReason(
  field: string,
  operator: FilterOperator,
  itemValue: any,
  conditionValue: any
): string {
  const formattedValue = formatValue(itemValue);
  const formattedCondition = formatValue(conditionValue);

  switch (operator) {
    case 'EQUALS':
      return `${field} (${formattedValue}) != ${formattedCondition}`;

    case 'NOT_EQUALS':
      return `${field} (${formattedValue}) == ${formattedCondition}`;

    case 'GREATER_THAN':
      return `${field} (${formattedValue}) <= ${formattedCondition}`;

    case 'GREATER_THAN_OR_EQUAL':
      return `${field} (${formattedValue}) < ${formattedCondition}`;

    case 'LESS_THAN':
      return `${field} (${formattedValue}) >= ${formattedCondition}`;

    case 'LESS_THAN_OR_EQUAL':
      return `${field} (${formattedValue}) > ${formattedCondition}`;

    case 'BETWEEN':
      if (Array.isArray(conditionValue) && conditionValue.length === 2) {
        return `${field} (${formattedValue}) not in [${conditionValue[0]}, ${conditionValue[1]}]`;
      }
      return `${field} (${formattedValue}) failed BETWEEN check`;

    case 'IN':
      return `${field} (${formattedValue}) not in [${formattedCondition}]`;

    case 'NOT_IN':
      return `${field} (${formattedValue}) in [${formattedCondition}]`;

    case 'CONTAINS':
      return `${field} (${formattedValue}) does not contain "${formattedCondition}"`;

    case 'DOES_NOT_CONTAIN':
      return `${field} (${formattedValue}) contains "${formattedCondition}"`;

    case 'STARTS_WITH':
      return `${field} (${formattedValue}) does not start with "${formattedCondition}"`;

    case 'ENDS_WITH':
      return `${field} (${formattedValue}) does not end with "${formattedCondition}"`;

    case 'IS_NULL':
      return `${field} is not null`;

    case 'IS_NOT_NULL':
      return `${field} is null`;

    default:
      return `${field} failed ${operator} check`;
  }
}

/**
 * Format value for display in failure reason
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
