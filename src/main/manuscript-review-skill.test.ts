import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBuiltInSkillDirs } from './deepagent/skill-manager';
import { getManuscriptReviewSkillMarkdown, getManuscriptReviewSkillResources } from './manuscript-review-skill';

let builtInSkillsRoot: string;
let previousBuiltInSkillsRoot: string | undefined;

beforeEach(() => {
  builtInSkillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-manuscript-review-'));
  previousBuiltInSkillsRoot = process.env.CDF_BUILT_IN_SKILLS_ROOT;
  process.env.CDF_BUILT_IN_SKILLS_ROOT = builtInSkillsRoot;
});

afterEach(() => {
  if (previousBuiltInSkillsRoot === undefined) {
    delete process.env.CDF_BUILT_IN_SKILLS_ROOT;
  } else {
    process.env.CDF_BUILT_IN_SKILLS_ROOT = previousBuiltInSkillsRoot;
  }
  fs.rmSync(builtInSkillsRoot, { recursive: true, force: true });
});

describe('Manuscript Review Skill', () => {
  it('materializes a static, provenance-complete manuscript review package', () => {
    const markdown = getManuscriptReviewSkillMarkdown();
    const resources = getManuscriptReviewSkillResources();
    const skillDir = getBuiltInSkillDirs().find((dir) => dir.endsWith(`${path.sep}manuscript-review`));

    expect(markdown).toContain('name: manuscript-review');
    expect(markdown).toContain('Manuscript Summary');
    expect(markdown).toContain('Review Simulation');
    expect(markdown).toContain('explicitly specify one or more Manuscript files');
    expect(markdown).toContain('normalized manifest');
    expect(markdown).toContain('content hash');
    expect(markdown).toContain('generic cross-disciplinary criteria');
    expect(markdown).toContain('Conversation Review Context');
    expect(markdown).toContain('contribution');
    expect(markdown).toContain('methodological rigor');
    expect(markdown).toContain('experimental evidence');
    expect(markdown).toContain('writing and presentation');
    expect(markdown).toContain('related work and citations');
    expect(markdown).toContain('not a publication prediction or a real editorial decision');
    expect(markdown).toContain('Local Review Corpus');
    expect(markdown).toContain('untrusted evidence');
    expect(markdown).toContain('Full Manuscript Coverage');
    expect(markdown).toContain('.cdf/manuscript-reviews/');
    expect(markdown).toContain('excludes upstream schematic scripts, external APIs, OpenRouter');
    expect(markdown).not.toContain('OPENROUTER_API_KEY');
    expect(markdown).not.toContain('npm install');

    expect(resources.map((resource) => resource.relativePath)).toEqual(expect.arrayContaining([
      'PROVENANCE.md',
      'LICENSES/K-Dense-AI-scientific-agent-skills-MIT.txt',
      'references/reporting_standards.md',
      'references/common_issues.md',
    ]));
    expect(resources.find((resource) => resource.relativePath === 'PROVENANCE.md')?.content).toContain('fc0b9f692459ea7d9e5a5c64948a5878e1bce274');
    expect(resources.find((resource) => resource.relativePath === 'PROVENANCE.md')?.content).toContain('skills/peer-review/SKILL.md');
    expect(resources.find((resource) => resource.relativePath === 'PROVENANCE.md')?.content).toContain('schematic scripts');
    expect(resources.find((resource) => resource.relativePath === 'LICENSES/K-Dense-AI-scientific-agent-skills-MIT.txt')?.content).toContain('MIT License');
    expect(skillDir).toBeTruthy();
    expect(fs.readFileSync(path.join(skillDir as string, 'SKILL.md'), 'utf-8')).toBe(markdown);
    expect(fs.existsSync(path.join(skillDir as string, 'scripts'))).toBe(false);
    expect(fs.readFileSync(path.join(skillDir as string, 'PROVENANCE.md'), 'utf-8')).toContain('Included');
  });

  it('publishes the summary, simulation, evidence, coverage, and report contracts without executable resources', () => {
    const markdown = getManuscriptReviewSkillMarkdown();
    const resources = getManuscriptReviewSkillResources();
    const venueGuidance = resources.find((resource) => resource.relativePath === 'references/venue-category-guidance.md');

    expect(markdown).toContain('Do not evaluate publication suitability');
    expect(markdown).toContain('Do not perform live literature search');
    expect(markdown).toContain('PDF Parsing Skill');
    expect(markdown).toContain('Never choose `reject` solely because the Local Review Corpus is empty');
    expect(markdown).toContain('file path, line range, and section');
    expect(markdown).toContain('page number and section');
    expect(markdown).toContain('failed, skipped, unsupported, unreadable, or truncated');
    expect(markdown).toContain('safely append that one rule');
    expect(markdown).toContain('A Manuscript Summary report must not contain a Simulated Editorial Recommendation');
    expect(venueGuidance?.content).toContain('Version:');
    expect(venueGuidance?.content).toMatch(/conference/i);
    expect(venueGuidance?.content).toMatch(/journal/i);
    expect(resources.some((resource) => resource.relativePath.endsWith('.js') || resource.relativePath.endsWith('.py'))).toBe(false);
  });
});
