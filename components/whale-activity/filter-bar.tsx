'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Filter, X } from 'lucide-react';
import type { WhaleActivityFilters } from '@/components/whale-activity-interface/types';

interface FilterBarProps {
  filters: WhaleActivityFilters;
  onFiltersChange: (filters: WhaleActivityFilters) => void;
  showAdvanced?: boolean;
}

export function FilterBar({ filters, onFiltersChange, showAdvanced = true }: FilterBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const timeframes = [
    { value: '24h', label: 'Last 24 Hours' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
    { value: 'all', label: 'All Time' },
  ];

  const categories = ['Politics', 'Crypto', 'Finance', 'Tech', 'Sports', 'Pop Culture'];

  const handleReset = () => {
    onFiltersChange({
      timeframe: '24h',
      action: 'all',
      side: 'all',
    });
  };

  return (
    <div className="space-y-4 bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Quick Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-medium">Filters:</span>
        </div>

        {/* Timeframe */}
        <Select
          value={filters.timeframe}
          onValueChange={(value) =>
            onFiltersChange({ ...filters, timeframe: value as WhaleActivityFilters['timeframe'] })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeframes.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Min Amount */}
        {showAdvanced && (
          <>
            <Input
              type="number"
              placeholder="Min Amount ($)"
              value={filters.min_amount || ''}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  min_amount: e.target.value ? parseFloat(e.target.value) : undefined,
                })
              }
              className="w-[140px]"
            />

            {/* Category */}
            <Select
              value={filters.categories?.[0] || 'all'}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  categories: value === 'all' ? undefined : [value],
                })
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Action */}
            <Select
              value={filters.action || 'all'}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  action: value as WhaleActivityFilters['action'],
                })
              }
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="BUY">Buy Only</SelectItem>
                <SelectItem value="SELL">Sell Only</SelectItem>
              </SelectContent>
            </Select>

            {/* Side */}
            <Select
              value={filters.side || 'all'}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  side: value as WhaleActivityFilters['side'],
                })
              }
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Side" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sides</SelectItem>
                <SelectItem value="YES">YES Only</SelectItem>
                <SelectItem value="NO">NO Only</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}

        {/* Reset */}
        <Button variant="ghost" size="sm" onClick={handleReset} className="ml-auto">
          <X className="h-4 w-4 mr-1" />
          Reset
        </Button>
      </div>

      {/* Active Filters Count */}
      {showAdvanced && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {Object.entries(filters).filter(([key, value]) => {
              if (key === 'timeframe') return value !== '24h';
              if (key === 'action' || key === 'side') return value !== 'all';
              return value !== undefined && value !== null;
            }).length}{' '}
            active filters
          </span>
        </div>
      )}
    </div>
  );
}
