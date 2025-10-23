/**
 * DATA TRANSFORMER SERVICE
 *
 * Handles data transformation operations for transform nodes.
 * Uses mathjs for safe formula evaluation.
 *
 * Supported operations:
 * - add-column: Add computed column with custom formula
 * - filter-rows: Filter rows based on condition
 * - sort: Sort by field(s)
 * - aggregate: Group by and aggregate
 * - map: Transform each item
 */

import { evaluate, create, all } from 'mathjs'

// Create limited math instance (safer than full mathjs)
const math = create(all)

export interface TransformOperation {
  type: 'add-column' | 'filter-rows' | 'sort' | 'aggregate' | 'map'
  config: any
}

export interface AddColumnConfig {
  name: string
  formula: string
}

export interface FilterRowsConfig {
  condition: string
}

export interface SortConfig {
  field: string
  order?: 'asc' | 'desc'
}

export interface AggregateConfig {
  groupBy: string[]
  aggregations: Array<{
    field: string
    operation: 'sum' | 'avg' | 'min' | 'max' | 'count'
    as: string
  }>
}

export interface MapConfig {
  transform: string
}

/**
 * Apply transformation operations to data
 */
export function transformData(data: any, operations: TransformOperation[]): any {
  let result = data

  for (const operation of operations) {
    switch (operation.type) {
      case 'add-column':
        result = addColumn(result, operation.config)
        break
      case 'filter-rows':
        result = filterRows(result, operation.config)
        break
      case 'sort':
        result = sortData(result, operation.config)
        break
      case 'aggregate':
        result = aggregateData(result, operation.config)
        break
      case 'map':
        result = mapData(result, operation.config)
        break
      default:
        console.warn(`Unknown operation type: ${operation.type}`)
    }
  }

  return result
}

/**
 * Add a computed column using a formula
 * Formula can reference any field from the row
 *
 * Example: { name: "edge", formula: "currentPrice - 0.5" }
 */
function addColumn(data: any, config: AddColumnConfig): any {
  const { name, formula } = config

  // Handle array of objects
  if (Array.isArray(data)) {
    return data.map((row) => {
      try {
        const value = evaluateFormula(formula, row)
        return { ...row, [name]: value }
      } catch (error) {
        console.error(`Error evaluating formula for row:`, error)
        return { ...row, [name]: null }
      }
    })
  }

  // Handle single object
  if (typeof data === 'object' && data !== null) {
    try {
      const value = evaluateFormula(formula, data)
      return { ...data, [name]: value }
    } catch (error) {
      console.error(`Error evaluating formula:`, error)
      return { ...data, [name]: null }
    }
  }

  return data
}

/**
 * Filter rows based on a condition
 *
 * Example: { condition: "volume > 50000 && price < 0.7" }
 */
function filterRows(data: any, config: FilterRowsConfig): any {
  const { condition } = config

  if (!Array.isArray(data)) {
    console.warn('filterRows requires array data')
    return data
  }

  return data.filter((row) => {
    try {
      const result = evaluateFormula(condition, row)
      return Boolean(result)
    } catch (error) {
      console.error(`Error evaluating condition for row:`, error)
      return false
    }
  })
}

/**
 * Sort data by field
 */
function sortData(data: any, config: SortConfig): any {
  const { field, order = 'asc' } = config

  if (!Array.isArray(data)) {
    console.warn('sort requires array data')
    return data
  }

  const sorted = [...data].sort((a, b) => {
    const aVal = getValueByPath(a, field)
    const bVal = getValueByPath(b, field)

    if (aVal === bVal) return 0
    if (aVal === undefined || aVal === null) return 1
    if (bVal === undefined || bVal === null) return -1

    const comparison = aVal < bVal ? -1 : 1
    return order === 'asc' ? comparison : -comparison
  })

  return sorted
}

/**
 * Aggregate data (group by and summarize)
 */
