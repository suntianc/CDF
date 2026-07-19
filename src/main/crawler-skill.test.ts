import { describe, expect, it } from 'vitest';
import { getCrawlerSkillMarkdown } from './crawler-skill';

describe('Crawler Skill', () => {
  it('describes a strategy-only crawling workflow over the Obscura Browser Tool', () => {
    const markdown = getCrawlerSkillMarkdown();

    expect(markdown).toContain('name: crawler');
    expect(markdown).toContain('description: Guide structured crawling with the Obscura Browser Tool.');
    expect(markdown).toContain('when_to_use: Use when the user needs structured web crawling');
    expect(markdown).toContain('obscura_browse');
    expect(markdown).toContain('format: "links"');
    expect(markdown).toContain('format: "cookies"');
    expect(markdown).toContain('format: "assets"');
    expect(markdown).toContain('format: "original"');
    expect(markdown).toContain('Define the target');
    expect(markdown).toContain('Define the extraction schema');
    expect(markdown).toContain('Define the traversal plan');
    expect(markdown).toContain('Define the access posture');
    expect(markdown).toContain('Respect robots.txt by default');
    expect(markdown).toContain('Write each extracted record as JSONL or Markdown');
    expect(markdown).toContain('Do not call Obscura through shell commands');
    expect(markdown).not.toContain('scrape');
    expect(markdown).not.toContain('--eval');
  });
});
