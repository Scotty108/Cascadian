# Node Config Panel Component

## Overview

The Node Config Panel is a comprehensive side panel component for configuring workflow nodes in the Cascadian strategy builder. It provides a modern, intuitive interface for editing node properties, settings, and type-specific configurations.

## Features

### Visual Design
- **Modern Gradient Header**: Radial gradient overlays using brand color (#00E0AA)
- **Type-Specific Styling**: Each node type has unique colors and icons
- **Responsive Layout**: Flexible header, scrollable content, fixed footer
- **Dark Mode Support**: Fully optimized for dark theme

### Form Elements
- **Rounded Design**: All inputs use rounded-xl/2xl/3xl for modern feel
- **Brand Color Focus**: #00E0AA focus states on all interactive elements
- **Enhanced Hover States**: Border and shadow effects on hover
- **Clean Typography**: Clear visual hierarchy with proper labels

### Node Types Supported

1. **Start Node** (PlayCircle icon, #00E0AA)
   - Entry point for workflows
   - No additional configuration needed

2. **End Node** (StopCircle icon, #a855f7 purple)
   - Exit point for workflows
   - No additional configuration needed

3. **HTTP Request** (Globe icon, #3b82f6 blue)
   - Configure HTTP method (GET, POST, PUT, PATCH, DELETE)
   - Set URL, headers, and request body
   - JSON formatting for headers and body

4. **Conditional** (GitBranch icon, #f59e0b amber)
   - Define JavaScript condition expressions
   - Access previous node outputs
   - Branch workflow based on logic

5. **JavaScript** (Code2 icon, #818cf8 indigo)
   - Write custom JavaScript code
   - Transform data between nodes
   - Access environment variables

6. **Webhook** (Globe icon, #ec4899 pink)
   - Generate unique webhook URLs
   - Optional secret key validation
   - Copy-to-clipboard functionality

7. **Delay** (Settings2 icon, #6366f1 violet)
   - Configure delay duration
   - Multiple time units (seconds, minutes, hours)

### Advanced Features
- **Collapsible Advanced Settings**: Retry attempts, timeouts, node ID
- **Copy to Clipboard**: For webhook URLs and node IDs
- **Delete Protection**: Start/End nodes cannot be deleted
- **Form Validation**: Type-appropriate inputs and constraints
- **Helper Text**: Contextual examples and tips

## Usage

```tsx
import { NodeConfigPanel } from "@/components/node-config-panel"
import type { NodeConfig } from "@/components/node-config-panel/types"

function StrategyBuilder() {
  const [selectedNode, setSelectedNode] = useState<NodeConfig | null>(null)

  const handleSave = (node: NodeConfig) => {
    // Update node in workflow
    console.log("Saving node:", node)
  }

  const handleDelete = (nodeId: string) => {
    // Remove node from workflow
    console.log("Deleting node:", nodeId)
  }

  return (
    <div className="flex h-screen">
      {/* Canvas area */}
      <div className="flex-1">
        {/* Workflow canvas */}
      </div>

      {/* Config panel */}
      {selectedNode && (
        <div className="w-[400px] border-l border-border/40">
          <NodeConfigPanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  )
}
```

## Props

### NodeConfigPanelProps

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `node` | `NodeConfig \| null` | Yes | The node to configure |
| `onClose` | `() => void` | Yes | Called when panel is closed |
| `onSave` | `(node: NodeConfig) => void` | Yes | Called when changes are saved |
| `onDelete` | `(nodeId: string) => void` | No | Called when node is deleted |

## Styling

The component uses Tailwind CSS with custom design tokens:

- **Border Radius**: rounded-xl (inputs), rounded-2xl (containers), rounded-3xl (large sections), rounded-full (CTAs)
- **Brand Color**: #00E0AA for primary actions and focus states
- **Spacing**: Consistent 4px/8px grid system
- **Shadows**: Layered shadows with brand color tint
- **Transitions**: Smooth hover and focus transitions

## Accessibility

- Proper ARIA labels on all interactive elements
- Keyboard navigation support
- Focus management for modal behavior
- Screen reader friendly descriptions
- High contrast mode compatible

## Performance Considerations

- Controlled inputs with debouncing for large text areas
- Lazy rendering of type-specific configurations
- Optimized re-renders with React.memo where appropriate
- Efficient state updates

## Integration Points

The component integrates with:
- Strategy builder canvas
- Workflow execution engine
- Node validation system
- Configuration persistence layer

## Future Enhancements

- [ ] Real-time validation for JavaScript code
- [ ] Autocomplete for condition expressions
- [ ] Visual code editor with syntax highlighting
- [ ] Test execution for HTTP requests
- [ ] Version history for configurations
- [ ] Templates for common configurations
- [ ] Drag-and-drop for connection management

## Design System Compliance

This component follows the Cascadian design system:
- ✅ Gradient backgrounds with radial overlays
- ✅ Rounded-2xl/3xl containers
- ✅ Brand color (#00E0AA) integration
- ✅ Enhanced hover states
- ✅ Dark mode support
- ✅ Consistent spacing and typography
- ✅ Modern form design
- ✅ Accessible components
