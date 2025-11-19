# Duplicate Key Fix - React Error

## Error Identified

```
Encountered two children with the same key, `polymarket-stream-node`.
Keys should be unique so that components maintain their identity across updates.
```

## Root Cause

The AI was creating multiple nodes, and the ID generation was not guaranteed to be unique:

**Problem Code:**
```typescript
const id = args.id || `${nodeType}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
```

**Issues:**
1. **Trusted AI-provided IDs:** If AI passed `args.id`, it might not be unique
2. **Same timestamp:** Multiple nodes created in same millisecond = same `Date.now()` value
3. **Random collisions:** Math.random() could theoretically collide (unlikely but possible)

When the AI created 10 `polymarket-stream` nodes rapidly, they all got IDs like:
- `polymarket-stream-1234567890-abc1`
- `polymarket-stream-1234567890-def2` ← Same timestamp!
- `polymarket-stream-1234567890-ghi3` ← Same timestamp!

React saw duplicate keys and threw the error.

---

## Fix Applied

### Solution: Guaranteed Unique IDs with Counter

Added an **incrementing counter** that ensures uniqueness even for nodes created in the same millisecond:

```typescript
// Module-level counter
let nodeIdCounter = 0

function createNode(toolName: string, args: any, nodeCount: number): Node {
  const nodeType = getNodeTypeFromTool(toolName)

  // ALWAYS generate unique ID - never trust AI-provided IDs
  const timestamp = Date.now()
  const uniqueId = `${nodeType}-${timestamp}-${++nodeIdCounter}`  // Counter guarantees uniqueness!

  console.log(`[Workflow Builder] Creating node: ${uniqueId}`)

  return {
    id: uniqueId,  // Guaranteed unique!
    type: nodeType,
    // ...
  }
}
```

**How it works:**
- Counter starts at 0
- Each node increments counter: 1, 2, 3, 4...
- Even if timestamp is same, counter makes it unique:
  - `polymarket-stream-1234567890-1` ✅
  - `polymarket-stream-1234567890-2` ✅
  - `polymarket-stream-1234567890-3` ✅

---

## Files Modified

### 1. API Route (Server-side)
**File:** `app/api/ai/conversational-build/route.ts`
**Lines:** 474-505

Added counter and unique ID generation in `createNode()` function.

### 2. ConversationalChat (Client-side)
**File:** `components/workflow-editor/ConversationalChat.tsx`
**Lines:** 336-376

Added counter and unique ID generation in `createNodeFromToolCall()` function.

---

## Testing

After restarting the server, you should:

1. ✅ **No more React key errors** in console
2. ✅ **See unique IDs in console:**
   ```
   [Workflow Builder] Creating node: polymarket-stream-1736789012345-1
   [Workflow Builder] Creating node: polymarket-stream-1736789012345-2
   [AI Copilot] Creating node with unique ID: filter-1736789012346-3
   ```
3. ✅ **10 polymarket-stream nodes** should all have different IDs

---

## Benefits

✅ **Guaranteed Uniqueness:** Counter ensures no collisions
✅ **Fast Creation:** Can create thousands of nodes per second without issues
✅ **No AI Trust Issues:** Ignores any IDs the AI tries to pass
✅ **Debugging Friendly:** Console logs show exact ID created

---

## Impact

This fix ensures:
- React renders nodes correctly
- No duplicate key warnings
- Nodes maintain identity across updates
- Stable component behavior

---

## Summary

**Before:**
- IDs could collide if created quickly
- Relied on Math.random() and AI-provided IDs
- React threw duplicate key errors

**After:**
- IDs guaranteed unique via counter
- Never trusts AI-provided IDs
- No more React errors!

Ready to test! Restart the server and the error should be gone. 🎯
