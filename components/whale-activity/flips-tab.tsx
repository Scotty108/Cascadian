'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, TrendingUp, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PositionFlip, WhaleActivityFilters } from '@/components/whale-activity-interface/types';

interface FlipsTabProps {
  filters: WhaleActivityFilters;
}

export function FlipsTab({ filters }: FlipsTabProps) {
  const [flips, setFlips] = useState<PositionFlip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFlips = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('timeframe', filters.timeframe);
        if (filters.min_sws) params.set('min_sws', filters.min_sws.toString());
        if (filters.wallets?.length) params.set('wallet', filters.wallets[0]);

        const response = await fetch(`/api/whale/flips?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setFlips(data.data);
        }
      } catch (error) {
        console.error('Error fetching flips:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFlips();
  }, [filters]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading position flips...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 p-4 rounded-lg">
        <div className="flex items-start gap-2">
          <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-blue-900 dark:text-blue-200">About Position Flips</p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Position flips occur when a whale exits one side of a market and takes a new position on the opposite side.
              These can signal changing conviction and are often followed by price movements.
            </p>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Timeline Line */}
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700" />

        {flips.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-12 text-center">
            <ArrowLeftRight className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No position flips detected in the selected timeframe</p>
          </div>
        ) : (
          <div className="space-y-6">
            {flips.map((flip, index) => (
              <div key={flip.flip_id} className="relative pl-20">
                {/* Timeline Dot */}
                <div className="absolute left-6 w-5 h-5 bg-blue-500 rounded-full border-4 border-white dark:border-slate-950 shadow" />

                {/* Card */}
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6 hover:shadow-lg transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">{formatTimestamp(flip.flip_date)}</div>
                      <Link
                        href={`/analysis/wallet/${flip.wallet_address}`}
                        className="text-lg font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {flip.wallet_alias || flip.wallet_address.slice(0, 8) + '...'}
                      </Link>
                      {flip.sws_score && (
                        <Badge variant="outline" className="ml-2">
                          SWS: {flip.sws_score.toFixed(1)}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(flip.flip_date).toLocaleTimeString()}
                    </div>
                  </div>

                  <div className="mb-4">
                    <Link
                      href={`/analysis/market/${flip.market_id}`}
                      className="font-medium hover:underline"
                    >
                      {flip.market_title}
                    </Link>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* From Side */}
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded">
                      <div className="text-sm text-muted-foreground mb-2">Exited Position</div>
                      <Badge
                        variant={flip.from_side === 'YES' ? 'default' : 'secondary'}
                        className={`mb-2 ${
                          flip.from_side === 'YES'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        }`}
                      >
                        {flip.from_side}
                      </Badge>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Invested: </span>
                        <span className="font-medium">
                          ${flip.prev_investment.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="flex items-center justify-center">
                      <ArrowLeftRight className="h-8 w-8 text-blue-500" />
                    </div>

                    {/* To Side */}
                    <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded border-2 border-blue-200 dark:border-blue-900">
                      <div className="text-sm text-muted-foreground mb-2">New Position</div>
                      <Badge
                        variant={flip.to_side === 'YES' ? 'default' : 'secondary'}
                        className={`mb-2 ${
                          flip.to_side === 'YES'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        }`}
                      >
                        {flip.to_side}
                      </Badge>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Invested: </span>
                        <span className="font-medium">
                          ${flip.new_investment.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        at {flip.price_at_flip.toFixed(2)}¢
                      </div>
                    </div>
                  </div>

                  {/* Investment Change */}
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Investment Change:</span>
                      <span className={flip.new_investment > flip.prev_investment ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                        {flip.new_investment > flip.prev_investment ? '+' : ''}
                        ${(flip.new_investment - flip.prev_investment).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        {' '}({((flip.new_investment - flip.prev_investment) / flip.prev_investment * 100).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {flips.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {flips.length} position flip{flips.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
