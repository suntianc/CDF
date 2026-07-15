import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { SceneWorkspace } from './SceneWorkspace';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
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
    useSessionStore.setState({ activeSessionId: 'session-1' });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      knowledge: {
        list: knowledgeListMock,
      },
      papers: {
        openPdf: openPaperPdfMock,
      },
    };
  });

  it('hides research scene navigation on the welcome surface', () => {
    useSessionStore.setState({ activeSessionId: null });

    render(
      <SceneWorkspace
        scene="research"
        conversation={<div data-testid="conversation-workspace">Conversation</div>}
      />,
    );

    expect(screen.getByTestId('conversation-workspace')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /论文库|Paper Library/ })).toBeNull();
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

  it('shows bibliographic fields and Journal Metrics Snapshot fields', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry({
        relativePath: 'papers/metrics.md',
        title: 'Metrics Paper',
        tags: ['metrics'],
        frontmatter: {
          type: 'Paper',
          title: 'Metrics Paper',
          description: 'A paper with complete bibliographic metadata.',
          authors: ['Grace Hopper'],
          source: 'DOI:10.1234/metrics',
          journal: 'Nature Machine Intelligence',
          volume: '5',
          issue: '2',
          pages: '100-112',
          year: 2024,
          doi: '10.1234/metrics',
          journalMetrics: {
            impactFactor: 18.8,
            casTier: '1区',
            jcrQuartile: 'Q1',
            indexing: ['SCI', 'EI'],
            year: 2025,
            source: 'easyScholar',
          },
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

    expect(await screen.findByText('Metrics Paper')).toBeTruthy();
    expect(screen.getAllByText(/Nature Machine Intelligence/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2024/)).toBeTruthy();
    expect(screen.getByText(/5.*2/)).toBeTruthy();
    expect(screen.getByText(/100-112/)).toBeTruthy();
    expect(screen.getAllByText(/10\.1234\/metrics/).length).toBeGreaterThan(0);
    expect(screen.getByText('IF 18.8 (2025, easyScholar)')).toBeTruthy();
    expect(screen.getByText('CAS 1区 (2025)')).toBeTruthy();
    expect(screen.getByText('JCR Q1 (2025)')).toBeTruthy();
    expect(screen.getByText('SCI, EI (2025)')).toBeTruthy();
  });

  it('filters Paper Entries by keyword including the Knowledge Entry body', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry(),
      paperEntry({
        relativePath: 'papers/retrieval-augmented-generation.md',
        title: 'Retrieval-Augmented Generation',
        tags: ['rag'],
        body: 'The body contains the unique keyword bodyonlyquasar.',
        frontmatter: {
          type: 'Paper',
          title: 'Retrieval-Augmented Generation',
          description: 'Parametric and non-parametric memory for language generation.',
          authors: ['Patrick Lewis'],
          source: 'arXiv:2005.11401',
          journal: 'Journal of Retrieval',
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
      target: { value: 'bodyonlyquasar' },
    });

    expect(screen.queryByText('Attention Is All You Need')).toBeNull();
    expect(screen.getByText('Retrieval-Augmented Generation')).toBeTruthy();
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

  it('filters Paper Entries by journal and CAS tier together', async () => {
    knowledgeListMock.mockResolvedValue([
      paperEntry({
        relativePath: 'papers/a.md',
        title: 'Journal A Tier One',
        tags: ['ml'],
        frontmatter: {
          type: 'Paper',
          title: 'Journal A Tier One',
          journal: 'Journal A',
          journalMetrics: { casTier: '1区', year: 2025, source: 'easyScholar' },
        },
      }),
      paperEntry({
        relativePath: 'papers/b.md',
        title: 'Journal A Tier Two',
        tags: ['ml'],
        frontmatter: {
          type: 'Paper',
          title: 'Journal A Tier Two',
          journal: 'Journal A',
          journalMetrics: { casTier: '2区', year: 2025, source: 'easyScholar' },
        },
      }),
      paperEntry({
        relativePath: 'papers/c.md',
        title: 'Journal B Tier One',
        tags: ['systems'],
        frontmatter: {
          type: 'Paper',
          title: 'Journal B Tier One',
          journal: 'Journal B',
          journalMetrics: { casTier: '1区', year: 2025, source: 'easyScholar' },
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
    expect(await screen.findByText('Journal A Tier One')).toBeTruthy();
    expect(screen.getByText('Journal A Tier Two')).toBeTruthy();
    expect(screen.getByText('Journal B Tier One')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /筛选期刊 Journal A|Filter journal Journal A/ }));

    expect(screen.getByText('Journal A Tier One')).toBeTruthy();
    expect(screen.getByText('Journal A Tier Two')).toBeTruthy();
    expect(screen.queryByText('Journal B Tier One')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /筛选中科院分区 1区|Filter CAS tier 1区/ }));

    expect(screen.getByText('Journal A Tier One')).toBeTruthy();
    expect(screen.queryByText('Journal A Tier Two')).toBeNull();
    expect(screen.queryByText('Journal B Tier One')).toBeNull();
  });

  it('keeps Paper Entries flat without tag grouping and shows multi-tag papers once', async () => {
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

    expect(screen.queryByRole('button', { name: /按标签分组|Group by tag/ })).toBeNull();
    expect(screen.getByRole('button', { name: /筛选标签 transformer|Filter tag transformer/ })).toBeTruthy();
    expect(screen.getAllByText('transformer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('nlp').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: 'Attention Is All You Need' })).toHaveLength(1);
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
