"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExternalLink, Info } from "lucide-react";
import { getTierConfig } from "@/hooks/use-wallet-wio";

interface ProfileCardProps {
  walletAddress: string;
  username?: string | null;
  profilePicture?: string | null;
  bio?: string | null;
  tier?: string | null;
  polymarketUrl?: string | null;
  predictionsCount?: number;
  joinedDate?: string | null;
  credibility?: number;
  winRate?: number;
  roi?: number;
}

interface StatChipProps {
  label: string;
  value: string;
  tooltip: string;
}

function StatChip({ label, value, tooltip }: StatChipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col items-center p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-help min-w-0 flex-1">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
              <Info className="h-2.5 w-2.5 text-muted-foreground/40" />
            </div>
            <span className="text-base font-bold truncate">{value}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ProfileCard({
  walletAddress,
  username,
  profilePicture,
  bio,
  tier,
  polymarketUrl,
  predictionsCount,
  joinedDate,
  credibility,
  winRate,
  roi,
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

      {/* Bottom stats row - Chip style */}
      <div className="mt-auto pt-4 border-t border-border/50">
        <div className="grid grid-cols-4 gap-2">
          {credibility !== undefined && (
            <StatChip
              label="Credibility"
              value={`${(credibility * 100).toFixed(0)}%`}
              tooltip="Credibility score based on trading history, consistency, and behavior patterns. Higher is more trustworthy."
            />
          )}
          {winRate !== undefined && (
            <StatChip
              label="Win Rate"
              value={`${(winRate * 100).toFixed(1)}%`}
              tooltip="Percentage of resolved positions that were profitable. Above 50% indicates positive selection ability."
            />
          )}
          {predictionsCount !== undefined && (
            <StatChip
              label="Positions"
              value={predictionsCount.toLocaleString()}
              tooltip="Total number of positions taken across all markets. More positions = more data for analysis."
            />
          )}
          {roi !== undefined && (
            <StatChip
              label="ROI"
              value={`${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`}
              tooltip="Cost-weighted return on investment across all positions. Shows overall profitability relative to capital deployed."
            />
          )}
        </div>
      </div>
    </Card>
  );
}
