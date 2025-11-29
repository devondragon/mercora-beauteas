# Mercora Production Deployment Guide

> **Complete step-by-step guide for deploying Mercora to production**

This comprehensive guide covers the complete deployment process for Mercora, including multi-environment setup, all third-party services, infrastructure configuration, security setup, and admin dashboard deployment.

## 🏗️ Infrastructure Overview

Mercora runs on Cloudflare's edge infrastructure with integrated services:

- **Hosting**: Cloudflare Workers + Next.js 15 with App Router
- **Database**: Cloudflare D1 (distributed SQLite with Drizzle ORM)
- **Storage**: Cloudflare R2 Object Storage for images and content
- **AI Platform**: Cloudflare AI (Llama 3.1 8B + BGE embeddings)
- **Vector Database**: Cloudflare Vectorize for semantic search
- **Authentication**: Clerk Authentication (with admin role support)
- **Payments**: Stripe with Stripe Tax for global tax calculation
- **Email**: Resend for transactional emails
- **Admin Dashboard**: Complete admin interface with AI analytics

## 🔀 Multi-Environment Architecture

Mercora uses isolated environments to prevent accidental production changes:

| Environment | Worker | Database | R2 Bucket | Vectorize |
|-------------|--------|----------|-----------|-----------|
| **dev** | mercora-dev | mercora-db-dev | mercora-images-dev | mercora-index-dev |
| **production** | mercora | mercora-db | mercora-images | mercora-index |

**Safety Model:**
- `npm run deploy` defaults to dev environment (safe)
- `npm run deploy:production` required for production (explicit)
- No top-level resource bindings to prevent accidents

## 📋 Prerequisites

### Required Service Accounts
1. **Cloudflare Account** - Workers paid plan required ($5/month minimum)
2. **Clerk Account** - Authentication service (free tier available)
3. **Stripe Account** - Payment processing with Stripe Tax enabled
4. **GitHub Account** - Repository hosting and optional CI/CD

### Local Development Environment
- **Node.js 18+** and npm/yarn/pnpm
- **Git** for version control
- **Wrangler CLI**: `npm install -g wrangler`
- **Terminal/Command Line** access

### Domain Requirements (Optional)
- **Custom Domain** for production deployment
- **DNS Management** access for custom domains

---

## 1️⃣ Cloudflare Setup

