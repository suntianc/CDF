import { describe, expect, it } from 'vitest';
import {
  addComposerAttachment,
  closePathMentionCandidates,
  deletePreviousLeadingItem,
  createComposerInputState,
  finishComposition,
  getComposerInputRenderModel,
  insertCommandEntry,
  removeComposerAttachment,
  resolvePathMentionCandidateRequest,
  selectPathMentionCandidate,
  startPathMentionCandidateRequest,
  startComposition,
  submitComposerInput,
  updateComposerInputText,
} from './composerInput';
import type { CommandDispatchAction, SlashCommand } from '@shared/types';

const goalCommand: SlashCommand = {
  name: 'goal',
  description: 'Set a session goal',
  source: 'system',
  target: 'goal',
  sourceLabel: 'system',
  badge: '[system]',
};

const qualifiedSkillCommand: SlashCommand = {
  name: 'apps/web:deploy',
  qualifiedName: 'apps/web:deploy',
  skillName: 'deploy',
  description: 'Deploy the web app',
  source: 'skill:project',
  target: 'project:apps/web:deploy',
  sourceLabel: 'Project Skill: apps/web',
  badge: '[skill:project]',
};

describe('composerInput', () => {
  it('submits normal text in session mode and clears the prepared instruction', () => {
    const initial = createComposerInputState();
    const typed = updateComposerInputText(initial, {
      value: 'Fix the failing tests',
      cursor: 'Fix the failing tests'.length,
      hasProject: true,
    });

    const result = submitComposerInput(typed, {
      mode: 'session',
      isStreaming: false,
      commands: [],
      resolveCommand: () => null,
    });

    expect(result.intent).toEqual({
      type: 'sendConversation',
      mode: 'session',
      content: 'Fix the failing tests',
      attachments: [],
    });
    expect(result.state.text).toBe('');
  });

  it('submits a leading Command Entry as a command intent without clearing through side effects', () => {
    const plan: CommandDispatchAction = {
      kind: 'GoalLoop',
      command: goalCommand,
      args: 'write tests',
      goal: 'write tests',
    };
    const initial = createComposerInputState();
    const typed = updateComposerInputText(initial, {
      value: '/goal write tests',
      cursor: 0,
      hasProject: true,
    });

    const result = submitComposerInput(typed, {
      mode: 'session',
      isStreaming: false,
      commands: [goalCommand],
      resolveCommand: () => plan,
    });

    expect(result.intent).toEqual({
      type: 'executeCommand',
      plan,
    });
    expect(result.state.text).toBe('');
  });

  it('opens Path Mention candidates when the user types a project path mention', () => {
    const initial = createComposerInputState();

    const state = updateComposerInputText(initial, {
      value: '@sr',
      cursor: 3,
      hasProject: true,
    });

    expect(state.pathMention).toMatchObject({
      isOpen: true,
      query: 'sr',
      cursor: 3,
    });
  });

  it('keeps Path Mention candidates closed when no project is active', () => {
    const state = updateComposerInputText(createComposerInputState(), {
      value: '@sr',
      cursor: 3,
      hasProject: false,
    });

    expect(state.pathMention).toMatchObject({
      isOpen: false,
      query: '',
      cursor: 0,
    });
  });

  it('opens Command Entry candidates while the user is typing a leading command name', () => {
    const state = updateComposerInputText(createComposerInputState(), {
      value: '/go',
      cursor: 3,
      hasProject: true,
    });

    expect(state.commandEntry).toEqual({
      isOpen: true,
      query: 'go',
    });
  });

  it('inserts a Command Entry for later editing without executing it', () => {
    const state = insertCommandEntry(createComposerInputState(), '/goal');

    expect(state.text).toBe('/goal ');
    expect(state.commandEntry.isOpen).toBe(false);
  });

  it('selects a Path Mention candidate as literal text and closes candidates', () => {
    const initial = createComposerInputState();
    const typed = updateComposerInputText(initial, {
      value: 'please inspect @sr',
      cursor: 'please inspect @sr'.length,
      hasProject: true,
    });

    const selected = selectPathMentionCandidate(typed, 'src/foo.ts');

    expect(selected.text).toBe('please inspect @src/foo.ts ');
    expect(selected.pathMention.isOpen).toBe(false);
  });

  it('drops stale Path Mention candidate responses and keeps the latest candidates', () => {
    const opened = updateComposerInputText(createComposerInputState(), {
      value: '@sr',
      cursor: 3,
      hasProject: true,
    });
    const first = startPathMentionCandidateRequest(opened);
    const second = startPathMentionCandidateRequest(first.state);

    const stale = resolvePathMentionCandidateRequest(second.state, first.requestId, {
      candidates: ['old.ts'],
      truncated: false,
    });
    const latest = resolvePathMentionCandidateRequest(stale, second.requestId, {
      candidates: ['src/foo.ts'],
      truncated: true,
    });

    expect(stale.pathMention.candidates).toEqual([]);
    expect(stale.pathMention.loading).toBe(true);
    expect(latest.pathMention.candidates).toEqual(['src/foo.ts']);
    expect(latest.pathMention.truncated).toBe(true);
    expect(latest.pathMention.loading).toBe(false);
  });

  it('closes Path Mention candidates and releases candidate data', () => {
    const opened = updateComposerInputText(createComposerInputState(), {
      value: '@sr',
      cursor: 3,
      hasProject: true,
    });
    const request = startPathMentionCandidateRequest(opened);
    const resolved = resolvePathMentionCandidateRequest(request.state, request.requestId, {
      candidates: ['src/foo.ts'],
      truncated: true,
    });

    const closed = closePathMentionCandidates(resolved);

    expect(closed.text).toBe('@sr');
    expect(closed.pathMention).toMatchObject({
      isOpen: false,
      loading: false,
      candidates: [],
      truncated: false,
    });
  });

  it('swallows submit immediately after IME composition finishes', () => {
    const typed = updateComposerInputText(createComposerInputState(), {
      value: '修复测试',
      cursor: '修复测试'.length,
      hasProject: true,
    });
    const composing = startComposition(typed);
    const finished = finishComposition(composing);

    const result = submitComposerInput(finished, {
      mode: 'session',
      isStreaming: false,
      commands: [],
      resolveCommand: () => null,
    });

    expect(result.intent).toEqual({ type: 'noop' });
    expect(result.state.text).toBe('修复测试');
    expect(result.state.justFinishedComposition).toBe(false);
  });

  it('submits a Composer Attachment without text using the default image instruction', () => {
    const added = addComposerAttachment(createComposerInputState(), {
      dataUrl: 'data:image/png;base64,abc',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });

    const result = submitComposerInput(added.state, {
      mode: 'session',
      isStreaming: false,
      commands: [],
      resolveCommand: () => null,
    });

    expect(added.accepted).toBe(true);
    expect(result.intent).toEqual({
      type: 'sendConversation',
      mode: 'session',
      content: '请描述这张图片',
      attachments: ['data:image/png;base64,abc'],
    });
    expect(result.state.attachments).toEqual([]);
  });

  it('removes a Composer Attachment before the prepared instruction is sent', () => {
    const first = addComposerAttachment(createComposerInputState(), {
      dataUrl: 'data:image/png;base64,one',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });
    const second = addComposerAttachment(first.state, {
      dataUrl: 'data:image/png;base64,two',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });

    const next = removeComposerAttachment(second.state, 0);

    expect(next.attachments).toEqual(['data:image/png;base64,two']);
  });

  it('rejects invalid Composer Attachments without changing state', () => {
    const fullState = createComposerInputState({
      attachments: [
        'data:image/png;base64,1',
        'data:image/png;base64,2',
        'data:image/png;base64,3',
        'data:image/png;base64,4',
        'data:image/png;base64,5',
      ],
    });

    const unsupported = addComposerAttachment(createComposerInputState(), {
      dataUrl: 'data:text/plain;base64,abc',
      mimeType: 'text/plain',
      sizeBytes: 10,
    });
    const tooLarge = addComposerAttachment(createComposerInputState(), {
      dataUrl: 'data:image/png;base64,abc',
      mimeType: 'image/png',
      sizeBytes: 5 * 1024 * 1024 + 1,
    });
    const tooMany = addComposerAttachment(fullState, {
      dataUrl: 'data:image/png;base64,6',
      mimeType: 'image/png',
      sizeBytes: 10,
    });

    expect(unsupported).toEqual({
      state: createComposerInputState(),
      accepted: false,
      reason: 'unsupportedType',
    });
    expect(tooLarge).toEqual({
      state: createComposerInputState(),
      accepted: false,
      reason: 'tooLarge',
    });
    expect(tooMany).toEqual({
      state: fullState,
      accepted: false,
      reason: 'tooMany',
    });
  });

  it('builds a semantic overlay render model for leading Command Entry and Path Mention capsules', () => {
    const state = updateComposerInputText(createComposerInputState(), {
      value: '/goal @src/foo.ts fix it',
      cursor: '/goal @src/foo.ts fix it'.length,
      hasProject: true,
    });

    expect(getComposerInputRenderModel(state, [goalCommand])).toEqual({
      leadingItems: [
        {
          type: 'commandEntry',
          name: 'goal',
          raw: '/goal',
          source: 'system',
        },
        {
          type: 'pathMention',
          name: 'src/foo.ts',
          raw: '@src/foo.ts',
          kind: 'file',
        },
      ],
      visibleTail: 'fix it',
    });
  });

  it('builds a command token for qualified Skill slash names', () => {
    const state = updateComposerInputText(createComposerInputState(), {
      value: '/apps/web:deploy prod',
      cursor: '/apps/web:deploy prod'.length,
      hasProject: true,
    });

    expect(getComposerInputRenderModel(state, [qualifiedSkillCommand])).toEqual({
      leadingItems: [
        {
          type: 'commandEntry',
          name: 'apps/web:deploy',
          raw: '/apps/web:deploy',
          source: 'skill:project',
        },
      ],
      visibleTail: 'prod',
    });
  });

  it('deletes the last leading semantic item when Backspace starts the visible tail', () => {
    const state = updateComposerInputText(createComposerInputState(), {
      value: '/goal @src/foo.ts fix it',
      cursor: '/goal @src/foo.ts '.length,
      hasProject: true,
    });

    const next = deletePreviousLeadingItem(state, [goalCommand]);

    expect(next.text).toBe('/goal fix it');
    expect(getComposerInputRenderModel(next, [goalCommand])).toEqual({
      leadingItems: [
        {
          type: 'commandEntry',
          name: 'goal',
          raw: '/goal',
          source: 'system',
        },
      ],
      visibleTail: 'fix it',
    });
  });
});
