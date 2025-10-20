"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatNumber, formatPercent, getRiskColor } from "../utils"
import type { StakingPool } from "../types"

interface PoolDetailsModalProps {
  pool: StakingPool | null
  isOpen: boolean
  onClose: () => void
  onStake: (pool: StakingPool) => void
}

export function PoolDetailsModal({ pool, isOpen, onClose, onStake }: PoolDetailsModalProps) {
  if (!pool) return null

  const Icon = pool.stakingTypeIcon

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={pool.tokenLogo || "/placeholder.svg"} alt={pool.token} />
              <AvatarFallback>{pool.tokenSymbol.substring(0, 2)}</AvatarFallback>
            </Avatar>
            <span>{pool.name}</span>
          </DialogTitle>
          <DialogDescription>
            {pool.protocol} • {pool.chain}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="space-y-1">
            <Label className="text-muted-foreground">APY</Label>
            <div className="font-medium text-lg text-green-500">{formatPercent(pool.apy)}</div>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">TVL</Label>
            <div className="font-medium">{formatNumber(pool.tvl)}</div>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Lock Period</Label>
            <div className="font-medium">{pool.lockPeriodText}</div>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Min Stake</Label>
            <div className="font-medium">
              {pool.minStake} {pool.tokenSymbol}
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-4 py-4">
          <div>
            <Label className="text-muted-foreground">Description</Label>
            <p className="mt-1">{pool.description}</p>
          </div>

          <div>
            <Label className="text-muted-foreground">Rewards</Label>
            <div className="mt-1 flex items-center space-x-2">
              {pool.rewardLogos.map((logo, index) => (
                <Avatar key={index} className="h-6 w-6">
                  <AvatarImage src={logo || "/placeholder.svg"} alt={pool.rewardTokens[index]} />
                  <AvatarFallback>{pool.rewardTokens[index].substring(0, 2)}</AvatarFallback>
                </Avatar>
              ))}
              <span>{pool.rewards.join(", ")}</span>
            </div>
          </div>

          <div>
            <Label className="text-muted-foreground">Risk Level</Label>
            <div className="mt-1 flex items-center">
              <div className={`h-2 w-2 rounded-full mr-2 ${getRiskColor(pool.riskLevel)}`}></div>
              <span>{pool.riskLevel}</span>
            </div>
          </div>

          <div>
            <Label className="text-muted-foreground">Staking Type</Label>
            <div className="mt-1 flex items-center">
              <Icon className="h-4 w-4 mr-2" />
              <span>{pool.stakingTypeLabel}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="w-full" onClick={() => onStake(pool)}>
            Stake {pool.tokenSymbol}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
