/**
 * TEXT SEARCH INPUT COMPONENT
 *
 * Task Group 5.2: Text search input with case-sensitive toggle
 * Supports CONTAINS, DOES_NOT_CONTAIN, STARTS_WITH, ENDS_WITH operators
 */

"use client"

import React from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FilterOperator } from '@/lib/strategy-builder/types';

interface TextSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (caseSensitive: boolean) => void;
  operator: FilterOperator;
  className?: string;
  placeholder?: string;
}

/**
 * Check if operator is a text search operator
 */
export function isTextSearchOperator(operator: FilterOperator): boolean {
  return ['CONTAINS', 'DOES_NOT_CONTAIN', 'STARTS_WITH', 'ENDS_WITH'].includes(operator);
}

/**
 * Text search input with search icon and case-sensitive toggle
 */
export default function TextSearchInput({
  value,
  onChange,
  caseSensitive,
  onCaseSensitiveChange,
  operator,
  className,
  placeholder = 'Search text...',
}: TextSearchInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleCaseSensitiveChange = (checked: boolean | 'indeterminate') => {
    onCaseSensitiveChange(checked === true);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Search input with icon */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={value ?? ''}
          onChange={handleChange}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>

      {/* Case-sensitive toggle */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="case-sensitive"
          checked={caseSensitive}
          onCheckedChange={handleCaseSensitiveChange}
        />
        <Label
          htmlFor="case-sensitive"
          className="text-sm text-muted-foreground cursor-pointer"
        >
          Case sensitive
        </Label>
      </div>
    </div>
  );
}
