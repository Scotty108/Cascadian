/**
 * CONDITION ROW COMPONENT
 *
 * Task Group 1.4: Single condition row with field selector, operator, and value
 * Task Group 3.4: Updated with smart operator and value input components
 * Task Group 5.3: Updated to support text search with case-sensitive toggle
 * Supports responsive layout and remove functionality
 */

"use client"

import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import FieldSelector from './field-selector';
import OperatorSelector from './operator-selector';
import ValueInput from './value-input';
import type { FilterCondition, FilterOperator, FieldDefinition } from '@/lib/strategy-builder/types';

interface ConditionRowProps {
  condition: FilterCondition;
  onUpdate: (condition: FilterCondition) => void;
  onRemove: () => void;
  canRemove: boolean;
  availableFields?: FieldDefinition[];
  useFieldSelector?: boolean;
  useSmartInputs?: boolean; // Enable smart operator and value inputs
}

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'EQUALS', label: '=' },
  { value: 'NOT_EQUALS', label: '!=' },
  { value: 'GREATER_THAN', label: '>' },
  { value: 'GREATER_THAN_OR_EQUAL', label: '>=' },
  { value: 'LESS_THAN', label: '<' },
  { value: 'LESS_THAN_OR_EQUAL', label: '<=' },
  { value: 'IN', label: 'IN' },
  { value: 'NOT_IN', label: 'NOT IN' },
  { value: 'CONTAINS', label: 'CONTAINS' },
  { value: 'BETWEEN', label: 'BETWEEN' },
];

const DEFAULT_FIELDS = [
  'volume',
  'liquidity',
  'current_price',
  'category',
  'title',
  'question',
  'end_date',
];

export default function ConditionRow({
  condition,
  onUpdate,
  onRemove,
  canRemove,
  availableFields,
  useFieldSelector = false,
  useSmartInputs = false,
}: ConditionRowProps) {
  // Get field type from available fields if using smart inputs
  const fieldType = React.useMemo(() => {
    if (!useSmartInputs || !availableFields || !condition.field) {
      return condition.fieldType || 'string';
    }
    const field = availableFields.find(f => f.path === condition.field);
    return field?.type || 'string';
  }, [useSmartInputs, availableFields, condition.field, condition.fieldType]);

  const handleFieldChange = (field: string) => {
    // Update field type when field changes
    if (useSmartInputs && availableFields) {
      const fieldDef = availableFields.find(f => f.path === field);
      onUpdate({ ...condition, field, fieldType: fieldDef?.type });
    } else {
      onUpdate({ ...condition, field });
    }
  };

  const handleOperatorChange = (operator: FilterOperator) => {
    onUpdate({ ...condition, operator });
  };

  const handleValueChange = (value: any) => {
    onUpdate({ ...condition, value });
  };

  const handleCaseSensitiveChange = (caseSensitive: boolean) => {
    onUpdate({ ...condition, caseSensitive });
  };

  const handleLegacyValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;

    // Try to parse as number if it looks like a number
    let value: any = rawValue;
    if (!isNaN(Number(rawValue)) && rawValue !== '') {
      value = Number(rawValue);
    }

    onUpdate({ ...condition, value });
  };

  return (
    <div
      data-testid={`condition-row-${condition.id}`}
      className="flex flex-col sm:flex-row gap-2 items-start sm:items-center p-3 bg-muted/30 rounded-lg border border-border"
    >
      {/* Field Selector */}
      <div className="flex-1 min-w-[150px]">
        {useFieldSelector && availableFields ? (
          <FieldSelector
            fields={availableFields}
            value={condition.field}
            onChange={handleFieldChange}
            placeholder="Select field"
          />
        ) : (
          <Select value={condition.field} onValueChange={handleFieldChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select field" />
            </SelectTrigger>
            <SelectContent>
              {(availableFields
                ? availableFields.map(f => f.path)
                : DEFAULT_FIELDS
              ).map((field) => (
                <SelectItem key={field} value={field}>
                  {field}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Operator Selector */}
      <div className="w-full sm:w-[140px]">
        {useSmartInputs ? (
          <OperatorSelector
            value={condition.operator}
            onChange={handleOperatorChange}
            fieldType={fieldType}
            className="w-full"
          />
        ) : (
          <Select value={condition.operator} onValueChange={handleOperatorChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Operator" />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Value Input */}
      <div className="flex-1 min-w-[150px]">
        {useSmartInputs ? (
          <ValueInput
            value={condition.value}
            onChange={handleValueChange}
            fieldType={fieldType}
            operator={condition.operator}
            fieldName={condition.field}
            caseSensitive={condition.caseSensitive ?? false}
            onCaseSensitiveChange={handleCaseSensitiveChange}
            className="w-full"
          />
        ) : (
          <Input
            type="text"
            value={condition.value}
            onChange={handleLegacyValueChange}
            placeholder="Value"
            className="w-full"
          />
        )}
      </div>

      {/* Remove Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="Remove condition"
        className="shrink-0 hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
