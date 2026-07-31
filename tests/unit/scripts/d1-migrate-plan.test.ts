import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEPLOY_TARGETS,
  backupNames,
  exportArgs,
  interpretMigrationsList,
  migrationsApplyArgs,
  migrationsListArgs,
  r2PutArgs,
  requiresDurableBackup,
  resolveTargets,
  targetSlug,
} from '@/scripts/lib/d1-migrate-plan.mjs';

// Real `wrangler d1 migrations list --remote` output (wrangler 4.105.0),
// captured against beauteas-db-dev while 0022/0023 were pending.
const PENDING_OUTPUT = `
 ⛅️ wrangler 4.105.0 (update available 4.118.0)
───────────────────────────────────────────────
Resource location: remote

Migrations to be applied:
┌───────────────────────────────┐
│ Name                          │
├───────────────────────────────┤
│ 0022_add_shipping_carrier.sql │
├───────────────────────────────┤
│ 0023_add_order_events.sql     │
└───────────────────────────────┘
`;

const UP_TO_DATE_OUTPUT = `
 ⛅️ wrangler 4.105.0
────────────────────
Resource location: remote

No migrations to apply!
`;

describe('resolveTargets', () => {
  it('expands dev to BOTH the dev DB and the dev preview DB', () => {
    const targets = resolveTargets('dev');
    expect(targets).toHaveLength(2);
    expect(targets.map(targetSlug)).toEqual(['beauteas-db-dev', 'beauteas-db-dev-preview']);
  });

  // The preview DB "has been forgotten before" (docs/database-migrations.md).
  // If this ever regresses, a dev deploy silently leaves the preview DB behind.
  it('marks exactly one dev target as the preview database', () => {
    expect(resolveTargets('dev').filter((t: { preview: boolean }) => t.preview)).toHaveLength(1);
  });

  it('resolves production to the single prod DB', () => {
    const targets = resolveTargets('production');
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      database: 'beauteas-db',
      wranglerEnv: 'production',
      preview: false,
    });
  });

  it('throws on an unknown env rather than silently migrating nothing', () => {
    expect(() => resolveTargets('staging')).toThrow(/Unknown --env "staging"/);
    expect(() => resolveTargets(undefined)).toThrow(/Unknown --env/);
  });

  it('never points a dev target at the production database', () => {
    for (const target of DEPLOY_TARGETS.dev) {
      expect(target.database).not.toBe('beauteas-db');
      expect(target.wranglerEnv).toBe('dev');
    }
  });
});

describe('requiresDurableBackup', () => {
  it('requires an off-machine backup for production only', () => {
    expect(requiresDurableBackup('production')).toBe(true);
    expect(requiresDurableBackup('dev')).toBe(false);
  });
});

describe('interpretMigrationsList', () => {
  it('extracts pending migration filenames from the wrangler table', () => {
    expect(interpretMigrationsList(PENDING_OUTPUT)).toEqual({
      status: 'pending',
      migrations: ['0022_add_shipping_carrier.sql', '0023_add_order_events.sql'],
    });
  });

  it('recognises an up-to-date database', () => {
    expect(interpretMigrationsList(UP_TO_DATE_OUTPUT)).toEqual({
      status: 'up-to-date',
      migrations: [],
    });
  });

  // The dangerous failure mode: output we cannot parse must NOT read as
  // "nothing pending", or a reworded wrangler would wave an unmigrated
  // database straight through to a live deploy.
  it('reports unrecognized output instead of assuming nothing is pending', () => {
    expect(interpretMigrationsList('some future wrangler phrasing').status).toBe('unrecognized');
    expect(interpretMigrationsList('').status).toBe('unrecognized');
    expect(interpretMigrationsList(null).status).toBe('unrecognized');
  });

  it('handles the duplicated 0010 prefix without collapsing the two files', () => {
    const out = `
Migrations to be applied:
│ 0010_add_blog_tables.sql │
│ 0010_add_gift_cards.sql  │
`;
    expect(interpretMigrationsList(out).migrations).toEqual([
      '0010_add_blog_tables.sql',
      '0010_add_gift_cards.sql',
    ]);
  });

  // A colorized filename defeats the leading \b (an SGR sequence ends in a
  // letter, and letter→digit is not a word boundary), so pending migrations
  // would read as "unrecognized" and abort a deploy for no reason.
  it('parses ANSI-colorized output, e.g. when FORCE_COLOR is set on a runner', () => {
    const E = String.fromCharCode(27);
    const colorized = PENDING_OUTPUT.replace(
      /(\d{4}_[A-Za-z0-9._-]*?\.sql)/g,
      `${E}[32m$1${E}[0m`,
    );
    expect(colorized).toContain(`${E}[32m`);
    expect(interpretMigrationsList(colorized)).toEqual({
      status: 'pending',
      migrations: ['0022_add_shipping_carrier.sql', '0023_add_order_events.sql'],
    });
  });

  it('recognises an up-to-date database through ANSI codes', () => {
    const E = String.fromCharCode(27);
    expect(interpretMigrationsList(`${E}[32mNo migrations to apply!${E}[0m`).status).toBe(
      'up-to-date',
    );
  });

  it('de-duplicates a filename repeated in the output', () => {
    const out = 'Migrations to be applied:\n0024_x.sql\n0024_x.sql';
    expect(interpretMigrationsList(out).migrations).toEqual(['0024_x.sql']);
  });
});

