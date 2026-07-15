import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockedStore = vi.hoisted(() => {
  const state = {
    sceneSkillExposures: {} as Record<string, Record<string, boolean>>,
  };
  return {
    state,
    store: {
      get: vi.fn((key: string) => key === 'sceneSkillExposures' ? state.sceneSkillExposures : undefined),
      set: vi.fn((key: string, value: Record<string, Record<string, boolean>>) => {
        if (key === 'sceneSkillExposures') state.sceneSkillExposures = value;
      }),
    },
  };
});

vi.mock('./store', () => ({ default: mockedStore.store }));
vi.mock('./deepagent/shared-infra', () => ({
  getProvider: vi.fn(),
  normalizeProviderId: vi.fn((providerId: string | null | undefined) => providerId ?? null),
}));
import {
  GENERAL_SCENE_DEFAULT_PROMPT,
  RESEARCH_SCENE_DEFAULT_PROMPT,
  ensureMasterAgent,
} from './project-agent-service';
import {
  captureConversationSystemContextSnapshot,
  getOrCaptureConversationSystemContextSnapshot,
} from './conversation-system-context-snapshot';
import { buildCdfSkillsRuntimeAssembly } from './deepagent/runtime-assembly';

const cleanupPaths: string[] = [];
let previousBuiltInSkillsRoot: string | undefined;

function writeProjectSkill(projectPath: string, description: string): void {
  const skillDir = path.join(projectPath, '.cdf', 'skills', 'project-research-notes');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: project-research-notes\ndescription: ${description}\n---\n\n# Project Research Notes\n`,
    'utf-8',
  );
}

