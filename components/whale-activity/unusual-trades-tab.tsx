'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Eye, ArrowUpRight, ArrowDownRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { WhaleTrade, WhaleActivityFilters } from '@/components/whale-activity-interface/types';

interface UnusualTradesTabProps {
  filters: WhaleActivityFilters;
}

export function UnusualTradesTab({ filters }: UnusualTradesTabProps) {
  const [trades, setTrades] = useState<WhaleTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('timeframe', filters.timeframe);
        params.set('only_unusual', 'true');
        if (filters.min_amount) params.set('min_amount', filters.min_amount.toString());
        if (filters.max_amount) params.set('max_amount', filters.max_amount.toString());
        if (filters.categories?.length) params.set('category', filters.categories[0]);
        if (filters.wallets?.length) params.set('wallet', filters.wallets[0]);
        if (filters.min_sws) params.set('min_sws', filters.min_sws.toString());

        const response = await fetch(`/api/whale/trades?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setTrades(data.data);
        }
      } catch (error) {
        console.error('Error fetching unusual trades:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTrades();
  }, [filters]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading unusual trades...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alert Banner */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-4 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">Unusual Trading Activity Detected</p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              These trades exhibit unusual patterns including volume spikes (&gt;2x average), large price impact (&gt;5%),
              timing anomalies (near major events), or position flips (switching sides).
            </p>
          </div>
        </div>
      </div>

      {/* Unusual Trades Grid */}
      <div className="grid grid-cols-1 gap-4">
        {trades.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No unusual trades detected in the selected timeframe</p>
          </div>
        ) : (
          trades.map((trade) => (
            <div
              key={trade.trade_id}
              className="bg-white dark:bg-slate-900 rounded-lg border-2 border-amber-200 dark:border-amber-900 p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-6 w-6 text-amber-500" />
                  <div>
                    <Link
                      href={`/analysis/wallet/${trade.wallet_address}`}
                      className="text-lg font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {trade.wallet_alias || trade.wallet_address.slice(0, 8) + '...'}
                    </Link>
                    {trade.sws_score && (
                      <Badge variant="outline" className="ml-2">
                        SWS: {trade.sws_score.toFixed(1)}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">{formatTimestamp(trade.timestamp)}</div>
                  <div className="text-xs text-muted-foreground">{new Date(trade.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Market</div>
                  <Link
                    href={`/analysis/market/${trade.market_id}`}
                    className="font-medium hover:underline"
                  >
                    {trade.market_title}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-1">{trade.category}</div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Action</div>
                    <div className="flex items-center gap-1">
                      {trade.action === 'BUY' ? (
                        <>
                          <ArrowUpRight className="h-4 w-4 text-green-500" />
                          <span className="font-medium text-green-600 dark:text-green-400">BUY</span>
                        </>
                      ) : (
                        <>
                          <ArrowDownRight className="h-4 w-4 text-red-500" />
                          <span className="font-medium text-red-600 dark:text-red-400">SELL</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Side</div>
                    <Badge
                      variant={trade.side === 'YES' ? 'default' : 'secondary'}
                      className={
                        trade.side === 'YES'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }
                    >
                      {trade.side}
                    </Badge>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Price</div>
                    <div className="font-medium">{trade.price.toFixed(2)}¢</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4 bg-slate-50 dark:bg-slate-950 p-4 rounded">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Shares</div>
                  <div className="font-semibold">{trade.shares.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Amount</div>
                  <div className="font-semibold text-lg">
                    ${trade.amount_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>

              {trade.unusual_reasons && trade.unusual_reasons.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-3">
                  <div className="text-sm font-medium text-amber-900 dark:text-amber-200 mb-2">
                    Unusual Patterns Detected:
                  </div>
                  <ul className="space-y-1">
                    {trade.unusual_reasons.map((reason, idx) => (
                      <li key={idx} className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                        <span className="text-amber-500 mt-0.5">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/analysis/wallet/${trade.wallet_address}`}>
                    <Eye className="h-4 w-4 mr-2" />
                    View Wallet Details
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {trades.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {trades.length} unusual trade{trades.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
