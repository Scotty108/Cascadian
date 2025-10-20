"use client"

import { useState } from "react"
import type { BotTemplate } from "../types"
import { botTemplatesData } from "../data"

export const useTemplates = () => {
  const [templates, setTemplates] = useState<BotTemplate[]>(botTemplatesData)

  const toggleFavorite = (id: string) => {
    setTemplates((prevTemplates) =>
      prevTemplates.map((template) =>
        template.id === id ? { ...template, isFavorite: !template.isFavorite } : template,
      ),
    )
  }

  const getTemplateById = (id: string) => {
    return templates.find((template) => template.id === id)
  }

  return {
    templates,
    toggleFavorite,
    getTemplateById,
  }
}
