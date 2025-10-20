import { Twitter, Facebook, Linkedin, MessageCircle, Phone } from "lucide-react"
import type { SocialPlatform } from "./types"

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { name: "Twitter", icon: Twitter, color: "text-blue-500" },
  { name: "Facebook", icon: Facebook, color: "text-blue-600" },
  { name: "LinkedIn", icon: Linkedin, color: "text-blue-700" },
  { name: "Telegram", icon: MessageCircle, color: "text-blue-400" },
  { name: "WhatsApp", icon: Phone, color: "text-green-500" },
]

export const DEFAULT_REFERRAL_MESSAGE =
  "Join me on DefibotX, the ultimate AI-powered crypto trading platform. Use my referral link to get started and we'll both earn rewards!"

export const REFERRAL_TIPS = [
  {
    title: "Personalize Your Invitations",
    description: "Add a personal touch to your invitations. Explain why you use DefibotX and how it has helped you.",
  },
  {
    title: "Target the Right Audience",
    description:
      "Focus on friends who are already interested in crypto trading or looking to optimize their investments.",
  },
  {
    title: "Share Your Success Stories",
    description:
      "Include specific examples of how DefibotX has improved your trading or helped you discover opportunities.",
  },
  {
    title: "Follow Up",
    description: "Check in with friends you've invited to see if they have questions or need help getting started.",
  },
]
