import type { AgentApprovalRequest, Message } from '@shared/types';

export type ConversationTimelineMessageItem = {
  type: 'message';
  id: string;
  message: Message;
};

export type ConversationTimelineToolGroupItem = {
  type: 'tool_group';
  id: string;
  tools: Message[];
};

export type ConversationTimelineFoldedBlockItem = {
  type: 'folded_block';
  id: string;
  duration: number;
  foldedItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem>;
};

export type ConversationTimelinePendingApprovalItem = {
  type: 'pending_approval_block';
  id: string;
  approval: AgentApprovalRequest;
};

export type ConversationTimelineItem =
  | ConversationTimelineMessageItem
  | ConversationTimelineToolGroupItem
  | ConversationTimelineFoldedBlockItem
  | ConversationTimelinePendingApprovalItem;

export function projectConversationTimeline(input: {
  messages: Message[];
  isStreaming: boolean;
  pendingApproval: AgentApprovalRequest | null;
}): ConversationTimelineItem[] {
  const groupedItems = groupToolMessages(input.messages);
  const turns = splitIntoTurns(groupedItems);
  const timelineItems: ConversationTimelineItem[] = [];

  turns.forEach((turn, turnIndex) => {
    if (turn.userItem) {
      timelineItems.push(turn.userItem);
    }

    const isLastTurn = turnIndex === turns.length - 1;
    if (isLastTurn && input.isStreaming) {
      timelineItems.push(...turn.responseItems);
      return;
    }

    timelineItems.push(...foldResponseItems(turn.responseItems, turnIndex));
  });

  if (input.isStreaming && input.pendingApproval) {
    timelineItems.push({
      type: 'pending_approval_block',
      id: `pending-approval-${input.pendingApproval.id}`,
      approval: input.pendingApproval,
    });
  }

  return timelineItems;
}

function groupToolMessages(messages: Message[]): Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem> {
  const items: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem> = [];
  let currentGroup: Message[] = [];
  let currentGroupStartId: string | null = null;

  const flushToolGroup = (fallbackId: string) => {
    if (currentGroup.length === 0) return;
    items.push({
      type: 'tool_group',
      id: currentGroupStartId || fallbackId,
      tools: currentGroup,
    });
    currentGroup = [];
    currentGroupStartId = null;
  };

  messages.forEach((message) => {
    if (isToolMessage(message)) {
      if (currentGroup.length === 0) {
        currentGroupStartId = message.id;
      }
      currentGroup.push(message);
      return;
    }

    flushToolGroup(`tool-group-${message.id}`);
    items.push({
      type: 'message',
      id: message.id,
      message,
    });
  });

  flushToolGroup('tool-group-end');

  return items;
}

