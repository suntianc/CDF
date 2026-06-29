import { describe, expect, it } from 'vitest';
import type { AgentApprovalRequest, Message } from '@shared/types';
import { projectConversationTimeline } from './conversationTimeline';

function message(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    session_id: 'session-1',
    created_at: 1_000,
    ...overrides,
  };
}

function toolMessage(id: string, name: string): Message {
  return message({
    id,
    role: 'system',
    content: JSON.stringify({ type: 'tool', name, status: 'success' }),
  });
}

describe('projectConversationTimeline', () => {
  it('groups consecutive tool messages while preserving ordinary message order', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: 'inspect the repo' });
    const firstTool = toolMessage('tool-1', 'view_file');
    const secondTool = toolMessage('tool-2', 'grep_search');
    const assistantMessage = message({ id: 'assistant-1', role: 'assistant', content: 'done' });

    const timelineItems = projectConversationTimeline({
      messages: [userMessage, firstTool, secondTool, assistantMessage],
      isStreaming: false,
      pendingApproval: null,
    });

    expect(timelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
      { type: 'tool_group', id: 'tool-1', tools: [firstTool, secondTool] },
      { type: 'message', id: 'assistant-1', message: assistantMessage },
    ]);
  });

  it('folds a completed single-message think block while preserving visible assistant text', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: 'plan this' });
    const assistantMessage = message({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Before <think>private process</think> After',
      created_at: 4_000,
    });

    const timelineItems = projectConversationTimeline({
      messages: [userMessage, assistantMessage],
      isStreaming: false,
      pendingApproval: null,
    });

    expect(timelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
      {
        type: 'message',
        id: 'assistant-1-pre',
        message: { ...assistantMessage, id: 'assistant-1-pre', content: 'Before' },
      },
      {
        type: 'folded_block',
        id: 'folded-0',
        duration: 1,
        foldedItems: [
          {
            type: 'message',
            id: 'assistant-1-think',
            message: { ...assistantMessage, id: 'assistant-1-think', content: 'private process' },
          },
        ],
      },
      {
        type: 'message',
        id: 'assistant-1-post',
        message: { ...assistantMessage, id: 'assistant-1-post', content: 'After' },
      },
    ]);
  });

  it('keeps the active streaming turn unfolded', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: 'plan this' });
    const assistantMessage = message({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Before <think>still streaming',
    });

    const timelineItems = projectConversationTimeline({
      messages: [userMessage, assistantMessage],
      isStreaming: true,
      pendingApproval: null,
    });

    expect(timelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
      { type: 'message', id: 'assistant-1', message: assistantMessage },
    ]);
  });

  it('folds a multi-item think interval with grouped tool activity inside it', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: 'investigate' });
    const firstAssistantMessage = message({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Intro <think>start',
      created_at: 2_000,
    });
    const firstTool = toolMessage('tool-1', 'view_file');
    const secondTool = toolMessage('tool-2', 'grep_search');
    const lastAssistantMessage = message({
      id: 'assistant-2',
      role: 'assistant',
      content: 'finish</think> Result',
      created_at: 6_000,
    });

    const timelineItems = projectConversationTimeline({
      messages: [userMessage, firstAssistantMessage, firstTool, secondTool, lastAssistantMessage],
      isStreaming: false,
      pendingApproval: null,
    });

    expect(timelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
      {
        type: 'message',
        id: 'assistant-1-pre',
        message: { ...firstAssistantMessage, id: 'assistant-1-pre', content: 'Intro' },
      },
      {
        type: 'folded_block',
        id: 'folded-0',
        duration: 4,
        foldedItems: [
          {
            type: 'message',
            id: 'assistant-1-think',
            message: { ...firstAssistantMessage, id: 'assistant-1-think', content: 'start' },
          },
          { type: 'tool_group', id: 'tool-1', tools: [firstTool, secondTool] },
          {
            type: 'message',
            id: 'assistant-2-think',
            message: { ...lastAssistantMessage, id: 'assistant-2-think', content: 'finish' },
          },
        ],
      },
      {
        type: 'message',
        id: 'assistant-2-post',
        message: { ...lastAssistantMessage, id: 'assistant-2-post', content: 'Result' },
      },
    ]);
  });

  it('keeps the final assistant answer outside an unclosed folded process block after tool activity', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: 'write files' });
    const thinkingMessage = message({
      id: 'assistant-1',
      role: 'assistant',
      content: '<think>Need to inspect and write files',
      created_at: 2_000,
    });
    const firstTool = toolMessage('tool-1', 'write_file');
    const secondTool = toolMessage('tool-2', 'write_file');
    const finalAnswer = message({
      id: 'assistant-2',
      role: 'assistant',
      content: '<think>checking the written files\n\n写文件任务圆满完成啦～',
      created_at: 6_000,
    });

    const timelineItems = projectConversationTimeline({
      messages: [userMessage, thinkingMessage, firstTool, secondTool, finalAnswer],
      isStreaming: false,
      pendingApproval: null,
    });

    expect(timelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
      {
        type: 'folded_block',
        id: 'folded-0',
        duration: 4,
        foldedItems: [
          {
            type: 'message',
            id: 'assistant-1-think',
            message: { ...thinkingMessage, id: 'assistant-1-think', content: 'Need to inspect and write files' },
          },
          { type: 'tool_group', id: 'tool-1', tools: [firstTool, secondTool] },
          {
            type: 'message',
            id: 'assistant-2-think',
            message: { ...finalAnswer, id: 'assistant-2-think', content: 'checking the written files' },
          },
        ],
      },
      {
        type: 'message',
        id: 'assistant-2-post',
        message: { ...finalAnswer, id: 'assistant-2-post', content: '写文件任务圆满完成啦～' },
      },
    ]);
  });

  it('cleans extra closing think tags without folding ordinary assistant text', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: 'summarize' });
    const assistantMessage = message({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Visible</think> answer',
    });

    const timelineItems = projectConversationTimeline({
      messages: [userMessage, assistantMessage],
      isStreaming: false,
      pendingApproval: null,
    });

    expect(timelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
      {
        type: 'message',
        id: 'assistant-1',
        message: { ...assistantMessage, content: 'Visible answer' },
      },
    ]);
  });

  it('appends pending approval only while the conversation is streaming', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: 'run it' });
    const pendingApproval: AgentApprovalRequest = {
      id: 'approval-1',
      runId: 'run-1',
      actions: [{ name: 'write_to_file', description: 'Write file' }],
    };

    const streamingTimelineItems = projectConversationTimeline({
      messages: [userMessage],
      isStreaming: true,
      pendingApproval,
    });

    expect(streamingTimelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
      {
        type: 'pending_approval_block',
        id: 'pending-approval-approval-1',
        approval: pendingApproval,
      },
    ]);

    const completedTimelineItems = projectConversationTimeline({
      messages: [userMessage],
      isStreaming: false,
      pendingApproval,
    });

    expect(completedTimelineItems).toEqual([
      { type: 'message', id: 'user-1', message: userMessage },
    ]);
  });
});
