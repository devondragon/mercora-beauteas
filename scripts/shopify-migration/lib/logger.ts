/**
 * Migration Logger
 *
 * Structured logging with entity context and migration report generation.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

interface EntityReport {
  entity: string;
  source: number;
  migrated: number;
  skipped: number;
  errors: number;
}

export class MigrationLogger {
  private entity: string;
  private reports: EntityReport[] = [];

  constructor(entity: string = 'migration') {
    this.entity = entity;
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Set the current entity context
   */
  setEntity(entity: string): void {
    this.entity = entity;
  }

  /**
   * Log info message
   */
  info(message: string): void {
    console.log(`[${this.timestamp()}] [${this.entity}] INFO: ${message}`);
  }

  /**
   * Log warning message
   */
  warn(message: string): void {
    console.warn(`[${this.timestamp()}] [${this.entity}] WARN: ${message}`);
  }

  /**
   * Log error message
   */
  error(message: string, err?: unknown): void {
    const errorDetail = err instanceof Error ? ` -- ${err.message}` : '';
    console.error(
      `[${this.timestamp()}] [${this.entity}] ERROR: ${message}${errorDetail}`
    );
  }

  /**
   * Add entity migration results to the report
   */
  addToReport(
    entity: string,
    counts: { source: number; migrated: number; skipped: number; errors: number }
  ): void {
    this.reports.push({ entity, ...counts });
  }

  /**
   * Generate formatted summary report
   */
  generateReport(): string {
    const lines: string[] = [
      '='.repeat(60),
      'MIGRATION REPORT',
      `Generated: ${this.timestamp()}`,
      '='.repeat(60),
      '',
      'Entity             | Source | Migrated | Skipped | Errors',
      '-'.repeat(60),
    ];

    let totalSource = 0;
    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const r of this.reports) {
      const name = r.entity.padEnd(19);
      const source = String(r.source).padStart(6);
      const migrated = String(r.migrated).padStart(8);
      const skipped = String(r.skipped).padStart(7);
      const errors = String(r.errors).padStart(6);
      lines.push(`${name}| ${source} | ${migrated} | ${skipped} | ${errors}`);

      totalSource += r.source;
      totalMigrated += r.migrated;
      totalSkipped += r.skipped;
      totalErrors += r.errors;
    }

    lines.push('-'.repeat(60));
    const totalName = 'TOTAL'.padEnd(19);
    lines.push(
      `${totalName}| ${String(totalSource).padStart(6)} | ${String(totalMigrated).padStart(8)} | ${String(totalSkipped).padStart(7)} | ${String(totalErrors).padStart(6)}`
    );
    lines.push('='.repeat(60));

    if (totalErrors > 0) {
      lines.push(`\nWARNING: ${totalErrors} errors occurred during migration.`);
    } else {
      lines.push('\nAll entities migrated successfully.');
    }

    return lines.join('\n');
  }

  /**
   * Write report to file
   */
  writeReport(path: string): void {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const report = this.generateReport();
    writeFileSync(path, report, 'utf-8');
    this.info(`Report written to ${path}`);
  }
}

/** Default logger instance */
export const logger = new MigrationLogger();
