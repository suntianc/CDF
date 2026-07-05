import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { SceneWorkspace } from './SceneWorkspace';
import { useProjectStore } from '../../stores/projectStore';
import type { KnowledgeEntrySummary } from '@shared/types';

const knowledgeListMock = vi.fn();
const openPaperPdfMock = vi.fn();

function paperEntry(overrides: Partial<KnowledgeEntrySummary> = {}): KnowledgeEntrySummary {
  return {
    relativePath: 'papers/attention-is-all-you-need.md',
    title: 'Attention Is All You Need',
    tags: ['transformer', 'nlp'],
    body: '',
    frontmatter: {
      type: 'Paper',
      title: 'Attention Is All You Need',
      description: 'Introduces the Transformer architecture for sequence transduction.',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      source: 'NeurIPS 2017',
      resource: 'papers/attention.pdf',
    },
    warnings: [],
    invalidFrontmatter: false,
    ...overrides,
  };
}

describe('SceneWorkspace Paper Library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      projects: [],
      currentProjectId: 'project-1',
      activeView: 'chat',
      taskPanelOpen: false,
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      knowledge: {
        list: knowledgeListMock,
      },
      papers: {
        openPdf: openPaperPdfMock,
      },
    };
  });

  it('shows Paper Entries from the project Knowledge Base', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry(),
      paperEntry({
        relativePath: 'notes/not-a-paper.md',
        title: 'Vector Notes',
        tags: ['notes'],
        frontmatter: {
          type: 'Note',
          title: 'Vector Notes',
          description: 'Implementation note',
        },
      }),
    ]);

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));

    await waitFor(() => expect(knowledgeListMock).toHaveBeenCalledWith('project-1', { sortBy: 'timestamp', sortOrder: 'desc' }));
    expect(await screen.findByText('Attention Is All You Need')).toBeTruthy();
    expect(screen.getByText('Ashish Vaswani, Noam Shazeer')).toBeTruthy();
    expect(screen.getByText('Introduces the Transformer architecture for sequence transduction.')).toBeTruthy();
    expect(screen.getByText('NeurIPS 2017')).toBeTruthy();
    expect(screen.getAllByText('transformer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('nlp').length).toBeGreaterThan(0);
    expect(screen.queryByText('Vector Notes')).toBeNull();
  });

  it('filters Paper Entries by keyword without matching the note body', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry(),
      paperEntry({
        relativePath: 'papers/retrieval-augmented-generation.md',
        title: 'Retrieval-Augmented Generation',
        tags: ['rag'],
        body: 'transformer body note should not match keyword filtering',
        frontmatter: {
          type: 'Paper',
          title: 'Retrieval-Augmented Generation',
          description: 'Parametric and non-parametric memory for language generation.',
          authors: ['Patrick Lewis'],
          source: 'arXiv:2005.11401',
        },
      }),
    ]);

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));
    expect(await screen.findByText('Attention Is All You Need')).toBeTruthy();
    expect(screen.getByText('Retrieval-Augmented Generation')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: /搜索论文|Search papers/ }), {
      target: { value: 'arXiv' },
    });

    expect(screen.queryByText('Attention Is All You Need')).toBeNull();
    expect(screen.getByText('Retrieval-Augmented Generation')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: /搜索论文|Search papers/ }), {
      target: { value: 'transformer' },
    });

    expect(screen.getByText('Attention Is All You Need')).toBeTruthy();
    expect(screen.queryByText('Retrieval-Augmented Generation')).toBeNull();
  });

  it('keeps the flat Paper Entry order returned by timestamp-desc loading', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry({
        relativePath: 'papers/newer.md',
        title: 'Newer Paper',
        tags: [],
        frontmatter: {
          type: 'Paper',
          title: 'Newer Paper',
          timestamp: '2025-01-01T00:00:00.000Z',
        },
      }),
      paperEntry({
        relativePath: 'papers/older.md',
        title: 'Older Paper',
        tags: [],
        frontmatter: {
          type: 'Paper',
          title: 'Older Paper',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      }),
    ]);

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));

    expect(await screen.findByText('Newer Paper')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Newer Paper', 'Older Paper']);
  });

  it('filters Paper Entries by selected tag', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry(),
      paperEntry({
        relativePath: 'papers/retrieval-augmented-generation.md',
        title: 'Retrieval-Augmented Generation',
        tags: ['rag'],
        frontmatter: {
          type: 'Paper',
          title: 'Retrieval-Augmented Generation',
          description: 'Parametric and non-parametric memory for language generation.',
          authors: ['Patrick Lewis'],
          source: 'arXiv:2005.11401',
        },
      }),
    ]);

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));
    expect(await screen.findByText('Attention Is All You Need')).toBeTruthy();
    expect(screen.getByText('Retrieval-Augmented Generation')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /筛选标签 transformer|Filter tag transformer/ }));

    expect(screen.getByText('Attention Is All You Need')).toBeTruthy();
    expect(screen.queryByText('Retrieval-Augmented Generation')).toBeNull();
  });

  it('groups filtered Paper Entries by tag and repeats multi-tag papers', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry(),
      paperEntry({
        relativePath: 'papers/untagged.md',
        title: 'A Survey Without Tags',
        tags: [],
        frontmatter: {
          type: 'Paper',
          title: 'A Survey Without Tags',
          description: 'A paper with no tags.',
        },
      }),
    ]);

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));
    expect(await screen.findByText('Attention Is All You Need')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /按标签分组|Group by tag/ }));

    expect(screen.getByRole('heading', { name: 'transformer' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'nlp' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /未标记|Untagged/ })).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Attention Is All You Need' })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'A Survey Without Tags' })).toBeTruthy();
  });

  it('expands a paper abstract inline when the card is clicked', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry({
        frontmatter: {
          type: 'Paper',
          title: 'Attention Is All You Need',
          description: 'A long abstract that starts compact and expands inline after the user clicks the paper card.',
          authors: ['Ashish Vaswani'],
          source: 'NeurIPS 2017',
        },
      }),
    ]);

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));
    const card = await screen.findByRole('button', { name: /Attention Is All You Need/ });
    const abstract = screen.getByText('A long abstract that starts compact and expands inline after the user clicks the paper card.');

    expect(card.getAttribute('aria-expanded')).toBe('false');
    expect(abstract.className).toContain('line-clamp-3');

    fireEvent.click(card);

    expect(card.getAttribute('aria-expanded')).toBe('true');
    expect(abstract.className).not.toContain('line-clamp-3');
  });

  it('shows an explicit PDF button only for Paper Entries with a resource', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry(),
      paperEntry({
        relativePath: 'papers/no-local-pdf.md',
        title: 'No Local PDF',
        tags: [],
        frontmatter: {
          type: 'Paper',
          title: 'No Local PDF',
          description: 'Metadata only.',
          authors: ['Ada Lovelace'],
          source: 'DOI:10.0000/example',
        },
      }),
    ]);
    openPaperPdfMock.mockResolvedValue({ success: true });

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));
    expect(await screen.findByText('Attention Is All You Need')).toBeTruthy();
    expect(screen.getByText('No Local PDF')).toBeTruthy();

    const openButtons = screen.getAllByRole('button', { name: /打开 PDF|Open PDF/ });
    expect(openButtons).toHaveLength(1);

    fireEvent.click(openButtons[0]);

    expect(openPaperPdfMock).toHaveBeenCalledWith('project-1', 'papers/attention.pdf');
  });

  it('reloads Paper Entries when the refresh button is clicked', async () => {
    knowledgeListMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([paperEntry()]);

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));
    await waitFor(() => expect(knowledgeListMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Attention Is All You Need')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /刷新论文库|Refresh paper library/ }));

    await waitFor(() => expect(knowledgeListMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Attention Is All You Need')).toBeTruthy();
  });

  it('keeps warning and invalid frontmatter signals visible on Paper Entries', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry({
        invalidFrontmatter: true,
        warnings: ['Invalid authors field'],
      }),
    ]);

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /论文库|Paper Library/ }));

    expect(await screen.findByText('Attention Is All You Need')).toBeTruthy();
    expect(screen.getByText(/frontmatter 异常|Invalid frontmatter/)).toBeTruthy();
    expect(screen.getByText('Invalid authors field')).toBeTruthy();
  });
});
