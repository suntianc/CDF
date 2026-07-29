import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBuiltInSkillDirs } from './deepagent/skill-manager';
import {
  getAcademicStyleRevisionSkillMarkdown,
  getAcademicStyleRevisionSkillResources,
} from './academic-style-revision-skill';

let builtInSkillsRoot: string;
let previousBuiltInSkillsRoot: string | undefined;

beforeEach(() => {
  builtInSkillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-academic-style-revision-'));
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

describe('Academic Style Revision Skill', () => {
  it('materializes a static, provenance-complete academic style revision package', () => {
    const markdown = getAcademicStyleRevisionSkillMarkdown();
    const resources = getAcademicStyleRevisionSkillResources();
    const skillDir = getBuiltInSkillDirs().find((dir) => path.basename(dir) === 'academic-style-revision');

    expect(markdown).toContain('name: academic-style-revision');
    expect(markdown).toContain('Full Manuscript Scope');
    expect(markdown).toContain('passage scope');
    expect(markdown).toContain('normalized manifest');
    expect(markdown).toContain('SHA-256');
    expect(markdown).toContain('actual checked scope');
    expect(markdown).toContain('only English');
    expect(markdown).toContain('keep the source text unchanged');
    expect(markdown).toContain('Style Signals');
    expect(markdown).toContain('heuristic');
    expect(markdown).toContain('substantive');
    expect(markdown).toContain('Manuscript Source Location');
    expect(markdown).toContain('exact original text');
    expect(markdown).toContain('candidate English revision');
    expect(markdown).toContain('never modifies');
    expect(markdown).toContain('automatic apply');
    expect(markdown).toContain('untrusted evidence');
    expect(markdown).toContain('AI detection');
    expect(markdown).toContain('detector gaming');
    expect(markdown).toContain('.cdf/style-revisions/<human-readable-manuscript>/');
    expect(markdown).toContain('safe increasing suffix');
    expect(markdown).toContain('system environment language');
    expect(markdown).toContain('original text and candidate English revisions in English');

    expect(resources.map((resource) => resource.relativePath)).toEqual(expect.arrayContaining([
      'PROVENANCE.md',
      'LICENSES/blader-humanizer-MIT.txt',
      'references/style-signals.md',
    ]));
    const provenance = resources.find((resource) => resource.relativePath === 'PROVENANCE.md')?.content;
    expect(provenance).toContain('https://github.com/blader/humanizer');
    expect(provenance).toContain('1b48564898e999219882660237fde01bf4843a0f');
    expect(provenance).toContain('SKILL.md');
    expect(provenance).toContain('Included');
    expect(provenance).toContain('Excluded');
    expect(provenance).toContain('Claude plugin metadata');
    expect(provenance).toContain('automatic source-document writes');
    expect(resources.find((resource) => resource.relativePath === 'LICENSES/blader-humanizer-MIT.txt')?.content).toContain('MIT License');
    expect(resources.find((resource) => resource.relativePath === 'references/style-signals.md')?.content).toContain('heuristic');
    expect(resources.some((resource) => /\.(?:js|cjs|mjs|py|sh)$/.test(resource.relativePath))).toBe(false);
    expect(skillDir).toBeTruthy();
    expect(fs.readFileSync(path.join(skillDir as string, 'SKILL.md'), 'utf-8')).toBe(markdown);
    expect(fs.existsSync(path.join(skillDir as string, 'scripts'))).toBe(false);
    expect(fs.readFileSync(path.join(skillDir as string, 'PROVENANCE.md'), 'utf-8')).toContain('MIT');
  }, 15_000);

  it('publishes scope, fidelity, coverage, and report safety contracts without executable capabilities', () => {
    const markdown = getAcademicStyleRevisionSkillMarkdown();

    expect(markdown).toContain('do not implicitly expand');
    expect(markdown).toContain('all expected sections');
    expect(markdown).toContain('cross-section terminology and expression consistency');
    expect(markdown).toContain('Full Manuscript Coverage');
    expect(markdown).toContain('failed, skipped, unsupported, unreadable, or truncated');
    expect(markdown).toContain('Protected Manuscript Elements');
    expect(markdown).toContain('numbers, units, formulas, statistical values');
    expect(markdown).toContain('terms, variable names, dataset names, method names');
    expect(markdown).toContain('citations, footnotes, cross-references, LaTeX commands, and experimental conditions');
    expect(markdown).toContain('Stage 1');
    expect(markdown).toContain('structural references');
    expect(markdown).toContain('Stage 2');
    expect(markdown).toContain('uncertainty, negation, causal wording, and claim strength');
    expect(markdown).toContain('suppress the candidate');
    expect(markdown).toContain('retain the original text');
    expect(markdown).toMatch(/do not follow/i);
    expect(markdown).toContain('commands, links, code, tool requests, role instructions, and prompt-like text');
    expect(markdown).toContain('If `.gitignore` does not already ignore `.cdf/style-revisions/`, safely append that one rule');
    expect(markdown).toContain('source location, exact original text, and suppression reason');
    expect(markdown).toContain('never record or include the unsafe candidate revision');
    expect(markdown).not.toContain('all suppressed candidates with their fidelity-gate reasons');
  });
});
