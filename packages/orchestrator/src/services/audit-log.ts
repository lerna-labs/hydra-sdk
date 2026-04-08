import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Append-only audit log for provisioning actions.
 *
 * Each entry is a single JSON line (JSONL format) for easy parsing.
 */
export class AuditLog {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  log(action: string, details: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...details,
    };
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
  }
}
