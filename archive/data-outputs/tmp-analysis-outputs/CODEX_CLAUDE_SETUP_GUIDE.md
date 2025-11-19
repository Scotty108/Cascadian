# Codex & Claude Configuration Setup Guide

**Date**: 2025-11-10
**Purpose**: Complete setup for both Codex (orchestrator) and Claude (implementer)

---

## 🎯 What You Need

### For Both Agents to Work Properly:
1. ✅ **RULES.md** read on startup (workflow authority)
2. ✅ **CLAUDE.md** read on startup (project context)
3. ✅ MCPs configured (sequential_thinking, claude-self-reflect, Context7, Playwright)
4. ✅ Project-specific settings
5. ✅ Proper permissions

---

## 📋 Current Status

### ✅ What's Already Configured

**Global Codex Config** (`~/.codex/config.toml`):
```toml
model = "gpt-5-codex"
model_reasoning_effort = "high"
```

**Claude Settings** (`.claude/settings.local.json`):
```json
{
  "permissions": {
    "allow": [
      "Bash(curl:*)",
      "Bash(rm:*)",
      "WebFetch(domain:chatgpt.com)",
      "Bash(npx tsx:*)",
      "Bash(npm run check:tables:*)"
    ]
  }
}
```

**Project Files**:
- ✅ `RULES.md` exists (801 lines, workflow authority)
- ✅ `CLAUDE.md` exists (project context)
- ✅ `.claude/agents/` exists (custom agents)
- ✅ `.claude/commands/` exists (slash commands)

---

## ⚠️ What's Missing

### 1. RULES.md Not Configured to Be Read on Startup

**Problem**: CLAUDE.md is automatically read, but RULES.md is not.

**Solution Options**:

#### Option A: Merge RULES.md → CLAUDE.md (Not Recommended)
- Makes CLAUDE.md too long
- Loses cross-project reusability

#### Option B: Add to Project Instructions (Recommended)
Create `.claude/project-instructions.md`:
```markdown
# Project Instructions

**CRITICAL**: Read RULES.md first before any work.

RULES.md contains:
- AI agent roles (Codex vs Claude)
- Workflow patterns
- MCP server documentation
- Quality gates
- File organization rules
```

#### Option C: Add Note to CLAUDE.md (Quick Fix)
Add at top of CLAUDE.md:
```markdown
# IMPORTANT: Read RULES.md First

Before working on this project, read `/RULES.md` for:
- AI agent roles (Codex orchestrator, Claude implementer)
- Workflow patterns and response formats
- MCP server documentation
- Quality gates and guardrails

This file (CLAUDE.md) contains project-specific context only.
```

---

### 2. MCP Configuration

**Current MCPs** (from RULES.md documentation):
- sequential_thinking
- claude-self-reflect
- Context7
- Playwright
- IDE Integration (built-in)

**Status**: Documented in RULES.md but not verified installed/configured

**To Verify**:
```bash
# Check if MCPs are installed (Claude Code)
claude mcp list
```

**To Configure** (if not already):
MCP config typically in:
- `~/.claude/mcp-config.json` (global)
- or project-specific MCP settings

---

### 3. Codex-Specific Configuration

**Problem**: Codex doesn't have equivalent of CLAUDE.md

**What Codex Needs to Know**:
- It's the orchestrator (not implementer)
- Manage 2-3 Claude terminals
- Give plain English summaries
- Response format standards
- When to delegate to Claude

**Solution**: Create `.codex/instructions.md` in project:
```markdown
# Codex Instructions for Cascadian Project

**Role**: Orchestrator & Context Manager

## Read These First
1. `/RULES.md` - Complete workflow authority (your primary guide)
2. `/CLAUDE.md` - Project context (for understanding, not execution)

## Your Responsibilities
- Quick answers & direction (< 30 seconds)
- Manage 2-3 Claude terminals (track which is doing what)
- Context switching between workstreams
- Prevent rabbit holes with ground truth checks
- Suggest when to spawn new terminal
- Give plain English summaries for Claude terminals

## Response Format
# [Clear Answer in Bold]

## Context
Brief explanation

## Recommendation
What to do next

## For Claude Terminal [N]
```
Exact instructions to paste
```

## Why This Approach
Reasoning

## When to Delegate to Claude
- Implementation tasks
- SQL queries, deployments, operations
- Tasks > 30 seconds
- Multi-step operations
- Database work
```

