import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMcpClient, loadMcpTools } from './mcp-connector';

describe('mcp-connector', () => {
  const tempDir = path.join(os.tmpdir(), `cdf-mcp-test-${Math.random().toString(36).slice(2)}`);
  const mockServerPath = path.join(tempDir, 'mock-mcp-server.js');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      mockServerPath,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('line', (line) => {
  const req = JSON.parse(line);
  if (req.method === 'initialize') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock', version: '1.0.0' } } }));
  } else if (req.method === 'notifications/initialized') {
  } else if (req.method === 'tools/list') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'greet', description: 'Greets', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }] } }));
  } else if (req.method === 'tools/call') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: 'Hello, ' + req.params.arguments.name + '!' }] } }));
  }
});
      `,
      'utf-8'
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should load tools through MultiServerMCPClient and execute them', async () => {
    const server = {
      id: 'mock-server',
      name: 'Mock Server',
      server_type: 'stdio' as const,
      config: {
        command: 'node',
        args: [mockServerPath],
      },
      is_connected: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const { client, tools } = await loadMcpTools('test-agent-id', [server]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toContain('greet');

    const result = await tools[0].invoke({ name: 'Antigravity' });
    expect(String(result)).toContain('Hello, Antigravity!');
    await client!.close();
  });

  it('should build an sse client config without throwing', () => {
    const client = createMcpClient([
      {
        id: 'sse-server',
        name: 'SSE Server',
        server_type: 'sse',
        config: { url: 'http://localhost:1234/sse', headers: { Authorization: 'Bearer x' } },
        is_connected: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ]);
    expect(client).toBeDefined();
  });
});
