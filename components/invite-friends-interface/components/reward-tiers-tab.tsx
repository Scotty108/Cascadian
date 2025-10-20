import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RewardTierItem } from "./reward-tier-item"
import type { RewardTier } from "../types"

interface RewardTiersTabProps {
  tiers: RewardTier[]
  currentInvites: number
}

export function RewardTiersTab({ tiers, currentInvites }: RewardTiersTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reward Tiers</CardTitle>
        <CardDescription>Earn more by inviting more friends to DefibotX</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {tiers.map((tier) => (
            <RewardTierItem key={tier.tier} tier={tier} currentInvites={currentInvites} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
