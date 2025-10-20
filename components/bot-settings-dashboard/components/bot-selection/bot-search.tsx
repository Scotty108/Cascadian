"use client"

import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

interface BotSearchProps {
  value: string
  onChange: (value: string) => void
}

export function BotSearch({ value, onChange }: BotSearchProps) {
  return (
    <div className="relative">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input placeholder="Search bots..." className="pl-8" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
