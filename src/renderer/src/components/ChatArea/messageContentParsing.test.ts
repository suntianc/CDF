import { describe, expect, it } from 'vitest';
import {
  AT_TOKEN_SCAN_LIMIT,
  checkThinkingFinished,
  containsRenderableAtTokens,
  joinThinkParts,
  parseFoldedThinkView,
  parseThinkBlocks,
  segmentMarkdownForAtTokens,
  stripOrphanThinkClosers,
} from './messageContentParsing';

describe('checkThinkingFinished', () => {
  it('treats content without think markup, or with a closed trace, as finished', () => {
    expect(checkThinkingFinished('')).toBe(true);
    expect(checkThinkingFinished('plain answer')).toBe(true);
    expect(checkThinkingFinished('<think>a</think> answer')).toBe(true);
  });

  it('detects an unclosed trailing trace', () => {
    expect(checkThinkingFinished('<think>still going')).toBe(false);
    expect(checkThinkingFinished('<think>a</think> more <think>open')).toBe(false);
  });
});

describe('parseThinkBlocks', () => {
  it('separates multiple closed traces from the main content', () => {
    const result = parseThinkBlocks('Intro <think>a</think> middle <think>b</think> outro');

    expect(result.thinkParts).toEqual(['a', 'b']);
    expect(result.mainContent).toBe('Intro  middle  outro');
    expect(result.isThinkingFinished).toBe(true);
  });

  it('marks an unclosed final trace as unfinished and keeps its partial text', () => {
    const result = parseThinkBlocks('Answer <think>partial trace');

    expect(result.thinkParts).toEqual(['partial trace']);
    expect(result.mainContent).toBe('Answer');
    expect(result.isThinkingFinished).toBe(false);
  });

  it('joins trimmed non-empty parts with newlines', () => {
    expect(joinThinkParts([' a ', '', '  ', 'b'])).toBe('a\nb');
  });
});

describe('stripOrphanThinkClosers', () => {
  it('removes every closer when there is no opener', () => {
    expect(stripOrphanThinkClosers('Hello</think> world</think>!')).toBe('Hello world!');
  });

  it('removes only the last closer when openers exist', () => {
    expect(stripOrphanThinkClosers('<think>a</think> b</think>')).toBe('<think>a</think> b');
  });

  it('leaves balanced or opener-heavy content untouched', () => {
    expect(stripOrphanThinkClosers('<think>a</think> b')).toBe('<think>a</think> b');
    expect(stripOrphanThinkClosers('<think>open')).toBe('<think>open');
  });
});

describe('parseFoldedThinkView', () => {
  it('returns null when the message has no think markup', () => {
    expect(parseFoldedThinkView('plain answer')).toBeNull();
  });

  it('splits pre/folded/post around the first trace', () => {
    expect(parseFoldedThinkView(' Intro <think> a </think> outro ')).toEqual({
      preContent: 'Intro',
      foldedContent: 'a',
      postContent: 'outro',
      isThinkingFinished: true,
    });
  });

  it('keeps everything after the FIRST closer as post content (later traces included)', () => {
    const view = parseFoldedThinkView('Intro <think>a</think> middle <think>b</think> outro');

    expect(view?.foldedContent).toBe('a\nb');
    expect(view?.postContent).toBe('middle <think>b</think> outro');
  });

  it('reports an unclosed trace with empty post content', () => {
    expect(parseFoldedThinkView('Intro <think>open')).toEqual({
      preContent: 'Intro',
      foldedContent: 'open',
      postContent: '',
      isThinkingFinished: false,
    });
  });
});

describe('containsRenderableAtTokens', () => {
  it('requires an @, a scannable length, and at least one parsed token', () => {
    expect(containsRenderableAtTokens('no tokens here')).toBe(false);
    expect(containsRenderableAtTokens('see @src/foo.ts')).toBe(true);
    expect(containsRenderableAtTokens(`@src/foo.ts${' x'.repeat(AT_TOKEN_SCAN_LIMIT / 2)}`)).toBe(false);
    expect(containsRenderableAtTokens('mail me @ home')).toBe(false);
  });
});

describe('segmentMarkdownForAtTokens', () => {
  it('splits text around inline code, keeping the backticks inside code segments', () => {
    expect(segmentMarkdownForAtTokens('Before `code` after')).toEqual([
      { kind: 'text', value: 'Before ' },
      { kind: 'code', value: '`code`' },
      { kind: 'text', value: ' after' },
    ]);
  });

  it('treats fenced blocks as one code segment', () => {
    expect(segmentMarkdownForAtTokens('intro\n```ts\nconst a = 1;\n```\ntail')).toEqual([
      { kind: 'text', value: 'intro\n' },
      { kind: 'code', value: '```ts\nconst a = 1;\n```' },
      { kind: 'text', value: '\ntail' },
    ]);
  });

  it('runs an unclosed fence or inline code to the end of the text', () => {
    expect(segmentMarkdownForAtTokens('open ```js\nno close')).toEqual([
      { kind: 'text', value: 'open ' },
      { kind: 'code', value: '```js\nno close' },
    ]);
    expect(segmentMarkdownForAtTokens('tick `oops')).toEqual([
      { kind: 'text', value: 'tick ' },
      { kind: 'code', value: '`oops' },
    ]);
  });

  it('matches inline code by backtick run length', () => {
    expect(segmentMarkdownForAtTokens('a ``code `with` ticks`` b')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'code', value: '``code `with` ticks``' },
      { kind: 'text', value: ' b' },
    ]);
  });

  it('returns a single text segment when there is no code at all', () => {
    expect(segmentMarkdownForAtTokens('just words')).toEqual([
      { kind: 'text', value: 'just words' },
    ]);
  });
});
