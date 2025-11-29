# BeauTeas - Organic Skincare Tea Shop

> **Build Your Beauty from Within** - An AI-powered eCommerce storefront for organic skincare teas

BeauTeas is a sophisticated, AI-enhanced eCommerce storefront built on the [Mercora](https://github.com/russellkmoore/mercora) platform by Russell K. Moore. Specializing in USDA certified organic teas designed to improve skin health from within, BeauTeas features an intelligent AI shopping assistant, semantic search, and personalized recommendations.

## 🍵 About BeauTeas

BeauTeas offers the **Clearly Calendula** collection - organic tea blends formulated for skincare benefits:

- **Morning Blend** - Black tea with calendula for an energizing start
- **Afternoon Blend** - Green tea with spearmint for sustained focus
- **Evening Blend** - Caffeine-free herbal blend for relaxation

All teas are USDA certified organic and designed to fight acne, boost collagen, and provide antioxidant benefits.

## 🏗️ Built on Mercora

This storefront is powered by **[Mercora](https://github.com/russellkmoore/mercora)**, an open-source AI-powered eCommerce platform created by [Russell K. Moore](https://github.com/russellkmoore).

### Key Platform Features

- **AI Shopping Assistant**: Conversational assistant with semantic search and personalized recommendations
- **Edge Performance**: Cloudflare Workers for sub-100ms global response times
- **Complete eCommerce**: Product catalog, cart, Stripe checkout, order management
- **Admin Dashboard**: Full product, order, and content management
- **MACH Architecture**: Microservices, API-first, Cloud-native, Headless

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS |
| Backend | Cloudflare Workers with OpenNext |
| Database | Cloudflare D1 (SQLite) with Drizzle ORM |
| Storage | Cloudflare R2 Object Storage |
| AI | Cloudflare AI (Llama 3.1 8B, BGE embeddings) |
| Auth | Clerk Authentication |
| Payments | Stripe with Stripe Tax |

## 🎨 BeauTeas Branding

This fork demonstrates Mercora's theming system with a complete rebrand:

- **Color Palette**: Warm cream backgrounds with blush/peach accents
- **Typography**: Lora (headings) and Alegreya (body) serif fonts
- **Theme**: Light, elegant aesthetic suited for wellness/beauty products

The branding is configured in `lib/brand.config.ts` - see [THEMING.md](docs/THEMING.md) for details on customizing your own storefront.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare account with Workers paid plan
- Clerk account (authentication)
- Stripe account (payments)

### Installation

1. **Clone and Install**
   ```bash
   git clone https://github.com/devondragon/mercora-beauteas.git
   cd mercora-beauteas
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env.local
   # Add your Clerk and Stripe keys
   ```

3. **Create Cloudflare Resources**
   ```bash
   # Create DEV environment resources
   wrangler d1 create beauteas-db-dev
   wrangler r2 bucket create beauteas-images-dev
   wrangler vectorize create beauteas-index-dev --dimensions=1024 --metric=cosine

   # Create PRODUCTION resources (when ready)
   wrangler d1 create beauteas-db
   wrangler r2 bucket create beauteas-images
   wrangler vectorize create beauteas-index --dimensions=1024 --metric=cosine

   # Update wrangler.jsonc with the database IDs
   ```

4. **Database Setup**
   ```bash
   # Apply schema migrations to dev
   npx wrangler d1 migrations apply beauteas-db-dev --env dev

   # Load sample data (optional)
   npx wrangler d1 execute beauteas-db-dev --env dev --file=data/d1/seed.sql
   ```

5. **Set Secrets (per environment)**
   ```bash
   wrangler secret put CLERK_SECRET_KEY --env dev
   wrangler secret put STRIPE_SECRET_KEY --env dev
   wrangler secret put STRIPE_WEBHOOK_SECRET --env dev
   wrangler secret put RESEND_API_KEY --env dev
   ```

6. **Start Development**
   ```bash
   npm run dev
   ```

## 📚 Documentation

- **[Theming Guide](docs/THEMING.md)** - How to customize branding
- **[System Architecture](docs/architecture.md)** - Complete system design
- **[AI Pipeline](docs/ai-pipeline.md)** - AI workflows and recommendations
- **[API Architecture](docs/api-architecture.md)** - RESTful API specifications
- **[Admin Dashboard](docs/admin-dashboard-specification.md)** - Admin interface guide
- **[Stripe Integration](docs/STRIPE_INTEGRATION.md)** - Payment processing setup
- **[Deployment Guide](docs/DEPLOYMENT_SETUP.md)** - Production deployment

## 🎯 Development

### Key Commands
```bash
npm run dev               # Start local dev server
npm run build             # Build for production
npm run deploy            # Deploy to DEV (safe default)
npm run deploy:dev        # Deploy to DEV explicitly
npm run deploy:production # Deploy to PRODUCTION
npm run preview:dev       # Local preview with dev bindings
npm run lint              # Run linter
```

### Environment Architecture
BeauTeas uses isolated environments to prevent accidental production changes:

| Environment | Worker | Database | R2 Bucket | Vectorize |
|-------------|--------|----------|-----------|-----------|
| **dev** | beauteas-dev | beauteas-db-dev | beauteas-images-dev | beauteas-index-dev |
| **production** | beauteas | beauteas-db | beauteas-images | beauteas-index |

The default `npm run deploy` command deploys to dev for safety. Production requires explicit `npm run deploy:production`.

### Project Structure
```
mercora-beauteas/
├── app/                  # Next.js App Router
│   ├── admin/            # Admin dashboard
│   ├── api/              # API routes
│   └── checkout/         # Checkout flow
├── components/           # React components
├── lib/
│   ├── brand.config.ts   # BeauTeas branding configuration
│   ├── brand/            # Brand context provider
│   ├── db/               # Database schema
│   └── models/           # Data access layer
├── data/
│   ├── d1/               # Database seed data
│   └── r2/               # Product images & content
└── docs/                 # Documentation
```

## 💳 Test Payment Cards

| Card | Result |
|------|--------|
| `4242424242424242` | Success |
| `4000000000000002` | Decline |
| `4000002500003155` | 3D Secure |

## 🙏 Acknowledgments

- **[Russell K. Moore](https://github.com/russellkmoore)** - Creator of the Mercora platform
- **[Mercora](https://github.com/russellkmoore/mercora)** - The open-source eCommerce platform powering this store
- **Cloudflare** - Edge platform and AI infrastructure
- **Clerk** - Authentication
- **Stripe** - Payment processing
- **Next.js & shadcn/ui** - Frontend framework and components

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**🍵 BeauTeas - Build Your Beauty from Within**

*Powered by [Mercora](https://github.com/russellkmoore/mercora)*
