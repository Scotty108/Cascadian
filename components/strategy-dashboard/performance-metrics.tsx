'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { StrategyStatusData } from '@/hooks/use-strategy-status';
import { Activity, TrendingUp, Clock, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PerformanceMetricsProps {
  status: StrategyStatusData;
  className?: string;
}

/**
 * PerformanceMetrics component displays key strategy performance indicators
 *
 * Metrics displayed:
 * - Success rate (with progress bar)
 * - Average execution time
 * - Total executions (success/failed breakdown)
 * - Total markets watched
 *
 * Visual indicators:
 * - Green for good performance (>90% success)
 * - Yellow for moderate performance (70-90% success)
 * - Red for poor performance (<70% success)
 *
 * @param status - Strategy status data from useStrategyStatus hook
 * @param className - Optional additional CSS classes
 */
export function PerformanceMetrics({
  status,
  className,
}: PerformanceMetricsProps) {
  const successRate = status.success_rate * 100;
  const avgExecutionTime = (status.average_execution_time_ms / 1000).toFixed(2);

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 90) return 'text-green-500';
    if (rate >= 70) return 'text-amber-500';
    return 'text-red-500';
  };

  const getSuccessRateIndicator = (rate: number) => {
    if (rate >= 90) return 'bg-green-500';
    if (rate >= 70) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Performance Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Success Rate</span>
              </div>
              <span
                className={cn(
                  'text-2xl font-bold',
                  getSuccessRateColor(successRate)
                )}
              >
                {successRate.toFixed(1)}%
              </span>
            </div>
            <Progress
              value={successRate}
              className="h-2"
              indicatorClassName={getSuccessRateIndicator(successRate)}
            />
            <p className="text-xs text-muted-foreground mt-2">
              {status.success_count} successful, {status.error_count} failed out
              of {status.execution_count} total executions
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              icon={Clock}
              label="Avg Execution Time"
              value={`${avgExecutionTime}s`}
              description="Per execution"
            />

            <MetricCard
              icon={TrendingUp}
              label="Total Executions"
              value={status.execution_count}
              description="Since started"
            />

            <MetricCard
              icon={Eye}
              label="Markets Watched"
              value={status.watchlist_size}
              description="In watchlist"
            />
          </div>

          {status.uptime_seconds > 0 && (
            <div className="pt-4 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Uptime</span>
                <span className="font-medium">{formatUptime(status.uptime_seconds)}</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  description: string;
}

function MetricCard({ icon: Icon, label, value, description }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-bold mb-1">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}

export function PerformanceMetricsSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Performance Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
            <Skeleton className="h-2 w-full" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
