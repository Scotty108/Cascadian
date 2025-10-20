import type { Asset, NewsFeed, NewsItem } from "../types"

// Mock news data generator
export function generateNewsFeed(asset: Asset): NewsFeed {
  const newsItems: NewsItem[] = [
    {
      id: "1",
      title: `${asset.symbol} Reaches New Technical Milestone`,
      summary: `Recent analysis shows ${asset.symbol} has broken through key resistance levels, indicating potential for continued upward momentum in the coming weeks.`,
      source: "CryptoNews Daily",
      publishedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      sentiment: "positive",
      impact: "high",
      url: "#",
      tags: ["technical-analysis", "price-action", "bullish"],
      relevanceScore: 95,
    },
    {
      id: "2",
      title: `Market Analysis: ${asset.symbol} Shows Strong Fundamentals`,
      summary: `Institutional adoption and improved market conditions have positioned ${asset.symbol} for potential growth, according to leading market analysts.`,
      source: "Blockchain Insights",
      publishedAt: new Date(Date.now() - Math.random() * 172800000).toISOString(),
      sentiment: "positive",
      impact: "medium",
      url: "#",
      tags: ["fundamentals", "institutional", "adoption"],
      relevanceScore: 88,
    },
    {
      id: "3",
      title: `Regulatory Update Affects ${asset.symbol} Trading`,
      summary: `New regulatory guidelines may impact trading patterns for ${asset.symbol}, with market participants adjusting their strategies accordingly.`,
      source: "Regulatory Watch",
      publishedAt: new Date(Date.now() - Math.random() * 259200000).toISOString(),
      sentiment: "neutral",
      impact: "medium",
      url: "#",
      tags: ["regulation", "compliance", "trading"],
      relevanceScore: 82,
    },
    {
      id: "4",
      title: `${asset.symbol} Volume Surge Indicates Increased Interest`,
      summary: `Trading volume for ${asset.symbol} has increased significantly over the past 24 hours, suggesting heightened market interest and potential price volatility.`,
      source: "Market Monitor",
      publishedAt: new Date(Date.now() - Math.random() * 345600000).toISOString(),
      sentiment: "neutral",
      impact: "low",
      url: "#",
      tags: ["volume", "trading", "volatility"],
      relevanceScore: 75,
    },
    {
      id: "5",
      title: `Technical Correction Expected for ${asset.symbol}`,
      summary: `After recent gains, technical indicators suggest ${asset.symbol} may experience a healthy correction before continuing its upward trajectory.`,
      source: "Technical Traders",
      publishedAt: new Date(Date.now() - Math.random() * 432000000).toISOString(),
      sentiment: "negative",
      impact: "low",
      url: "#",
      tags: ["correction", "technical", "bearish"],
      relevanceScore: 70,
    },
  ]

  return {
    items: newsItems.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
    lastUpdated: new Date().toISOString(),
    totalCount: newsItems.length,
  }
}

export function getSentimentColor(sentiment: string): string {
  switch (sentiment) {
    case "positive":
      return "text-green-600"
    case "negative":
      return "text-red-600"
    default:
      return "text-gray-600"
  }
}

export function getSentimentBadgeVariant(sentiment: string): "default" | "destructive" | "secondary" {
  switch (sentiment) {
    case "positive":
      return "default"
    case "negative":
      return "destructive"
    default:
      return "secondary"
  }
}

export function getImpactColor(impact: string): string {
  switch (impact) {
    case "high":
      return "text-red-600"
    case "medium":
      return "text-yellow-600"
    case "low":
      return "text-green-600"
    default:
      return "text-gray-600"
  }
}

export function formatTimeAgo(dateString: string): string {
  const now = new Date()
  const date = new Date(dateString)
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return "Just now"
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours} hour${hours > 1 ? "s" : ""} ago`
  } else {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days} day${days > 1 ? "s" : ""} ago`
  }
}
