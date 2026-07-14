import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureConversationSystemContextSnapshot,
  getConversationSkillSnapshot,
} from './conversation-system-context-snapshot';

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function writeSkill(root: string, name: string, description: string, body: string): void {
  const skillDir = path.join(root, '.cdf', 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\nargument-hint: <file>\n---\n\n${body}\n`,
  );
}

describe('Conversation system-context Skill Snapshot', () => {
  it('captures source identities and discovery metadata without copying Skill instructions, and survives restart', () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-conversation-skills-'));
    const databasePath = path.join(os.tmpdir(), `cdf-conversation-skills-${crypto.randomUUID()}.db`);
    cleanupPaths.push(projectPath, databasePath);
    writeSkill(projectPath, 'project-review', 'Review project changes', 'Current source instructions');

    const snapshot = captureConversationSystemContextSnapshot({
      projectPath,
      sceneId: 'general',
      promptSnapshot: 'Captured Master prompt',
    });
    expect(snapshot.promptSnapshot).toBe('Captured Master prompt');
    expect(snapshot.skillSnapshot).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'project-review',
        qualifiedName: 'project-review',
        description: 'Review project changes',
        argumentHint: '<file>',
        sourceKind: 'project',
        skillPath: path.join(projectPath, '.cdf', 'skills', 'project-review', 'SKILL.md'),
        userInvocable: true,
      }),
    ]));
    expect(JSON.stringify(snapshot.skillSnapshot)).not.toContain('Current source instructions');

    const db = new Database(databasePath);
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, skill_snapshot TEXT)');
    db.prepare('INSERT INTO sessions (id, skill_snapshot) VALUES (?, ?)')
      .run('conversation-1', JSON.stringify(snapshot.skillSnapshot));
    db.close();

    const restartedDb = new Database(databasePath);
    expect(getConversationSkillSnapshot(restartedDb, 'conversation-1')).toEqual(snapshot.skillSnapshot);
    restartedDb.close();
  });
});
