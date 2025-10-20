"use client"

import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useSearch } from "../hooks/use-search"

interface SearchSectionProps {
  onSearch: (query: string) => void
  onContactSupport: () => void
  onLiveChat: () => void
}

export function SearchSection({ onSearch, onContactSupport, onLiveChat }: SearchSectionProps) {
  const { searchQuery, handleSearch } = useSearch(onSearch)

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="col-span-2">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search for help articles, tutorials, and FAQs..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex space-x-2">
        <Button className="flex-1" variant="outline" onClick={onLiveChat}>
          Live Chat
        </Button>
        <Button className="flex-1" onClick={onContactSupport}>
          Contact Support
        </Button>
      </div>
    </div>
  )
}
