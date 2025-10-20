import type { Article } from "./types"

export const filterArticles = (articles: Article[], searchQuery: string, selectedCategory: string): Article[] => {
  let filtered = articles

  // Filter by search query
  if (searchQuery.trim()) {
    filtered = filtered.filter((article) => article.title.toLowerCase().includes(searchQuery.toLowerCase()))
  }

  // Filter by category
  if (selectedCategory !== "all") {
    filtered = filtered.filter((article) => article.category === selectedCategory)
  }

  return filtered
}

export const formatViews = (views: number): string => {
  return views.toLocaleString()
}

export const getStatusColor = (status: string): string => {
  switch (status) {
    case "online":
      return "bg-green-500"
    case "away":
      return "bg-yellow-500"
    case "offline":
      return "bg-gray-500"
    default:
      return "bg-gray-500"
  }
}

export const getCategoryName = (categoryId: string, categories: any[]): string => {
  const category = categories.find((c) => c.id === categoryId)
  return category?.name || categoryId
}
