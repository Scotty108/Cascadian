"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useReferrals } from "./hooks/use-referrals"
import { generateReferralLink } from "./utils"
import { mockRewardTiers } from "./data"
import { ReferralLinkCard } from "./components/referral-link-card"
import { EmailInvitationCard } from "./components/email-invitation-card"
import { ReferralStatsCards } from "./components/referral-stats-cards"
import { ReferralHistoryTab } from "./components/referral-history-tab"
import { RewardTiersTab } from "./components/reward-tiers-tab"
import { ReferralSettingsCard } from "./components/referral-settings-card"
import { ReferralTipsCard } from "./components/referral-tips-card"

export function InviteFriendsInterface() {
  const { stats, referrals, settings, updateSettings } = useReferrals()
  const [mounted, setMounted] = useState(false)

  // Generate referral link (in a real app, this would come from user data)
  const referralLink = generateReferralLink("ayaanzafar")

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Invite Friends</h1>
        <p className="text-muted-foreground mt-2">
          Invite your friends to DefibotX and earn rewards for every successful referral
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ReferralLinkCard referralLink={referralLink} />
        <EmailInvitationCard />
      </div>

      <ReferralStatsCards stats={stats} />

      <Tabs defaultValue="referrals" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-[400px]">
          <TabsTrigger value="referrals">Referral History</TabsTrigger>
          <TabsTrigger value="rewards">Reward Tiers</TabsTrigger>
        </TabsList>

        <TabsContent value="referrals" className="mt-6">
          <ReferralHistoryTab referrals={referrals} />
        </TabsContent>

        <TabsContent value="rewards" className="mt-6">
          <RewardTiersTab tiers={mockRewardTiers} currentInvites={stats.totalInvites} />
        </TabsContent>
      </Tabs>

      <ReferralSettingsCard settings={settings} onSettingsChange={updateSettings} />

      <ReferralTipsCard />
    </div>
  )
}
