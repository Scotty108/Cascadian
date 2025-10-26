'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStrategyWatchlist } from '@/hooks/use-strategy-watchlist';
import type { WatchlistEntry } from '@/hooks/use-strategy-watchlist';
import { X, Trash2, TrendingUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { toast } from 'sonner';

interface WatchlistDisplayProps {
  workflowId: string;
  className?: string;
}

/**
 * WatchlistDisplay component shows markets being monitored by the strategy
 *
 * Features:
 * - Grid/list view of watched markets
 * - Market metadata (question, category, volume, price)
 * - Inline remove button for each market
 * - Clear all button
 * - Real-time updates via polling
 * - Empty state
 *
 * @param workflowId - The strategy/workflow ID to display watchlist for
 * @param className - Optional additional CSS classes
 */
export function WatchlistDisplay({
  workflowId,
  className,
}: WatchlistDisplayProps) {
  const { data, isLoading, error, removeMarket, clearWatchlist } =
    useStrategyWatchlist(workflowId);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const handleRemove = async (marketId: string) => {
    setRemovingId(marketId);
    try {
      await removeMarket.mutateAsync(marketId);
      toast.success('Market removed from watchlist');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to remove market'
      );
    } finally {
      setRemovingId(null);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear the entire watchlist?')) {
      return;
    }

    setIsClearing(true);
    try {
      await clearWatchlist.mutateAsync();
      toast.success('Watchlist cleared');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear watchlist');
    } finally {
      setIsClearing(false);
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Watchlist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
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
          <CardTitle>Watchlist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-red-500">Failed to load watchlist</p>
            <p className="text-xs text-muted-foreground mt-1">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const watchlist = data?.data ?? [];

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Watchlist</CardTitle>
            <Badge variant="secondary">{watchlist.length}</Badge>
          </div>
          {watchlist.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={isClearing}
              className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {watchlist.length === 0 ? (
          <div className="text-center py-8">
            <TrendingUp className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No markets in watchlist yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Markets will appear here when your strategy adds them
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {watchlist.map((entry) => (
                <WatchlistItem
                  key={entry.id}
                  entry={entry}
                  onRemove={handleRemove}
                  isRemoving={removingId === entry.market_id}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

interface WatchlistItemProps {
  entry: WatchlistEntry;
  onRemove: (marketId: string) => void;
  isRemoving: boolean;
}

function WatchlistItem({ entry, onRemove, isRemoving }: WatchlistItemProps) {
  const { metadata } = entry;

  const formatVolume = (volume?: number) => {
    if (!volume) return 'N/A';
    if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `$${(volume / 1000).toFixed(0)}K`;
    return `$${volume}`;
  };

  return (
    <div className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm leading-tight mb-2 line-clamp-2">
            {metadata.question || entry.market_id}
          </h4>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {metadata.category && (
              <Badge variant="outline" className="h-5">
                {metadata.category}
              </Badge>
            )}

            {metadata.volume_24h && (
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {formatVolume(metadata.volume_24h)}
              </span>
            )}

            <span>
              Added {formatDistanceToNow(new Date(entry.added_at), { addSuffix: true })}
            </span>
          </div>

          {entry.reason && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
              {entry.reason}
            </p>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(entry.market_id)}
          disabled={isRemoving}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
