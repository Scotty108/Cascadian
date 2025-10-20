import type React from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

interface SettingsToggleProps {
  id: string
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

export const SettingsToggle: React.FC<SettingsToggleProps> = ({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}) => {
  return (
    <div className="flex items-center justify-between space-x-4">
      <div className="flex-1 space-y-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}
