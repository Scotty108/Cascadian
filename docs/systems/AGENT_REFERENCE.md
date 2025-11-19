# Agent Reference Guide

> **Complete listing of available agents and when to use them**

## Quick Reference

| Type | Count | Use When |
|------|-------|----------|
| **Agent OS (Custom)** | 9 agents | Spec → Implementation workflow for features |
| **Built-in Specialists** | 21+ agents | Isolated tasks requiring domain expertise |
| **Custom Commands** | 6 workflows | Orchestrating multi-agent workflows |

---

## Agent OS Agents (9 Custom in `.claude/agents/`)

### Specification Phase

**1. spec-initializer**
- **Purpose:** Initializes spec folder structure and saves raw feature ideas
- **Usage:** Start of new feature development
- **Output:** `/specs/{name}/` directory with raw idea captured

**2. spec-shaper**
- **Purpose:** Gathers detailed requirements through targeted questions and visual analysis
- **Usage:** After initialization, before writing spec
- **Output:** Detailed requirements document with user input

**3. spec-writer**
- **Purpose:** Creates detailed technical specification documents
- **Usage:** After requirements gathered
- **Output:** Complete spec.md with architecture, components, flows

**4. spec-verifier**
- **Purpose:** QA gate that verifies spec completeness and accuracy
- **Usage:** After spec written, before creating tasks
- **Output:** Verification report with gaps/issues identified

### Implementation Phase

**5. task-list-creator**
- **Purpose:** Breaks specs into actionable tasks with test-first approach
- **Usage:** After spec verified
- **Output:** tasks.md with 2-8 tests per task group
- **Pattern:** Database → API → UI → Testing phases

**6. implementer**
- **Purpose:** Executes implementation following tasks.md with test-first methodology
- **Usage:** For sequential implementation of tasks
- **Output:** Working code with tests passing

**7. implementation-verifier**
- **Purpose:** Final verification, runs full test suite, marks roadmap complete
- **Usage:** After all tasks implemented
- **Output:** Verification report, test results, completion status

### Planning

**8. product-planner**
- **Purpose:** Creates mission/roadmap for new products or major pivots
- **Usage:** New product kickoff or major feature sets
- **Output:** Mission statement, roadmap, high-level architecture

**9. database-architect**
- **Purpose:** Designs schemas, optimizes queries, manages migrations
- **Usage:** Use proactively for any database work
- **Output:** Schema designs, migration scripts, query optimizations

---

## Standard Claude Code Agents (21+ Built-in)

### Specialist Agents (Domain-Specific)

**backend-specialist**
- Backend architecture, APIs, databases, server logic
- Use when: Building API endpoints, server-side logic

**frontend-specialist**
- UI/UX, React components, styling, client-side logic
- Use when: Building UI components, layout, interactions

**database-specialist** (alias: **database-architect**)
- Database design, migrations, query optimization
- Use when: Schema changes, performance issues

**architecture-designer**
- System architecture, scalability, technology decisions
- Use when: High-level design, technology selection

**design-system-specialist**
- Design tokens, component libraries, UI patterns
- Use when: Building design system, theming

**accessibility-specialist**
- WCAG compliance, a11y testing, inclusive design
- Use when: Accessibility audits, screen reader support

**mobile-specialist**
- Mobile-first design, responsive layouts, touch interactions
- Use when: Mobile optimization, responsive design

**ml-specialist**
- Machine learning, AI/ML model training, data science
- Use when: ML model development, data analysis

### Process & Quality Agents

**qa-testing-specialist**
- Test planning, test case creation, QA strategy
- Use when: Creating test plans, QA strategy

**code-reviewer**
- Code quality, best practices, architecture review
- Use when: PR reviews, code quality audits

**security-specialist**
- Security review, vulnerability detection, hardening
- Use when: Security audits, penetration testing prep

**performance-specialist**
- Performance optimization, profiling, load testing
- Use when: Performance bottlenecks, optimization

**devops-specialist**
- DevOps, infrastructure, CI/CD, deployment
- Use when: Deployment setup, infrastructure work

**devex-specialist**
- Developer experience, tooling, documentation
- Use when: Improving developer workflows

**integration-specialist**
- Third-party integrations, API consumption
- Use when: Integrating external services

### Analysis & Research Agents

**research-specialist**
- Research, proof of concepts, technical exploration
- Use when: Evaluating new technologies, POCs

**debugging-specialist**
- Bug investigation, root cause analysis
- Use when: Complex bugs, performance issues

**refactoring-specialist**
- Code refactoring, technical debt reduction
- Use when: Large refactors, code cleanup

**documentation-specialist**
- Technical writing, docs generation, knowledge transfer
- Use when: Writing documentation, guides

**cost-optimization-specialist**
- Cost analysis, optimization, resource efficiency
- Use when: Reducing cloud costs, resource optimization

### Utility Agents

**general-purpose**
- Default agent for general tasks
- Use when: No specific specialist needed

**Explore**
- Codebase exploration, pattern discovery
- Use when: Finding files, understanding structure

**Plan**
- Task planning and breakdown
- Use when: Breaking down complex tasks

---

## Custom Commands (6 Workflows)

### For New Products/Features

**`/plan-product`**
- Initiates product planning (mission, roadmap, tech stack)
- Delegates to: product-planner agent
- Output: Mission, roadmap, architecture docs

**`/shape-spec`**
- Requirements gathering (initializer → shaper workflow)
- Delegates to: spec-initializer, spec-shaper agents
- Output: Detailed requirements document

**`/write-spec`**
- Creates technical specifications
- Delegates to: spec-writer, spec-verifier agents
- Output: Complete technical spec with verification

### For Implementation

**`/create-tasks`**
- Breaks spec into test-first task groups
- Delegates to: task-list-creator agent
- Output: tasks.md with database → API → UI → testing phases

**`/implement-tasks`**
- Simple sequential implementation (for tasks < 8 hours)
- Delegates to: implementer agent
- Output: Working implementation with tests

**`/orchestrate-tasks`**
- Advanced parallel implementation (for features > 8 hours, multi-team)
- Delegates to: Multiple specialist agents in parallel
- Output: Complete feature with all agents coordinated

---

## Workflow Examples

### Small Feature (< 4 hours)
```
/shape-spec → /create-tasks → /implement-tasks → Done
```

### Medium Feature (4-8 hours)
```
/shape-spec → /create-tasks → /implement-tasks → /implement-tasks → Done
```

### Large Feature (> 8 hours)
```
/shape-spec → /create-tasks → /orchestrate-tasks → Parallel agents execute → Done
```

### New Product/Major Work
```
/plan-product → /shape-spec → /create-tasks → /orchestrate-tasks → Done
```

---

## Quick Delegation Pattern

```
@backend-specialist implement the API endpoint for X
@code-reviewer please review this PR for quality issues
@architecture-designer design the system for X
@qa-testing-specialist create test plan for X
@security-specialist review this for vulnerabilities
```

---

## When to Delegate

Delegate to agents when:
- Task is isolated (doesn't need full system context)
- Task is repetitive (review, testing, security check)
- Task requires specialized expertise
- You want to preserve your own context budget
- Task can be done in parallel with other work

Keep in main conversation when:
- Task requires system-wide context
- Task involves making architectural decisions
- Task requires back-and-forth discussion
- Task is quick (< 5 min) and not worth delegation overhead
