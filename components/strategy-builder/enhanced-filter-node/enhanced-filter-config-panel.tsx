/**
 * ENHANCED FILTER CONFIGURATION PANEL
 *
 * Task Group 7.3: Side panel for configuring multi-condition filters
 * - Embeds multi-condition builder component
 * - Save/Cancel buttons
 * - Real-time validation feedback
 * - Preview of filter logic in plain English
 */

"use client"

import React, { useState, useMemo } from 'react';
import { X, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import MultiConditionBuilder from './multi-condition-builder';
import type { EnhancedFilterConfig, FilterCondition, FilterLogic, FieldDefinition } from '@/lib/strategy-builder/types';

interface EnhancedFilterConfigPanelProps {
  nodeId: string;
  config: EnhancedFilterConfig;
  onSave: (nodeId: string, data: { config: EnhancedFilterConfig }) => void;
  onClose: () => void;
  availableFields?: FieldDefinition[];
}

export default function EnhancedFilterConfigPanel({
  nodeId,
  config,
  onSave,
  onClose,
  availableFields,
}: EnhancedFilterConfigPanelProps) {
  const [localConfig, setLocalConfig] = useState<EnhancedFilterConfig>(config);

  // Validation
  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (localConfig.conditions.length === 0) {
      errors.push('At least one condition is required');
    }

    localConfig.conditions.forEach((condition, index) => {
      if (!condition.field) {
        errors.push(`Condition ${index + 1}: Field is required`);
      }
      if (!condition.operator) {
        errors.push(`Condition ${index + 1}: Operator is required`);
      }
      if (condition.value === null || condition.value === undefined || condition.value === '') {
        errors.push(`Condition ${index + 1}: Value is required`);
      }
    });

    // Check for potentially conflicting conditions
    if (localConfig.logic === 'AND') {
      // Look for contradictory conditions on same field
      const fieldGroups = localConfig.conditions.reduce((acc, cond) => {
        if (!acc[cond.field]) acc[cond.field] = [];
        acc[cond.field].push(cond);
        return acc;
      }, {} as Record<string, FilterCondition[]>);

      Object.entries(fieldGroups).forEach(([field, conditions]) => {
        if (conditions.length > 1) {
          warnings.push(`Multiple conditions on "${field}" with AND logic may be restrictive`);
        }
      });
    }

    const isValid = errors.length === 0;

    return { isValid, errors, warnings };
  }, [localConfig]);

  // Generate human-readable filter preview
  const filterPreview = useMemo(() => {
    if (localConfig.conditions.length === 0) {
      return 'No conditions configured';
    }

    const conditionTexts = localConfig.conditions.map((cond) => {
      const operatorText = {
        EQUALS: 'equals',
        NOT_EQUALS: 'does not equal',
        GREATER_THAN: 'is greater than',
        GREATER_THAN_OR_EQUAL: 'is greater than or equal to',
        LESS_THAN: 'is less than',
        LESS_THAN_OR_EQUAL: 'is less than or equal to',
        IN: 'is in',
        NOT_IN: 'is not in',
        CONTAINS: 'contains',
        DOES_NOT_CONTAIN: 'does not contain',
        STARTS_WITH: 'starts with',
        ENDS_WITH: 'ends with',
        BETWEEN: 'is between',
      }[cond.operator] || cond.operator;

      const valueText = Array.isArray(cond.value)
        ? `[${cond.value.join(', ')}]`
        : typeof cond.value === 'string'
        ? `"${cond.value}"`
        : cond.value;

      return `${cond.field} ${operatorText} ${valueText}`;
    });

    const logicText = localConfig.logic.toLowerCase();

    if (conditionTexts.length === 1) {
      return conditionTexts[0];
    }

    return conditionTexts.join(` ${logicText} `);
  }, [localConfig]);

  const handleChange = (updates: { conditions: FilterCondition[]; logic: FilterLogic }) => {
    setLocalConfig({
      ...localConfig,
      conditions: updates.conditions,
      logic: updates.logic,
    });
  };

  const handleSave = () => {
    if (validation.isValid) {
      onSave(nodeId, { config: localConfig });
      onClose();
    }
  };

  return (
    <div className="flex h-full w-[500px] flex-col border-l border-border/40 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 p-4">
        <div>
          <h3 className="text-lg font-semibold">Enhanced Filter Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Configure multi-condition filtering with AND/OR logic
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          {/* Multi-Condition Builder */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Filter Conditions</h4>
            <MultiConditionBuilder
              conditions={localConfig.conditions}
              logic={localConfig.logic}
              onChange={handleChange}
              availableFields={availableFields}
            />
          </div>

          {/* Filter Preview */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Filter Preview</h4>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-sm font-mono text-foreground leading-relaxed">
                {filterPreview}
              </p>
            </div>
          </div>

          {/* Validation Feedback */}
          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="space-y-2">
              {validation.errors.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                        Validation Errors
                      </p>
                      <ul className="text-xs text-red-600 dark:text-red-300 space-y-1">
                        {validation.errors.map((error, index) => (
                          <li key={index}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {validation.warnings.length > 0 && (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">
                        Warnings
                      </p>
                      <ul className="text-xs text-yellow-600 dark:text-yellow-300 space-y-1">
                        {validation.warnings.map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Success Indicator */}
          {validation.isValid && validation.warnings.length === 0 && (
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <p className="text-sm text-green-700 dark:text-green-400">
                  Configuration is valid and ready to save
                </p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-border/40 p-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!validation.isValid}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          Save Configuration
        </Button>
      </div>
    </div>
  );
}
