"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Wallet, Trophy, TrendingUp, Target } from "lucide-react";
import {
  WalletClassification,
  WalletMetrics,
  WalletScore,
  getTierConfig,
  formatPnL,
  formatPercent,
} from "@/hooks/use-wallet-wio";

interface WalletHeroSectionProps {
  walletAddress: string;
  username?: string | null;
  profilePicture?: string | null;
  bio?: string | null;
  classification: WalletClassification | null;
  score: WalletScore | null;
  metrics: WalletMetrics | null;
}

export function WalletHeroSection({
  walletAddress,
  username,
  profilePicture,
  bio,
  classification,
  score,
  metrics,
}: WalletHeroSectionProps) {
  const tierConfig = getTierConfig(classification?.tier);
  const truncatedAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  // Calculate derived values
  const totalPnL = metrics?.pnl_total_usd ?? classification?.pnl_total_usd ?? 0;
  const winRate = metrics?.win_rate ?? classification?.win_rate ?? 0;
  const credibility = score?.credibility_score ?? classification?.credibility_score ?? 0;
  const positions = metrics?.positions_n ?? classification?.resolved_positions_n ?? 0;

  return (
    <div className="space-y-4">
      {/* Identity Row */}
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <Avatar className="h-16 w-16 border-2 border-[#00E0AA]/20">
          <AvatarImage
            src={profilePicture || `https://api.dicebear.com/7.x/identicon/svg?seed=${walletAddress}`}
            alt={username || walletAddress}
          />
          <AvatarFallback className="bg-[#00E0AA]/10 text-[#00E0AA]">
            {username?.[0]?.toUpperCase() || walletAddress.slice(2, 4).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        {/* Name & Address */}
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {username ? (
              <h1 className="text-2xl font-bold">{username}</h1>
            ) : (
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-[#00E0AA]" />
                <h1 className="text-2xl font-bold font-mono">{truncatedAddress}</h1>
              </div>
            )}

            {/* Tier Badge */}
            {classification?.tier && (
              <Badge
                className={`${tierConfig.bgColor} ${tierConfig.textColor} border ${tierConfig.borderColor}`}
              >
                {tierConfig.label}
              </Badge>
            )}
          </div>

          {username && (
            <p className="text-sm text-muted-foreground font-mono mt-1">
              {walletAddress}
            </p>
          )}

          {bio && (
            <p className="text-sm text-muted-foreground mt-1 max-w-md line-clamp-2">
              {bio}
            </p>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Credibility */}
        <Card className="p-4 bg-card/50 border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Trophy className="h-4 w-4" />
            <span className="text-xs font-medium">Credibility</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">
              {(credibility * 100).toFixed(0)}%
            </span>
            {classification?.tier && (
              <span className={`text-xs ${tierConfig.textColor}`}>
                {tierConfig.label}
              </span>
            )}
          </div>
        </Card>

        {/* Total PnL */}
        <Card className="p-4 bg-card/50 border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium">Total PnL</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
              {formatPnL(totalPnL)}
            </span>
            {metrics?.roi_cost_weighted !== undefined && (
              <span className={`text-xs ${metrics.roi_cost_weighted >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                {formatPercent(metrics.roi_cost_weighted)}
              </span>
            )}
          </div>
        </Card>

        {/* Win Rate */}
        <Card className="p-4 bg-card/50 border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Target className="h-4 w-4" />
            <span className="text-xs font-medium">Win Rate</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${winRate >= 0.5 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
              {(winRate * 100).toFixed(1)}%
            </span>
            {metrics && (
              <span className="text-xs text-muted-foreground">
                {metrics.resolved_positions_n} resolved
              </span>
            )}
          </div>
        </Card>

        {/* Positions */}
        <Card className="p-4 bg-card/50 border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Wallet className="h-4 w-4" />
            <span className="text-xs font-medium">Positions</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">
              {positions.toLocaleString()}
            </span>
            {metrics?.active_days_n && (
              <span className="text-xs text-muted-foreground">
                {metrics.active_days_n}d active
              </span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
