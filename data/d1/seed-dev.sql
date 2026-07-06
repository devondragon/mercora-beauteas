-- DEV-ONLY seed data. NEVER run this against production (same rule as
-- data/d1/seed.sql — production data comes from the Shopify migration).
--
-- Migration 0012 removes the seeded 'test-agent' MCP credential from every DB so
-- the publicly-known key ('test-key-123') is not live in production (BMC-136 / C9).
-- This file restores that agent for LOCAL development only, so that
--   X-Agent-API-Key: test-key-123
-- keeps working for manual MCP-server testing. It is wired into `npm run dev`
-- (scripts/db-local-ensure.mjs) and `npm run db:reset:local`, both of which target
-- the local D1 exclusively.
--
-- The stored value is the SHA-256 hash of 'test-key-123' — not the raw key — to
-- match the hash-based lookup added in migration 0011 (lib/auth/crypto.ts
-- sha256Hex / lib/mcp/auth.ts authenticateAgent).
INSERT OR REPLACE INTO mcp_agents (
  agent_id,
  name,
  description,
  api_key_hash,
  permissions,
  rate_limit_rpm,
  rate_limit_oph,
  is_active
) VALUES (
  'test-agent',
  'Test Agent',
  'Development test agent for MCP server (dev-only seed — see data/d1/seed-dev.sql)',
  '625faa3fbbc3d2bd9d6ee7678d04cc5339cb33dc68d9b58451853d60046e226a',
  '["read:products", "write:cart", "place:orders"]',
  1000,
  100,
  1
);
