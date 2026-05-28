import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArxivResponse, searchArxiv } from './arxiv-tool';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>42</opensearch:totalResults>
  <opensearch:startIndex>10</opensearch:startIndex>
  <opensearch:itemsPerPage>2</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <updated>2023-08-02T00:00:00Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary> A transformer architecture. </summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <arxiv:comment>15 pages</arxiv:comment>
    <arxiv:journal_ref>NIPS 2017</arxiv:journal_ref>
    <arxiv:doi>10.5555/3295222.3295349</arxiv:doi>
    <arxiv:primary_category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

function mockFetchWithXml(xml = SAMPLE_XML) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    text: async () => xml,
  })) as any;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('parseArxivResponse', () => {
  it('should parse feed metadata and arXiv extension fields', () => {
    const result = parseArxivResponse(SAMPLE_XML);

    expect(result.metadata).toEqual({
      totalResults: 42,
      startIndex: 10,
      itemsPerPage: 2,
    });
    expect(result.papers[0]).toMatchObject({
      id: '1706.03762v7',
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      summary: 'A transformer architecture.',
      published: '2017-06-12T17:57:34Z',
      updated: '2023-08-02T00:00:00Z',
      categories: ['cs.CL', 'cs.LG'],
      primaryCategory: 'cs.CL',
      doi: '10.5555/3295222.3295349',
      journalRef: 'NIPS 2017',
      comment: '15 pages',
      abstractLink: 'http://arxiv.org/abs/1706.03762v7',
      pdfLink: 'http://arxiv.org/pdf/1706.03762v7',
    });
  });
});

describe('searchArxiv', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should build a simple fielded query for plain keywords', async () => {
    const fetchMock = mockFetchWithXml();

    await searchArxiv({ query: 'attention is all you need', maxResults: 3, field: 'ti' });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('search_query')).toBe('ti:attention is all you need');
    expect(url.searchParams.get('max_results')).toBe('3');
  });

  it('should preserve advanced arXiv query syntax', async () => {
    const fetchMock = mockFetchWithXml();

    await searchArxiv({
      query: 'au:Yann LeCun AND cat:cs.LG',
      sortBy: 'submittedDate',
      sortOrder: 'ascending',
      start: 20,
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('search_query')).toBe('au:Yann LeCun AND cat:cs.LG');
    expect(url.searchParams.get('sortBy')).toBe('submittedDate');
    expect(url.searchParams.get('sortOrder')).toBe('ascending');
    expect(url.searchParams.get('start')).toBe('20');
  });

  it('should support batch lookup through id_list', async () => {
    const fetchMock = mockFetchWithXml();

    await searchArxiv({ ids: ['1706.03762', '1605.08386v1'] });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('id_list')).toBe('1706.03762,1605.08386v1');
    expect(url.searchParams.has('search_query')).toBe(false);
  });

  it('should support search_query plus id_list filtering', async () => {
    const fetchMock = mockFetchWithXml();

    await searchArxiv({
      searchQuery: 'cat:cs.CL',
      ids: ['1706.03762', '1605.08386v1'],
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('search_query')).toBe('cat:cs.CL');
    expect(url.searchParams.get('id_list')).toBe('1706.03762,1605.08386v1');
  });
});
