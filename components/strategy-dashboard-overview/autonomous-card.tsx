'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '../strategy-dashboard/status-badge';
import { ExternalLink, Play, Pause } from 'lucide-react';
import Link from 'next/link';
import { useStrategyStatus } from '@/hooks/use-strategy-status';
import { formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';
import { toast } from 'sonner';

interface AutonomousCardProps {
  strategyId: string;
  strategyName: string;
  strategyDescription?: string;
  onStatusChange?: () => void;
}

/**
 * AutonomousCard component for displaying autonomous strategy in overview
 *
 * Shows:
 * - Strategy status badge (running, paused, stopped, error)
 * - Uptime and execution count
 * - Watchlist size
 * - Success rate
 * - Quick action buttons (view, pause/resume)
 *
 * @param strategyId - The strategy/workflow ID
 * @param strategyName - Strategy name for display
 * @param strategyDescription - Optional strategy description
 * @param onStatusChange - Callback when status changes (for refresh)
 */
export function AutonomousCard({
  strategyId,
  strategyName,
  strategyDescription,
  onStatusChange,
}: AutonomousCardProps) {
  const { data: status, isLoading, refetch } = useStrategyStatus(strategyId, {
    refetchInterval: 300000, // Poll every 5 minutes (reduced from 60s to save egress)
  });
  const [isActionLoading, setIsActionLoading] = useState(false);

  const handleToggleStatus = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!status) return;

    const isRunning = status.status === 'running';
    const endpoint = isRunning ? 'pause' : 'start';

    setIsActionLoading(true);
    try {
      const response = await fetch(`/api/strategies/${strategyId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed to ${endpoint} strategy`);
      }

      toast.success(`Strategy ${isRunning ? 'paused' : 'started'}`);
      refetch();
      onStatusChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${endpoint} strategy`);
    } finally {
      setIsActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="h-full group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Link href={`/strategies/${strategyId}`} className="block">
        <Card className="h-full group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/40 hover:shadow-xl cursor-pointer">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold tracking-tight">
              {strategyName}
            </CardTitle>
            <CardDescription className="text-sm">
              {strategyDescription || 'Click to view details'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">Unable to load strategy status</p>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  const successRate = (status.success_rate * 100).toFixed(1);
  const uptime = formatUptime(status.uptime_seconds);
  const isRunning = status.status === 'running';

  return (
    <Link href={`/strategies/${strategyId}`} className="block">
      <Card className="h-full group overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/40 hover:shadow-xl cursor-pointer">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between mb-2">
            <StatusBadge status={status.status} />
            {status.auto_run && (
              <Badge variant="outline" className="text-xs">
                Autonomous
              </Badge>
            )}
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">
            {strategyName}
          </CardTitle>
          <CardDescription className="text-sm line-clamp-2">
            {strategyDescription || 'Autonomous strategy'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Uptime:</span>
              <span className="font-medium">{uptime || 'Not started'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Executions:</span>
              <span className="font-medium">{status.execution_count}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Success Rate:</span>
              <span className="font-medium">{successRate}%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Watchlist:</span>
              <span className="font-medium">{status.watchlist_size} markets</span>
            </div>
          </div>

          {status.last_executed_at && (
            <div className="text-xs text-muted-foreground">
              Last run: {formatDistanceToNow(new Date(status.last_executed_at), { addSuffix: true })}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              variant={isRunning ? 'outline' : 'default'}
              className={
                isRunning
                  ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-500/10'
                  : 'bg-green-500 hover:bg-green-600'
              }
              onClick={handleToggleStatus}
              disabled={isActionLoading}
            >
              {isRunning ? (
                <>
                  <Pause className="h-3 w-3 mr-1" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  Start
                </>
              )}
            </Button>
            <div className="flex-1 text-xs text-muted-foreground group-hover:text-[#00E0AA] transition text-right">
              <span>View Details</span>
              <ExternalLink className="inline ml-1 h-3 w-3" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
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
