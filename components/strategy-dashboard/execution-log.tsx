'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useStrategyExecutions } from '@/hooks/use-strategy-executions';
import type { StrategyExecution } from '@/hooks/use-strategy-executions';
import { CheckCircle2, XCircle, ChevronDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';

interface ExecutionLogProps {
  workflowId: string;
  className?: string;
}

/**
 * ExecutionLog component displays recent strategy execution history
 *
 * Features:
 * - Last 50 executions with auto-refresh
 * - Status icons (success/failure)
 * - Execution duration and summary
 * - Expandable error details for failed executions
 * - Real-time updates via polling
 *
 * @param workflowId - The strategy/workflow ID to display logs for
 * @param className - Optional additional CSS classes
 */
export function ExecutionLog({ workflowId, className }: ExecutionLogProps) {
  const { data, isLoading, error } = useStrategyExecutions(workflowId);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Execution Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Execution Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-red-500">
              Failed to load execution history
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const executions = data?.data ?? [];

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Execution Log</CardTitle>
          <span className="text-sm text-muted-foreground">
            Last {executions.length} runs
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {executions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              No executions yet. Start the strategy to see activity here.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {executions.map((execution) => (
                <ExecutionLogItem key={execution.id} execution={execution} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

interface ExecutionLogItemProps {
  execution: StrategyExecution;
}

function ExecutionLogItem({ execution }: ExecutionLogItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isSuccess = execution.status === 'completed';
  const isFailed = execution.status === 'failed';
  const isRunning = execution.status === 'running';

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div
        className={cn(
          'rounded-lg border p-3 transition-colors',
          isSuccess && 'border-green-500/20 bg-green-500/5',
          isFailed && 'border-red-500/20 bg-red-500/5',
          isRunning && 'border-blue-500/20 bg-blue-500/5'
        )}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            {isSuccess && (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            )}
            {isFailed && <XCircle className="h-5 w-5 text-red-500" />}
            {isRunning && (
              <Clock className="h-5 w-5 text-blue-500 animate-pulse" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">
                  {formatDistanceToNow(new Date(execution.executed_at), {
                    addSuffix: true,
                  })}
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground">
                  {(execution.duration_ms / 1000).toFixed(1)}s
                </span>
                {execution.nodes_executed > 0 && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-muted-foreground">
                      {execution.nodes_executed} nodes
                    </span>
                  </>
                )}
              </div>

              {isFailed && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 px-2">
                    <span className="text-xs">Details</span>
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 ml-1 transition-transform',
                        isExpanded && 'rotate-180'
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>

            <p className="text-sm text-foreground mt-1">{execution.summary}</p>

            {isFailed && (
              <CollapsibleContent>
                <div className="mt-2 pt-2 border-t border-red-500/20">
                  <p className="text-xs text-red-500 font-mono">
                    {execution.error_message}
                  </p>
                </div>
              </CollapsibleContent>
            )}
          </div>
        </div>
      </div>
    </Collapsible>
  );
}
