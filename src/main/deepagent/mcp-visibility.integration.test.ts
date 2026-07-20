import fs from 'fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TMP_DIR = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const osSync = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('node:fs') as typeof import('node:fs');
  const dir = `${osSync.tmpdir()}/cdf-mcp-visibility-${process.pid}-${Date.now()}`;
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
});

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR },
}));

import db from '../database';
import { createAgentCatalog } from '../agent-catalog';
import { getAgentMcpServers } from './mcp-visibility';

const PROJECT_ID = 'project-mcp-visibility';

const TABLES_IN_DELETE_ORDER = [
  'agent_mcp_exclusions',
  'mcp_servers',
  'projects',
];

function freshDb() {
  db.pragma('foreign_keys = ON');
  for (const table of TABLES_IN_DELETE_ORDER) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.exec("DELETE FROM agents WHERE role = 'custom'");

  db.prepare(
    `INSERT INTO projects (id, name, path, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0)`,
  ).run(PROJECT_ID, 'MCP Visibility Project', TMP_DIR);

  const ids = ['agent-a', 'agent-b'];
  let index = 0;
  const catalog = createAgentCatalog(db, { createId: () => ids[index++]! });
  catalog.createCustom({ name: 'agent-a' });
  catalog.createCustom({ name: 'agent-b' });
}

function insertMcpServer(id: string, isConnected: boolean) {
  db.prepare(
    `INSERT INTO mcp_servers (id, name, server_type, config, is_connected, created_at, updated_at)
     VALUES (?, ?, 'stdio', ?, ?, 0, 0)`,
  ).run(id, id, JSON.stringify({ command: 'node', args: [`${id}.js`] }), isConnected ? 1 : 0);
}

beforeEach(() => {
  freshDb();
});

afterAll(() => {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('MCP Server Exclusion runtime visibility', () => {
  it('makes connected MCP servers globally visible unless an Agent excludes them', () => {
    insertMcpServer('alpha', true);
    insertMcpServer('beta', true);
    insertMcpServer('disabled', false);
    db.prepare(
      `INSERT INTO agent_mcp_exclusions (agent_id, mcp_server_id)
       VALUES (?, ?)`,
    ).run('agent-a', 'beta');

    expect(getAgentMcpServers('agent-a').map((server) => server.id)).toEqual(['alpha']);
    expect(getAgentMcpServers('agent-b').map((server) => server.id)).toEqual(['alpha', 'beta']);
  });
});
