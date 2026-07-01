import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSkillMetadata } from './skill-metadata';

describe('parseSkillMetadata', () => {
  const tempRoot = path.join(os.tmpdir(), `cdf-skill-metadata-test-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('parses valid YAML skill metadata with typed optional fields', () => {
    const skillDir = path.join(tempRoot, 'metadata-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: metadata-skill',
        'description: A skill with metadata',
        'disable-model-invocation: true',
        'user-invocable: false',
        'allowed-tools:',
        '  - read_file',
        '  - grep',
        'when_to_use: Use for metadata tests',
        'license: MIT',
        'compatibility: Node >=22',
        'metadata:',
        '  owner: cdf',
        'module: ./main.js',
        '---',
        '',
        '# Metadata Skill',
      ].join('\n'),
      'utf-8'
    );

    const result = parseSkillMetadata(skillDir);

    expect(result.errors).toEqual([]);
    expect(result.metadata).toMatchObject({
      name: 'metadata-skill',
      description: 'A skill with metadata',
      disableModelInvocation: true,
      userInvocable: false,
      allowedTools: ['read_file', 'grep'],
      whenToUse: 'Use for metadata tests',
      license: 'MIT',
      compatibility: 'Node >=22',
      metadata: {
        owner: 'cdf',
      },
      module: './main.js',
    });
  });

  it('rejects skill names that violate Agent Skills naming rules', () => {
    const invalidNames = [
      'Uppercase',
      'has_underscore',
      '-leading-hyphen',
      'trailing-hyphen-',
      'double--hyphen',
      'a'.repeat(65),
    ];

    for (const skillName of invalidNames) {
      const skillDir = path.join(tempRoot, skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          `name: ${skillName}`,
          'description: Invalid name test',
          '---',
          '',
          '# Invalid Skill',
        ].join('\n'),
        'utf-8'
      );

      const result = parseSkillMetadata(skillDir);

      expect(result.metadata).toBeUndefined();
      expect(result.errors.join('\n')).toContain('Skill 名称');
    }
  });

  it('rejects root skills whose name does not match the containing directory', () => {
    const skillDir = path.join(tempRoot, 'directory-name');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: frontmatter-name',
        'description: Directory mismatch test',
        '---',
        '',
        '# Directory Mismatch',
      ].join('\n'),
      'utf-8'
    );

    const result = parseSkillMetadata(skillDir);

    expect(result.metadata).toBeUndefined();
    expect(result.errors.join('\n')).toContain('目录名');
    expect(result.errors.join('\n')).toContain('directory-name');
    expect(result.errors.join('\n')).toContain('frontmatter-name');
  });

  it('truncates descriptions longer than the DeepAgents metadata limit with a warning', () => {
    const skillDir = path.join(tempRoot, 'long-description');
    const longDescription = 'x'.repeat(1100);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: long-description',
        `description: ${longDescription}`,
        '---',
        '',
        '# Long Description',
      ].join('\n'),
      'utf-8'
    );

    const result = parseSkillMetadata(skillDir);

    expect(result.errors).toEqual([]);
    expect(result.metadata?.description).toHaveLength(1024);
    expect(result.warnings.join('\n')).toContain('description');
  });

  it('ignores unsafe module paths with a warning', () => {
    const skillDir = path.join(tempRoot, 'unsafe-module');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: unsafe-module',
        'description: Unsafe module test',
        'module: ../outside.js',
        '---',
        '',
        '# Unsafe Module',
      ].join('\n'),
      'utf-8'
    );

    const result = parseSkillMetadata(skillDir);

    expect(result.errors).toEqual([]);
    expect(result.metadata?.module).toBeUndefined();
    expect(result.warnings.join('\n')).toContain('module');
  });
});
