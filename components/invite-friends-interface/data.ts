import type { ReferralStats, Referral, RewardTier, ReferralSettings } from "./types"

export const mockReferralStats: ReferralStats = {
  totalInvites: 24,
  pendingInvites: 7,
  activeUsers: 17,
  totalEarned: 450,
  nextReward: 50,
  progressToNextReward: 70,
}

export const mockRecentReferrals: Referral[] = [
  { id: 1, name: "Alex Johnson", date: "2 days ago", status: "active", reward: 25 },
  { id: 2, name: "Sarah Williams", date: "3 days ago", status: "active", reward: 25 },
  { id: 3, name: "Michael Brown", date: "5 days ago", status: "active", reward: 25 },
  { id: 4, name: "Emily Davis", date: "1 week ago", status: "active", reward: 25 },
  { id: 5, name: "David Miller", date: "1 week ago", status: "pending", reward: 0 },
]

export const mockRewardTiers: RewardTier[] = [
  { tier: 1, invites: 5, reward: "$50 in BTC" },
  { tier: 2, invites: 10, reward: "$150 in BTC" },
  { tier: 3, invites: 25, reward: "$500 in BTC" },
  { tier: 4, invites: 50, reward: "$1,500 in BTC" },
  { tier: 5, invites: 100, reward: "$5,000 in BTC" },
]

export const defaultReferralSettings: ReferralSettings = {
  emailNotifications: true,
  showInLeaderboard: true,
  autoShareAchievements: false,
}
