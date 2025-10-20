import type React from "react"
export interface Category {
  id: string
  name: string
  icon: React.ComponentType<{ className?: string }>
}

export interface Article {
  id: number
  title: string
  category: string
  views: number
  updated: string
}

export interface FAQ {
  id: string
  question: string
  answer: string
}

export interface VideoTutorial {
  id: number
  title: string
  duration: string
  thumbnail: string
  videoUrl?: string
}

export interface SupportTeamMember {
  name: string
  role: string
  avatar: string
  status: "online" | "away" | "offline"
}

export interface ResourceLink {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
}

export interface PlatformStatus {
  status: "operational" | "degraded" | "down"
  message: string
  lastUpdated: string
}

export interface HelpCenterState {
  searchQuery: string
  selectedCategory: string
  filteredArticles: Article[]
  isLoading: boolean
  error: string | null
}
