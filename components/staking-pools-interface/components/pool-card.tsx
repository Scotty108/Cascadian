"use client"

import Image from "next/image";
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Heart, Check, Lock, Droplets } from "lucide-react"
import { formatNumber, formatPercent, getRiskColor } from "../utils"
import type { StakingPool } from "../types"
import { cn } from "@/lib/utils"

interface PoolCardProps {
  pool: StakingPool
  onStake: (pool: StakingPool) => void
  onToggleFavorite: (poolId: string) => void
  onShowDetails: (pool: StakingPool) => void
}

export function PoolCard({ pool, onStake, onToggleFavorite, onShowDetails }: PoolCardProps) {
  const Icon = pool.stakingTypeIcon

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col md:flex-row">
        <div className="p-4 md:w-3/4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <Avatar className="h-10 w-10">
                <AvatarImage src={pool.tokenLogo || "/placeholder.svg"} alt={pool.token} />
                <AvatarFallback>{pool.tokenSymbol.substring(0, 2)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-medium">{pool.name}</h3>
                  {pool.isVerified && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Check className="h-4 w-4 text-green-500" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Verified Pool</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="flex items-center text-sm text-muted-foreground">
                  <Image src={pool.chainLogo || "/placeholder.svg"} alt={pool.chain} width={12} height={12} className="w-3 h-3 mr-1" />
                  {pool.chain} • {pool.protocol}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onToggleFavorite(pool.id)}>
              <Heart className={cn("h-4 w-4", pool.isFavorite ? "fill-primary text-primary" : "")} />
              <span className="sr-only">Toggle favorite</span>
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">APY</div>
              <div className="font-medium text-lg text-green-500">{formatPercent(pool.apy)}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">TVL</div>
              <div className="font-medium">{formatNumber(pool.tvl)}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Lock Period</div>
              <div className="font-medium flex items-center">
                {pool.lockPeriod ? <Lock className="h-3 w-3 mr-1" /> : null}
                {pool.lockPeriodText}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Min Stake</div>
              <div className="font-medium">
                {pool.minStake} {pool.tokenSymbol}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm text-muted-foreground mb-1">Rewards</div>
            <div className="flex items-center space-x-2">
              {pool.rewardLogos.map((logo, index) => (
                <TooltipProvider key={index}>
                  <Tooltip>
                    <TooltipTrigger>
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={logo || "/placeholder.svg"} alt={pool.rewardTokens[index]} />
                        <AvatarFallback>{pool.rewardTokens[index].substring(0, 2)}</AvatarFallback>
                      </Avatar>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{pool.rewardTokens[index]}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
              <span className="text-sm">{pool.rewards.join(", ")}</span>
            </div>
          </div>

          <div className="mt-4 flex items-center space-x-2">
            {pool.isLiquidStaking && (
              <Badge variant="outline" className="flex items-center">
                <Droplets className="h-3 w-3 mr-1" />
                Liquid Staking
              </Badge>
            )}

            <Badge variant="outline" className="flex items-center">
              <div className={cn("h-2 w-2 rounded-full mr-1", getRiskColor(pool.riskLevel))}></div>
              {pool.riskLevel} Risk
            </Badge>

            <Badge variant="outline" className="flex items-center">
              <Icon className="h-3 w-3 mr-1" />
              {pool.stakingTypeLabel}
            </Badge>
          </div>
        </div>

        <div className="p-4 flex flex-col justify-between border-t md:border-t-0 md:border-l border-border md:w-1/4">
          <div className="text-sm">{pool.description}</div>

          <div className="mt-4 space-y-2">
            <Button className="w-full" onClick={() => onStake(pool)}>
              Stake
            </Button>

            <Button variant="outline" className="w-full" onClick={() => onShowDetails(pool)}>
              Learn More
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