afterEach(() => {
  if (previousBuiltInSkillsRoot === undefined) {
    delete process.env.CDF_BUILT_IN_SKILLS_ROOT;
  } else {
    process.env.CDF_BUILT_IN_SKILLS_ROOT = previousBuiltInSkillsRoot;
  }
  previousBuiltInSkillsRoot = undefined;
  mockedStore.state.sceneSkillExposures = {};
  vi.clearAllMocks();
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe('Research Scene integration', () => {
  it('connects the Research Master workflow, built-in Skills, and frozen Conversation catalog', () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-research-scene-'));
    const databasePath = path.join(os.tmpdir(), `cdf-research-scene-${crypto.randomUUID()}.db`);
    const builtInSkillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-research-built-ins-'));
    cleanupPaths.push(projectPath, databasePath, builtInSkillsRoot);
    previousBuiltInSkillsRoot = process.env.CDF_BUILT_IN_SKILLS_ROOT;
    process.env.CDF_BUILT_IN_SKILLS_ROOT = builtInSkillsRoot;
    mockedStore.state.sceneSkillExposures = {};

    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, scene TEXT NOT NULL);
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT,
        description TEXT,
        provider_id TEXT,
        system_prompt TEXT,
        config TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        prompt_snapshot TEXT,
        skill_snapshot TEXT
      );
      INSERT INTO projects (id, scene) VALUES ('research-project', 'research'), ('general-project', 'general');
      INSERT INTO sessions (id, prompt_snapshot, skill_snapshot) VALUES
        ('research-conversation', NULL, NULL),
        ('next-research-conversation', NULL, NULL),
        ('project-skill-v1-conversation', NULL, NULL),
        ('project-skill-v2-conversation', NULL, NULL);
    `);

    const master = ensureMasterAgent(db, 'research-project', {
      createId: () => 'research-master',
      now: () => 1,
    });
    const researchConversation = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'research-conversation',
      projectPath,
      sceneId: 'research',
      promptSnapshot: master.system_prompt ?? '',
    });

    expect(researchConversation.promptSnapshot).toBe(RESEARCH_SCENE_DEFAULT_PROMPT);
    expect(researchConversation.promptSnapshot).toContain('when literature discovery is needed, use paper-search');
    expect(researchConversation.promptSnapshot).toContain('network or paper-search configuration is unavailable');
    expect(researchConversation.promptSnapshot).toContain('local Knowledge Base or Local Review Corpus');
    expect(researchConversation.promptSnapshot).toContain('disclose that limitation');
    expect(researchConversation.promptSnapshot).toContain('paper-collection');
    expect(researchConversation.promptSnapshot).toContain('Knowledge Base');
    expect(researchConversation.promptSnapshot).toContain('paper-reading');
    expect(researchConversation.promptSnapshot).toContain('computational experiments');
    expect(researchConversation.promptSnapshot).toContain('physical experiment');
    expect(researchConversation.promptSnapshot).toContain('Manuscript');
    expect(researchConversation.promptSnapshot).toContain('manuscript-review');
    expect(researchConversation.promptSnapshot).toContain('Summary');
    expect(researchConversation.promptSnapshot).toContain('Review Simulation');
    expect(researchConversation.promptSnapshot).toContain('academic-style-revision');
    expect(researchConversation.promptSnapshot).toContain('English');
    expect(researchConversation.promptSnapshot).toContain('directly');
    expect(researchConversation.promptSnapshot).toMatch(/do not delegate/i);
    expect(researchConversation.promptSnapshot).toContain('Paper Entry');
    expect(researchConversation.promptSnapshot).toContain('Structured Paper Parse');
    expect(researchConversation.promptSnapshot).toContain('untrusted evidence');
    expect(researchConversation.promptSnapshot).toMatch(/embedded commands/i);

    const assembledResearchRuntime = buildCdfSkillsRuntimeAssembly(projectPath, [], [], 'research').skillsRuntime;
    const researchWorkflowSkillNames = [
      'paper-search',
      'paper-collection',
      'paper-reading',
      'manuscript-review',
      'academic-style-revision',
    ];
    expect(assembledResearchRuntime.skills
      .filter((skill) => researchWorkflowSkillNames.includes(skill.name))
      .map((skill) => skill.name).sort()).toEqual([...researchWorkflowSkillNames].sort());

    const researchSkills = researchConversation.skillSnapshot.filter((skill) => skill.sourceKind === 'built-in');
    expect(researchSkills.map((skill) => skill.name)).toEqual(expect.arrayContaining([
      'paper-search',
      'paper-collection',
      'paper-reading',
      'manuscript-review',
      'academic-style-revision',
    ]));
    expect(researchSkills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'manuscript-review',
        qualifiedName: 'manuscript-review',
        sourceKind: 'built-in',
        modelDiscovery: 'full',
        userInvocable: true,
      }),
      expect.objectContaining({
        name: 'academic-style-revision',
        qualifiedName: 'academic-style-revision',
        sourceKind: 'built-in',
        modelDiscovery: 'full',
        userInvocable: true,
      }),
    ]));

    const generalSkills = captureConversationSystemContextSnapshot({
      projectPath,
      sceneId: 'general',
      promptSnapshot: GENERAL_SCENE_DEFAULT_PROMPT,
    }).skillSnapshot;
    expect(generalSkills.map((skill) => skill.name)).not.toContain('manuscript-review');
    expect(generalSkills.map((skill) => skill.name)).not.toContain('academic-style-revision');

    const manuscriptReview = researchSkills.find((skill) => skill.name === 'manuscript-review');
    const academicStyleRevision = researchSkills.find((skill) => skill.name === 'academic-style-revision');
    expect(manuscriptReview).toBeDefined();
    expect(academicStyleRevision).toBeDefined();
    const manuscriptReviewDir = path.dirname(manuscriptReview!.skillPath);
    const academicStyleRevisionDir = path.dirname(academicStyleRevision!.skillPath);
    const manuscriptReviewMarkdown = fs.readFileSync(manuscriptReview!.skillPath, 'utf-8');
    const academicStyleRevisionMarkdown = fs.readFileSync(academicStyleRevision!.skillPath, 'utf-8');

    expect(manuscriptReviewMarkdown).toContain('Manuscript Summary');
    expect(manuscriptReviewMarkdown).toContain('Review Simulation');
    expect(manuscriptReviewMarkdown).toContain('untrusted evidence');
    expect(manuscriptReviewMarkdown).toContain('.cdf/manuscript-reviews/');
    expect(fs.readFileSync(path.join(manuscriptReviewDir, 'PROVENANCE.md'), 'utf-8')).toContain('MIT');
    expect(fs.readFileSync(path.join(manuscriptReviewDir, 'LICENSES', 'K-Dense-AI-scientific-agent-skills-MIT.txt'), 'utf-8')).toContain('MIT License');
    expect(academicStyleRevisionMarkdown).toContain('only English');
    expect(academicStyleRevisionMarkdown).toContain('Fidelity Gate');
    expect(academicStyleRevisionMarkdown).toContain('untrusted evidence');
    expect(academicStyleRevisionMarkdown).toContain('.cdf/style-revisions/');
    expect(fs.readFileSync(path.join(academicStyleRevisionDir, 'PROVENANCE.md'), 'utf-8')).toContain('MIT');
    expect(fs.readFileSync(path.join(academicStyleRevisionDir, 'LICENSES', 'blader-humanizer-MIT.txt'), 'utf-8')).toContain('MIT License');

    writeProjectSkill(projectPath, 'Project Skill v1');
    const projectSkillV1Conversation = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'project-skill-v1-conversation',
      projectPath,
      sceneId: 'research',
      promptSnapshot: 'Project Skill v1 Master prompt',
    });
    writeProjectSkill(projectPath, 'Project Skill v2');
    const projectSkillV2Conversation = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'project-skill-v2-conversation',
      projectPath,
      sceneId: 'research',
      promptSnapshot: 'Project Skill v2 Master prompt',
    });
    const frozenProjectSkillV1Conversation = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'project-skill-v1-conversation',
      projectPath,
      sceneId: 'research',
      promptSnapshot: 'Changed Project Skill Master prompt',
    });

    expect(projectSkillV1Conversation.skillSnapshot.find((skill) => skill.name === 'project-research-notes')?.description).toBe('Project Skill v1');
    expect(projectSkillV2Conversation.skillSnapshot.find((skill) => skill.name === 'project-research-notes')?.description).toBe('Project Skill v2');
    expect(frozenProjectSkillV1Conversation).toEqual(projectSkillV1Conversation);

    const projectSkillV1Runtime = buildCdfSkillsRuntimeAssembly(
      projectPath,
      [],
      [],
      'research',
      projectSkillV1Conversation.skillSnapshot,
    ).skillsRuntime;
    const projectSkillV2Runtime = buildCdfSkillsRuntimeAssembly(
      projectPath,
      [],
      [],
      'research',
      projectSkillV2Conversation.skillSnapshot,
    ).skillsRuntime;
    expect(projectSkillV1Runtime.skills.find((skill) => skill.name === 'project-research-notes')?.description)
      .toBe('Project Skill v1');
    expect(projectSkillV2Runtime.skills.find((skill) => skill.name === 'project-research-notes')?.description)
      .toBe('Project Skill v2');

    mockedStore.state.sceneSkillExposures = {
      'built-in:manuscript-review': { research: false },
    };
    const laterConversation = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'next-research-conversation',
      projectPath,
      sceneId: 'research',
      promptSnapshot: 'Later Master prompt',
    });
    const frozenConversation = getOrCaptureConversationSystemContextSnapshot(db, {
      sessionId: 'research-conversation',
      projectPath,
      sceneId: 'research',
      promptSnapshot: 'Changed Master prompt',
    });

    expect(laterConversation.skillSnapshot.map((skill) => skill.name)).not.toContain('manuscript-review');
    expect(frozenConversation).toEqual(researchConversation);

    const frozenRuntime = buildCdfSkillsRuntimeAssembly(
      projectPath,
      [],
      [],
      'research',
      frozenConversation.skillSnapshot,
    ).skillsRuntime;
    const laterRuntime = buildCdfSkillsRuntimeAssembly(
      projectPath,
      [],
      [],
      'research',
      laterConversation.skillSnapshot,
    ).skillsRuntime;
    expect(frozenRuntime.skills.map((skill) => skill.name)).toContain('manuscript-review');
    expect(laterRuntime.skills.map((skill) => skill.name)).not.toContain('manuscript-review');
    db.close();
  });
});
