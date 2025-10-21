'use client';

import { useState, ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  title?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
  showCount?: number;
  compactView?: ReactNode;
  expandText?: string;
  collapseText?: string;
  className?: string;
  onToggle?: (isExpanded: boolean) => void;
}

export function CollapsibleSection({
  title,
  defaultExpanded = false,
  children,
  showCount,
  compactView,
  expandText = 'Show All',
  collapseText = 'Show Less',
  className,
  onToggle,
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    onToggle?.(newState);
  };

  return (
    <div className={cn('border rounded-lg p-4', className)}>
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
      )}

      {!isExpanded && compactView && (
        <div className="mb-3">{compactView}</div>
      )}

      {isExpanded && (
        <div className={cn(
          'mb-3 overflow-hidden transition-all duration-300 ease-in-out',
          isExpanded ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
        )}>
          {children}
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        className="w-full"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="h-4 w-4 mr-2" />
            {collapseText}
          </>
        ) : (
          <>
            <ChevronDown className="h-4 w-4 mr-2" />
            {expandText}
            {showCount && ` (${showCount})`}
          </>
        )}
      </Button>
    </div>
  );
}
