import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Sparkline } from './sparkline';

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon?: ReactNode;
  sparklineData?: number[];
  className?: string;
  compact?: boolean;
}

export function MetricCard({
  label,
  value,
  change,
  changeType = 'neutral',
  icon,
  sparklineData,
  className,
  compact = false,
}: MetricCardProps) {
  return (
    <Card className={cn(
      'transition-all hover:shadow-md',
      compact ? 'p-3' : 'p-4',
      className
    )}>
      <div className="flex items-start justify-between mb-2">
        <div className={cn(
          'text-muted-foreground',
          compact ? 'text-xs' : 'text-sm'
        )}>
          {label}
        </div>
        {icon && (
          <div className="text-muted-foreground opacity-60">
            {icon}
          </div>
        )}
      </div>

      <div className={cn(
        'font-bold mb-1',
        compact ? 'text-xl' : 'text-2xl'
      )}>
        {value}
      </div>

      {change && (
        <div className={cn(
          'font-medium flex items-center gap-1',
          compact ? 'text-xs' : 'text-sm',
          changeType === 'positive' && 'text-green-600',
          changeType === 'negative' && 'text-red-600',
          changeType === 'neutral' && 'text-muted-foreground'
        )}>
          {changeType === 'positive' && '↑'}
          {changeType === 'negative' && '↓'}
          {change}
        </div>
      )}

      {sparklineData && sparklineData.length > 0 && (
        <div className="mt-3">
          <Sparkline
            data={sparklineData}
            height={compact ? 24 : 30}
            color={
              changeType === 'positive'
                ? 'rgb(22, 163, 74)'
                : changeType === 'negative'
                ? 'rgb(239, 68, 68)'
                : 'rgb(107, 114, 128)'
            }
          />
        </div>
      )}
    </Card>
  );
}
