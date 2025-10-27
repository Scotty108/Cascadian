/**
 * VALUE INPUT COMPONENT
 *
 * Task Group 3.3: Smart value input that adapts to field type and operator
 * Task Group 4.4: Enhanced with category and tag picker support
 * Task Group 5.3: Enhanced with text search input support
 * Handles different input types: number, string, array, date, boolean, category, tag, text search
 * Special handling for BETWEEN operator (shows two inputs)
 */

"use client"

import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { CalendarIcon, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import CategoryPicker from './category-picker';
import TagPicker from './tag-picker';
import TextSearchInput, { isTextSearchOperator } from './text-search-input';
import type { FilterOperator, FieldType } from '@/lib/strategy-builder/types';

interface ValueInputProps {
  value: any;
  onChange: (value: any) => void;
  fieldType?: FieldType;
  operator: FilterOperator;
  className?: string;
  placeholder?: string;
  fieldName?: string; // Used to detect category/tag fields by name
  caseSensitive?: boolean; // For text search operators
  onCaseSensitiveChange?: (caseSensitive: boolean) => void;
}

/**
 * Number input with increment/decrement buttons
 */
function NumberInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const handleIncrement = () => {
    const numValue = Number(value) || 0;
    onChange(numValue + 1);
  };

  const handleDecrement = () => {
    const numValue = Number(value) || 0;
    onChange(numValue - 1);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const strValue = e.target.value;
    // Allow empty string during editing
    if (strValue === '') {
      onChange(0);
      return;
    }
    const numValue = Number(strValue);
    if (!isNaN(numValue)) {
      onChange(numValue);
    }
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleDecrement}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <Input
        type="number"
        value={value ?? ''}
        onChange={handleChange}
        placeholder={placeholder}
        className="text-center"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleIncrement}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}

/**
 * Date picker input
 */
function DateInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: Date | string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [date, setDate] = React.useState<Date | undefined>(
    value ? (typeof value === 'string' ? new Date(value) : value) : undefined
  );

  const handleSelect = (newDate: Date | undefined) => {
    setDate(newDate);
    if (newDate) {
      onChange(format(newDate, 'yyyy-MM-dd'));
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, 'PPP') : <span>{placeholder || 'Pick a date'}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelect}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Boolean toggle switch
 */
function BooleanInput({
  value,
  onChange,
  className,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Switch
        checked={value ?? false}
        onCheckedChange={onChange}
      />
      <span className="text-sm text-muted-foreground">
        {value ? 'True' : 'False'}
      </span>
    </div>
  );
}

/**
 * Range input for BETWEEN operator (two number inputs or date inputs)
 */
function RangeInput({
  value,
  onChange,
  fieldType,
  className,
}: {
  value: [number, number] | [string, string] | any[];
  onChange: (value: [number, number] | [string, string]) => void;
  fieldType?: FieldType;
  className?: string;
}) {
  const [from, to] = Array.isArray(value) ? value : [0, 0];

  const handleFromChange = (newFrom: number) => {
    onChange([newFrom, to as number]);
  };

  const handleToChange = (newTo: number) => {
    onChange([from as number, newTo]);
  };

  if (fieldType === 'date') {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <DateInput
          value={from}
          onChange={(val) => onChange([val, to as string])}
          placeholder="From"
          className="flex-1"
        />
        <span className="text-muted-foreground">to</span>
        <DateInput
          value={to}
          onChange={(val) => onChange([from as string, val])}
          placeholder="To"
          className="flex-1"
        />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <NumberInput
        value={from}
        onChange={handleFromChange}
        placeholder="From"
        className="flex-1"
      />
      <span className="text-muted-foreground">to</span>
      <NumberInput
        value={to}
        onChange={handleToChange}
        placeholder="To"
        className="flex-1"
      />
    </div>
  );
}

/**
 * Main value input component that adapts to field type and operator
 */
export default function ValueInput({
  value,
  onChange,
  fieldType = 'string',
  operator,
  className,
  placeholder = 'Value',
  fieldName = '',
  caseSensitive = false,
  onCaseSensitiveChange,
}: ValueInputProps) {
  // Detect if this is a category or tag field
  const isCategoryField = fieldType === 'string' &&
    (fieldName.toLowerCase().includes('category') || fieldName === 'category');
  const isTagField = fieldType === 'array' ||
    fieldName.toLowerCase().includes('tag') ||
    fieldName === 'tags' ||
    fieldName === 'tag';

  // Text search operators for string fields (CONTAINS, DOES_NOT_CONTAIN, STARTS_WITH, ENDS_WITH)
  if (fieldType === 'string' && isTextSearchOperator(operator)) {
    return (
      <TextSearchInput
        value={value}
        onChange={onChange}
        caseSensitive={caseSensitive}
        onCaseSensitiveChange={onCaseSensitiveChange || (() => {})}
        operator={operator}
        className={className}
        placeholder={placeholder || 'Search text...'}
      />
    );
  }

  // BETWEEN operator always shows range input
  if (operator === 'BETWEEN') {
    return (
      <RangeInput
        value={value}
        onChange={onChange}
        fieldType={fieldType}
        className={className}
      />
    );
  }

  // Category picker for category fields
  if (isCategoryField) {
    // Multi-select for IN/NOT_IN operators, single-select otherwise
    const multiSelect = operator === 'IN' || operator === 'NOT_IN';

    return (
      <CategoryPicker
        value={value}
        onChange={onChange}
        className={className}
        placeholder={placeholder || 'Select category'}
        multiSelect={multiSelect}
      />
    );
  }

  // Tag picker for tag fields
  if (isTagField) {
    // Ensure value is always an array for tag picker
    const arrayValue = Array.isArray(value) ? value : (value ? [value] : []);

    return (
      <TagPicker
        value={arrayValue}
        onChange={onChange}
        className={className}
        placeholder={placeholder || 'Select tags'}
      />
    );
  }

  // Type-specific inputs
  switch (fieldType) {
    case 'number':
      return (
        <NumberInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={className}
        />
      );

    case 'date':
      return (
        <DateInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={className}
        />
      );

    case 'boolean':
      return (
        <BooleanInput
          value={value}
          onChange={onChange}
          className={className}
        />
      );

    case 'string':
    default:
      // String input with autocomplete (future enhancement)
      const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
      };

      return (
        <Input
          type="text"
          value={value ?? ''}
          onChange={handleChange}
          placeholder={placeholder}
          className={className}
        />
      );
  }
}
