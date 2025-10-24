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
  const { trades, totalTrades, isLoading: tradesLoading, error: tradesError } = useWalletTrades({ walletAddress, limit: 100 });
  const { value: portfolioValue, isLoading: valueLoading, error: valueError } = useWalletValue(walletAddress);
  const { closedPositions, totalRealizedPnL, winRate, totalClosed, isLoading: closedLoading } = useWalletClosedPositions({ walletAddress, limit: 100 });
  const { profile, isLoading: profileLoading } = useWalletProfile(walletAddress);

  // Calculate advanced metrics
  const metrics = useWalletMetrics(positions, closedPositions, trades, portfolioValue || positionsValue);

  // Calculate category-based wallet score
  const walletScore = useMemo(() => {
    if (closedPositions.length === 0) return null;
    const categoryScores = calculateCategoryScore(closedPositions);
    return calculateWalletScore(walletAddress, categoryScores, 10000); // TODO: Get actual total traders from DB
  }, [closedPositions, walletAddress]);

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
    <div className="min-h-screen bg-background p-6">
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
              rankAll={100} // TODO: Calculate from database
              totalTraders={10000} // TODO: Get from database
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
            ) : closedPositions.length === 0 ? (
              <Alert className="border-[#00E0AA]/20 bg-[#00E0AA]/5">
                <AlertCircle className="h-4 w-4 text-[#00E0AA]" />
                <AlertTitle className="text-[#00E0AA]">
                  No Intelligence Score Available
                </AlertTitle>
                <AlertDescription className="text-sm">
                  This wallet has no closed positions yet. Intelligence scores are calculated based on realized trading performance (closed positions with P&L).
                  <br />
                  <br />
                  Once this wallet closes some positions, we'll calculate:
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
                <TradingBubbleChart
                  closedPositions={closedPositions}
                />
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
                <Badge variant="outline">{totalClosed}</Badge>
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
                Data sourced from <span className="font-semibold">Polymarket Data-API</span> • Real-time wallet analytics
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
