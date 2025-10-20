import { Users, Gift, Trophy } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { ReferralStats } from "../types"

interface ReferralStatsCardsProps {
  stats: ReferralStats
}

export function ReferralStatsCards({ stats }: ReferralStatsCardsProps) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Invites</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold">{stats.totalInvites}</div>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.pendingInvites} pending, {stats.activeUsers} active
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold">${stats.totalEarned}</div>
            <Gift className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">Lifetime earnings from referrals</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Next Reward</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold">${stats.nextReward}</div>
            <Trophy className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span>{stats.progressToNextReward}% to next reward</span>
              <span>{stats.progressToNextReward}/100</span>
            </div>
            <Progress value={stats.progressToNextReward} className="h-1" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
