# Mercora Documentation Index

> **Complete documentation for the Mercora AI-powered eCommerce platform**

This directory contains comprehensive documentation for all aspects of the Mercora platform. Start here to find the information you need.

## 📚 Documentation Map

### 🚀 **Getting Started**
- **[Main README](../README.md)** - Project overview, features, and quick start
- **[Deployment Guide](DEPLOYMENT_SETUP.md)** - Complete production deployment instructions
- **[Development Roadmap](ROADMAP.md)** - Current status and future plans

### ⚙️ **Operational Knowledge** (current source of truth)
- **[Database & Migrations](database-migrations.md)** - Migration table, deploy-order blocker, schema-change workflow, D1 gotchas
- **[Cloudflare Environments](cloudflare-environments.md)** - `wrangler.jsonc` envs, bindings, rate limiters, secrets, deploy commands
- **[Testing & CI](testing.md)** - The three suites and what CI actually gates
- **[Troubleshooting](troubleshooting.md)** - Symptom → cause table
- **[Cutover Status](cutover-status.md)** - Shopify→Mercora progress, remaining go-live work, branding debt

### 🏗️ **Technical Architecture**
- **[API Routes](api-routes.md)** - Current route map incl. fulfillment endpoints
- **[Authentication Model](auth-model.md)** - The two fail-closed auth layers
- **[Chai (AI Assistant)](ai-chai.md)** - Model config, indexing, recommendations seam
- **[CMS Pages](cms-pages.md)** - Page templates + markup authoring conventions
- **[Redirects](redirects.md)** - Shopify→Mercora 301s and how they resolve
- **[Development Context](../CLAUDE.md)** - Essential context for developers and AI assistants

### 📜 **Older design docs** (broader background; some predate the current implementation)
- **[System Architecture](architecture.md)** - System design with Mermaid diagrams
- **[API Architecture](api-architecture.md)** - RESTful API specifications and flows
- **[AI Processing Pipeline](ai-pipeline.md)** - Deep dive into AI workflows and anti-hallucination

### 💼 **Admin & Business Features**
- **[Admin Dashboard Specification](admin-dashboard-specification.md)** - Complete admin interface specification
- **[Admin Authentication](admin-authentication.md)** - Production-ready authentication and security
- **[Stripe Integration](STRIPE_INTEGRATION.md)** - Payment processing and tax calculation

### 🚀 **Innovation & Future**
- **[MCP Server Integration](mcp-server-specification.md)** - Revolutionary agentic commerce through developer tools

## 📋 **Quick Reference**

### **Current Platform Status**
- ✅ **Production Ready**: Complete eCommerce platform deployed and running
- ✅ **AI Assistant**: Volt AI with semantic search and personalization
- ✅ **Admin Dashboard**: Full management interface with AI analytics
- ✅ **CMS System**: Content management for pages and articles  
- ✅ **Authentication**: Multi-layered security with role-based access
- 🚧 **MCP Server**: Under development for agentic commerce

### **Key Technologies**
- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Cloudflare Workers, D1 Database, R2 Storage
- **AI**: Cloudflare AI (Llama 3.1 8B + BGE embeddings)
- **Auth**: Clerk with role-based admin access
- **Payments**: Stripe with Stripe Tax integration

### **Live Demo**
🌐 **[voltique.russellkmoore.me](https://voltique.russellkmoore.me)**

## 🔍 **Find What You Need**

### For Developers
- Start with [CLAUDE.md](../CLAUDE.md) for development context
- Review [architecture.md](architecture.md) for system understanding
- Check [api-routes.md](api-routes.md) for the current route map

### For Business Users
- Review [admin-dashboard-specification.md](admin-dashboard-specification.md) for admin capabilities
- Check [ROADMAP.md](ROADMAP.md) for current status and future plans

### For DevOps/Deployment
- Follow [DEPLOYMENT_SETUP.md](DEPLOYMENT_SETUP.md) for complete setup
- Review security sections in [admin-authentication.md](admin-authentication.md)

### For AI Integration
- Study [ai-pipeline.md](ai-pipeline.md) for AI implementation details
- Review [mcp-server-specification.md](mcp-server-specification.md) for future AI features

## 📊 **Documentation Quality**

All documentation has been recently audited and updated to ensure:
- ✅ **Accuracy**: Information matches current implementation
- ✅ **Completeness**: All major features and capabilities documented
- ✅ **Consistency**: Unified terminology and structure
- ✅ **Timeliness**: Recent updates reflect latest developments
- ✅ **Accessibility**: Clear navigation and cross-references

## 🔄 **Documentation Updates**

**Last Updated**: September 1, 2025

**Recent Changes**:
- Updated all docs to reflect current production state
- Added CMS system and admin user management documentation
- Corrected authentication status (now production-ready)
- Updated API architecture with new admin endpoints
- Consolidated roadmap with completed features

---

💡 **Need help?** Start with the [Main README](../README.md) or jump to the specific documentation section you need above.