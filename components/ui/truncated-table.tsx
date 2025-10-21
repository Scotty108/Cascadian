'use client';

import { useState, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface TruncatedTableProps<T> {
  data: T[];
  initialRows?: number;
  renderRow: (item: T, index: number) => ReactNode;
  renderHeader: () => ReactNode;
  emptyMessage?: string;
  expandText?: string;
  collapseText?: string;
  className?: string;
}

export function TruncatedTable<T>({
  data,
  initialRows = 5,
  renderRow,
  renderHeader,
  emptyMessage = 'No data available',
  expandText = 'Show All',
  collapseText = 'Show Less',
  className = '',
}: TruncatedTableProps<T>) {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayData = isExpanded ? data : data.slice(0, initialRows);
  const hasMore = data.length > initialRows;

  if (data.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <table className="w-full">
          {renderHeader()}
          <tbody>
            {displayData.map((item, index) => renderRow(item, index))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full mt-2"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4 mr-2" />
              {collapseText}
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4 mr-2" />
              {expandText} ({data.length})
            </>
          )}
        </Button>
      )}
    </div>
  );
}
