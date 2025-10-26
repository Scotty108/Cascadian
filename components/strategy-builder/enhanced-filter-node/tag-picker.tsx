/**
 * TAG PICKER COMPONENT
 *
 * Task Group 4.3: Tag picker for Polymarket tags
 * Provides a multi-select dropdown with autocomplete for selecting tags
 * Displays selected tags as chips/badges with remove functionality
 */

"use client"

import React, { useState, useEffect } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronsUpDown, X, Tag as TagIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Common Polymarket tags (predefined list for autocomplete)
 * In production, these could be fetched from an API endpoint
 */
export const COMMON_TAGS = [
  { value: 'election', label: 'election', popularity: 1500 },
  { value: 'bitcoin', label: 'bitcoin', popularity: 1200 },
  { value: 'trump', label: 'trump', popularity: 2000 },
  { value: 'biden', label: 'biden', popularity: 1800 },
  { value: 'AI', label: 'AI', popularity: 900 },
  { value: 'ethereum', label: 'ethereum', popularity: 800 },
  { value: 'economy', label: 'economy', popularity: 700 },
  { value: 'climate', label: 'climate', popularity: 600 },
  { value: 'stocks', label: 'stocks', popularity: 850 },
  { value: 'sports', label: 'sports', popularity: 1100 },
  { value: 'nfl', label: 'nfl', popularity: 950 },
  { value: 'nba', label: 'nba', popularity: 920 },
  { value: 'president', label: 'president', popularity: 1600 },
  { value: 'congress', label: 'congress', popularity: 500 },
  { value: 'senate', label: 'senate', popularity: 480 },
  { value: 'federal-reserve', label: 'federal-reserve', popularity: 450 },
  { value: 'inflation', label: 'inflation', popularity: 550 },
  { value: 'recession', label: 'recession', popularity: 520 },
  { value: 'china', label: 'china', popularity: 750 },
  { value: 'russia', label: 'russia', popularity: 700 },
] as const;

interface TagPickerProps {
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
  placeholder?: string;
  maxTags?: number;
  allowCustomTags?: boolean;
}

/**
 * TagPicker component for multi-selecting tags
 * Displays selected tags as chips with remove buttons
 * Supports autocomplete with popular tags
 */
export default function TagPicker({
  value = [],
  onChange,
  className,
  placeholder = 'Select tags',
  maxTags = 10,
  allowCustomTags = true,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter tags based on search query and exclude already selected
  const filteredTags = COMMON_TAGS.filter(tag =>
    tag.label.toLowerCase().includes(searchQuery.toLowerCase()) &&
    !value.includes(tag.value)
  ).sort((a, b) => b.popularity - a.popularity); // Sort by popularity

  // Add tag to selection
  const handleSelectTag = (tagValue: string) => {
    if (value.length >= maxTags) {
      return; // Max tags reached
    }

    if (!value.includes(tagValue)) {
      onChange([...value, tagValue]);
    }
    setSearchQuery('');
  };

  // Remove tag from selection
  const handleRemoveTag = (tagToRemove: string) => {
    onChange(value.filter(tag => tag !== tagToRemove));
  };

  // Handle custom tag creation (when user presses Enter on non-existent tag)
  const handleCreateCustomTag = () => {
    if (!allowCustomTags || !searchQuery.trim()) return;

    const customTag = searchQuery.trim().toLowerCase();

    // Don't add if it already exists or max reached
    if (value.includes(customTag) || value.length >= maxTags) return;

    onChange([...value, customTag]);
    setSearchQuery('');
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Selected tags as chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((tag) => {
            const tagDef = COMMON_TAGS.find(t => t.value === tag);

            return (
              <Badge
                key={tag}
                variant="secondary"
                className="flex items-center gap-1 px-2 py-1 text-sm"
              >
                <TagIcon className="h-3 w-3" />
                <span>{tag}</span>
                {tagDef && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ({tagDef.popularity})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-1 hover:text-destructive transition-colors"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {/* Tag picker dropdown */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={value.length >= maxTags}
          >
            {value.length === 0 ? (
              placeholder
            ) : (
              `${value.length} tag${value.length === 1 ? '' : 's'} selected`
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search tags..."
              value={searchQuery}
              onValueChange={setSearchQuery}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && allowCustomTags) {
                  e.preventDefault();
                  handleCreateCustomTag();
                }
              }}
            />
            <CommandEmpty>
              {allowCustomTags && searchQuery.trim() ? (
                <div className="p-2">
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={handleCreateCustomTag}
                  >
                    <TagIcon className="mr-2 h-4 w-4" />
                    Create &quot;{searchQuery.trim()}&quot;
                  </Button>
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  No tags found
                </div>
              )}
            </CommandEmpty>
            <CommandGroup>
              {filteredTags.slice(0, 20).map((tag) => (
                <CommandItem
                  key={tag.value}
                  value={tag.value}
                  onSelect={() => {
                    handleSelectTag(tag.value);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.includes(tag.value) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <TagIcon className="mr-2 h-4 w-4" />
                  <span className="flex-1">{tag.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {tag.popularity}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Helper text */}
      {value.length >= maxTags && (
        <p className="text-xs text-muted-foreground">
          Maximum {maxTags} tags reached
        </p>
      )}
    </div>
  );
}
