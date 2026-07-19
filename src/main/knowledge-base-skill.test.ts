import { describe, expect, it } from 'vitest';
import {
  getKnowledgeBaseAgentsBlock,
  getKnowledgeBaseSkillMarkdown,
} from './knowledge-base-skill';

describe('Knowledge Base Skill', () => {
  it('describes the Skill-driven Knowledge Base workflow', () => {
    const markdown = getKnowledgeBaseSkillMarkdown();

    expect(markdown).toContain('knowledge-base');
    expect(markdown).toContain('knowledge_create');
    expect(markdown).toContain('knowledge_search');
    expect(markdown).toContain('.cdf/knowledge');
    expect(markdown).toContain('AGENTS.md');
    expect(markdown).toContain('Do not report that the Knowledge Base is enabled until `AGENTS.md` contains the managed block.');
    expect(markdown).toContain('write and verify the `AGENTS.md` managed block first');
    expect(markdown).toContain('OKF `type`');
    expect(markdown).toContain('timestamp');
    expect(markdown).toContain('For Paper entries, `source` and `authors` are CDF-managed OKF metadata');
    expect(markdown).toContain('Do not invent `source.type: agent`');
    expect(markdown).not.toContain('`source` is not part of the CDF-managed OKF metadata');
    expect(markdown).not.toContain('Defaults to { type: "agent" }');
    expect(markdown).toContain('<!-- CDF:knowledge-base:start -->');
    expect(markdown).toContain('<!-- CDF:knowledge-base:end -->');
  });

  it('keeps the AGENTS.md managed block to a concise Skill trigger note', () => {
    const block = getKnowledgeBaseAgentsBlock();

    expect(block).toContain('<!-- CDF:knowledge-base:start -->');
    expect(block).toContain('<!-- CDF:knowledge-base:end -->');
    expect(block).toContain('使用 Knowledge Base Skill');
    expect(block).toContain('.cdf/knowledge');
    expect(block).not.toContain('knowledge_create');
    expect(block).not.toContain('created_at');
    expect(block).not.toContain('updated_at');
  });
});
