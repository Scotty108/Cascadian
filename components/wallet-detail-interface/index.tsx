// @ts-nocheck
"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, DollarSign, Target, Activity, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWalletPositions } from "@/hooks/use-wallet-positions";
import { useWalletTrades } from "@/hooks/use-wallet-trades";
import { useWalletValue } from "@/hooks/use-wallet-value";
import { useWalletClosedPositions } from "@/hooks/use-wallet-closed-positions";
import { useWalletMetrics } from "@/hooks/use-wallet-metrics";
import { useWalletProfile } from "@/hooks/use-wallet-profile";
import { useWalletOmegaScore } from "@/hooks/use-wallet-omega-score";
import { useWalletGoldskyPositions } from "@/hooks/use-wallet-goldsky-positions";
import { calculateCategoryScore, calculateWalletScore } from "@/lib/wallet-scoring";
import { HeroMetrics } from "./components/hero-metrics";
import { TradingBubbleChart } from "./components/trading-bubble-chart";
import { TradingCalendarHeatmap } from "./components/trading-calendar-heatmap";
import { CategoryScores } from "./components/category-scores";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface WalletDetailProps {
  walletAddress: string;
}

export function WalletDetail({ walletAddress }: WalletDetailProps) {
  const router = useRouter();
  const [showAllPositions, setShowAllPositions] = useState(false);
  const [showAllTrades, setShowAllTrades] = useState(false);

  // Fetch real wallet data from Polymarket Data-API
  const { positions, totalValue: positionsValue, isLoading: positionsLoading, error: positionsError } = useWalletPositions(walletAddress);
  const { trades, totalTrades, isLoading: tradesLoading, error: tradesError } = useWalletTrades({ walletAddress, limit: 1000 }); // Increased from 100 to match closed positions
  const { value: portfolioValue, isLoading: valueLoading, error: valueError } = useWalletValue(walletAddress);
  const { closedPositions, totalRealizedPnL, winRate, totalClosed, isLoading: closedLoading } = useWalletClosedPositions({ walletAddress, limit: 1000 });
  const { profile, isLoading: profileLoading } = useWalletProfile(walletAddress);

  // Fetch Omega score for smart money metrics
  const { data: omegaScore, isLoading: omegaLoading } = useWalletOmegaScore({ walletAddress });

  // Fetch complete closed positions from Goldsky (includes wins AND losses)
  const { positions: goldskyPositions } = useWalletGoldskyPositions(walletAddress);

  // Calculate advanced metrics - USE POLYMARKET DATA (actually complete now!)
  // Polymarket /closed-positions now returns all wins AND losses
  const metrics = useWalletMetrics(positions, closedPositions, trades, portfolioValue || positionsValue);

  // Calculate category-based wallet score (use Goldsky data for accuracy)
  const walletScore = useMemo(() => {
    if (goldskyPositions.length === 0) return null;
    const categoryScores = calculateCategoryScore(goldskyPositions);
    return calculateWalletScore(walletAddress, categoryScores, 10000); // TODO: Get actual total traders from DB
  }, [goldskyPositions, walletAddress]);

  // Loading state
  const isLoading = positionsLoading || tradesLoading || valueLoading || closedLoading;

  // Error state
  const hasError = positionsError || tradesError || valueError;

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Format percentage
  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  // Format date
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Format time ago
  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      <div className="px-6 py-6">
        <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>

            {/* Profile Picture */}
            <Avatar className="h-16 w-16 border-2 border-[#00E0AA]/20">
              <AvatarImage
                src={profile?.profilePicture || `https://api.dicebear.com/7.x/identicon/svg?seed=${walletAddress}`}
                alt={profile?.username || walletAddress}
              />
              <AvatarFallback className="bg-[#00E0AA]/10 text-[#00E0AA]">
                {profile?.username?.[0]?.toUpperCase() || walletAddress.slice(2, 4).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div>
              <div className="flex items-center gap-3">
                {profile?.username && (
                  <h1 className="text-3xl font-bold">{profile.username}</h1>
                )}
                {!profile?.username && (
                  <>
                    <Wallet className="h-6 w-6 text-[#00E0AA]" />
                    <h1 className="text-3xl font-bold">Wallet Detail</h1>
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1 font-mono">
                {walletAddress}
              </p>
              {profile?.bio && (
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  {profile.bio}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Error State */}
        {hasError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error Loading Wallet Data</AlertTitle>
            <AlertDescription>
              {positionsError?.message || tradesError?.message || valueError?.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {isLoading && !hasError && (
          <Card className="p-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
              <p className="text-muted-foreground">Loading wallet data from Polymarket...</p>
            </div>
          </Card>
        )}

        {/* Omega Score Banner */}
        {omegaScore && omegaScore.meets_minimum_trades && (
          <Card className={`p-6 border-2 ${
            omegaScore.grade === 'S' ? 'border-purple-500 bg-purple-500/10' :
            omegaScore.grade === 'A' ? 'border-[#00E0AA] bg-[#00E0AA]/10' :
            omegaScore.grade === 'B' ? 'border-blue-500 bg-blue-500/10' :
            omegaScore.grade === 'C' ? 'border-yellow-500 bg-yellow-500/10' :
            omegaScore.grade === 'D' ? 'border-orange-500 bg-orange-500/10' :
            'border-red-500 bg-red-500/10'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className={`flex items-center justify-center w-16 h-16 rounded-full ${
                  omegaScore.grade === 'S' ? 'bg-purple-500' :
                  omegaScore.grade === 'A' ? 'bg-[#00E0AA]' :
                  omegaScore.grade === 'B' ? 'bg-blue-500' :
                  omegaScore.grade === 'C' ? 'bg-yellow-500' :
                  omegaScore.grade === 'D' ? 'bg-orange-500' :
                  'bg-red-500'
                }`}>
                  <span className="text-3xl font-bold text-black">{omegaScore.grade}</span>
                </div>
                <div>
                  <h3 className="text-2xl font-bold flex items-center gap-2">
                    Smart Money Grade
                    <Badge variant={
                      omegaScore.momentum_direction === 'improving' ? 'default' :
                      omegaScore.momentum_direction === 'declining' ? 'destructive' :
                      'secondary'
                    } className="text-sm">
                      {omegaScore.momentum_direction === 'improving' && '📈 Improving'}
                      {omegaScore.momentum_direction === 'declining' && '📉 Declining'}
                      {omegaScore.momentum_direction === 'stable' && '➡️ Stable'}
                    </Badge>
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Omega Ratio: <span className="font-bold">{omegaScore.omega_ratio.toFixed(2)}</span> •
                    Win Rate: <span className="font-bold">{(omegaScore.win_rate * 100).toFixed(1)}%</span> •
                    {omegaScore.closed_positions} closed trades
                  </p>
                </div>
              </div>
              <div className="flex gap-6">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total Gains</p>
                  <p className="text-xl font-bold text-[#00E0AA]">
                    {omegaScore.total_gains >= 1000
                      ? `$${(omegaScore.total_gains / 1000).toFixed(1)}k`
                      : `$${omegaScore.total_gains.toFixed(2)}`
                    }
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total Losses</p>
                  <p className="text-xl font-bold text-red-500">
                    {omegaScore.total_losses >= 1000
                      ? `$${(omegaScore.total_losses / 1000).toFixed(1)}k`
                      : `$${omegaScore.total_losses.toFixed(2)}`
                    }
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Net PnL</p>
                  <p className={`text-xl font-bold ${omegaScore.total_pnl >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                    {Math.abs(omegaScore.total_pnl) >= 1000
                      ? `$${(omegaScore.total_pnl / 1000).toFixed(1)}k`
                      : `$${omegaScore.total_pnl.toFixed(2)}`
                    }
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Key Metrics */}
        {!isLoading && !hasError && (
          <>
            {/* Hero Metrics - 8 Cards */}
            <HeroMetrics
              totalPnL={metrics.totalPnL}
              totalPnLPct={metrics.totalPnLPct}
              winRate={metrics.winRate}
              winningTrades={metrics.winningTrades}
              losingTrades={metrics.losingTrades}
              rankAll={null} // Rank disabled until we have real leaderboard data
              totalTraders={null} // Total traders disabled until we have real data
              activePositions={metrics.activePositions}
              activeValue={metrics.portfolioValue}
              unrealizedPnL={metrics.unrealizedPnL}
              totalInvested={metrics.totalInvested}
              daysActive={metrics.daysActive}
              sharpeRatio={metrics.sharpeRatio}
              sharpeLevel={metrics.sharpeLevel}
              avgTradeSize={metrics.avgTradeSize}
              totalTrades={metrics.totalTrades}
              marketsTraded={metrics.marketsTraded}
              activeMarkets={metrics.activeMarkets}
              pnlSparkline={metrics.pnlHistory.slice(-20).map(h => h.pnl)}
              volumeSparkline={metrics.volumeHistory.slice(-20).map(h => h.volume)}
            />

            {/* Wallet Intelligence Score - Category Breakdown */}
            {walletScore ? (
              <CategoryScores walletScore={walletScore} />
            ) : goldskyPositions.length === 0 ? (
              <Alert className="border-[#00E0AA]/20 bg-[#00E0AA]/5">
                <AlertCircle className="h-4 w-4 text-[#00E0AA]" />
                <AlertTitle className="text-[#00E0AA]">
                  No Intelligence Score Available
                </AlertTitle>
                <AlertDescription className="text-sm">
                  This wallet has no closed positions yet. Intelligence scores are calculated based on realized trading performance (closed positions with P&L).
                  <br />
                  <br />
                  Once this wallet closes some positions, we&apos;ll calculate:
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>Category-specific scores (Politics, Economics, Commodities, etc.)</li>
                    <li>Specialization levels (Expert, Advanced, Intermediate)</li>
                    <li>Strengths and weaknesses by market type</li>
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {/* Open Positions */}
            <Card className="p-6 border-border/50">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Open Positions</h2>
                <Badge variant="outline">{positions.length}</Badge>
              </div>

              {positions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No open positions
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Market</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead className="text-right">Size</TableHead>
                          <TableHead className="text-right">Entry Price</TableHead>
                          <TableHead className="text-right">Current Price</TableHead>
                          <TableHead className="text-right">Unrealized PnL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showAllPositions ? positions : positions.slice(0, 10)).map((position, index) => {
                          const unrealizedPnL = position.unrealizedPnL || position.unrealized_pnl || 0;
                          const entryPrice = position.entryPrice || position.entry_price || 0;
                          const pnlPercent = entryPrice
                            ? ((unrealizedPnL / (entryPrice * (position.size || position.shares || 0))) * 100)
                            : 0;

                          return (
                            <TableRow key={index}>
                              <TableCell className="font-medium max-w-xs truncate">
                                {position.market || position.question || `Position #${index + 1}`}
                              </TableCell>
                              <TableCell>
                                <Badge variant={position.side === 'YES' ? 'default' : 'secondary'}>
                                  {position.side || position.outcome || 'N/A'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {(position.size || position.shares || 0).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(position.entryPrice || position.entry_price || 0)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(position.currentPrice || position.current_price || 0)}
                              </TableCell>
                              <TableCell className={`text-right font-semibold ${unrealizedPnL >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                                {formatCurrency(unrealizedPnL)}
                                <div className="text-xs">
                                  {formatPercent(pnlPercent)}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {positions.length > 10 && (
                    <div className="mt-4 text-center">
                      <Button
                        variant="outline"
                        onClick={() => setShowAllPositions(!showAllPositions)}
                      >
                        {showAllPositions ? 'Show Less' : `Show All ${positions.length} Positions`}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* Trading Activity Visualizations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Bubble Chart - Market Performance */}
              <Card className="p-6 border-border/50">
                {/* Using Polymarket data - now has COMPLETE win/loss data with proper categories */}
                <TradingBubbleChart
                  closedPositions={closedPositions}
                />
                {closedPositions.length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Showing all {closedPositions.length} positions (wins and losses).
                  </div>
                )}
              </Card>

              {/* Calendar Heatmap - Trading Activity */}
              <Card className="p-6 border-border/50">
                <TradingCalendarHeatmap
                  trades={trades}
                  closedPositions={closedPositions}
                />
              </Card>
            </div>

            {/* Trade History */}
            <Card className="p-6 border-border/50">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Trade History</h2>
                <Badge variant="outline">{totalTrades}</Badge>
              </div>

              {trades.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No trade history
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Market</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead className="text-right">Size</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showAllTrades ? trades : trades.slice(0, 20)).map((trade, index) => (
                          <TableRow key={trade.id || trade.trade_id || index}>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatTimeAgo(trade.timestamp || trade.created_at)}
                            </TableCell>
                            <TableCell className="font-medium max-w-xs truncate">
                              {trade.market || trade.question || `Market #${index + 1}`}
                            </TableCell>
                            <TableCell>
                              <Badge variant={trade.action === 'BUY' || trade.type === 'BUY' ? 'default' : 'secondary'}>
                                {trade.action || trade.type || 'N/A'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={trade.side === 'YES' ? 'default' : 'outline'}>
                                {trade.side || trade.outcome || 'N/A'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {(trade.shares || trade.size || 0).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(trade.price || 0)}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatCurrency(trade.amount || trade.amount_usd || 0)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {trades.length > 20 && (
                    <div className="mt-4 text-center">
                      <Button
                        variant="outline"
                        onClick={() => setShowAllTrades(!showAllTrades)}
                      >
                        {showAllTrades ? 'Show Less' : `Show All ${trades.length} Trades`}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* Closed Positions */}
            <Card className="p-6 border-border/50">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Closed Positions</h2>
                <Badge variant="outline">{closedPositions.length}</Badge>
              </div>

              {closedPositions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No closed positions
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Market</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Entry Price</TableHead>
                        <TableHead className="text-right">Exit Price</TableHead>
                        <TableHead className="text-right">Realized PnL</TableHead>
                        <TableHead>Closed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {closedPositions.slice(0, 10).map((position, index) => {
                        const realizedPnL = position.realizedPnL || position.realized_pnl || position.profit || 0;

                        return (
                          <TableRow key={position.id || position.position_id || index}>
                            <TableCell className="font-medium max-w-xs truncate">
                              {position.market || position.question || `Position #${index + 1}`}
                            </TableCell>
                            <TableCell>
                              <Badge variant={position.side === 'YES' ? 'default' : 'secondary'}>
                                {position.side || position.outcome || 'N/A'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(position.entryPrice || position.entry_price || 0)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(position.exitPrice || position.exit_price || 0)}
                            </TableCell>
                            <TableCell className={`text-right font-semibold ${realizedPnL >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                              {formatCurrency(realizedPnL)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(position.closed_at)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>

            {/* Data Source Attribution */}
            <Card className="p-4 bg-muted/50 border-border/50">
              <p className="text-sm text-muted-foreground text-center">
                Data sourced from <span className="font-semibold">Goldsky PnL Subgraph</span> (complete win/loss data) and <span className="font-semibold">Polymarket Data-API</span> (market metadata) • Real-time wallet analytics
              </p>
            </Card>
          </>
        )}
        </div>
      </div>
    </Card>
  );
}
