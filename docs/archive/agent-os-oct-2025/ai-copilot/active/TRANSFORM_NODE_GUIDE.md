# Transform Node - Complete Guide

## Overview

The Transform Node allows you to manipulate, filter, sort, and aggregate data as it flows through your workflow. It's essential for data analysis and preparing data for decision-making.

---

## Supported Operations

### 1. Add Column
Add a new calculated column to your data using formulas.

**Config**:
```json
{
  "type": "add-column",
  "config": {
    "name": "profit_margin",
    "formula": "currentPrice - 0.5"
  }
}
```

**Example**:
```javascript
// Input
[
  { id: 1, currentPrice: 0.65 },
  { id: 2, currentPrice: 0.75 }
]

// Output (with profit_margin column added)
[
  { id: 1, currentPrice: 0.65, profit_margin: 0.15 },
  { id: 2, currentPrice: 0.75, profit_margin: 0.25 }
]
```

**Supported Formulas**:
- Basic math: `+`, `-`, `*`, `/`
- Field references: Use field names directly (e.g., `currentPrice * 2`)
- Constants: Numbers and strings

---

### 2. Filter Rows
Filter data based on conditions.

**Config**:
```json
{
  "type": "filter-rows",
  "config": {
    "condition": "volume > 50000"
  }
}
```

**Example**:
```javascript
// Input
[
  { id: 1, volume: 100000 },
  { id: 2, volume: 25000 },
  { id: 3, volume: 75000 }
]

// Output (only rows where volume > 50000)
[
  { id: 1, volume: 100000 },
  { id: 3, volume: 75000 }
]
```

**Supported Conditions**:
- Comparisons: `>`, `<`, `>=`, `<=`, `==`, `!=`
- Logical: `&&` (and), `||` (or)
- Field references: Use field names directly

---

### 3. Sort
Sort data by a field in ascending or descending order.

**Config**:
```json
{
  "type": "sort",
  "config": {
    "field": "volume",
    "direction": "desc"
  }
}
```

**Example**:
```javascript
// Input
[
  { id: 1, volume: 100000 },
  { id: 2, volume: 250000 },
  { id: 3, volume: 75000 }
]

// Output (sorted by volume, descending)
[
  { id: 2, volume: 250000 },
  { id: 1, volume: 100000 },
  { id: 3, volume: 75000 }
]
```

**Options**:
- `direction`: `"asc"` (ascending) or `"desc"` (descending)

---

### 4. Aggregate ✨ NEW
Calculate aggregate statistics (sum, average, count, min, max) with optional grouping.

#### Simple Aggregation (No Grouping)

**COUNT**: Count total rows
```json
{
  "type": "aggregate",
  "config": {
    "operation": "count"
  }
}
```

**SUM**: Sum values in a field
```json
{
  "type": "aggregate",
  "config": {
    "operation": "sum",
    "field": "volume"
  }
}
```

**AVG**: Calculate average
```json
{
  "type": "aggregate",
  "config": {
    "operation": "avg",
    "field": "price"
  }
}
```

**MIN**: Find minimum value
```json
{
  "type": "aggregate",
  "config": {
    "operation": "min",
    "field": "price"
  }
}
```

**MAX**: Find maximum value
```json
{
  "type": "aggregate",
  "config": {
    "operation": "max",
    "field": "volume"
  }
}
```

**Example (Simple Aggregate)**:
```javascript
// Input
[
  { id: 1, category: 'Politics', volume: 100000, price: 0.65 },
  { id: 2, category: 'Politics', volume: 250000, price: 0.52 },
  { id: 3, category: 'Crypto', volume: 75000, price: 0.45 }
]

// Config: SUM volume
{
  "type": "aggregate",
  "config": {
    "operation": "sum",
    "field": "volume"
  }
}

// Output
[
  {
    "operation": "sum",
    "field": "volume",
    "result": 425000,
    "count": 3
  }
]
```

#### Group-By Aggregation

Add `groupBy` to aggregate within groups.

**Example (Group By)**:
```javascript
// Input
[
  { id: 1, category: 'Politics', volume: 100000, price: 0.65 },
  { id: 2, category: 'Politics', volume: 250000, price: 0.52 },
  { id: 3, category: 'Crypto', volume: 75000, price: 0.45 },
  { id: 4, category: 'Crypto', volume: 125000, price: 0.70 }
]

// Config: SUM volume by category
{
  "type": "aggregate",
  "config": {
    "operation": "sum",
    "field": "volume",
    "groupBy": "category"
  }
}

// Output
[
  {
    "category": "Politics",
    "operation": "sum",
    "field": "volume",
    "result": 350000,
    "count": 2
  },
  {
    "category": "Crypto",
    "operation": "sum",
    "field": "volume",
    "result": 200000,
    "count": 2
  }
]
```

**Aggregate Operations Summary**:

| Operation | Field Required | Description | Example Result |
|-----------|---------------|-------------|----------------|
| `count` | No | Count rows | `5` |
| `sum` | Yes | Sum values | `425000` |
| `avg` | Yes | Average value | `0.624` |
| `min` | Yes | Minimum value | `0.45` |
| `max` | Yes | Maximum value | `250000` |

---

## Complete Transform Node Config

You can chain multiple operations in a single Transform Node:

```json
{
  "type": "transform",
  "config": {
    "operations": [
      {
        "type": "filter-rows",
        "config": {
          "condition": "volume > 50000"
        }
      },
      {
        "type": "add-column",
        "config": {
          "name": "high_volume",
          "formula": "volume > 100000"
        }
      },
      {
        "type": "sort",
        "config": {
          "field": "volume",
          "direction": "desc"
        }
      },
      {
        "type": "aggregate",
        "config": {
          "operation": "sum",
          "field": "volume",
          "groupBy": "category"
        }
      }
    ]
  }
}
```

