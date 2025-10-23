"use client"

import { useEffect, useState } from "react"
import { workflowSessionService } from "@/lib/services/workflow-session-service"
import type { WorkflowSession } from "@/types/database"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  Search,
  Trash2,
  Copy,
  Clock,
  Play,
  AlertCircle,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface WorkflowListModalProps {
  open: boolean
  onClose: () => void
  onSelect: (workflowId: string) => void
  onDelete: (workflowId: string) => void
}

export function WorkflowListModal({
  open,
  onClose,
  onSelect,
  onDelete,
}: WorkflowListModalProps) {
  const [workflows, setWorkflows] = useState<WorkflowSession[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      loadWorkflows()
    }
  }, [open])

  async function loadWorkflows() {
    try {
      setLoading(true)
      setError(null)
      const { data, error: loadError } = await workflowSessionService.listWorkflows({
        status: 'active',
        orderBy: 'updated_at',
        orderDirection: 'desc',
        limit: 100,
      })

      if (loadError) throw loadError
      setWorkflows(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load workflows')
    } finally {
      setLoading(false)
    }
  }

  const filteredWorkflows = workflows.filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-500'
      case 'draft':
        return 'bg-yellow-500/10 text-yellow-500'
      case 'archived':
        return 'bg-gray-500/10 text-gray-500'
      default:
        return 'bg-blue-500/10 text-blue-500'
    }
  }

  const handleDuplicate = async (workflow: WorkflowSession) => {
    try {
      const { data } = await workflowSessionService.duplicateWorkflow(
        workflow.id,
        `${workflow.name} (Copy)`
      )
      if (data) {
        await loadWorkflows()
      }
    } catch (err: any) {
      console.error('Failed to duplicate:', err)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Your Strategies</DialogTitle>
          <DialogDescription>
            Load an existing workflow or create a new one
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Workflows List */}
        <ScrollArea className="h-[400px] pr-4">
          {loading && (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-32 text-destructive">
              <AlertCircle className="h-5 w-5 mr-2" />
              {error}
            </div>
          )}

          {!loading && !error && filteredWorkflows.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <p>No workflows found</p>
              <p className="text-sm">Create your first strategy!</p>
            </div>
          )}

          {!loading && !error && filteredWorkflows.length > 0 && (
            <div className="space-y-2">
              {filteredWorkflows.map((workflow) => (
                <div
                  key={workflow.id}
                  className="group relative flex items-start gap-4 rounded-lg border p-4 transition hover:bg-accent cursor-pointer"
                  onClick={() => onSelect(workflow.id)}
                >
                  {/* Main Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold truncate">{workflow.name}</h4>
                      <Badge variant="outline" className={getStatusColor(workflow.status)}>
                        {workflow.status}
                      </Badge>
                    </div>

                    {workflow.description && (
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-1">
                        {workflow.description}
                      </p>
                    )}

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(workflow.updatedAt), { addSuffix: true })}
                      </span>
                      <span>{workflow.nodes.length} nodes</span>
                      <span>{workflow.edges.length} connections</span>
                      {workflow.tags && workflow.tags.length > 0 && (
                        <div className="flex gap-1">
                          {workflow.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                          {workflow.tags.length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{workflow.tags.length - 2}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDuplicate(workflow)
                      }}
                      className="h-8 w-8 p-0"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(workflow.id)
                      }}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer Stats */}
        {!loading && workflows.length > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-4">
            <span>{workflows.length} total strategies</span>
            <span>{filteredWorkflows.length} shown</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
