import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureConversationSystemContextSnapshot,
  getConversationSkillSnapshot,
  getOrCaptureConversationSystemContextSnapshot,
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

  it('lazily freezes missing prompt and Skill snapshots on first authoritative access', () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-conversation-lazy-freeze-'));
    const databasePath = path.join(os.tmpdir(), `cdf-conversation-lazy-freeze-${crypto.randomUUID()}.db`);
    cleanupPaths.push(projectPath, databasePath);
    writeSkill(projectPath, 'first-skill', 'First frozen Skill', 'First instructions');

    const db = new Database(databasePath);
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, prompt_snapshot TEXT, skill_snapshot TEXT)');
    db.prepare('INSERT INTO sessions (id, prompt_snapshot, skill_snapshot) VALUES (?, NULL, NULL)')
      .run('legacy-conversation');

    const first = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'legacy-conversation',
      projectPath,
      sceneId: 'general',
      promptSnapshot: 'First Master prompt',
    });
    writeSkill(projectPath, 'second-skill', 'Added after freeze', 'Second instructions');
    const second = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'legacy-conversation',
      projectPath,
      sceneId: 'general',
      promptSnapshot: 'Changed Master prompt',
    });

    expect(first.promptSnapshot).toBe('First Master prompt');
    expect(first.skillSnapshot.map((skill) => skill.name)).toContain('first-skill');
    expect(second).toEqual(first);
    expect(getConversationSkillSnapshot(db, 'legacy-conversation')).toEqual(first.skillSnapshot);
    db.close();
  });

  it('captures nested Project Skills for stable slash invocation', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-conversation-nested-skill-'));
    cleanupPaths.push(projectPath);
    const nestedSkillsRoot = path.join(projectPath, 'apps', 'web');
    writeSkill(nestedSkillsRoot, 'deploy', 'Deploy web app', 'Deploy instructions');

    const snapshot = captureConversationSystemContextSnapshot({
      projectPath,
      sceneId: 'general',
      promptSnapshot: 'Master prompt',
    }).skillSnapshot;
    const { collectSkillCommands } = await import('./commands/collectors/skill');
    const commands = await collectSkillCommands(projectPath, { catalog: snapshot });

    expect(snapshot).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'deploy',
        qualifiedName: 'apps/web:deploy',
        sourceKind: 'project-nested',
        userInvocable: true,
      }),
    ]));
    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'apps/web:deploy',
        skillSourceKind: 'project-nested',
      }),
    ]));
  });
});