---

## 🚀 Setup Instructions

### Step 1: Create Codex Project Instructions

```bash
mkdir -p .codex
cat > .codex/instructions.md << 'EOF'
# Codex Instructions for Cascadian

**READ FIRST**: `/RULES.md` - Your complete workflow guide

**Role**: Orchestrator (fast, grounded, context manager)

See RULES.md section "AI Agent Roles & Workflow" for:
- Your responsibilities
- Response format
- Multi-terminal management
- When to delegate to Claude
EOF
```

---

### Step 2: Update CLAUDE.md Header

Add at the very top of CLAUDE.md:

```markdown
# ⚠️ READ RULES.MD FIRST

Before working on this project:
1. Read `/RULES.md` for workflow patterns, agent roles, and guidelines
2. Then read this file (CLAUDE.md) for project-specific context

RULES.md = How to work | CLAUDE.md = What you're working on
```

---

### Step 3: Create Project Instructions File

```bash
cat > .claude/project-instructions.md << 'EOF'
# Cascadian Project Instructions

## Required Reading Order
1. **RULES.md** - Workflow authority, agent roles, MCP docs, quality gates
2. **CLAUDE.md** - Project-specific context, architecture, quick navigation

## Your Role (Claude)
**Implementer**: Deep, thorough, experimental

**Always include in responses**:
- Terminal identification (Main / Claude 2 / Claude 3)
- Time spent
- User's local time
- Clear results

See RULES.md "AI Agent Roles & Workflow" section for complete guidelines.
EOF
```

---

### Step 4: Verify MCP Configuration

```bash
# Check installed MCPs
claude mcp list

# Expected output:
# - sequential_thinking
# - claude-self-reflect
# - Context7
# - Playwright
```

If any missing, install them according to their docs.

---

### Step 5: Update Codex Global Config (Optional Additions)

Edit `~/.codex/config.toml`:

```toml
model = "gpt-5-codex"
model_reasoning_effort = "high"

# Optional: Add project-specific settings
[projects.cascadian]
path = "/Users/scotty/Projects/Cascadian-app"
instructions_file = ".codex/instructions.md"

# Optional: Notifications
[notifications]
enabled = true
sound = true
```

---

### Step 6: Test the Setup

**Test with Codex**:
1. Start new conversation
2. Ask: "What's your role on this project?"
3. Expected: Should mention orchestrator, RULES.md, manage Claude terminals

**Test with Claude**:
1. Start new conversation
2. Ask: "What's your role on this project?"
3. Expected: Should mention implementer, RULES.md, terminal identification

---

## 📋 Complete Configuration Checklist

### Files to Create/Update
- [ ] Create `.codex/instructions.md`
- [ ] Update `CLAUDE.md` header (add RULES.md reference)
- [ ] Create `.claude/project-instructions.md`
- [ ] Verify `RULES.md` complete (✅ already done)
- [ ] Verify `.claude/settings.local.json` (✅ already done)

### MCPs to Verify
- [ ] sequential_thinking installed
- [ ] claude-self-reflect installed (verify: `~/.claude-self-reflect/`)
- [ ] Context7 installed
- [ ] Playwright configured
- [ ] IDE Integration (built-in, should work)

### Configuration to Update
- [ ] `~/.codex/config.toml` (optional project settings)
- [ ] MCP config if any missing
- [ ] Notifications enabled (both Codex and Claude)

