import { describe, expect, it } from 'vitest';
import {
  appendToIndex,
  createInMemoryPaperCollectionThreadState,
  markLatestConsumed,
  maybeArchive,
  PAPER_COLLECTION_CACHE_DIR,
  readArchive,
  readIndex,
  readLatestPaperCollectionCache,
  writeLatest,
  writeLatestPaperCollectionCache,
} from './paper-collection-cache';

describe('paper collection cache', () => {
  const payload = {
    searchedAt: '2026-07-05T10:00:00Z',
    query: 'agentic retrieval',
    source: 'arxiv',
    candidates: [
      {
        title: 'Agentic Retrieval',
      },
    ],
    journalMetricsByJournal: {
      nature: {
        jcrQuartile: 'Q1',
      },
    },
  };

  it('stores the cache under the project .cdf area', () => {
    expect(PAPER_COLLECTION_CACHE_DIR).toBe('.cdf/paper-collection-cache');
  });

  it('restores the latest paper search payload after writing it', () => {
    const threadState = createInMemoryPaperCollectionThreadState();

    writeLatestPaperCollectionCache(threadState, payload);

    expect(readLatestPaperCollectionCache(threadState)).toEqual(payload);
  });

  it('appends index entries in order without replacing previous entries', () => {
    const threadState = createInMemoryPaperCollectionThreadState();

    appendToIndex(threadState, {
      searchedAt: '2026-07-05T10:00:00Z',
      query: 'first',
      candidateCount: 1,
      status: 'fresh',
    });
    appendToIndex(threadState, {
      searchedAt: '2026-07-05T11:00:00Z',
      query: 'second',
      candidateCount: 2,
      status: 'fresh',
    });

    expect(readIndex(threadState)).toEqual([
      {
        searchedAt: '2026-07-05T10:00:00Z',
        query: 'first',
        candidateCount: 1,
        status: 'fresh',
      },
      {
        searchedAt: '2026-07-05T11:00:00Z',
        query: 'second',
        candidateCount: 2,
        status: 'fresh',
      },
    ]);
  });

  it.each([
    ['29:59', '2026-07-05T10:44:59Z', false],
    ['30:00', '2026-07-05T10:45:00Z', true],
    ['30:01', '2026-07-05T10:45:01Z', true],
  ])('applies the 30 minute archive threshold at %s', (_, now, shouldArchive) => {
    const threadState = createInMemoryPaperCollectionThreadState();
    const consumedPayload = {
      ...payload,
      consumedAt: '2026-07-05T10:15:00Z',
    };
    writeLatest(threadState, consumedPayload);
    appendToIndex(threadState, {
      searchedAt: payload.searchedAt,
      query: payload.query,
      candidateCount: payload.candidates.length,
      status: 'consumed',
    });

    const result = maybeArchive(threadState, new Date(now));

    expect(result.archived).toBe(shouldArchive);
    if (!shouldArchive) {
      expect(readLatestPaperCollectionCache(threadState)).toEqual(consumedPayload);
      expect(readIndex(threadState)[0]).toMatchObject({ status: 'consumed' });
      return;
    }

    expect(readLatestPaperCollectionCache(threadState)).toBeUndefined();
    expect(result.archivePath).toBe('.cdf/paper-collection-cache/archive/2026-07-05T10:00:00Z.json');
    expect(readArchive(threadState, result.archivePath as string)).toEqual(consumedPayload);
    expect(readIndex(threadState)[0]).toMatchObject({
      status: 'archived',
      archivePath: result.archivePath,
    });
  });

  it('does not archive an unconsumed latest payload', () => {
    const threadState = createInMemoryPaperCollectionThreadState();
    writeLatest(threadState, payload);

    expect(maybeArchive(threadState, new Date('2026-07-05T12:00:00Z'))).toEqual({ archived: false });
    expect(readLatestPaperCollectionCache(threadState)).toEqual(payload);
  });

  it('marks latest as consumed and updates the matching index entry', () => {
    const threadState = createInMemoryPaperCollectionThreadState();
    writeLatest(threadState, payload);
    appendToIndex(threadState, {
      searchedAt: payload.searchedAt,
      query: payload.query,
      candidateCount: payload.candidates.length,
      status: 'fresh',
    });

    const consumed = markLatestConsumed(threadState, '2026-07-05T10:15:00Z');

    expect(consumed).toEqual({
      ...payload,
      consumedAt: '2026-07-05T10:15:00Z',
    });
    expect(readLatestPaperCollectionCache(threadState)).toEqual(consumed);
    expect(readIndex(threadState)).toEqual([
      {
        searchedAt: payload.searchedAt,
        query: payload.query,
        candidateCount: payload.candidates.length,
        status: 'consumed',
      },
    ]);
  });

  it('rejects invalid latest payload schema before writing', () => {
    const threadState = createInMemoryPaperCollectionThreadState();

    expect(() => writeLatest(threadState, {
      ...payload,
      candidates: {},
    } as never)).toThrow('candidates must be an array');
    expect(() => writeLatest(threadState, {
      ...payload,
      journalMetricsByJournal: [],
    } as never)).toThrow('journalMetricsByJournal must be an object');
    expect(() => writeLatest(threadState, {
      ...payload,
      searchedAt: 'not-a-date',
    })).toThrow('searchedAt must be an ISO timestamp');
  });
});
