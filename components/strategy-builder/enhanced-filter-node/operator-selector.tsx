/**
 * OPERATOR SELECTOR COMPONENT
 *
 * Task Group 3.2: Smart operator selector that filters operators based on field type
 * Task Group 5.3: Updated to support text search operators (CONTAINS, DOES_NOT_CONTAIN, STARTS_WITH, ENDS_WITH)
 * Shows only relevant operators for the selected field type
 */

"use client"

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FilterOperator, FieldType } from '@/lib/strategy-builder/types';

interface OperatorSelectorProps {
  value: FilterOperator;
  onChange: (operator: FilterOperator) => void;
  fieldType?: FieldType;
  className?: string;
}

/**
 * Operator definitions with labels and applicable field types
 */
interface OperatorDefinition {
  value: FilterOperator;
  label: string;
  fieldTypes: FieldType[];
}

/**
 * Complete operator list with field type compatibility
 * Numbers: =, !=, >, >=, <, <=, BETWEEN, IN_PERCENTILE, NOT_IN_PERCENTILE
 * Strings: =, !=, CONTAINS, DOES_NOT_CONTAIN, STARTS_WITH, ENDS_WITH, IN, IS_NULL, IS_NOT_NULL
 * Arrays: CONTAINS, HAS_ANY, HAS_ALL, IS_EMPTY
 * Dates: =, !=, >, >=, <, <=, BETWEEN
 */
const OPERATOR_DEFINITIONS: OperatorDefinition[] = [
  // Equality operators (all types)
  { value: 'EQUALS', label: '=', fieldTypes: ['number', 'string', 'boolean', 'date', 'unknown'] },
  { value: 'NOT_EQUALS', label: '!=', fieldTypes: ['number', 'string', 'boolean', 'date', 'unknown'] },

  // Comparison operators (numbers and dates)
  { value: 'GREATER_THAN', label: '>', fieldTypes: ['number', 'date'] },
  { value: 'GREATER_THAN_OR_EQUAL', label: '>=', fieldTypes: ['number', 'date'] },
  { value: 'LESS_THAN', label: '<', fieldTypes: ['number', 'date'] },
  { value: 'LESS_THAN_OR_EQUAL', label: '<=', fieldTypes: ['number', 'date'] },
  { value: 'BETWEEN', label: 'BETWEEN', fieldTypes: ['number', 'date'] },

  // Percentile operators (numbers only)
  { value: 'IN_PERCENTILE', label: 'IN PERCENTILE', fieldTypes: ['number'] },
  { value: 'NOT_IN_PERCENTILE', label: 'NOT IN PERCENTILE', fieldTypes: ['number'] },

  // String text search operators
  { value: 'CONTAINS', label: 'CONTAINS', fieldTypes: ['string'] },
  { value: 'DOES_NOT_CONTAIN', label: 'DOES NOT CONTAIN', fieldTypes: ['string'] },
  { value: 'STARTS_WITH', label: 'STARTS WITH', fieldTypes: ['string'] },
  { value: 'ENDS_WITH', label: 'ENDS WITH', fieldTypes: ['string'] },

  // String IN operator
  { value: 'IN', label: 'IN', fieldTypes: ['string', 'number'] },
  { value: 'NOT_IN', label: 'NOT IN', fieldTypes: ['string', 'number'] },

  // Null check operators (all types)
  { value: 'IS_NULL', label: 'IS NULL', fieldTypes: ['number', 'string', 'boolean', 'date', 'array', 'object', 'unknown'] },
  { value: 'IS_NOT_NULL', label: 'IS NOT NULL', fieldTypes: ['number', 'string', 'boolean', 'date', 'array', 'object', 'unknown'] },

  // Array-specific operators
  { value: 'CONTAINS', label: 'CONTAINS', fieldTypes: ['array'] },
  { value: 'IN', label: 'HAS ANY', fieldTypes: ['array'] },
  { value: 'NOT_IN', label: 'HAS ALL', fieldTypes: ['array'] },
];

/**
 * Get operators compatible with a field type
 */
function getOperatorsForFieldType(fieldType?: FieldType): OperatorDefinition[] {
  if (!fieldType) {
    // If no field type specified, show all operators
    return OPERATOR_DEFINITIONS;
  }

  // Filter operators by field type
  return OPERATOR_DEFINITIONS.filter(op =>
    op.fieldTypes.includes(fieldType)
  );
}

/**
 * Auto-select appropriate operator when field type changes
 */
function getDefaultOperator(fieldType?: FieldType): FilterOperator {
  switch (fieldType) {
    case 'number':
      return 'GREATER_THAN';
    case 'string':
      return 'CONTAINS';
    case 'array':
      return 'CONTAINS';
    case 'boolean':
      return 'EQUALS';
    case 'date':
      return 'GREATER_THAN';
    default:
      return 'EQUALS';
  }
}

export default function OperatorSelector({
  value,
  onChange,
  fieldType,
  className,
}: OperatorSelectorProps) {
  const availableOperators = getOperatorsForFieldType(fieldType);

  // Check if current value is valid for field type
  const isCurrentOperatorValid = availableOperators.some(op => op.value === value);

  // Auto-select default operator if current is invalid
  React.useEffect(() => {
    if (fieldType && !isCurrentOperatorValid) {
      const defaultOp = getDefaultOperator(fieldType);
      onChange(defaultOp);
    }
  }, [fieldType, isCurrentOperatorValid, onChange]);

  const handleChange = (newValue: string) => {
    onChange(newValue as FilterOperator);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Operator" />
      </SelectTrigger>
      <SelectContent>
        {availableOperators.map((op) => (
          <SelectItem key={`${op.value}-${op.label}`} value={op.value}>
            {op.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
