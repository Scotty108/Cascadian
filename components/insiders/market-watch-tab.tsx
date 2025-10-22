'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, TrendingUp, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { InsiderMarket } from '@/components/whale-activity-interface/types';

export function MarketWatchTab() {
  const [markets, setMarkets] = useState<InsiderMarket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMarkets = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/insiders/markets');
        const data = await response.json();

        if (data.success) {
          setMarkets(data.data);
        }
      } catch (error) {
        console.error('Error fetching insider markets:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMarkets();
  }, []);

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive">High Priority</Badge>;
      case 'medium':
        return <Badge variant="default" className="bg-amber-500">Medium Priority</Badge>;
      case 'low':
        return <Badge variant="outline">Low Priority</Badge>;
      default:
        return <Badge variant="secondary">{priority}</Badge>;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 7.5) return 'text-red-600 dark:text-red-400';
    if (score >= 6.5) return 'text-orange-600 dark:text-orange-400';
    if (score >= 5.5) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-blue-600 dark:text-blue-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading market data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-4 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">Markets Under Investigation</p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              These markets show elevated insider activity scores based on suspicious wallet involvement,
              unusual timing patterns, and coordinated cluster behavior.
            </p>
          </div>
        </div>
      </div>

      {/* Markets Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
            <thead className="sticky top-0 z-40 bg-background border-b border-border">
              <tr>
                <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Market</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Activity Score</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Suspicious Wallets</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Unusual Timing</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Volume Anomalies</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Cluster Involvement</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Priority</th>
              </tr>
            </thead>
            <tbody>
              {markets.length === 0 ? (
                <tr className="border-b border-border hover:bg-muted/30 transition">
                  <td colSpan={7} className="px-2 py-1.5 align-middle text-center text-muted-foreground py-8">
                    No markets with suspicious activity found
                  </td>
                </tr>
              ) : (
                markets.map((market) => (
                  <tr
                    key={market.market_id}
                    className={`border-b border-border hover:bg-muted/30 transition ${market.investigation_priority === 'high' ? 'bg-red-50 dark:bg-red-950/10' : ''}`}
                  >
                    <td className="px-2 py-1.5 align-middle">
                      <Link
                        href={`/analysis/market/${market.market_id}`}
                        className="hover:underline max-w-[300px] truncate block font-medium"
                      >
                        {market.market_title}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <span className={`text-xl font-bold ${getScoreColor(market.insider_activity_score)}`}>
                        {market.insider_activity_score.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{market.suspicious_wallets}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <Badge variant="outline">{market.unusual_timing_count}</Badge>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <Badge variant="outline">{market.unusual_volume_count}</Badge>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      {market.cluster_involvement > 0 ? (
                        <div className="flex items-center justify-end gap-2">
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                          <span className="font-medium text-red-600">{market.cluster_involvement}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      {getPriorityBadge(market.investigation_priority)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {markets.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {markets.length} market{markets.length !== 1 ? 's' : ''} with suspicious activity
        </div>
      )}
    </div>
  );
}
