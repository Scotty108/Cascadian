"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { getTierConfig } from "@/hooks/use-wallet-wio";

interface ProfileCardProps {
  walletAddress: string;
  username?: string | null;
  profilePicture?: string | null;
  bio?: string | null;
  tier?: string | null;
  polymarketUrl?: string | null;
  // Stats for bottom row
  positionsValue?: number;
  biggestWin?: number;
  predictionsCount?: number;
  joinedDate?: string | null;
  credibility?: number;
  winRate?: number;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

export function ProfileCard({
  walletAddress,
  username,
  profilePicture,
  bio,
  tier,
  polymarketUrl,
  positionsValue,
  biggestWin,
  predictionsCount,
  joinedDate,
  credibility,
  winRate,
}: ProfileCardProps) {
  const tierConfig = getTierConfig(tier as any);
  const truncatedAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  return (
    <Card className="p-5 bg-card border-border/50 h-full flex flex-col">
      {/* Top row: Avatar + Name + Actions */}
      <div className="flex items-start gap-4">
        <Avatar className="h-16 w-16 border-2 border-border">
          <AvatarImage
            src={profilePicture || `https://api.dicebear.com/7.x/identicon/svg?seed=${walletAddress}`}
            alt={username || walletAddress}
          />
          <AvatarFallback className="bg-muted text-muted-foreground">
            {username?.[0]?.toUpperCase() || walletAddress.slice(2, 4).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold truncate">
              {username || truncatedAddress}
            </h1>
            {/* Action icons */}
            {polymarketUrl && (
              <a
                href={polymarketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 hover:bg-muted rounded-md transition-colors ml-auto"
              >
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            )}
          </div>

          {/* Joined date + tier */}
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            {joinedDate && <span>Joined {joinedDate}</span>}
            {tier && (
              <Badge
                variant="outline"
                className={`${tierConfig.bgColor} ${tierConfig.textColor} border-0 text-xs`}
              >
                {tierConfig.label}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Bio */}
      {bio && (
        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
          {bio}
        </p>
      )}

      {/* Bottom stats row */}
      <div className="mt-auto pt-4 flex items-center gap-6 border-t border-border/50">
        {credibility !== undefined && (
          <div>
            <p className="text-xs text-muted-foreground">Credibility</p>
            <p className="text-lg font-semibold">{(credibility * 100).toFixed(0)}%</p>
          </div>
        )}
        {winRate !== undefined && (
          <div>
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="text-lg font-semibold">
              {(winRate * 100).toFixed(1)}%
            </p>
          </div>
        )}
        {predictionsCount !== undefined && (
          <div>
            <p className="text-xs text-muted-foreground">Positions</p>
            <p className="text-lg font-semibold">{predictionsCount}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
