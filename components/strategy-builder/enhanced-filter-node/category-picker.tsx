/**
 * CATEGORY PICKER COMPONENT
 *
 * Task Group 4.2: Category picker for Polymarket categories
 * Provides a searchable dropdown for selecting Polymarket market categories
 * with single-select or multi-select support based on operator
 */

"use client"

import React, { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, TrendingUp, Coins, Trophy, Star, Lightbulb, Briefcase, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Predefined Polymarket categories
 * These are the main categories used on Polymarket platform
 */
export const POLYMARKET_CATEGORIES = [
  { value: 'Politics', label: 'Politics', icon: TrendingUp },
  { value: 'Crypto', label: 'Crypto', icon: Coins },
  { value: 'Sports', label: 'Sports', icon: Trophy },
  { value: 'Pop Culture', label: 'Pop Culture', icon: Star },
  { value: 'Science', label: 'Science', icon: Lightbulb },
  { value: 'Business', label: 'Business', icon: Briefcase },
  { value: 'Technology', label: 'Technology', icon: Lightbulb },
  { value: 'News', label: 'News', icon: Globe },
  { value: 'Weather', label: 'Weather', icon: Globe },
  { value: 'Other', label: 'Other', icon: Globe },
] as const;

export type PolymarketCategory = typeof POLYMARKET_CATEGORIES[number]['value'];

interface CategoryPickerProps {
  value: string | string[];
  onChange: (value: string | string[]) => void;
  className?: string;
  placeholder?: string;
  multiSelect?: boolean;
}

/**
 * CategoryPicker component for selecting Polymarket categories
 * Supports both single-select and multi-select modes
 */
export default function CategoryPicker({
  value,
  onChange,
  className,
  placeholder = 'Select category',
  multiSelect = false,
}: CategoryPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  // Filter categories based on search query
  const filteredCategories = POLYMARKET_CATEGORIES.filter(category =>
    category.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle single select
  const handleSingleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    setIsOpen(false);
    setSearchQuery('');
  };

  // Handle multi-select
  const handleMultiSelect = (selectedValue: string) => {
    const currentValues = Array.isArray(value) ? value : [];

    if (currentValues.includes(selectedValue)) {
      // Remove if already selected
      onChange(currentValues.filter(v => v !== selectedValue));
    } else {
      // Add to selection
      onChange([...currentValues, selectedValue]);
    }
  };

  // Remove a selected category (multi-select only)
  const handleRemoveCategory = (categoryToRemove: string) => {
    if (Array.isArray(value)) {
      onChange(value.filter(v => v !== categoryToRemove));
    }
  };

  // Get display value for trigger
  const getDisplayValue = () => {
    if (multiSelect && Array.isArray(value)) {
      if (value.length === 0) return placeholder;
      if (value.length === 1) return value[0];
      return `${value.length} categories selected`;
    }
    return value || placeholder;
  };

  // For multi-select mode, render chips
  if (multiSelect && Array.isArray(value) && value.length > 0) {
    return (
      <div className={cn("space-y-2", className)}>
        {/* Selected categories as chips */}
        <div className="flex flex-wrap gap-2">
          {value.map((category) => {
            const categoryDef = POLYMARKET_CATEGORIES.find(c => c.value === category);
            const Icon = categoryDef?.icon || Globe;

            return (
              <Badge
                key={category}
                variant="secondary"
                className="flex items-center gap-1 px-2 py-1"
              >
                <Icon className="h-3 w-3" />
                <span>{category}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveCategory(category)}
                  className="ml-1 hover:text-destructive"
                  aria-label={`Remove ${category}`}
                >
                  ×
                </button>
              </Badge>
            );
          })}
        </div>

        {/* Dropdown to add more */}
        <Select value="" onValueChange={handleMultiSelect}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Add category" />
          </SelectTrigger>
          <SelectContent>
            {/* Search input */}
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search categories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                  autoFocus
                />
              </div>
            </div>

            {/* Category options */}
            {filteredCategories.length > 0 ? (
              filteredCategories.map((category) => {
                const Icon = category.icon;
                const isSelected = value.includes(category.value);

                return (
                  <SelectItem
                    key={category.value}
                    value={category.value}
                    disabled={isSelected}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span>{category.label}</span>
                      {isSelected && (
                        <Badge variant="outline" className="ml-auto text-xs">
                          Selected
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                );
              })
            ) : (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No categories found
              </div>
            )}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Single-select mode
  return (
    <Select value={value as string} onValueChange={handleSingleSelect}>
      <SelectTrigger className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder}>
          {value && (
            <div className="flex items-center gap-2">
              {(() => {
                const categoryDef = POLYMARKET_CATEGORIES.find(c => c.value === value);
                const Icon = categoryDef?.icon || Globe;
                return (
                  <>
                    <Icon className="h-4 w-4" />
                    <span>{value}</span>
                  </>
                );
              })()}
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {/* Search input */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>
        </div>

        {/* Category options */}
        {filteredCategories.length > 0 ? (
          filteredCategories.map((category) => {
            const Icon = category.icon;

            return (
              <SelectItem key={category.value} value={category.value}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span>{category.label}</span>
                </div>
              </SelectItem>
            );
          })
        ) : (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No categories found
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
