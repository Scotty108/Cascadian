import { BookOpen, FileText, BarChart, Cpu, Wallet, Shield, Settings } from "lucide-react"
import type { Category } from "./types"

export const CATEGORIES: Category[] = [
  { id: "all", name: "All Topics", icon: BookOpen },
  { id: "getting-started", name: "Getting Started", icon: FileText },
  { id: "trading", name: "Trading", icon: BarChart },
  { id: "bots", name: "Bots & AI", icon: Cpu },
  { id: "defi", name: "DeFi", icon: Wallet },
  { id: "security", name: "Security", icon: Shield },
  { id: "account", name: "Account", icon: Settings },
]

export const SEARCH_PLACEHOLDER = "Search for help articles, tutorials, and FAQs..."

export const CONTACT_INFO = {
  email: "support@defibotx.com",
  responseTime: "Currently under 2 hours",
  availability: "24/7 for Pro and Enterprise users",
}

export const PLATFORM_STATUS = {
  status: "operational" as const,
  message: "All Systems Operational",
  lastUpdated: "10 minutes ago",
}
