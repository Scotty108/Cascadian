'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TruncatedTextProps {
  text: string;
  maxLength?: number;
  className?: string;
  expandText?: string;
  collapseText?: string;
}

export function TruncatedText({
  text,
  maxLength = 120,
  className,
  expandText = 'Read more',
  collapseText = 'Read less',
}: TruncatedTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (text.length <= maxLength) {
    return <p className={className}>{text}</p>;
  }

  // Find the last space before maxLength to avoid cutting words
  const truncateAt = text.lastIndexOf(' ', maxLength);
  const truncatedText = truncateAt > 0
    ? text.substring(0, truncateAt) + '...'
    : text.substring(0, maxLength) + '...';

  return (
    <div className={className}>
      <p className="inline">
        {isExpanded ? text : truncatedText}
      </p>
      {' '}
      <Button
        variant="link"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="h-auto p-0 text-sm font-medium"
      >
        {isExpanded ? collapseText : expandText}
      </Button>
    </div>
  );
}
