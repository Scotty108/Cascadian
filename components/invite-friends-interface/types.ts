import type React from "react"
export interface ReferralStats {
  totalInvites: number
  pendingInvites: number
  activeUsers: number
  totalEarned: number
  nextReward: number
  progressToNextReward: number
}

export interface Referral {
  id: number
  name: string
  date: string
  status: "active" | "pending"
  reward: number
}

export interface RewardTier {
  tier: number
  invites: number
  reward: string
}

export interface ReferralSettings {
  emailNotifications: boolean
  showInLeaderboard: boolean
  autoShareAchievements: boolean
}

export interface SocialPlatform {
  name: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}

export interface InvitationFormData {
  emails: string
  message: string
}
