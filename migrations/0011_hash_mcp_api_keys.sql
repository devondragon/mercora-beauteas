-- BMC-141 / BMC-155: store MCP agent API keys as SHA-256 hashes, never plaintext.
--
-- mcp_agents.api_key previously held the raw, usable agent key, so any D1 read
-- (backup export, `wrangler d1 export`, admin-panel leak) exposed live
-- credentials. Rename the column to api_key_hash and have the app store/compare
-- SHA-256 hashes instead (mirroring api_tokens.token_hash). The indexed
-- hash-equality lookup also removes the plaintext-compare timing concern.
--
-- The UNIQUE + NOT NULL constraints ride along with RENAME COLUMN in SQLite/D1.
ALTER TABLE mcp_agents RENAME COLUMN api_key TO api_key_hash;

-- Re-seed the dev test agent with the hash of its documented key ('test-key-123'),
-- so `X-Agent-API-Key: test-key-123` keeps working in development after the switch
-- to hash-based lookup. sha256('test-key-123') computed with Web Crypto SHA-256,
-- matching lib/auth/crypto.ts sha256Hex().
UPDATE mcp_agents
SET api_key_hash = '625faa3fbbc3d2bd9d6ee7678d04cc5339cb33dc68d9b58451853d60046e226a'
WHERE agent_id = 'test-agent';

-- NOTE: any OTHER pre-existing agent rows still hold their raw key in this column
-- and can no longer authenticate (the raw key is not recoverable to re-hash in
-- SQL). Reissue those agents via the create flow, which now stores the hash.