### **Step 1: Create Cloudflare Account**
1. Sign up at [cloudflare.com](https://cloudflare.com)
2. Upgrade to Workers paid plan ($5/month minimum)
3. Note your Account ID from the dashboard

### **Step 2: Create Cloudflare Resources**

Create resources for both environments. Start with dev, create production when ready.

#### **DEV Environment Resources**
```bash
# D1 Database
wrangler d1 create mercora-db-dev
# Note the database ID from output

# R2 Bucket
wrangler r2 bucket create mercora-images-dev

# Vectorize Index
wrangler vectorize create mercora-index-dev \
  --dimensions=1024 \
  --metric=cosine
```

#### **PRODUCTION Environment Resources**
```bash
# D1 Database
wrangler d1 create mercora-db
# Note the database ID from output

# R2 Bucket
wrangler r2 bucket create mercora-images

# Vectorize Index
wrangler vectorize create mercora-index \
  --dimensions=1024 \
  --metric=cosine
```

#### **AI Binding**
AI binding is automatically available on Workers paid plans and shared across environments.

### **Step 3: Configure wrangler.jsonc**
Update `wrangler.jsonc` with the database IDs from the creation output:

```jsonc
{
  "name": "mercora",
  "main": ".open-next/worker.js",
  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],

  // Shared configuration
  "assets": { "binding": "ASSETS", "directory": ".open-next/assets" },
  "observability": { "enabled": true },
  "ai": { "binding": "AI" },

  "env": {
    "dev": {
      "name": "mercora-dev",
      "d1_databases": [{
        "binding": "DB",
        "database_name": "mercora-db-dev",
        "database_id": "YOUR_DEV_DATABASE_ID"
      }],
      "r2_buckets": [
        { "binding": "MEDIA", "bucket_name": "mercora-images-dev" },
        { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "mercora-images-dev" }
      ],
      "vectorize": [{ "binding": "VECTORIZE", "index_name": "mercora-index-dev" }],
      "vars": {
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": "pk_test_...",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY": "pk_test_..."
      }
    },
    "production": {
      "name": "mercora",
      "d1_databases": [{
        "binding": "DB",
        "database_name": "mercora-db",
        "database_id": "YOUR_PRODUCTION_DATABASE_ID"
      }],
      "r2_buckets": [
        { "binding": "MEDIA", "bucket_name": "mercora-images" },
        { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "mercora-images" }
      ],
      "vectorize": [{ "binding": "VECTORIZE", "index_name": "mercora-index" }],
      "vars": {
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": "pk_live_...",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY": "pk_live_..."
      }
    }
  }
}
```

---

## 2️⃣ Clerk Authentication Setup

### **Step 1: Create Clerk Application**
1. Sign up at [clerk.com](https://clerk.com)
2. Create a new application
3. Choose authentication methods (email, Google, GitHub, etc.)
4. Configure branding and themes to match your design

### **Step 2: Get API Keys**
From your Clerk Dashboard:
1. Go to **API Keys**
2. Copy **Publishable key** (starts with `pk_test_`)
3. Copy **Secret key** (starts with `sk_test_`)

### **Step 3: Configure Environment Variables**

#### **Local Development (.env.local)**
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
CLERK_SECRET_KEY=sk_test_your_secret_key_here
```

#### **Cloudflare Secrets (per environment)**
```bash
# DEV environment
wrangler secret put CLERK_SECRET_KEY --env dev
# Enter: sk_test_your_dev_secret_key

# PRODUCTION environment
wrangler secret put CLERK_SECRET_KEY --env production
# Enter: sk_live_your_production_secret_key
```

Public keys are configured in `wrangler.jsonc` vars per environment (see Step 3 above).

### **Step 4: Configure Domains**
In Clerk Dashboard:
1. Go to **Domains**
2. Add your domains:
   - Dev: `mercora-dev.<your-subdomain>.workers.dev`
   - Production: Your custom domain
3. Configure redirect URLs for authentication

---

## 3️⃣ Stripe Payment & Tax Setup

### **Step 1: Create Stripe Account**
1. Sign up at [stripe.com](https://stripe.com)
2. Complete business verification
3. Enable **Stripe Tax** in the dashboard

### **Step 2: Configure Stripe Tax**
1. Go to **Products > Tax** in Stripe Dashboard
2. Enable tax calculation
3. Configure your business location
4. Set up tax registration for required states/regions

### **Step 3: Get API Keys**
From Stripe Dashboard > **Developers > API Keys**:
1. Copy **Publishable key** (starts with `pk_test_`)
2. Copy **Secret key** (starts with `sk_test_`)

### **Step 4: Configure Webhooks**
1. Go to **Developers > Webhooks**
2. Click **+ Add endpoint**
3. Set endpoint URL: `https://yourdomain.com/api/webhooks/stripe`
4. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `checkout.session.completed`
5. Copy the **Signing secret** (starts with `whsec_`)

### **Step 5: Configure Environment Variables**

#### **Local Development (.env.local)**
```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

#### **Cloudflare Secrets (per environment)**
```bash
# DEV environment
wrangler secret put STRIPE_SECRET_KEY --env dev
wrangler secret put STRIPE_WEBHOOK_SECRET --env dev
wrangler secret put RESEND_API_KEY --env dev

# PRODUCTION environment
wrangler secret put STRIPE_SECRET_KEY --env production
wrangler secret put STRIPE_WEBHOOK_SECRET --env production
wrangler secret put RESEND_API_KEY --env production
```

Public keys are configured in `wrangler.jsonc` vars per environment.

---

## 4️⃣ Database Setup

### **Step 1: Run Migrations (per environment)**
```bash
# Apply migrations to DEV database
wrangler d1 migrations apply --env dev --remote

# Apply migrations to PRODUCTION database
wrangler d1 migrations apply --env production --remote
```

### **Step 2: Seed Data (Optional)**
```bash
# Seed DEV database
wrangler d1 execute --env dev --remote --file=./data/d1/seed.sql

# Seed PRODUCTION database (when ready)
wrangler d1 execute --env production --remote --file=./data/d1/seed.sql
```

### **Step 3: Verify Database**
```bash
# Check DEV tables
wrangler d1 execute --env dev --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table';"

# Check DEV product count
wrangler d1 execute --env dev --remote \
  --command="SELECT COUNT(*) FROM products;"

# Check PRODUCTION (same commands with --env production)
```

---

## 5️⃣ AI Content Indexing

### **Step 1: Content Preparation**
Ensure your content is properly organized:
- `data/r2/products_md/` - Product descriptions (30 files)
- `data/r2/knowledge_md/` - Support articles (8 files)
- Content should be uploaded to R2 bucket before indexing

### **Step 2: Deploy and Index Content**
```bash
# Deploy the application first
npm run deploy

# Index both products and knowledge articles (consolidated endpoint)
# Note: Authentication temporarily disabled for development
curl -X GET "https://yourdomain.com/api/admin/vectorize"

# For production with admin token:
curl -X GET "https://yourdomain.com/api/admin/vectorize?token=your-admin-token"
```

### **Step 3: Verify AI System**
1. Test the AI assistant via the chat interface
2. Verify semantic search is working with product queries
3. Check admin dashboard AI analytics section
4. Ensure 38 items are indexed (30 products + 8 knowledge articles)

### **Step 4: Admin Dashboard Verification**
1. Access admin dashboard at `/admin`
2. Check AI analytics section for indexing status
3. Verify vector search performance metrics
4. Test AI-powered business intelligence features

---

## 6️⃣ Deployment Process

### **Step 1: Final Configuration Check**
Verify all environment variables and secrets are configured:

```bash
# Check DEV secrets
wrangler secret list --env dev

# Check PRODUCTION secrets
wrangler secret list --env production

# Verify wrangler.jsonc configuration
cat wrangler.jsonc
```

### **Step 2: Deploy to DEV**
```bash
# Install dependencies
npm install

# Deploy to DEV (safe default)
npm run deploy
# Or explicitly: npm run deploy:dev
```

### **Step 3: Deploy to PRODUCTION**
```bash
# Deploy to PRODUCTION (explicit command required)
npm run deploy:production
```

### **Step 4: Deploy Verification**
1. Check deployment logs for errors
2. Visit your deployed site:
   - DEV: `mercora-dev.<your-account-subdomain>.workers.dev`
   - PRODUCTION: Your custom domain
3. Test core functionality:
   - User registration/login
   - Product browsing and filtering
   - AI chat with Volt assistant
   - Shopping cart and checkout flow (with test cards)
4. Test admin dashboard:
   - Access admin dashboard at `/admin`
   - Verify product management interface
   - Test order management functionality
   - Check AI analytics dashboard
   - Ensure settings management works

---

## 7️⃣ Post-Deployment Configuration

### **Step 1: Update Webhook URLs**
Update webhook endpoints in third-party services for each environment:

#### **Stripe Webhooks**
1. Go to Stripe Dashboard > **Developers > Webhooks**
2. Create separate endpoints for each environment:
   - DEV: `https://mercora-dev.<your-account-subdomain>.workers.dev/api/webhooks/stripe`
   - PRODUCTION: `https://yourdomain.com/api/webhooks/stripe`

#### **Clerk Webhooks (if any)**
Update Clerk webhook URLs for each environment.

### **Step 2: Configure Custom Domains**
For production:
1. Go to Cloudflare Dashboard > Workers & Pages > mercora > Settings > Domains
2. Add your custom domain
3. Configure DNS records (CNAME to workers.dev)
4. Update Clerk and Stripe with production domain

### **Step 3: Enable Analytics (Optional)**
Consider adding:
- Cloudflare Analytics
- Google Analytics
- Error tracking (Sentry)

---

## 8️⃣ Going Live (Production Keys)

When ready for real payments, configure the production environment with live keys:

### **Step 1: Get Live Keys**
From Stripe Dashboard (toggle to "Live" mode):
1. Copy live **Publishable key** (starts with `pk_live_`)
2. Copy live **Secret key** (starts with `sk_live_`)
3. Create production webhook and copy signing secret

From Clerk Dashboard (switch to production instance):
1. Copy live **Publishable key** (starts with `pk_live_`)
2. Copy live **Secret key** (starts with `sk_live_`)

### **Step 2: Update Production Secrets**
```bash
# Update production secrets with live keys
wrangler secret put CLERK_SECRET_KEY --env production
wrangler secret put STRIPE_SECRET_KEY --env production
wrangler secret put STRIPE_WEBHOOK_SECRET --env production
wrangler secret put RESEND_API_KEY --env production
```

### **Step 3: Update wrangler.jsonc Production Vars**
Update the production environment vars in `wrangler.jsonc`:
```jsonc
"production": {
  // ...
  "vars": {
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": "pk_live_your_clerk_key",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY": "pk_live_your_stripe_key"
  }
}
```

### **Step 4: Deploy to Production**
```bash
npm run deploy:production
```

---

## 9️⃣ Monitoring & Maintenance

### **Cloudflare Monitoring**
- Worker analytics and logs
- D1 database performance
- R2 storage usage
- AI usage and costs

### **Third-Party Monitoring**
- Stripe payment success rates
- Clerk authentication metrics
- Error tracking and alerts

### **Regular Maintenance**
- Update dependencies monthly
- Review and rotate API keys quarterly
- Monitor resource usage and costs
- Update AI content and indexes

---

## 🔐 Security Checklist

### **Environment Security**
- ✅ All secrets stored in Cloudflare secrets (not vars)
- ✅ `.env.local` files are gitignored
- ✅ No hardcoded API keys in code

### **API Security**
- ✅ Webhook signature verification enabled
- ✅ API rate limiting configured
- ✅ Authentication required for admin endpoints

### **Content Security**
- ✅ CSP headers configured
- ✅ Input validation on all forms
- ✅ SQL injection protection via Drizzle ORM

---

## 🆘 Troubleshooting

### **Common Issues**

#### **Deployment Fails**
- Check wrangler.jsonc syntax
- Verify all required secrets are set
- Ensure Workers paid plan is active

#### **Database Connection Issues**
- Verify D1 database ID in wrangler.jsonc
- Check migration status
- Ensure proper bindings

#### **Authentication Issues**
- Verify Clerk domain configuration
- Check redirect URL settings
- Ensure API keys are correct

#### **Payment Issues**
- Verify Stripe webhook configuration
- Check webhook signature validation
- Ensure tax calculation is working

### **Debug Commands**
```bash
# View DEV deployment logs
wrangler tail --env dev

# View PRODUCTION deployment logs
wrangler tail --env production

# Check DEV database status
wrangler d1 info mercora-db-dev --env dev

# Check PRODUCTION database status
wrangler d1 info mercora-db --env production

# Test API endpoints
curl https://mercora-dev.<your-account-subdomain>.workers.dev/api/products
curl https://yourdomain.com/api/products

# Check secrets per environment
wrangler secret list --env dev
wrangler secret list --env production
```

---

## 📞 Support Resources

- **Cloudflare Workers**: [workers.cloudflare.com](https://workers.cloudflare.com)
- **Clerk Documentation**: [clerk.com/docs](https://clerk.com/docs)
- **Stripe Documentation**: [stripe.com/docs](https://stripe.com/docs)
- **Next.js Documentation**: [nextjs.org/docs](https://nextjs.org/docs)

---

**🎉 Your Mercora platform is now ready for production!**