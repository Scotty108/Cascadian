'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy, TrendingUp, Eye, Info } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { WhaleWallet, WhaleActivityFilters } from '@/components/whale-activity-interface/types';

interface ScoreboardTabProps {
  filters: WhaleActivityFilters;
}

export function ScoreboardTab({ filters }: ScoreboardTabProps) {
  const [wallets, setWallets] = useState<WhaleWallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScoreboard = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', '100');
        if (filters.min_sws) params.set('min_sws', filters.min_sws.toString());

        const response = await fetch(`/api/whale/scoreboard?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setWallets(data.data);
        }
      } catch (error) {
        console.error('Error fetching scoreboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchScoreboard();
  }, [filters]);

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          <span className="font-bold text-yellow-600 dark:text-yellow-400">#{rank}</span>
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-gray-400" />
          <span className="font-bold text-gray-600 dark:text-gray-400">#{rank}</span>
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-orange-600" />
          <span className="font-bold text-orange-600 dark:text-orange-400">#{rank}</span>
        </div>
      );
    }
    return <span className="font-medium text-muted-foreground">#{rank}</span>;
  };

  const getScoreColor = (score: number) => {
    if (score >= 9) return 'text-emerald-600 dark:text-emerald-400';
    if (score >= 8) return 'text-green-600 dark:text-green-400';
    if (score >= 7) return 'text-blue-600 dark:text-blue-400';
    if (score >= 6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  const getReliabilityBadge = (reliability: number) => {
    if (reliability >= 0.9) return <Badge variant="default">High Confidence</Badge>;
    if (reliability >= 0.8) return <Badge variant="secondary">Medium Confidence</Badge>;
    return <Badge variant="outline">Low Confidence</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading scoreboard...</div>
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
            <p className="font-medium text-blue-900 dark:text-blue-200">About Smart Whale Score (SWS)</p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              SWS is a composite metric (0-10) based on win rate, risk-adjusted returns (Omega & Sortino ratios),
              timing edge, and consistency. Higher scores indicate more sophisticated trading patterns.
              Reliability shows data confidence based on trade volume.
            </p>
          </div>
        </div>
      </div>

      {/* Scoreboard Table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Rank</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead className="text-right">SWS Score</TableHead>
              <TableHead className="text-right">Reliability</TableHead>
              <TableHead className="text-right">Win Rate</TableHead>
              <TableHead className="text-right">Total Volume</TableHead>
              <TableHead className="text-right">Realized P&L</TableHead>
              <TableHead className="text-right">ROI</TableHead>
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-right">Active Positions</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {wallets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  No whales found matching the filters
                </TableCell>
              </TableRow>
            ) : (
              wallets.map((wallet) => (
                <TableRow key={wallet.address}>
                  <TableCell>{wallet.rank && getRankBadge(wallet.rank)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/analysis/wallet/${wallet.address}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {wallet.alias || wallet.address.slice(0, 8) + '...'}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <span className={`text-2xl font-bold ${getScoreColor(wallet.sws_score)}`}>
                            {wallet.sws_score.toFixed(1)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">Smart Whale Score</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Composite metric based on performance, risk management, and timing
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-right">
                    {getReliabilityBadge(wallet.sws_reliability)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={wallet.win_rate >= 0.7 ? 'text-green-600 font-medium' : ''}>
                      {(wallet.win_rate * 100).toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    ${wallet.total_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={wallet.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {wallet.realized_pnl >= 0 ? '+' : ''}
                      ${wallet.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={wallet.realized_roi >= 0.5 ? 'text-green-600 font-medium' : ''}>
                      {(wallet.realized_roi * 100).toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{wallet.total_trades}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">{wallet.active_positions}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/analysis/wallet/${wallet.address}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {wallets.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing top {wallets.length} whale{wallets.length !== 1 ? 's' : ''} ranked by Smart Whale Score
        </div>
      )}
    </div>
  );
}