describe('wrangler argv builders', () => {
  const [devDb, devPreview] = DEPLOY_TARGETS.dev;
  const [prod] = DEPLOY_TARGETS.production;

  it('always targets the remote DB, never local', () => {
    for (const args of [migrationsListArgs(prod), migrationsApplyArgs(prod), exportArgs(prod, '/tmp/x.sql')]) {
      expect(args).toContain('--remote');
      expect(args).not.toContain('--local');
    }
  });

  it('passes --preview only for the preview database', () => {
    expect(migrationsApplyArgs(devPreview)).toContain('--preview');
    expect(migrationsApplyArgs(devDb)).not.toContain('--preview');
    expect(migrationsListArgs(devPreview)).toContain('--preview');
    expect(migrationsListArgs(devDb)).not.toContain('--preview');
  });

  // Regression: `wrangler d1 export` rejects --preview ("Unknown argument:
  // preview") even though migrations list/apply accept it. Sending it there
  // aborted the dev deploy at the pre-flight backup.
  it('never sends --preview to d1 export, addressing the preview DB by ID', () => {
    const args = exportArgs(devPreview, '/tmp/x.sql');
    expect(args).not.toContain('--preview');
    expect(args[2]).toBe(devPreview.exportDatabaseId);
    expect(args[2]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exports the non-preview databases by name', () => {
    expect(exportArgs(devDb, '/tmp/x.sql')[2]).toBe('beauteas-db-dev');
    expect(exportArgs(prod, '/tmp/x.sql')[2]).toBe('beauteas-db');
  });

  it('selects the right wrangler env', () => {
    expect(migrationsApplyArgs(prod).join(' ')).toContain('--env production');
    expect(migrationsApplyArgs(devDb).join(' ')).toContain('--env dev');
  });

  it('exports non-interactively so an unattended deploy cannot block', () => {
    const args = exportArgs(prod, '/tmp/backup.sql');
    expect(args).toContain('--skip-confirmation');
    expect(args).toContain('--output');
    expect(args[args.indexOf('--output') + 1]).toBe('/tmp/backup.sql');
  });

  it('builds an r2 put targeting bucket/key with the local file', () => {
    const args = r2PutArgs('beauteas-db-backups', 'd1/beauteas-db/x.sql', '/tmp/x.sql');
    expect(args.slice(0, 4)).toEqual([
      'r2', 'object', 'put', 'beauteas-db-backups/d1/beauteas-db/x.sql',
    ]);
    expect(args[args.indexOf('--file') + 1]).toBe('/tmp/x.sql');
    expect(args).toContain('--remote');
  });
});

// The preview database ID is duplicated from wrangler.jsonc because
// `wrangler d1 export` cannot resolve it via --preview. Duplication is only
// safe if drift is caught, so assert the two agree.
describe('wrangler.jsonc parity', () => {
  it('exportDatabaseId matches preview_database_id in wrangler.jsonc', () => {
    const raw = readFileSync(path.resolve(__dirname, '../../../wrangler.jsonc'), 'utf8');
    const match = raw.match(/"preview_database_id"\s*:\s*"([0-9a-f-]{36})"/);
    expect(match, 'preview_database_id not found in wrangler.jsonc').not.toBeNull();

    const previewTarget = DEPLOY_TARGETS.dev.find(
      (t: { preview: boolean }) => t.preview,
    ) as { exportDatabaseId: string } | undefined;
    expect(previewTarget?.exportDatabaseId).toBe(match![1]);
  });

  // Compare against the imported module, not hardcoded literals — asserting
  // that wrangler.jsonc contains two strings the test author already knew
  // would still pass if DEPLOY_TARGETS itself were typo'd, catching no drift.
  it('every database name in DEPLOY_TARGETS exists in wrangler.jsonc', () => {
    const raw = readFileSync(path.resolve(__dirname, '../../../wrangler.jsonc'), 'utf8');
    const configured = [...raw.matchAll(/"database_name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);

    const declared = [...DEPLOY_TARGETS.dev, ...DEPLOY_TARGETS.production].map(
      (t: { database: string }) => t.database,
    );
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(configured, `DEPLOY_TARGETS names ${name}, absent from wrangler.jsonc`).toContain(name);
    }
  });
});

describe('backupNames', () => {
  it('flattens colons and dots so the ISO stamp is object-key safe', () => {
    const { fileName, objectKey } = backupNames(
      DEPLOY_TARGETS.production[0],
      '2026-07-31T21:57:49.572Z',
    );
    expect(fileName).toBe('beauteas-db-2026-07-31T21-57-49-572Z.sql');
    expect(objectKey).toBe(`d1/beauteas-db/${fileName}`);
    expect(objectKey).not.toMatch(/[:]/);
  });

  it('keeps dev and dev-preview backups in separate key prefixes', () => {
    const [devDb, devPreview] = DEPLOY_TARGETS.dev;
    const stamp = '2026-07-31T00:00:00.000Z';
    expect(backupNames(devDb, stamp).objectKey).toContain('d1/beauteas-db-dev/');
    expect(backupNames(devPreview, stamp).objectKey).toContain('d1/beauteas-db-dev-preview/');
    expect(backupNames(devDb, stamp).objectKey).not.toBe(backupNames(devPreview, stamp).objectKey);
  });
});