function splitIntoTurns(items: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem>): Array<{
  userItem: ConversationTimelineMessageItem | null;
  responseItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem>;
}> {
  const turns: Array<{
    userItem: ConversationTimelineMessageItem | null;
    responseItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem>;
  }> = [];
  let currentTurn: {
    userItem: ConversationTimelineMessageItem | null;
    responseItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem>;
  } = { userItem: null, responseItems: [] };

  items.forEach((item) => {
    if (item.type === 'message' && item.message.role === 'user') {
      if (currentTurn.userItem || currentTurn.responseItems.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = { userItem: item, responseItems: [] };
      return;
    }

    currentTurn.responseItems.push(item);
  });

  if (currentTurn.userItem || currentTurn.responseItems.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}

function foldResponseItems(
  responseItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem>,
  turnIndex: number,
): ConversationTimelineItem[] {
  let firstThinkIdx = -1;
  let lastThinkIdx = -1;

  responseItems.forEach((item, index) => {
    if (item.type !== 'message' || item.message.role !== 'assistant') return;

    const content = item.message.content || '';
    if (firstThinkIdx === -1 && content.includes('<think>')) {
      firstThinkIdx = index;
    }
    if (content.includes('</think>') || content.includes('<think>')) {
      lastThinkIdx = index;
    }
  });

  if (firstThinkIdx === -1 || lastThinkIdx === -1 || lastThinkIdx < firstThinkIdx) {
    return responseItems.map(cleanVisibleItem);
  }

  const firstItem = responseItems[firstThinkIdx];
  if (firstItem.type !== 'message') {
    return responseItems;
  }

  if (firstThinkIdx !== lastThinkIdx) {
    return foldMultiItemThinkBlock(responseItems, firstThinkIdx, lastThinkIdx, turnIndex, firstItem);
  }

  const firstMsgContent = cleanMessageContent(firstItem.message.content);
  const firstThinkTagIdx = firstMsgContent.indexOf('<think>');
  const lastThinkEndTagIdx = firstMsgContent.lastIndexOf('</think>');

  let prePart = '';
  let postPart = '';
  let thinkPart = firstMsgContent;

  if (firstThinkTagIdx !== -1) {
    prePart = firstMsgContent.substring(0, firstThinkTagIdx).trim();
    if (lastThinkEndTagIdx !== -1 && lastThinkEndTagIdx > firstThinkTagIdx) {
      thinkPart = firstMsgContent.substring(firstThinkTagIdx, lastThinkEndTagIdx + 8);
      postPart = firstMsgContent.substring(lastThinkEndTagIdx + 8).trim();
    } else {
      const splitUnclosed = splitUnclosedThinkContent(firstMsgContent);
      if (splitUnclosed) {
        thinkPart = splitUnclosed.thinkPart;
        postPart = splitUnclosed.postPart;
      } else {
        thinkPart = firstMsgContent.substring(firstThinkTagIdx);
      }
    }
  }

  const preFoldItems: ConversationTimelineItem[] = [];
  const foldedItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem> = [];
  const postFoldItems: ConversationTimelineItem[] = [];

  for (let i = 0; i < firstThinkIdx; i++) {
    preFoldItems.push(responseItems[i]);
  }

  if (prePart) {
    preFoldItems.push({
      type: 'message',
      id: `${firstItem.id}-pre`,
      message: { ...firstItem.message, id: `${firstItem.message.id}-pre`, content: prePart },
    });
  }

  foldedItems.push({
    type: 'message',
    id: `${firstItem.id}-think`,
    message: {
      ...firstItem.message,
      id: `${firstItem.message.id}-think`,
      content: stripThinkTags(thinkPart),
    },
  });

  if (postPart) {
    postFoldItems.push({
      type: 'message',
      id: `${firstItem.id}-post`,
      message: { ...firstItem.message, id: `${firstItem.message.id}-post`, content: postPart },
    });
  }

  for (let i = lastThinkIdx + 1; i < responseItems.length; i++) {
    postFoldItems.push(responseItems[i]);
  }

  return [
    ...preFoldItems,
    {
      type: 'folded_block',
      id: `folded-${turnIndex}`,
      duration: calculateFoldedDuration(responseItems, firstThinkIdx),
      foldedItems,
    },
    ...postFoldItems,
  ];
}

function foldMultiItemThinkBlock(
  responseItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem>,
  firstThinkIdx: number,
  lastThinkIdx: number,
  turnIndex: number,
  firstItem: ConversationTimelineMessageItem,
): ConversationTimelineItem[] {
  const preFoldItems: ConversationTimelineItem[] = [];
  const foldedItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem> = [];
  const postFoldItems: ConversationTimelineItem[] = [];

  for (let i = 0; i < firstThinkIdx; i++) {
    preFoldItems.push(responseItems[i]);
  }

  const firstMsgContent = cleanMessageContent(firstItem.message.content);
  const firstThinkTagIdx = firstMsgContent.indexOf('<think>');
  let prePart = '';
  let firstThinkPart = firstMsgContent;
  if (firstThinkTagIdx !== -1) {
    prePart = firstMsgContent.substring(0, firstThinkTagIdx).trim();
    firstThinkPart = firstMsgContent.substring(firstThinkTagIdx);
  }

  if (prePart) {
    preFoldItems.push({
      type: 'message',
      id: `${firstItem.id}-pre`,
      message: { ...firstItem.message, id: `${firstItem.message.id}-pre`, content: prePart },
    });
  }

  foldedItems.push({
    type: 'message',
    id: `${firstItem.id}-think`,
    message: {
      ...firstItem.message,
      id: `${firstItem.message.id}-think`,
      content: stripThinkTags(firstThinkPart),
    },
  });

  for (let i = firstThinkIdx + 1; i < lastThinkIdx; i++) {
    foldedItems.push(cleanFoldedItem(responseItems[i]));
  }

  const lastItem = responseItems[lastThinkIdx];
  if (lastItem.type !== 'message') {
    return responseItems;
  }

  const lastMsgContent = cleanMultiItemLastThinkContent(lastItem.message.content);
  const lastThinkEndTagIdx = lastMsgContent.lastIndexOf('</think>');
  let postPart = '';
  let lastThinkPart = lastMsgContent;
  if (lastThinkEndTagIdx !== -1) {
    postPart = lastMsgContent.substring(lastThinkEndTagIdx + 8).trim();
    lastThinkPart = lastMsgContent.substring(0, lastThinkEndTagIdx + 8);
  } else {
    const splitUnclosed = splitUnclosedThinkContent(lastMsgContent);
    if (splitUnclosed) {
      lastThinkPart = splitUnclosed.thinkPart;
      postPart = splitUnclosed.postPart;
    }
  }

  foldedItems.push({
    type: 'message',
    id: `${lastItem.id}-think`,
    message: {
      ...lastItem.message,
      id: `${lastItem.message.id}-think`,
      content: stripThinkTags(lastThinkPart),
    },
  });

  if (postPart) {
    postFoldItems.push({
      type: 'message',
      id: `${lastItem.id}-post`,
      message: { ...lastItem.message, id: `${lastItem.message.id}-post`, content: postPart },
    });
  }

  for (let i = lastThinkIdx + 1; i < responseItems.length; i++) {
    postFoldItems.push(responseItems[i]);
  }

  return [
    ...preFoldItems,
    {
      type: 'folded_block',
      id: `folded-${turnIndex}`,
      duration: calculateFoldedDuration(responseItems, firstThinkIdx),
      foldedItems,
    },
    ...postFoldItems,
  ];
}

function cleanFoldedItem(
  item: ConversationTimelineMessageItem | ConversationTimelineToolGroupItem,
): ConversationTimelineMessageItem | ConversationTimelineToolGroupItem {
  if (item.type !== 'message') return item;

  return {
    ...item,
    message: {
      ...item.message,
      content: stripThinkTags(cleanMessageContent(item.message.content)),
    },
  };
}

function cleanVisibleItem(
  item: ConversationTimelineMessageItem | ConversationTimelineToolGroupItem,
): ConversationTimelineMessageItem | ConversationTimelineToolGroupItem {
  if (item.type !== 'message' || item.message.role !== 'assistant') return item;

  const content = cleanMessageContent(item.message.content);
  if (content === item.message.content) return item;

  return {
    ...item,
    message: {
      ...item.message,
      content,
    },
  };
}

function calculateFoldedDuration(
  responseItems: Array<ConversationTimelineMessageItem | ConversationTimelineToolGroupItem>,
  firstThinkIdx: number,
): number {
  const firstItem = responseItems[firstThinkIdx];
  if (firstItem.type !== 'message') return 1;

  const startTimestamp = firstItem.message.created_at;
  const lastMessageItem = [...responseItems].reverse().find((item) => item.type === 'message');
  const endTimestamp = lastMessageItem?.message.created_at ?? startTimestamp;
  return Math.max(1, Math.round((endTimestamp - startTimestamp) / 1000));
}

function cleanMessageContent(content: string): string {
  if (!content) return '';

  let cleanContent = content;
  const thinkCount = (cleanContent.match(/<think>/g) || []).length;
  const thinkEndCount = (cleanContent.match(/<\/think>/g) || []).length;
  if (thinkEndCount > thinkCount) {
    if (thinkCount === 0) {
      cleanContent = cleanContent.replace(/<\/think>/g, '');
    } else {
      const lastIdx = cleanContent.lastIndexOf('</think>');
      if (lastIdx !== -1) {
        cleanContent = cleanContent.substring(0, lastIdx) + cleanContent.substring(lastIdx + 8);
      }
    }
  }
  return cleanContent;
}

function stripThinkTags(content: string): string {
  return content.replace(/<\/?think>/g, '').trim();
}

function cleanMultiItemLastThinkContent(content: string): string {
  const thinkCount = (content.match(/<think>/g) || []).length;
  const thinkEndCount = (content.match(/<\/think>/g) || []).length;
  if (thinkEndCount <= 1) return content;
  if (thinkCount > 0) return cleanMessageContent(content);

  const firstEndIdx = content.indexOf('</think>');
  if (firstEndIdx === -1) return content;
  const firstEndTagEnd = firstEndIdx + '</think>'.length;
  return content.substring(0, firstEndTagEnd) + content.substring(firstEndTagEnd).replace(/<\/think>/g, '');
}

function splitUnclosedThinkContent(content: string): { thinkPart: string; postPart: string } | null {
  const thinkStartIdx = content.lastIndexOf('<think>');
  if (thinkStartIdx === -1 || content.includes('</think>')) return null;

  const thinkBodyStartIdx = thinkStartIdx + '<think>'.length;
  const contentAfterThink = content.substring(thinkBodyStartIdx);
  const separatorIdx = contentAfterThink.lastIndexOf('\n\n');
  if (separatorIdx === -1) return null;

  const thinkBody = contentAfterThink.substring(0, separatorIdx).trim();
  const postPart = contentAfterThink.substring(separatorIdx).trim();
  if (!thinkBody || !postPart) return null;

  return {
    thinkPart: `${content.substring(0, thinkBodyStartIdx)}${thinkBody}`,
    postPart,
  };
}

function isToolMessage(message: Message): boolean {
  if (message.role !== 'system') return false;

  try {
    const parsed = JSON.parse(message.content);
    return Boolean(parsed && parsed.type === 'tool');
  } catch {
    return false;
  }
}