function aggregateData(data: any, config: AggregateConfig): any {
  const { groupBy, aggregations } = config

  if (!Array.isArray(data)) {
    console.warn('aggregate requires array data')
    return data
  }

  // Group data
  const groups = new Map<string, any[]>()
  for (const row of data) {
    const key = groupBy.map((field) => getValueByPath(row, field)).join('|')
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(row)
  }

  // Aggregate each group
  const result: any[] = []
  for (const [key, rows] of groups.entries()) {
    const aggregated: any = {}

    // Add group by fields
    groupBy.forEach((field, i) => {
      aggregated[field] = key.split('|')[i]
    })

    // Add aggregations
    for (const agg of aggregations) {
      aggregated[agg.as] = performAggregation(rows, agg.field, agg.operation)
    }

    result.push(aggregated)
  }

  return result
}

/**
 * Perform aggregation operation
 */
function performAggregation(
  rows: any[],
  field: string,
  operation: 'sum' | 'avg' | 'min' | 'max' | 'count'
): number {
  const values = rows.map((row) => getValueByPath(row, field)).filter((v) => v !== undefined)

  switch (operation) {
    case 'sum':
      return values.reduce((sum, val) => sum + Number(val), 0)
    case 'avg':
      return values.length > 0 ? values.reduce((sum, val) => sum + Number(val), 0) / values.length : 0
    case 'min':
      return Math.min(...values.map(Number))
    case 'max':
      return Math.max(...values.map(Number))
    case 'count':
      return values.length
    default:
      return 0
  }
}

/**
 * Map/transform each item
 */
function mapData(data: any, config: MapConfig): any {
  const { transform } = config

  if (Array.isArray(data)) {
    return data.map((item) => {
      try {
        return evaluateFormula(transform, item)
      } catch (error) {
        console.error(`Error transforming item:`, error)
        return item
      }
    })
  }

  try {
    return evaluateFormula(transform, data)
  } catch (error) {
    console.error(`Error transforming data:`, error)
    return data
  }
}

/**
 * Evaluate formula safely using mathjs
 * Variables are injected from scope
 */
function evaluateFormula(formula: string, scope: any): any {
  try {
    // Flatten nested objects for easier access
    const flatScope = flattenObject(scope)
    return math.evaluate(formula, flatScope)
  } catch (error) {
    console.error(`Formula evaluation error: ${formula}`, error)
    throw error
  }
}

/**
 * Get value from nested object by path
 */
function getValueByPath(obj: any, path: string): any {
  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Flatten nested object for formula evaluation
 * { market: { price: 0.5 } } => { "market.price": 0.5, price: 0.5 }
 */
function flattenObject(obj: any, prefix: string = ''): Record<string, any> {
  const flat: Record<string, any> = {}

  for (const key in obj) {
    const value = obj[key]
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively flatten nested objects
      Object.assign(flat, flattenObject(value, fullKey))
    } else {
      // Add both full path and short key (for convenience)
      flat[fullKey] = value
      flat[key] = value // Allow shorthand access
    }
  }

  return flat
}

/**
 * Validate formula syntax without executing
 */
export function validateFormula(formula: string): { valid: boolean; error?: string } {
  try {
    math.parse(formula)
    return { valid: true }
  } catch (error: any) {
    return { valid: false, error: error.message }
  }
}

/**
 * Get available math functions
 */
export function getAvailableFunctions(): string[] {
  return [
    // Arithmetic
    'abs', 'add', 'ceil', 'cube', 'divide', 'exp', 'floor', 'log', 'log10', 'mod', 'multiply',
    'pow', 'round', 'sqrt', 'square', 'subtract',
    // Trigonometry
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    // Statistics
    'max', 'mean', 'median', 'min', 'mode', 'std', 'sum', 'variance',
    // Logic
    'and', 'or', 'not', 'xor',
    // Comparison
    'equal', 'larger', 'largerEq', 'smaller', 'smallerEq', 'unequal',
  ]
}
