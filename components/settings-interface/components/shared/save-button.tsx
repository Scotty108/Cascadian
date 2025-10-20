"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Save } from "lucide-react"

interface SaveButtonProps {
  onSave: () => void
  isSaving: boolean
  hasUnsavedChanges: boolean
  disabled?: boolean
}

export const SaveButton: React.FC<SaveButtonProps> = ({ onSave, isSaving, hasUnsavedChanges, disabled = false }) => {
  return (
    <Button onClick={onSave} disabled={disabled || isSaving || !hasUnsavedChanges} className="min-w-[120px]">
      {isSaving ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Saving...
        </>
      ) : (
        <>
          <Save className="mr-2 h-4 w-4" />
          Save Changes
        </>
      )}
    </Button>
  )
}