### Testing
- [ ] Codex knows it's orchestrator
- [ ] Claude knows it's implementer
- [ ] Both reference RULES.md
- [ ] MCPs accessible
- [ ] File paths work correctly

---

## 🎯 How It Works After Setup

### When Codex Starts
1. Reads `.codex/instructions.md` → "Read RULES.md"
2. Reads `RULES.md` → Learns workflow, role, patterns
3. Reads `CLAUDE.md` → Understands project context
4. Knows: Fast orchestrator, manage Claude terminals, give summaries

### When Claude Starts
1. Reads `.claude/project-instructions.md` → "Read RULES.md first"
2. Reads `RULES.md` → Learns workflow, role, MCPs, quality gates
3. Reads `CLAUDE.md` → Understands project (architecture, quick nav)
4. Knows: Deep implementer, identify terminal, use MCPs, verify numbers

### When You Switch Contexts
- Codex: Knows which Claude terminal is doing what
- Claude: Identifies which terminal in responses
- Both: Reference RULES.md for consistency

---

## 🔧 Troubleshooting

### "Agent doesn't seem to read RULES.md"
- Check if `.codex/instructions.md` or `.claude/project-instructions.md` exist
- Add explicit reference at top of CLAUDE.md
- Mention it in first message: "Please read RULES.md first"

### "MCPs not working"
```bash
# Check installation
claude mcp list

# Check config
cat ~/.claude/mcp-config.json

# Reinstall if needed
# (installation commands depend on the MCP)
```

### "Codex doesn't know it's orchestrator"
- Verify `.codex/instructions.md` exists
- Check `~/.codex/config.toml` for project settings
- Explicitly mention in first message

### "File paths broken after cleanup"
- Update CLAUDE.md with new paths
- Check docs/ structure matches expectations
- Verify all links work

---

## 📊 Success Metrics

After setup, you should see:

**Codex Behavior**:
- ✅ Identifies as orchestrator
- ✅ Gives plain English summaries
- ✅ Suggests when to spawn Claude terminal
- ✅ Tracks which terminal is doing what
- ✅ Prevents rabbit holes

**Claude Behavior**:
- ✅ Identifies terminal in every response
- ✅ Uses MCPs appropriately
- ✅ Verifies database numbers
- ✅ Follows SLC mindset
- ✅ Uses Planning agent for tasks > 2 hours
- ✅ Reports time spent

---

## 🚀 Quick Setup Script

Run this to set up everything:

```bash
#!/bin/bash
# Codex & Claude Configuration Setup

echo "🚀 Setting up Codex & Claude configuration..."

# Create Codex instructions
mkdir -p .codex
cat > .codex/instructions.md << 'EOF'
# Codex Instructions for Cascadian

**READ FIRST**: `/RULES.md` - Your complete workflow guide

**Role**: Orchestrator (fast, grounded, context manager)

**Responsibilities**:
- Quick answers (< 30 seconds)
- Manage 2-3 Claude terminals
- Give plain English summaries
- Prevent rabbit holes

See RULES.md "AI Agent Roles & Workflow" for complete details.
EOF

# Create Claude project instructions
cat > .claude/project-instructions.md << 'EOF'
# Cascadian Project Instructions

**READ FIRST**: `/RULES.md` - Workflow authority

**Role**: Implementer (deep, thorough, experimental)

**Always include**:
- Terminal identification (Main / Claude 2 / Claude 3)
- Time spent
- User's local time

See RULES.md "AI Agent Roles & Workflow" for complete details.
EOF

echo "✅ Created .codex/instructions.md"
echo "✅ Created .claude/project-instructions.md"
echo ""
echo "⚠️  Manual steps required:"
echo "1. Add RULES.md reference to top of CLAUDE.md"
echo "2. Verify MCPs installed: claude mcp list"
echo "3. Test with both Codex and Claude"
echo ""
echo "See tmp/CODEX_CLAUDE_SETUP_GUIDE.md for complete instructions"
```

---

**Next Steps**: Run the setup script or manually create the config files?
