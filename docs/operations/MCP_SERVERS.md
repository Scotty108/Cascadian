# MCP Servers Reference

> **Model Context Protocol (MCP) server configuration and usage guide**

## Quick Status

| Server | Status | Purpose | Setup Required |
|--------|--------|---------|----------------|
| **github** | ✅ Connected | PR reviews, code analysis, issue tracking | `GITHUB_TOKEN` env var |
| **vercel** | ✅ Connected | Deployments, logs, environment management | `VERCEL_TOKEN` in `.env.local` |
| **playwright** | ✅ Connected | Browser automation, UI testing, screenshots | Built-in, no setup |
| **puppeteer** | ✅ Connected | Web scraping with stealth, Chrome automation | Configured in `.mcp.json` |
| **sequential-thinking** | ✅ Connected | Extended thinking for complex problems | Built-in, no setup |
| **context7** | ✅ Connected | Up-to-date library documentation | Built-in, no setup |
| **claude-self-reflect** | ⚠️ Offline | Semantic search of past conversations | Requires Docker/Qdrant |

---

## Detailed Setup & Usage

### GitHub MCP Server

**Setup:**
```bash
export GITHUB_TOKEN=<your-github-pat>
```

**Capabilities:**
- Browse repository contents and file history
- Read and analyze pull requests (code diffs, comments)
- View issues, milestones, and project status
- Search commits and code patterns
- Create and update issues/PRs (with extended permissions)

**Common Tasks:**
- "Analyze this PR for security vulnerabilities"
- "Search the repo for all usages of function X"
- "What were the changes in commit abc123?"
- "Create an issue for this bug with details"

**Documentation:** https://github.com/modelcontextprotocol/servers/tree/main/src/github

---

### Playwright MCP Server

**Setup:** Built-in, no additional setup required

**Capabilities:**
- Navigate to URLs and browse web pages
- Take screenshots of pages or specific elements
- Fill forms and submit them
- Click buttons and interact with UI elements
- Extract text and data from web pages
- Execute JavaScript in the browser context
- Handle multiple tabs and windows
- Wait for elements to load
- Test website functionality and UI

**Common Tasks:**
- "Take a screenshot of https://example.com and describe what's on the page"
- "Go to the Cascadian dashboard and check the current market prices"
- "Fill out a form on this website with the provided data"
- "Extract all the links from this page"
- "Test if the login form works correctly"

**Use Cases in Cascadian:**
- Monitor live market data on Polymarket UI
- Validate dashboard layout and styling
- Test strategy builder UI interactions
- Screenshot wallets or markets for documentation
- Automated smoke testing of critical flows

**Documentation:** https://github.com/modelcontextprotocol/servers/tree/main/src/playwright

---

### Puppeteer MCP Server

**Setup:** Project-scoped in `.mcp.json` (already configured)

**Community Package:** `puppeteer-mcp-claude` (official is deprecated)

**Capabilities:**
- Navigate and interact with web pages (Chrome/Chromium only)
- **Native stealth features to avoid bot detection** (key advantage over Playwright)
- Extract data from dynamic websites that block automated tools
- Fill forms and submit data
- Take screenshots and generate PDFs
- Execute JavaScript in page context
- Monitor network requests and responses
- Handle authentication, cookies, and sessions

**Puppeteer vs Playwright:**

| Feature | Puppeteer | Playwright |
|---------|-----------|------------|
| **Best For** | Web scraping, stealth | Testing, cross-browser |
| **Browser Support** | Chrome/Chromium only | Chrome, Firefox, Safari |
| **Bot Detection** | ✅ Native stealth plugin | ⚠️ Basic (more detectable) |
| **Speed** | ✅ 30% faster | Slower |
| **Use When** | Scraping external sites | Testing our own UI |

**Pro Tips:**
- Use **Puppeteer** for scraping external websites (stealth features)
- Use **Playwright** for testing our own application (cross-browser)
- Puppeteer is best for data collection from external sources
- Playwright is best for automated testing and QA

**Documentation:** https://github.com/jaenster/puppeteer-mcp-claude

---

### Vercel MCP Server

**Setup:**
```bash
# Add to .env.local
export VERCEL_TOKEN=<your-vercel-token>
```
Get token at: https://vercel.com/account/tokens

**Capabilities:**
- Deploy projects from Claude Code
- View deployment logs and status
- Manage environment variables across environments
- Access project settings and analytics
- Trigger rebuilds and redeploys
- Monitor deployment health

**Common Tasks:**
- "Deploy the current branch to production"
- "What's the status of my last deployment?"
- "Add this API key to the production environment"
- "Show me the build logs for the failed deploy"

**Documentation:** https://vercel.com/docs/mcp/vercel-mcp

---

### Sequential Thinking

**Activation:** Type `@ultrathink` in any prompt or explicitly request extended thinking

**Use cases:**
- Designing new database schemas
- Debugging complex performance issues
- Planning multi-phase implementations
- Analyzing technical trade-offs

---

### Context7

**Usage:** Automatically provides up-to-date documentation for any library mentioned

**No manual setup required** - Works automatically when you ask about libraries

---

## Troubleshooting

**Check server status:**
```bash
claude mcp list
```

**GitHub connection failing:**
- Verify `GITHUB_TOKEN` is set and valid
- Check token has `repo` scope permissions
- Token may have expired (create new one)

**Vercel not connecting:**
- Ensure `.env.local` has `VERCEL_TOKEN=<token>`
- Restart Claude Code for env var to load
- Verify token belongs to correct organization

**claude-self-reflect offline:**
- Requires Docker running with Qdrant service
- Check: `docker ps | grep qdrant`
- If missing, restart Docker: `docker-compose up -d`
- Semantic search will be unavailable until running
