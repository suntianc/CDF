import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDeleteFileTool } from './file-tools';

describe('createDeleteFileTool', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-delete-tool-'));
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('deletes a project file by virtual absolute path', async () => {
    const filePath = path.join(projectPath, 'notes.txt');
    fs.writeFileSync(filePath, 'temporary', 'utf-8');

    const deleteFile = createDeleteFileTool(projectPath);
    await (deleteFile as any).invoke({ file_path: '/notes.txt' });

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('rejects protected paths', async () => {
    const filePath = path.join(projectPath, '.env');
    fs.writeFileSync(filePath, 'SECRET=1', 'utf-8');

    const deleteFile = createDeleteFileTool(projectPath);

    await expect((deleteFile as any).invoke({ file_path: '/.env' })).rejects.toThrow('protected path');
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
