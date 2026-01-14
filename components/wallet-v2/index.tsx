"use client";

import { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion } from "framer-motion";

// Data hooks
import { useWalletWIO, TimeWindow } from "@/hooks/use-wallet-wio";
import { useWalletFingerprint } from "@/hooks/use-wallet-fingerprint";
import { useWalletProfile } from "@/hooks/use-wallet-profile";

// New layout components
import { ProfileCard } from "./profile-card";
import { PnLChartCard } from "./pnl-chart-card";
import { StatsRow } from "./stats-row";
import { ContentTabs } from "./content-tabs";
import { WalletProfileSkeleton } from "./loading-skeleton";

interface WalletProfileV2Props {
  walletAddress: string;
}

export function WalletProfileV2({ walletAddress }: WalletProfileV2Props) {
  const [selectedWindow, setSelectedWindow] = useState<TimeWindow>("ALL");

  // Primary data source: WIO
  const {
    profile: wioProfile,
    isLoading: wioLoading,
    error: wioError,
    score,
    classification,
    metrics: wioMetrics,
    allMetrics,
    categoryStats,
    realizedPnl,
    openPositionsCount,
    closedPositionsCount,
    openPositions,
    recentPositions,
    recentTrades,
    bubbleChartData,
  } = useWalletWIO({
    walletAddress,
    window: selectedWindow,
  });

  // Fingerprint data for radar/polar/hex charts
  const {
    metrics: fingerprintMetrics,
    overallScore,
  } = useWalletFingerprint({
    walletAddress,
    window: "90d",
  });

  // Polymarket profile for username/avatar/pnl
  const { profile: polymarketProfile } = useWalletProfile(walletAddress);

  // Update document title with username when available
  useEffect(() => {
    if (polymarketProfile?.username) {
      document.title = `@${polymarketProfile.username} | Cascadian`;
    } else {
      const short = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
      document.title = `${short} | Cascadian`;
    }
  }, [polymarketProfile?.username, walletAddress]);

  const isLoading = wioLoading;
  const error = wioError;

  // Compute derived values
  const totalPnL = wioMetrics?.pnl_total_usd ?? classification?.pnl_total_usd ?? 0;
  const unrealizedPnL = realizedPnl !== undefined ? totalPnL - realizedPnl : 0;
  // Use scores table credibility (correct formula with Bayesian shrinkage)
  // Classification table has outdated win-rate-heavy formula
  const credibility = score?.credibility_score ?? classification?.credibility_score ?? 0;
  const winRate = wioMetrics?.win_rate ?? classification?.win_rate ?? 0;
  const resolvedPositions = wioMetrics?.resolved_positions_n ?? classification?.resolved_positions_n ?? 0;
  const totalPositions = wioMetrics?.positions_n ?? classification?.resolved_positions_n ?? 0;
  const activeDays = wioMetrics?.active_days_n ?? 0;
  const roi = wioMetrics?.roi_cost_weighted;
  const profitFactor = wioMetrics?.profit_factor;

  // Calculate joined date from wallet age
  const joinedDate = wioMetrics?.wallet_age_days
    ? (() => {
        const d = new Date();
        d.setDate(d.getDate() - wioMetrics.wallet_age_days);
        return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      })()
    : null;

  // Use score table's credibility (correct formula)
  // Don't merge in classification's outdated formula
  const mergedScore = score ?? null;

  return (
    <div className="min-h-screen bg-[#F1F1F1] dark:bg-[#0a0a0a] rounded-t-2xl relative z-40">
      <div className="w-full px-6 pt-4 pb-6 space-y-4">

        {/* Error State */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error Loading Wallet Data</AlertTitle>
            <AlertDescription>
              {error.message || "Failed to load wallet data"}
            </AlertDescription>
          </Alert>
        )}

        {/* Main Content - Always render structure, components handle their own loading states */}
        {!error && (
          <>
            {/* Hero Section: Profile Card + PnL Chart */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >
              <ProfileCard
                walletAddress={walletAddress}
                username={polymarketProfile?.username}
                profilePicture={polymarketProfile?.profilePicture}
                bio={polymarketProfile?.bio}
                tier={classification?.tier ?? undefined}
                polymarketUrl={polymarketProfile?.polymarketUrl}
                predictionsCount={totalPositions}
                joinedDate={joinedDate}
                credibility={credibility}
                winRate={winRate}
                roi={roi}
                isLoading={isLoading}
              />
              <PnLChartCard
                walletAddress={walletAddress}
                polymarketUrl={polymarketProfile?.polymarketUrl}
                totalPnl={totalPnL}
                realizedPnl={realizedPnl ?? 0}
                unrealizedPnl={unrealizedPnL}
                polymarketPnl={polymarketProfile?.pnl}
                isLoading={isLoading}
              />
            </motion.div>

            {/* Stats Row */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
            >
              <StatsRow
                avgWinRoi={wioMetrics?.avg_win_roi ?? 0}
                avgLossRoi={wioMetrics?.avg_loss_roi ?? 0}
                cvar95={wioMetrics?.cvar_95_roi ?? 0}
                maxLossRoi={wioMetrics?.max_loss_roi ?? 0}
                brierScore={wioMetrics?.brier_mean ?? 0.25}
                holdMinutes={wioMetrics?.hold_minutes_p50 ?? 0}
                pctHeldToResolve={wioMetrics?.pct_held_to_resolve ?? 0}
                profitFactor={profitFactor ?? 0}
                clv4h={wioMetrics?.clv_4h_cost_weighted ?? 0}
                clv24h={wioMetrics?.clv_24h_cost_weighted ?? 0}
                clv72h={wioMetrics?.clv_72h_cost_weighted ?? 0}
                isLoading={isLoading}
              />
            </motion.div>

            {/* Tabbed Content */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
              <ContentTabs
                openPositions={openPositions || []}
                closedPositions={recentPositions || []}
                openPositionsCount={openPositionsCount}
                closedPositionsCount={closedPositionsCount}
                recentTrades={recentTrades || []}
                categoryStats={categoryStats || []}
                bubbleChartData={bubbleChartData || []}
                fingerprintMetrics={fingerprintMetrics}
                overallScore={overallScore}
                score={mergedScore}
                metrics={wioMetrics}
                allMetrics={allMetrics}
                selectedWindow={selectedWindow}
                onWindowChange={setSelectedWindow}
                isLoading={isLoading}
              />
            </motion.div>
          </>
        )}

        {/* Empty State - Only show after loading completes with no data */}
        {!isLoading && !error && !wioProfile && (
          <Card className="p-12 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Wallet Not Found</h3>
              <p className="text-muted-foreground max-w-md">
                This wallet doesn&apos;t have enough trading history in our
                database to generate a profile. Try a wallet with more activity
                on Polymarket.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
