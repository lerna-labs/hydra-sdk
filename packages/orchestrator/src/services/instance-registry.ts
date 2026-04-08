import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { InstanceStatus, ManagedInstance } from '../types.js';

/**
 * JSON-file-backed registry of managed Hydra head instances.
 *
 * Keeps an in-memory Map for fast reads and flushes to disk on every write.
 * The file at `filePath` is the source of truth across restarts.
 */
export class InstanceRegistry {
  private instances = new Map<string, ManagedInstance>();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  /** Load state from disk. Creates the file/directory if missing. */
  private load(): void {
    if (!existsSync(this.filePath)) {
      const dir = dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, '[]', 'utf-8');
      return;
    }

    const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as ManagedInstance[];
    for (const inst of data) {
      this.instances.set(inst.id, inst);
    }
  }

  /** Flush current state to disk. */
  private flush(): void {
    const data = Array.from(this.instances.values());
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /** Register a new instance. Throws if the ID already exists. */
  add(instance: ManagedInstance): void {
    if (this.instances.has(instance.id)) {
      throw new Error(`Instance "${instance.id}" already exists`);
    }
    this.instances.set(instance.id, instance);
    this.flush();
  }

  /** Get an instance by ID, or undefined. */
  get(id: string): ManagedInstance | undefined {
    return this.instances.get(id);
  }

  /** List all instances. */
  list(): ManagedInstance[] {
    return Array.from(this.instances.values());
  }

  /** List instances matching a given status. */
  listByStatus(...statuses: InstanceStatus[]): ManagedInstance[] {
    const set = new Set(statuses);
    return this.list().filter((i) => set.has(i.status));
  }

  /** Count active (non-stopped, non-failed) instances. */
  activeCount(): number {
    return this.listByStatus('SCAFFOLDING', 'READY').length;
  }

  /** Update fields on an existing instance. Throws if not found. */
  update(id: string, patch: Partial<ManagedInstance>): ManagedInstance {
    const inst = this.instances.get(id);
    if (!inst) throw new Error(`Instance "${id}" not found`);

    const updated = { ...inst, ...patch };
    this.instances.set(id, updated);
    this.flush();
    return updated;
  }

  /** Remove an instance from the registry entirely. */
  remove(id: string): void {
    this.instances.delete(id);
    this.flush();
  }
}
