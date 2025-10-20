import { CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { RewardTier } from "../types"

interface RewardTierItemProps {
  tier: RewardTier
  currentInvites: number
}

export function RewardTierItem({ tier, currentInvites }: RewardTierItemProps) {
  const isCompleted = currentInvites >= tier.invites

  return (
    <div className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full",
            isCompleted ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <span className="font-bold">{tier.tier}</span>
        </div>
        <div>
          <p className="font-medium">Tier {tier.tier}</p>
          <p className="text-sm text-muted-foreground">{tier.invites} successful referrals</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-medium">{tier.reward}</span>
        {isCompleted && <CheckCircle2 className="h-4 w-4 text-primary" />}
      </div>
    </div>
  )
}
