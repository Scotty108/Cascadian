export type NodeType =
  | "start"
  | "end"
  | "httpRequest"
  | "conditional"
  | "javascript"
  | "webhook"
  | "delay"
  | "database"
  | "email"
  | "transform"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type TimeUnit = "seconds" | "minutes" | "hours"

export interface BaseNodeConfig {
  id: string
  type: NodeType
  label: string
  description: string
  position?: { x: number; y: number }
  retryAttempts?: number
  timeout?: number
}

export interface StartNodeConfig extends BaseNodeConfig {
  type: "start"
  config: Record<string, never>
}

export interface EndNodeConfig extends BaseNodeConfig {
  type: "end"
  config: Record<string, never>
}

export interface HttpRequestNodeConfig extends BaseNodeConfig {
  type: "httpRequest"
  config: {
    method: HttpMethod
    url: string
    headers?: string
    body?: string
    queryParams?: string
  }
}

export interface ConditionalNodeConfig extends BaseNodeConfig {
  type: "conditional"
  config: {
    condition: string
  }
}

export interface JavaScriptNodeConfig extends BaseNodeConfig {
  type: "javascript"
  config: {
    code: string
  }
}

export interface WebhookNodeConfig extends BaseNodeConfig {
  type: "webhook"
  config: {
    secret?: string
    allowedIps?: string[]
  }
}

export interface DelayNodeConfig extends BaseNodeConfig {
  type: "delay"
  config: {
    duration: number
    unit: TimeUnit
  }
}

export type NodeConfig =
  | StartNodeConfig
  | EndNodeConfig
  | HttpRequestNodeConfig
  | ConditionalNodeConfig
  | JavaScriptNodeConfig
  | WebhookNodeConfig
  | DelayNodeConfig

export interface Connection {
  id: string
  from: string
  to: string
  label?: string
  condition?: boolean
}

export interface WorkflowData {
  nodes: NodeConfig[]
  connections: Connection[]
}
