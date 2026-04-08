import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManagedInstance } from '../types.js';
import { InstanceRegistry } from './instance-registry.js';

function makeInstance(id: string, overrides?: Partial<ManagedInstance>): ManagedInstance {
  return {
    id,
    network: 'preprod',
    status: 'READY',
    adminAddress: 'addr_test1abc',
    endpoints: null,
    apiKey: 'key-123',
    expressImage: 'ghcr.io/test:latest',
    createdAt: '2026-04-07T00:00:00Z',
    ...overrides,
  };
}

describe('InstanceRegistry', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = join(tmpdir(), `orchestrator-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, 'instances.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the file on first load', () => {
    new InstanceRegistry(filePath);
    expect(existsSync(filePath)).toBe(true);
  });

  it('adds and retrieves an instance', () => {
    const reg = new InstanceRegistry(filePath);
    const inst = makeInstance('alpha');
    reg.add(inst);
    expect(reg.get('alpha')).toEqual(inst);
  });

  it('throws on duplicate add', () => {
    const reg = new InstanceRegistry(filePath);
    reg.add(makeInstance('alpha'));
    expect(() => reg.add(makeInstance('alpha'))).toThrow('already exists');
  });

  it('lists all instances', () => {
    const reg = new InstanceRegistry(filePath);
    reg.add(makeInstance('alpha'));
    reg.add(makeInstance('beta'));
    expect(reg.list()).toHaveLength(2);
  });

  it('lists by status', () => {
    const reg = new InstanceRegistry(filePath);
    reg.add(makeInstance('alpha', { status: 'READY' }));
    reg.add(makeInstance('beta', { status: 'STOPPED' }));
    reg.add(makeInstance('gamma', { status: 'SCAFFOLDING' }));

    expect(reg.listByStatus('READY')).toHaveLength(1);
    expect(reg.listByStatus('READY', 'SCAFFOLDING')).toHaveLength(2);
  });

  it('counts active instances', () => {
    const reg = new InstanceRegistry(filePath);
    reg.add(makeInstance('alpha', { status: 'READY' }));
    reg.add(makeInstance('beta', { status: 'STOPPED' }));
    reg.add(makeInstance('gamma', { status: 'SCAFFOLDING' }));
    expect(reg.activeCount()).toBe(2);
  });

  it('updates an instance', () => {
    const reg = new InstanceRegistry(filePath);
    reg.add(makeInstance('alpha', { status: 'SCAFFOLDING' }));
    const updated = reg.update('alpha', { status: 'READY', readyAt: '2026-04-07T01:00:00Z' });
    expect(updated.status).toBe('READY');
    expect(updated.readyAt).toBe('2026-04-07T01:00:00Z');
  });

  it('throws on update of nonexistent instance', () => {
    const reg = new InstanceRegistry(filePath);
    expect(() => reg.update('nope', { status: 'READY' })).toThrow('not found');
  });

  it('removes an instance', () => {
    const reg = new InstanceRegistry(filePath);
    reg.add(makeInstance('alpha'));
    reg.remove('alpha');
    expect(reg.get('alpha')).toBeUndefined();
    expect(reg.list()).toHaveLength(0);
  });

  it('persists across instances', () => {
    const reg1 = new InstanceRegistry(filePath);
    reg1.add(makeInstance('alpha'));
    reg1.add(makeInstance('beta'));

    // New registry reads the same file
    const reg2 = new InstanceRegistry(filePath);
    expect(reg2.list()).toHaveLength(2);
    expect(reg2.get('alpha')?.id).toBe('alpha');
  });
});
