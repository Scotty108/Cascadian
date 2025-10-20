import type { BotTemplate, TemplateFilters } from "./types"

export const filterTemplates = (templates: BotTemplate[], filters: TemplateFilters): BotTemplate[] => {
  let filteredTemplates = [...templates]

  // Apply search filter
  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase()
    filteredTemplates = filteredTemplates.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.description.toLowerCase().includes(query) ||
        template.category.toLowerCase().includes(query) ||
        template.type.toLowerCase().includes(query),
    )
  }

  // Apply category filter
  if (filters.selectedCategory !== "all") {
    filteredTemplates = filteredTemplates.filter((template) => template.category === filters.selectedCategory)
  }

  // Apply type filter
  if (filters.selectedType !== "all") {
    filteredTemplates = filteredTemplates.filter((template) => template.type === filters.selectedType)
  }

  // Apply complexity filter
  if (filters.selectedComplexity !== "all") {
    filteredTemplates = filteredTemplates.filter((template) => template.complexity === filters.selectedComplexity)
  }

  // Apply tab filter
  if (filters.activeTab === "featured") {
    filteredTemplates = filteredTemplates.filter((template) => template.isFeatured)
  } else if (filters.activeTab === "new") {
    filteredTemplates = filteredTemplates.filter((template) => template.isNew)
  } else if (filters.activeTab === "favorites") {
    filteredTemplates = filteredTemplates.filter((template) => template.isFavorite)
  }

  return filteredTemplates
}

export const sortTemplates = (templates: BotTemplate[], sortBy: string): BotTemplate[] => {
  const sortedTemplates = [...templates]

  switch (sortBy) {
    case "popular":
      return sortedTemplates.sort((a, b) => b.popularity - a.popularity)
    case "rating":
      return sortedTemplates.sort((a, b) => b.rating - a.rating)
    case "newest":
      return sortedTemplates.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
    case "price-low":
      return sortedTemplates.sort((a, b) => {
        const priceA = a.price === "Free" ? 0 : a.price
        const priceB = b.price === "Free" ? 0 : b.price
        return priceA - priceB
      })
    case "price-high":
      return sortedTemplates.sort((a, b) => {
        const priceA = a.price === "Free" ? 0 : a.price
        const priceB = b.price === "Free" ? 0 : b.price
        return priceB - priceA
      })
    case "performance":
      return sortedTemplates.sort(
        (a, b) =>
          b.performance.winRate * b.performance.profitFactor - a.performance.winRate * a.performance.profitFactor,
      )
    default:
      return sortedTemplates
  }
}

export const formatPrice = (price: number | "Free"): string => {
  if (price === "Free") return "Free"
  return `$${price}`
}

export const formatPercentage = (value: number): string => {
  return `${value}%`
}

export const formatMultiplier = (value: number): string => {
  return `${value}x`
}

export const getComplexityColor = (complexity: string): string => {
  switch (complexity) {
    case "Beginner":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
    case "Intermediate":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
    case "Advanced":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300"
  }
}

export const getCategoryIcon = (category: string) => {
  const iconMap: Record<string, string> = {
    AI: "Cpu",
    DCA: "Repeat",
    Grid: "LayoutDashboard",
    Arbitrage: "Layers",
    Scalping: "TrendingUp",
    DeFi: "DollarSign",
    Technical: "BarChart3",
  }
  return iconMap[category] || "Circle"
}
