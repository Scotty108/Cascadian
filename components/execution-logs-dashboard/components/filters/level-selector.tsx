"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LOG_LEVELS } from "../../constants"

interface LevelSelectorProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export const LevelSelector = ({ value, onChange, className = "" }: LevelSelectorProps) => {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select level" />
      </SelectTrigger>
      <SelectContent>
        {LOG_LEVELS.map((level) => (
          <SelectItem key={level.value} value={level.value}>
            {level.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
