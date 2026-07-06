import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getScopePath,
  importPhysicalSkillDirectory,
  listPhysicalSkills,
  listResolvedSkillViews,
  materializePaperSearchRuntime,
  materializePdfParsingSkillRuntime,
  resolveAgentSkillConfigOptions,
  resolveAgentSkillsConfig,
  savePhysicalSkill,
} from './skill-manager';
import { parseSkillMetadata } from './skills-runtime/skill-metadata';

describe('skill-manager', () => {
  const tempProjectPath = path.join(os.tmpdir(), `cdf-skill-test-${Math.random().toString(36).slice(2)}`);
  const tempHomePath = path.join(os.tmpdir(), `cdf-skill-home-${Math.random().toString(36).slice(2)}`);
  let previousBuiltInSkillsRoot: string | undefined;

  beforeEach(() => {
    previousBuiltInSkillsRoot = process.env.CDF_BUILT_IN_SKILLS_ROOT;
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.rmSync(tempHomePath, { recursive: true, force: true });
    fs.mkdirSync(tempHomePath, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(tempHomePath);
    fs.mkdirSync(tempProjectPath, { recursive: true });
    process.env.CDF_BUILT_IN_SKILLS_ROOT = path.join(tempHomePath, 'built-in-skills');
  });

  afterEach(() => {
    if (previousBuiltInSkillsRoot === undefined) {
      delete process.env.CDF_BUILT_IN_SKILLS_ROOT;
    } else {
      process.env.CDF_BUILT_IN_SKILLS_ROOT = previousBuiltInSkillsRoot;
    }
    vi.restoreAllMocks();
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.rmSync(tempHomePath, { recursive: true, force: true });
  });

  it('should resolve .cdf skill scope paths', () => {
    expect(getScopePath(tempProjectPath, 'global')).toBe(path.join(os.homedir(), '.cdf', 'skills'));
    expect(getScopePath(tempProjectPath, 'project')).toBe(path.join(tempProjectPath, '.cdf', 'skills'));
  });

  it('materializes the compiled PDF Parsing Skill CLI with its runtime chunks', () => {
    const compiledDir = path.join(tempProjectPath, 'out', 'main');
    const chunksDir = path.join(compiledDir, 'chunks');
    fs.mkdirSync(chunksDir, { recursive: true });
    const compiledCliPath = path.join(compiledDir, 'pdf-parsing-skill-cli.js');
    fs.writeFileSync(
      compiledCliPath,
      "const chunk = require('./chunks/pdf-parsing-skill-test.js');\nprocess.stdout.write(chunk.value);\n",
      'utf-8',
    );
    fs.writeFileSync(
      path.join(chunksDir, 'pdf-parsing-skill-test.js'),
      "exports.value = 'chunk-loaded';\n",
      'utf-8',
    );

    const materializedCliPath = materializePdfParsingSkillRuntime(
      compiledCliPath,
      path.join(tempProjectPath, 'built-in-skill'),
    );

    expect(materializedCliPath).toBe(path.join(tempProjectPath, 'built-in-skill', 'runtime', 'pdf-parsing-skill-cli.js'));
    expect(fs.existsSync(path.join(tempProjectPath, 'built-in-skill', 'runtime', 'chunks', 'pdf-parsing-skill-test.js'))).toBe(true);
    expect(execFileSync(process.execPath, [materializedCliPath], { encoding: 'utf-8' })).toBe('chunk-loaded');
  });

  it('materializes the bundled Paper Search CLI with package metadata', () => {
    const compiledDir = path.join(tempProjectPath, 'out', 'main');
    fs.mkdirSync(compiledDir, { recursive: true });
    const compiledCliPath = path.join(compiledDir, 'paper-search-cli.cjs');
    const compiledPackagePath = path.join(compiledDir, 'paper-search-cli.package.json');
    fs.writeFileSync(
      compiledCliPath,
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));",
        "process.stdout.write(pkg.version);",
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(compiledPackagePath, '{"version":"0.3.4"}\n', 'utf-8');

    const materializedCliPath = materializePaperSearchRuntime(
      compiledCliPath,
      compiledPackagePath,
      path.join(tempProjectPath, 'built-in-paper-skill'),
    );

    expect(materializedCliPath).toBe(path.join(tempProjectPath, 'built-in-paper-skill', 'runtime', 'paper-search.cjs'));
    expect(fs.readFileSync(path.join(tempProjectPath, 'built-in-paper-skill', 'package.json'), 'utf-8')).toContain('"version":"0.3.4"');
    expect(execFileSync(process.execPath, [materializedCliPath], { encoding: 'utf-8' })).toBe('0.3.4');
  });

  it('should save and list physical skill bundles', () => {
    savePhysicalSkill(tempProjectPath, 'project', {
      name: 'test-js-skill',
      description: 'A JS skill',
      script_type: 'javascript',
      script_content: 'console.log("hello");',
    });

    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'test-js-skill');
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'main.js'))).toBe(true);

    const skills = listPhysicalSkills(tempProjectPath);
    const saved = skills.find((skill) => skill.id === 'project:test-js-skill');
    expect(saved).toMatchObject({
      id: 'project:test-js-skill',
      name: 'test-js-skill',
      scope: 'project',
      script_type: 'javascript',
      entryScript: 'main.js',
    });
    expect(saved?.script_content).toBe('console.log("hello");');
  });

  it('writes created skill metadata as valid YAML for descriptions with colon-space text', () => {
    const description = 'Use when: deployment requires review';

    savePhysicalSkill(tempProjectPath, 'project', {
      name: 'colon-description',
      description,
    });

    const result = parseSkillMetadata(
      path.join(tempProjectPath, '.cdf', 'skills', 'colon-description')
    );

    expect(result.errors).toEqual([]);
    expect(result.metadata?.description).toBe(description);
  });

  it('rejects creating a skill without required description metadata', () => {
    expect(() =>
      savePhysicalSkill(tempProjectPath, 'project', {
        name: 'missing-description',
      })
    ).toThrow('Skill 描述不能为空');

    expect(
      fs.existsSync(path.join(tempProjectPath, '.cdf', 'skills', 'missing-description'))
    ).toBe(false);
  });

  it('rejects creating a skill with an invalid metadata name', () => {
    expect(() =>
      savePhysicalSkill(tempProjectPath, 'project', {
        name: 'Bad_Name',
        description: 'Invalid name',
      })
    ).toThrow('Skill 名称');

    expect(
      fs.existsSync(path.join(tempProjectPath, '.cdf', 'skills', 'Bad_Name'))
    ).toBe(false);
  });

  it('rejects importing a skill with invalid required metadata', () => {
    const sourceDir = path.join(tempProjectPath, 'import-source', 'missing-description');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      [
        '---',
        'name: missing-description',
        '---',
        '',
        '# Missing Description',
      ].join('\n'),
      'utf-8'
    );

    expect(() => importPhysicalSkillDirectory(sourceDir)).toThrow('description 不能为空');

    expect(
      fs.existsSync(path.join(tempHomePath, '.cdf', 'skills', 'missing-description'))
    ).toBe(false);
  });

  it('rejects importing a skill without required name metadata', () => {
    const sourceDir = path.join(tempProjectPath, 'import-source', 'missing-name');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      [
        '---',
        'description: Missing name',
        '---',
        '',
        '# Missing Name',
      ].join('\n'),
      'utf-8'
    );

    expect(() => importPhysicalSkillDirectory(sourceDir)).toThrow('name 不能为空');

    expect(
      fs.existsSync(path.join(tempHomePath, '.cdf', 'skills', 'missing-name'))
    ).toBe(false);
  });

  it('imports a valid skill without rewriting its SKILL.md body', () => {
    const sourceDir = path.join(tempProjectPath, 'import-source', 'portable-review');
    fs.mkdirSync(sourceDir, { recursive: true });
    const skillBody = [
      '---',
      'name: portable-review',
      'description: Portable review',
      'allowed-tools:',
      '  - read_file',
      'disable-model-invocation: true',
      '---',
      '',
      '# Portable Review',
      '',
      'Keep this body exactly as imported.',
    ].join('\n');
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), skillBody, 'utf-8');

    const imported = importPhysicalSkillDirectory(sourceDir);

    expect(imported).toMatchObject({
      id: 'global:portable-review',
      name: 'portable-review',
      scope: 'global',
    });
    expect(
      fs.readFileSync(path.join(tempHomePath, '.cdf', 'skills', 'portable-review', 'SKILL.md'), 'utf-8')
    ).toBe(skillBody);
  });

  it('resolves user and agent skill override options from local store and agent config', () => {
    const agentConfig = JSON.stringify({
      skillOverrides: {
        'agent-hidden': 'off',
      },
    });

    const result = resolveAgentSkillConfigOptions(agentConfig, (key) => {
      if (key === 'skillOverrides') {
        return {
          'user-hidden': 'user-invocable-only',
          broken: 'never',
        };
      }
      return undefined;
    });

    expect(result.options).toEqual({
      userOverrides: {
        'user-hidden': 'user-invocable-only',
      },
      agentOverrides: {
        'agent-hidden': 'off',
      },
    });
    expect(result.warnings.join('\n')).toContain('broken');
  });

  it('should include project skills in the runtime source plan', () => {
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills'), { recursive: true });

    const config = resolveAgentSkillsConfig(tempProjectPath);
    expect(config.skillsSources).toContain(path.join(tempProjectPath, '.cdf', 'skills'));
  });

  it('should always load all project skills regardless of enabled list', () => {
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills', 'enabled-skill'), { recursive: true });
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills', 'disabled-skill'), { recursive: true });

    const config = resolveAgentSkillsConfig(tempProjectPath, ['project:enabled-skill']);
    // Project skills remain discoverable even when an Agent has preload Skill ids.
    expect(config.skillsSources).toContain(path.join(tempProjectPath, '.cdf', 'skills'));
  });

  it('should load global skills by default even when an agent has preload skill ids', () => {
    const globalSkillsDir = getScopePath(tempProjectPath, 'global');
    fs.mkdirSync(path.join(globalSkillsDir, 'preloaded-skill'), { recursive: true });
    fs.mkdirSync(path.join(globalSkillsDir, 'discoverable-skill'), { recursive: true });

    const config = resolveAgentSkillsConfig(tempProjectPath, ['global:preloaded-skill']);

    expect(config.skillsSources).toContain(globalSkillsDir);
    expect(config.skillsSources).not.toEqual(
      expect.arrayContaining([
        path.join(globalSkillsDir, 'preloaded-skill'),
      ])
    );
  });

  it('should not grant host filesystem-wide permissions', () => {
    const config = resolveAgentSkillsConfig(tempProjectPath);
    const paths = config.permissions.flatMap((permission) => permission.paths);

    expect(paths).not.toContain('/**');
    expect(paths).toContain(path.join(tempProjectPath, '*'));
    expect(paths).toContain(path.join(tempProjectPath, '**', '*'));
  });

  it('loads the built-in Knowledge Base Skill without writing to the user global skills directory', () => {
    const config = resolveAgentSkillsConfig(tempProjectPath);
    const knowledgeBaseSource = config.skillsSources.find((source) => source.includes('knowledge-base'));

    expect(knowledgeBaseSource).toBeTruthy();
    expect(knowledgeBaseSource?.startsWith(path.join(os.homedir(), '.cdf', 'skills'))).toBe(false);
  });

  it('loads the built-in Crawler Skill without writing to the user global skills directory', () => {
    const config = resolveAgentSkillsConfig(tempProjectPath);
    const crawlerSource = config.skillsSources.find((source) => source.includes('crawler'));

    expect(crawlerSource).toBeTruthy();
    expect(crawlerSource?.startsWith(path.join(os.homedir(), '.cdf', 'skills'))).toBe(false);
  });

  it('loads the built-in Paper Search and Paper Collection Skills with their bundled CLI runtime', () => {
    const compiledDir = path.join(tempProjectPath, 'compiled-paper-search');
    fs.mkdirSync(compiledDir, { recursive: true });
    const compiledCliPath = path.join(compiledDir, 'paper-search-cli.cjs');
    const compiledPackagePath = path.join(compiledDir, 'paper-search-cli.package.json');
    fs.writeFileSync(compiledCliPath, "process.stdout.write('paper-search-runtime');\n", 'utf-8');
    fs.writeFileSync(compiledPackagePath, '{"version":"0.3.4"}\n', 'utf-8');
    const builtInSkillsRoot = path.join(tempProjectPath, 'isolated-built-in-skills');
    const previousCliPath = process.env.CDF_PAPER_SEARCH_CLI_PATH;
    const previousPackagePath = process.env.CDF_PAPER_SEARCH_PACKAGE_PATH;
    const previousTestBuiltInSkillsRoot = process.env.CDF_BUILT_IN_SKILLS_ROOT;

    try {
      process.env.CDF_PAPER_SEARCH_CLI_PATH = compiledCliPath;
      process.env.CDF_PAPER_SEARCH_PACKAGE_PATH = compiledPackagePath;
      process.env.CDF_BUILT_IN_SKILLS_ROOT = builtInSkillsRoot;

      const config = resolveAgentSkillsConfig(tempProjectPath);
      const paperSearchSource = config.skillsSources.find((source) => source.includes('paper-search'));
      const paperCollectionSource = config.skillsSources.find((source) => source.includes('paper-collection'));

      expect(paperSearchSource).toBeTruthy();
      expect(paperSearchSource?.startsWith(builtInSkillsRoot)).toBe(true);
      expect(paperSearchSource?.startsWith(path.join(os.homedir(), '.cdf', 'skills'))).toBe(false);
      expect(fs.existsSync(path.join(paperSearchSource as string, 'runtime', 'paper-search.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(paperSearchSource as string, 'package.json'))).toBe(true);
      expect(fs.readFileSync(path.join(paperSearchSource as string, 'SKILL.md'), 'utf-8')).toContain('Paper Search Skill');
      expect(paperCollectionSource).toBeTruthy();
      expect(paperCollectionSource?.startsWith(builtInSkillsRoot)).toBe(true);
      expect(paperCollectionSource?.startsWith(path.join(os.homedir(), '.cdf', 'skills'))).toBe(false);
      expect(fs.existsSync(path.join(paperCollectionSource as string, 'runtime', 'paper-search.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(paperCollectionSource as string, 'package.json'))).toBe(true);
      expect(fs.readFileSync(path.join(paperCollectionSource as string, 'SKILL.md'), 'utf-8')).toContain('Paper Collection Skill');
    } finally {
      if (previousCliPath === undefined) {
        delete process.env.CDF_PAPER_SEARCH_CLI_PATH;
      } else {
        process.env.CDF_PAPER_SEARCH_CLI_PATH = previousCliPath;
      }
      if (previousPackagePath === undefined) {
        delete process.env.CDF_PAPER_SEARCH_PACKAGE_PATH;
      } else {
        process.env.CDF_PAPER_SEARCH_PACKAGE_PATH = previousPackagePath;
      }
      if (previousTestBuiltInSkillsRoot === undefined) {
        delete process.env.CDF_BUILT_IN_SKILLS_ROOT;
      } else {
        process.env.CDF_BUILT_IN_SKILLS_ROOT = previousTestBuiltInSkillsRoot;
      }
    }
  });

  it('grants read-only permissions for model-discoverable Skill sources outside the project', () => {
    const globalSkillsDir = getScopePath(tempProjectPath, 'global');
    savePhysicalSkill(tempProjectPath, 'global', {
      name: 'global-review',
      description: 'Global review workflow',
    });

    const config = resolveAgentSkillsConfig(tempProjectPath);
    const readOnlyPaths = config.permissions
      .filter((permission) => permission.operations.length === 1 && permission.operations[0] === 'read')
      .flatMap((permission) => permission.paths);

    expect(readOnlyPaths).toContain(path.join(globalSkillsDir, '*'));
    expect(readOnlyPaths).toContain(path.join(globalSkillsDir, '**', '*'));
    expect(readOnlyPaths.some((permissionPath) => permissionPath.includes('knowledge-base'))).toBe(true);
  });

  // ===== 08.2 P4 D-09: disable-model-invocation + whenToUse enforcement =====

  it('resolveAgentSkillsConfig: skills with disable-model-invocation: true are filtered out (D-09)', () => {
    // Create two skills in project .cdf/skills: one disabled, one enabled
    const skillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'enabled-skill'), { recursive: true });
    fs.mkdirSync(path.join(skillsDir, 'secret-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'enabled-skill', 'SKILL.md'),
      '---\nname: enabled-skill\ndescription: A normal skill\n---\n'
    );
    fs.writeFileSync(
      path.join(skillsDir, 'secret-skill', 'SKILL.md'),
      '---\nname: secret-skill\ndescription: A secret skill\ndisable-model-invocation: true\n---\n'
    );

    const config = resolveAgentSkillsConfig(tempProjectPath);
    const enabledPath = path.join(skillsDir, 'enabled-skill');
    const secretPath = path.join(skillsDir, 'secret-skill');

    expect(config.skillsSources).toContain(enabledPath);
    expect(config.skillsSources).not.toContain(secretPath);
  });

  it('resolveAgentSkillsConfig: project override off filters a skill from model sources', () => {
    const skillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'visible-skill'), { recursive: true });
    fs.mkdirSync(path.join(skillsDir, 'hidden-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({
        version: 1,
        overrides: {
          'hidden-skill': 'off',
        },
        additionalSkillDirectories: [],
      }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(skillsDir, 'visible-skill', 'SKILL.md'),
      '---\nname: visible-skill\ndescription: Visible skill\n---\n'
    );
    fs.writeFileSync(
      path.join(skillsDir, 'hidden-skill', 'SKILL.md'),
      '---\nname: hidden-skill\ndescription: Hidden skill\n---\n'
    );

    const config = resolveAgentSkillsConfig(tempProjectPath);

    expect(config.skillsSources).toContain(path.join(skillsDir, 'visible-skill'));
    expect(config.skillsSources).not.toContain(path.join(skillsDir, 'hidden-skill'));
    expect(config.skillsSources).not.toContain(skillsDir);
  });

  it('resolveAgentSkillsConfig: user override off filters a global skill from model sources', () => {
    const globalSkillsDir = getScopePath(tempProjectPath, 'global');
    fs.mkdirSync(path.join(globalSkillsDir, 'global-visible'), { recursive: true });
    fs.mkdirSync(path.join(globalSkillsDir, 'global-hidden'), { recursive: true });
    fs.writeFileSync(
      path.join(globalSkillsDir, 'global-visible', 'SKILL.md'),
      '---\nname: global-visible\ndescription: Visible global skill\n---\n'
    );
    fs.writeFileSync(
      path.join(globalSkillsDir, 'global-hidden', 'SKILL.md'),
      '---\nname: global-hidden\ndescription: Hidden global skill\n---\n'
    );

    const config = resolveAgentSkillsConfig(tempProjectPath, [], {
      userOverrides: {
        'global-hidden': 'off',
      },
    });

    expect(config.skillsSources).toContain(path.join(globalSkillsDir, 'global-visible'));
    expect(config.skillsSources).not.toContain(path.join(globalSkillsDir, 'global-hidden'));
    expect(config.skillsSources).not.toContain(globalSkillsDir);
  });

  it('resolveAgentSkillsConfig: skills with disable-model-invocation absent or false are kept (D-10 default)', () => {
    const skillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'no-frontmatter-skill'), { recursive: true });
    fs.mkdirSync(path.join(skillsDir, 'explicitly-enabled-skill'), { recursive: true });
    // No frontmatter at all — D-10 default: not disabled
    fs.writeFileSync(
      path.join(skillsDir, 'no-frontmatter-skill', 'SKILL.md'),
      '# Just a body, no frontmatter'
    );
    // Explicit disable-model-invocation: false
    fs.writeFileSync(
      path.join(skillsDir, 'explicitly-enabled-skill', 'SKILL.md'),
      '---\nname: explicitly-enabled-skill\ndescription: ok\ndisable-model-invocation: false\n---\n'
    );

    const config = resolveAgentSkillsConfig(tempProjectPath);
    // When no skill is disabled, the parent skills dir is kept (no expansion).
    expect(config.skillsSources).toContain(skillsDir);
  });

  it('listPhysicalSkills: whenToUse is appended to description in the returned view', () => {
    const skillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'hinted-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'hinted-skill', 'SKILL.md'),
      '---\nname: hinted-skill\ndescription: A skill with a hint\nwhen_to_use: 当用户提到 cookie 时调用\n---\n'
    );

    const skills = listPhysicalSkills(tempProjectPath);
    const hinted = skills.find((s) => s.name === 'hinted-skill');
    expect(hinted).toBeTruthy();
    expect(hinted?.description).toContain('A skill with a hint');
    expect(hinted?.description).toContain('何时使用：当用户提到 cookie 时调用');
    expect(hinted?.frontmatter?.whenToUse).toBe('当用户提到 cookie 时调用');
  });

  it('listPhysicalSkills: parses YAML arrays and booleans through shared skill metadata', () => {
    const skillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'typed-metadata'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'typed-metadata', 'SKILL.md'),
      [
        '---',
        'name: typed-metadata',
        'description: Typed metadata',
        'disable-model-invocation: true',
        'user-invocable: false',
        'allowed-tools:',
        '  - read_file',
        '  - grep',
        'when_to_use: 当用户需要 typed metadata 时调用',
        '---',
        '',
        '# Typed Metadata',
      ].join('\n'),
      'utf-8'
    );

    const skills = listPhysicalSkills(tempProjectPath);
    const typed = skills.find((s) => s.name === 'typed-metadata');

    expect(typed?.frontmatter).toMatchObject({
      disableModelInvocation: true,
      userInvocable: false,
      allowedTools: ['read_file', 'grep'],
      whenToUse: '当用户需要 typed metadata 时调用',
    });
  });

  it('listResolvedSkillViews: returns project additional skills with qualified names and source labels', () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const docsSkillsDir = path.join(tempProjectPath, 'docs', 'skills');
    fs.mkdirSync(projectSkillsDir, { recursive: true });
    fs.mkdirSync(docsSkillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({
        version: 1,
        overrides: {},
        additionalSkillDirectories: ['docs/skills'],
      }),
      'utf-8'
    );
    fs.mkdirSync(path.join(projectSkillsDir, 'review'), { recursive: true });
    fs.writeFileSync(
      path.join(projectSkillsDir, 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Root review\n---\n'
    );
    fs.mkdirSync(path.join(docsSkillsDir, 'review'), { recursive: true });
    fs.writeFileSync(
      path.join(docsSkillsDir, 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Docs review\n---\n'
    );

    const skills = listResolvedSkillViews(tempProjectPath, {
      builtInSkillDirs: [],
      userSkillsDir: null,
    });

    expect(skills).toEqual([
      expect.objectContaining({
        id: 'project:review',
        name: 'review',
        qualifiedName: 'review',
        sourceKind: 'project',
        sourceLabel: 'Project Skill',
        skillVisibility: 'on',
      }),
      expect.objectContaining({
        id: 'project-additional:docs:review',
        name: 'review',
        qualifiedName: 'docs:review',
        sourceKind: 'project-additional',
        sourceLabel: 'Project Skill: docs',
        skillVisibility: 'on',
      }),
    ]);
  });
});
