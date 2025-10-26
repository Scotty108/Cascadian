'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StrategyStatus = 'running' | 'paused' | 'stopped' | 'error';

interface StatusBadgeProps {
  status: StrategyStatus;
  className?: string;
}

/**
 * StatusBadge component displays color-coded status for autonomous strategies
 *
 * Color scheme:
 * - Running: Green with pulsing animation
 * - Paused: Yellow/Amber
 * - Stopped: Gray
 * - Error: Red
 *
 * @param status - The current strategy status
 * @param className - Optional additional CSS classes
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const statusConfig = {
    running: {
      label: 'Running',
      color: 'bg-green-500/10 text-green-500 border-green-500/20',
      dotColor: 'bg-green-500',
      pulse: true,
    },
    paused: {
      label: 'Paused',
      color: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
      dotColor: 'bg-amber-500',
      pulse: false,
    },
    stopped: {
      label: 'Stopped',
      color: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
      dotColor: 'bg-gray-500',
      pulse: false,
    },
    error: {
      label: 'Error',
      color: 'bg-red-500/10 text-red-500 border-red-500/20',
      dotColor: 'bg-red-500',
      pulse: false,
    },
  };

  const config = statusConfig[status];

  return (
    <Badge
      variant="outline"
      className={cn(
        'flex items-center gap-1.5 font-medium',
        config.color,
        className
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          config.dotColor,
          config.pulse && 'animate-pulse'
        )}
      />
      {config.label}
    </Badge>
  );
}
