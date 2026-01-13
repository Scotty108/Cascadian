"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { useWalletWIO, TimeWindow } from "@/hooks/use-wallet-wio";
import { useWalletProfile } from "@/hooks/use-wallet-profile";

import { WalletHeroSection } from "./wallet-hero-section";
import { WIOScoreCard } from "./wio-score-card";
import { PerformanceMetrics } from "./performance-metrics";
import { PositionsSection } from "./positions-section";
import { CategoryPerformance } from "./category-performance";
import { DotEventsSection } from "./dot-events-section";

interface WalletWIOProfileProps {
  walletAddress: string;
}

export function WalletWIOProfile({ walletAddress }: WalletWIOProfileProps) {
  const router = useRouter();
  const [selectedWindow, setSelectedWindow] = useState<TimeWindow>('ALL');

  // Fetch WIO data
  const {
    profile,
    isLoading,
    error,
    score,
    classification,
    metrics,
    allMetrics,
    categoryMetrics,
    openPositions,
    recentPositions,
    dotEvents,
  } = useWalletWIO({
    walletAddress,
    window: selectedWindow,
  });

  // Fetch profile from Polymarket (fallback for username/avatar)
  const { profile: polymarketProfile, isLoading: profileLoading } = useWalletProfile(walletAddress);

  const handleWindowChange = (window: TimeWindow) => {
    setSelectedWindow(window);
  };

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      <div className="px-6 py-6">
        <div className="max-w-[1600px] mx-auto space-y-6">
          {/* Back Button */}
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </div>

          {/* Error State */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error Loading Wallet Data</AlertTitle>
              <AlertDescription>
                {error.message || 'Failed to load wallet data'}
              </AlertDescription>
            </Alert>
          )}

          {/* Loading State */}
          {isLoading && !error && (
            <Card className="p-12">
              <div className="flex flex-col items-center justify-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
                <p className="text-muted-foreground">Loading wallet data from WIO...</p>
              </div>
            </Card>
          )}

          {/* Main Content */}
          {!isLoading && !error && (
            <>
              {/* Hero Section */}
              <WalletHeroSection
                walletAddress={walletAddress}
                username={polymarketProfile?.username}
                profilePicture={polymarketProfile?.profilePicture}
                bio={polymarketProfile?.bio}
                classification={classification}
                score={score}
                metrics={metrics}
              />

              {/* Dot Events (Smart Money Signals) - Show prominently if wallet has signals */}
              {dotEvents.length > 0 && (
                <DotEventsSection dotEvents={dotEvents} />
              )}

              {/* WIO Score Card */}
              <WIOScoreCard score={score} />

              {/* Performance Metrics */}
              <PerformanceMetrics
                metrics={metrics}
                allMetrics={allMetrics}
                selectedWindow={selectedWindow}
                onWindowChange={handleWindowChange}
              />

              {/* Positions */}
              <PositionsSection
                openPositions={openPositions}
                closedPositions={recentPositions}
              />

              {/* Category Performance */}
              {categoryMetrics.length > 0 && (
                <CategoryPerformance categoryMetrics={categoryMetrics} />
              )}

              {/* Data Source Attribution */}
              <Card className="p-4 bg-muted/50 border-border/50">
                <p className="text-sm text-muted-foreground text-center">
                  Data powered by <span className="font-semibold text-[#00E0AA]">WIO</span> (Wallet Intelligence Ontology) •
                  Updated hourly • {profile?.computed_at ? `Last computed: ${new Date(profile.computed_at).toLocaleString()}` : ''}
                </p>
              </Card>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// Re-export all types and components
export * from "./wallet-hero-section";
export * from "./wio-score-card";
export * from "./performance-metrics";
export * from "./positions-section";
export * from "./category-performance";
export * from "./dot-events-section";
