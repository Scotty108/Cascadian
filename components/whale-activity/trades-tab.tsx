'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Eye, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { WhaleTrade, WhaleActivityFilters } from '@/components/whale-activity-interface/types';

interface TradesTabProps {
  filters: WhaleActivityFilters;
}

export function TradesTab({ filters }: TradesTabProps) {
  const [trades, setTrades] = useState<WhaleTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('timeframe', filters.timeframe);
        if (filters.min_amount) params.set('min_amount', filters.min_amount.toString());
        if (filters.max_amount) params.set('max_amount', filters.max_amount.toString());
        if (filters.categories?.length) params.set('category', filters.categories[0]);
        if (filters.wallets?.length) params.set('wallet', filters.wallets[0]);
        if (filters.action && filters.action !== 'all') params.set('action', filters.action);
        if (filters.side && filters.side !== 'all') params.set('side', filters.side);
        if (filters.min_sws) params.set('min_sws', filters.min_sws.toString());
        if (filters.only_unusual) params.set('only_unusual', 'true');

        const response = await fetch(`/api/whale/trades?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setTrades(data.data);
        }
      } catch (error) {
        console.error('Error fetching trades:', error);
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
        <div className="text-muted-foreground">Loading trades...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Trades Table */}
      <div className="border rounded-lg overflow-hidden">
        <div
          className="overflow-x-auto"
          style={{
            maxHeight: '600px',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
            <thead className="sticky top-0 z-40 bg-background border-b border-border">
              <tr>
                <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Time</th>
                <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Wallet</th>
                <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Market</th>
                <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Type</th>
                <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Side</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Shares</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Price</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Amount</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">SWS</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-2 py-8 text-center text-muted-foreground">
                    No trades found matching the filters
                  </td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade.trade_id} className={`border-b border-border hover:bg-muted/30 transition ${trade.is_unusual ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                    <td className="px-2 py-1.5 align-middle">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{formatTimestamp(trade.timestamp)}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(trade.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <Link
                        href={`/analysis/wallet/${trade.wallet_address}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      >
                        {trade.wallet_alias || trade.wallet_address.slice(0, 8) + '...'}
                        {trade.is_unusual && (
                          <span title="Unusual trade">
                            <AlertCircle className="h-3 w-3 text-amber-500" />
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <Link
                        href={`/analysis/market/${trade.market_id}`}
                        className="hover:underline max-w-[200px] truncate block"
                      >
                        {trade.market_title}
                      </Link>
                      <span className="text-xs text-muted-foreground">{trade.category}</span>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
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
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          trade.side === 'YES'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        }`}
                      >
                        {trade.side}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">{trade.shares.toLocaleString()}</td>
                    <td className="px-2 py-1.5 align-middle text-right">{trade.price.toFixed(2)}¢</td>
                    <td className="px-2 py-1.5 align-middle text-right font-medium">
                      ${trade.amount_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      {trade.sws_score ? (
                        <span className="font-medium">{trade.sws_score.toFixed(1)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/analysis/wallet/${trade.wallet_address}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unusual Trades Legend */}
      {trades.some((t) => t.is_unusual) && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-4 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">Unusual Trades Detected</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Highlighted trades show unusual patterns like volume spikes, price impact, or timing anomalies.
              </p>
            </div>
          </div>
        </div>
      )}

      {trades.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {trades.length} trade{trades.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
