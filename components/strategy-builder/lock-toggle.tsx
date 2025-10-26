/**
 * Lock Toggle Component
 *
 * Task Group 18: Manual Layout Tools and Persistence
 * Subtask 18.4: Lock/unlock layout to control auto-layout behavior
 *
 * Provides a toggle button to lock/unlock the layout. When locked, manual
 * positions persist and auto-layout is prevented. Lock state is persisted
 * to the database per workflow.
 */

"use client"

import { Button } from '@/components/ui/button'
import { Lock, Unlock } from 'lucide-react'
import { saveLockState } from '@/lib/workflow/layout/layout-persistence'
import { useToast } from '@/components/ui/use-toast'

export interface LockToggleProps {
  isLocked: boolean
  onChange: (locked: boolean) => void
  strategyId?: string
}

export function LockToggle({ isLocked, onChange, strategyId }: LockToggleProps) {
  const { toast } = useToast()

  const handleToggle = async () => {
    const newLockState = !isLocked
    onChange(newLockState)

    // Persist to database if strategyId provided
    if (strategyId) {
      try {
        await saveLockState(strategyId, newLockState)
      } catch (error) {
        console.error('Failed to save lock state:', error)
        toast({
          title: 'Failed to save lock state',
          description: 'Layout lock preference was not saved',
          variant: 'destructive',
        })
        // Revert the change
        onChange(isLocked)
      }
    }
  }

  return (
    <Button
      variant={isLocked ? 'default' : 'outline'}
      size="sm"
      onClick={handleToggle}
      title={isLocked ? 'Unlock layout (allow auto-layout)' : 'Lock layout (prevent auto-layout)'}
      className="gap-2"
    >
      {isLocked ? (
        <>
          <Lock className="h-4 w-4" />
          <span className="hidden md:inline">Locked</span>
        </>
      ) : (
        <>
          <Unlock className="h-4 w-4" />
          <span className="hidden md:inline">Unlocked</span>
        </>
      )}
    </Button>
  )
}