---

## Use Cases

### 1. Calculate Total Market Volume by Category
```json
{
  "operations": [
    {
      "type": "aggregate",
      "config": {
        "operation": "sum",
        "field": "volume",
        "groupBy": "category"
      }
    }
  ]
}
```

**Use**: Identify which categories have the most trading activity.

---

### 2. Find Average Price of High-Volume Markets
```json
{
  "operations": [
    {
      "type": "filter-rows",
      "config": {
        "condition": "volume > 100000"
      }
    },
    {
      "type": "aggregate",
      "config": {
        "operation": "avg",
        "field": "currentPrice"
      }
    }
  ]
}
```

**Use**: Understand pricing in liquid markets.

---

### 3. Count Markets Per Category, Sorted by Count
```json
{
  "operations": [
    {
      "type": "aggregate",
      "config": {
        "operation": "count",
        "groupBy": "category"
      }
    },
    {
      "type": "sort",
      "config": {
        "field": "result",
        "direction": "desc"
      }
    }
  ]
}
```

**Use**: See which categories have the most markets.

---

### 4. Calculate Profit Margins and Find Best Opportunities
```json
{
  "operations": [
    {
      "type": "add-column",
      "config": {
        "name": "profit_potential",
        "formula": "(1 - currentPrice) * volume"
      }
    },
    {
      "type": "sort",
      "config": {
        "field": "profit_potential",
        "direction": "desc"
      }
    },
    {
      "type": "filter-rows",
      "config": {
        "condition": "profit_potential > 10000"
      }
    }
  ]
}
```

**Use**: Identify markets with highest profit potential.

---

## Output Format

The Transform Node always returns:
```javascript
{
  "transformed": [...], // Array of transformed/aggregated data
  "count": number       // Number of rows in result
}
```

For **aggregate operations without groupBy**:
```javascript
{
  "transformed": [
    {
      "operation": "sum",
      "field": "volume",
      "result": 425000,
      "count": 3
    }
  ],
  "count": 1
}
```

For **aggregate operations with groupBy**:
```javascript
{
  "transformed": [
    {
      "category": "Politics",
      "operation": "sum",
      "field": "volume",
      "result": 350000,
      "count": 2
    },
    {
      "category": "Crypto",
      "operation": "sum",
      "field": "volume",
      "result": 200000,
      "count": 2
    }
  ],
  "count": 2
}
```

---

## Tips & Best Practices

### 1. Chain Operations Efficiently
- Filter first to reduce data size
- Then transform/add columns
- Finally aggregate or sort

### 2. Use Meaningful Column Names
- Good: `profit_margin`, `high_volume`, `price_delta`
- Bad: `col1`, `temp`, `x`

### 3. Validate Formulas
- Test formulas with sample data first
- Ensure field names exist in your data
- Handle missing values (operations treat missing as 0)

### 4. Group-By Performance
- Grouping works best with categorical fields
- Avoid grouping on unique IDs (creates too many groups)
- Common group fields: `category`, `status`, `type`, `region`

### 5. Aggregate Order Matters
- Aggregate operations change the data structure
- Put aggregates at the end of operation chains
- Can't add columns or filter after aggregating (data shape changes)

---

## Error Handling

### Missing Field
If you aggregate a field that doesn't exist:
```javascript
// Input: [{ id: 1, name: 'Market' }]
// Config: { operation: 'sum', field: 'volume' }
// Result: 0 (missing fields treated as 0)
```

### Non-Numeric Values
Non-numeric values are converted to numbers:
```javascript
// '100' → 100
// 'abc' → 0
// null → 0
// undefined → 0
```

### Empty Data
Aggregating empty data returns:
```javascript
{
  "transformed": [
    {
      "operation": "sum",
      "field": "volume",
      "result": 0,
      "count": 0
    }
  ],
  "count": 1
}
```

---

## Complete Example Workflow

**Goal**: Find top 3 categories by total volume, excluding low-activity markets

```javascript
// Transform Node Config
{
  "operations": [
    // Step 1: Filter out low-volume markets
    {
      "type": "filter-rows",
      "config": {
        "condition": "volume > 25000"
      }
    },
    // Step 2: Sum volume by category
    {
      "type": "aggregate",
      "config": {
        "operation": "sum",
        "field": "volume",
        "groupBy": "category"
      }
    },
    // Step 3: Sort by total volume
    {
      "type": "sort",
      "config": {
        "field": "result",
        "direction": "desc"
      }
    }
  ]
}

// Input Data
[
  { category: 'Politics', volume: 100000 },
  { category: 'Politics', volume: 250000 },
  { category: 'Crypto', volume: 75000 },
  { category: 'Crypto', volume: 125000 },
  { category: 'Sports', volume: 50000 },
  { category: 'Sports', volume: 10000 }  // filtered out
]

// Final Output
[
  {
    "category": "Politics",
    "operation": "sum",
    "field": "volume",
    "result": 350000,
    "count": 2
  },
  {
    "category": "Crypto",
    "operation": "sum",
    "field": "volume",
    "result": 200000,
    "count": 2
  },
  {
    "category": "Sports",
    "operation": "sum",
    "field": "volume",
    "result": 50000,
    "count": 1
  }
]
```

---

## Status

**All Transform Operations**: ✅ Fully Implemented

- ✅ Add Column
- ✅ Filter Rows
- ✅ Sort
- ✅ Aggregate (COUNT, SUM, AVG, MIN, MAX)
- ✅ Group-By Support

**Ready for Production**: Yes

**Next Enhancements** (Future):
- [ ] Multiple field aggregates (e.g., sum volume AND avg price)
- [ ] Custom aggregate functions
- [ ] Pivot table support
- [ ] Window functions (running totals, moving averages)
