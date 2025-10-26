/**
 * MULTI-CONDITION BUILDER COMPONENT
 *
 * Task Group 1.3: Container component managing array of conditions
 * Supports 2-10 conditions with AND/OR logic
 */

"use client"

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConditionRow from './condition-row';
import type { FilterCondition, FilterLogic, EnhancedFilterConfig, FieldDefinition } from '@/lib/strategy-builder/types';

interface MultiConditionBuilderProps {
  conditions: FilterCondition[];
  logic: FilterLogic;
  onChange: (config: { conditions: FilterCondition[]; logic: FilterLogic }) => void;
  availableFields?: FieldDefinition[];
  useSmartInputs?: boolean; // Enable smart operator/value inputs (default: true when availableFields provided)
}

const MAX_CONDITIONS = 10;
const MIN_CONDITIONS = 1;

export default function MultiConditionBuilder({
  conditions,
  logic,
  onChange,
  availableFields,
  useSmartInputs = !!availableFields, // Default to true if availableFields provided
}: MultiConditionBuilderProps) {
  const handleAddCondition = () => {
    if (conditions.length >= MAX_CONDITIONS) {
      return;
    }

    const newCondition: FilterCondition = {
      id: `condition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      field: '',
      operator: 'EQUALS',
      value: '',
    };

    onChange({
      conditions: [...conditions, newCondition],
      logic,
    });
  };

  const handleUpdateCondition = (index: number, updatedCondition: FilterCondition) => {
    const newConditions = [...conditions];
    newConditions[index] = updatedCondition;

    onChange({
      conditions: newConditions,
      logic,
    });
  };

  const handleRemoveCondition = (index: number) => {
    if (conditions.length <= MIN_CONDITIONS) {
      return;
    }

    const newConditions = conditions.filter((_, i) => i !== index);

    onChange({
      conditions: newConditions,
      logic,
    });
  };

  const handleToggleLogic = () => {
    onChange({
      conditions,
      logic: logic === 'AND' ? 'OR' : 'AND',
    });
  };

  const canAddCondition = conditions.length < MAX_CONDITIONS;
  const canRemoveCondition = conditions.length > MIN_CONDITIONS;
  const showLogicToggle = conditions.length > 1;

  return (
    <div className="space-y-4">
      {/* Conditions List */}
      <div className="space-y-3">
        {conditions.map((condition, index) => (
          <div key={condition.id}>
            <ConditionRow
              condition={condition}
              onUpdate={(updated) => handleUpdateCondition(index, updated)}
              onRemove={() => handleRemoveCondition(index)}
              canRemove={canRemoveCondition}
              availableFields={availableFields}
              useFieldSelector={!!availableFields}
              useSmartInputs={useSmartInputs}
            />

            {/* AND/OR Toggle Between Conditions */}
            {showLogicToggle && index < conditions.length - 1 && (
              <div className="flex items-center justify-center my-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleLogic}
                  className="min-w-[80px] font-semibold"
                  aria-label={`Toggle logic operator (currently ${logic})`}
                >
                  {logic}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Condition Button */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddCondition}
          disabled={!canAddCondition}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Condition
        </Button>

        {conditions.length >= MAX_CONDITIONS && (
          <p className="text-xs text-muted-foreground">
            Maximum {MAX_CONDITIONS} conditions reached
          </p>
        )}

        {conditions.length < MAX_CONDITIONS && conditions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {conditions.length} / {MAX_CONDITIONS} conditions
          </p>
        )}
      </div>

      {/* Visual Hierarchy Helper */}
      {showLogicToggle && (
        <div className="mt-4 p-3 bg-muted/50 rounded-md border border-border/50">
          <p className="text-xs text-muted-foreground font-mono">
            {conditions.map((c, i) => (
              <span key={c.id}>
                {i > 0 && <span className="font-bold text-foreground"> {logic} </span>}
                ({c.field || '...'} {c.operator || '...'} {c.value || '...'})
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
