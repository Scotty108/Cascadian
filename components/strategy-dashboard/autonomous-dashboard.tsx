'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useStrategyStatus } from '@/hooks/use-strategy-status';
import { StatusBadge } from './status-badge';
import { ExecutionCountdown } from './execution-countdown';
import { ExecutionLog } from './execution-log';
import { WatchlistDisplay } from './watchlist-display';
import { PerformanceMetrics, PerformanceMetricsSkeleton } from './performance-metrics';
import { ArrowLeft, Play, Pause, Square, PlayCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface AutonomousDashboardProps {
  workflowId: string;
  strategyName?: string;
}

/**
 * AutonomousDashboard component for monitoring and controlling autonomous strategies
 *
 * This is the main dashboard view for Task Group 5 requirements:
 * - Real-time status updates (30-second polling)
 * - Control buttons (Start/Pause/Stop/Execute Now)
 * - Execution log (last 50 runs)
 * - Watchlist display with removal
 * - Performance metrics
 * - Responsive design (mobile/tablet/desktop)
 * - Loading states and error handling
 *
 * @param workflowId - The strategy/workflow ID to monitor
 * @param strategyName - Optional strategy name for header
 */
export function AutonomousDashboard({
  workflowId,
  strategyName,
}: AutonomousDashboardProps) {
  const router = useRouter();
  const { data: status, isLoading, error, refetch } = useStrategyStatus(workflowId);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const handleStart = async () => {
    setIsActionLoading(true);
    try {
      const response = await fetch(`/api/strategies/${workflowId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to start strategy');
      }

      toast.success('Strategy started successfully');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start strategy');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handlePause = async () => {
    setIsActionLoading(true);
    try {
      const response = await fetch(`/api/strategies/${workflowId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to pause strategy');
      }

      toast.success('Strategy paused');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to pause strategy');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm('Are you sure you want to stop this strategy permanently?')) {
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await fetch(`/api/strategies/${workflowId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to stop strategy');
      }

      toast.success('Strategy stopped');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop strategy');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleExecuteNow = async () => {
    setIsActionLoading(true);
    try {
      const response = await fetch(`/api/strategies/${workflowId}/execute-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to execute strategy');
      }

      toast.success('Manual execution started');
      setTimeout(() => refetch(), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to execute strategy');
    } finally {
      setIsActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <DashboardSkeleton />
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <p className="text-red-500">Failed to load strategy status</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  const canStart = status.status === 'paused' || status.status === 'stopped' || status.status === 'error';
  const canPause = status.status === 'running';
  const canStop = status.status !== 'stopped';

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/strategies')}
            className="h-9 w-9 p-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {strategyName || status.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Created {status.last_executed_at ? formatDistanceToNow(new Date(status.last_executed_at), { addSuffix: true }) : 'recently'}
            </p>
          </div>
        </div>

        <StatusBadge status={status.status} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Status</p>
              <p className="text-2xl font-bold">{status.status}</p>
              {status.next_execution_at && (
                <ExecutionCountdown
                  nextExecutionAt={status.next_execution_at}
                  className="mt-2"
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Uptime</p>
              <p className="text-2xl font-bold">{formatUptime(status.uptime_seconds)}</p>
              <p className="text-xs text-muted-foreground">
                Interval: {status.execution_interval_minutes}m
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Executions</p>
              <p className="text-2xl font-bold">{status.execution_count}</p>
              <p className="text-xs text-muted-foreground">
                {status.success_count} success, {status.error_count} failed
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Success Rate</p>
              <p className="text-2xl font-bold">
                {(status.success_rate * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground">
                Avg: {(status.average_execution_time_ms / 1000).toFixed(1)}s
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        {canStart && (
          <Button
            onClick={handleStart}
            disabled={isActionLoading}
            className="bg-green-500 hover:bg-green-600"
          >
            <Play className="h-4 w-4 mr-2" />
            {status.status === 'paused' ? 'Resume' : 'Start'} Strategy
          </Button>
        )}

        {canPause && (
          <Button
            onClick={handlePause}
            disabled={isActionLoading}
            variant="outline"
          >
            <Pause className="h-4 w-4 mr-2" />
            Pause Strategy
          </Button>
        )}

        {canStop && (
          <Button
            onClick={handleStop}
            disabled={isActionLoading}
            variant="outline"
            className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
          >
            <Square className="h-4 w-4 mr-2" />
            Stop Strategy
          </Button>
        )}

        <Button
          onClick={handleExecuteNow}
          disabled={isActionLoading}
          variant="outline"
        >
          <PlayCircle className="h-4 w-4 mr-2" />
          Execute Now
        </Button>
      </div>

      <PerformanceMetrics status={status} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ExecutionLog workflowId={workflowId} />
        <WatchlistDisplay workflowId={workflowId} />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>

      <PerformanceMetricsSkeleton />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-[500px] w-full" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    </>
  );
}

function formatUptime(seconds: number): string {
  if (seconds === 0) return '0s';
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
