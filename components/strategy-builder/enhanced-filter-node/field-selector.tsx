/**
 * FIELD SELECTOR COMPONENT
 *
 * Task Group 2.3: Searchable dropdown for field selection with type icons
 * Displays discovered fields grouped by category with sample values
 */

"use client"

import React, { useMemo, useState } from 'react';
import { Search, Hash, Type, Calendar, CheckSquare, List, Code } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FieldDefinition, FieldType } from '@/lib/strategy-builder/types';

interface FieldSelectorProps {
  fields: FieldDefinition[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Get icon component for field type
 */
function getFieldTypeIcon(type: FieldType): React.ReactNode {
  const iconClass = "h-3.5 w-3.5";

  switch (type) {
    case 'number':
      return <Hash className={iconClass} />;
    case 'string':
      return <Type className={iconClass} />;
    case 'boolean':
      return <CheckSquare className={iconClass} />;
    case 'array':
      return <List className={iconClass} />;
    case 'date':
      return <Calendar className={iconClass} />;
    case 'object':
      return <Code className={iconClass} />;
    default:
      return <Type className={iconClass} />;
  }
}

/**
 * Get color class for field type
 */
function getFieldTypeColor(type: FieldType): string {
  switch (type) {
    case 'number':
      return 'text-blue-500';
    case 'string':
      return 'text-green-500';
    case 'boolean':
      return 'text-purple-500';
    case 'array':
      return 'text-orange-500';
    case 'date':
      return 'text-pink-500';
    case 'object':
      return 'text-gray-500';
    default:
      return 'text-gray-400';
  }
}

export default function FieldSelector({
  fields,
  value,
  onChange,
  placeholder = "Select field",
  className,
}: FieldSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Group fields by category
  const fieldsByCategory = useMemo(() => {
    const grouped = fields.reduce((acc, field) => {
      if (!acc[field.category]) {
        acc[field.category] = [];
      }
      acc[field.category].push(field);
      return acc;
    }, {} as Record<string, FieldDefinition[]>);

    // Sort categories: Market Data, Analytics, Metadata
    const categoryOrder = ['Market Data', 'Analytics', 'Metadata'];
    return categoryOrder
      .filter(category => grouped[category])
      .map(category => ({
        category,
        fields: grouped[category].sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [fields]);

  // Filter fields by search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return fieldsByCategory;
    }

    const query = searchQuery.toLowerCase();
    return fieldsByCategory
      .map(({ category, fields }) => ({
        category,
        fields: fields.filter(
          field =>
            field.name.toLowerCase().includes(query) ||
            field.path.toLowerCase().includes(query)
        ),
      }))
      .filter(({ fields }) => fields.length > 0);
  }, [fieldsByCategory, searchQuery]);

  // Get the selected field definition for display
  const selectedField = fields.find(f => f.path === value);

  return (
    <div className={cn("w-full", className)}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder}>
            {selectedField && (
              <div className="flex items-center gap-2">
                <span className={getFieldTypeColor(selectedField.type)}>
                  {getFieldTypeIcon(selectedField.type)}
                </span>
                <span className="truncate">{selectedField.path}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>

        <SelectContent className="max-h-[400px]">
          {/* Search input */}
          <div className="flex items-center gap-2 px-2 pb-2 border-b sticky top-0 bg-background z-10">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search fields..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          {/* No results message */}
          {filteredCategories.length === 0 && (
            <div className="px-2 py-4 text-sm text-muted-foreground text-center">
              No fields found
            </div>
          )}

          {/* Fields grouped by category */}
          {filteredCategories.map(({ category, fields }) => (
            <div key={category} className="py-1">
              {/* Category header */}
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {category}
              </div>

              {/* Fields in this category */}
              {fields.map((field) => (
                <SelectItem
                  key={field.path}
                  value={field.path}
                  className="cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-3 w-full">
                    {/* Field name with type icon */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={getFieldTypeColor(field.type)}>
                        {getFieldTypeIcon(field.type)}
                      </span>
                      <span className="truncate font-medium">
                        {field.path}
                      </span>
                    </div>

                    {/* Sample value */}
                    <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                      {field.sampleValue}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
