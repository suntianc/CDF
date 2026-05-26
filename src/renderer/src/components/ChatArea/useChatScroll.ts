import { useEffect, useRef } from 'react';

interface UseChatScrollProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  messages: any[];
  activeSessionId: string | null;
  isStreaming: boolean;
}

export function useChatScroll({
  scrollContainerRef,
  messages,
  activeSessionId,
  isStreaming,
}: UseChatScrollProps) {
  const shouldAutoScrollRef = useRef(true);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // 如果滚动条距离底部大于 50px，说明用户手动往上滚动了，我们需要暂停自动吸底
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    shouldAutoScrollRef.current = isAtBottom;
  };

  // 消息数量改变时（如发送新消息或流式中间产生工具消息）
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    const isUserSent = lastMsg && lastMsg.role === 'user';

    if (isUserSent) {
      // 只有当最新消息是用户发送的，才无条件强制重置锁定并滚到底部
      shouldAutoScrollRef.current = true;
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    } else {
      // 其它情况（如流式中间增加工具消息），只有在原本就处于自动滚动时才跟随滚动
      const container = scrollContainerRef.current;
      if (container && shouldAutoScrollRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages.length]);

  // 当切换会话时，重置自动滚动，并强制滚到底部
  useEffect(() => {
    shouldAutoScrollRef.current = true;
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeSessionId]);

  // 当流式刚刚结束时，如果用户没有手动往上滚，则执行一次平滑滚动到底部
  useEffect(() => {
    if (isStreaming) return;
    const container = scrollContainerRef.current;
    if (container && shouldAutoScrollRef.current) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [isStreaming]);

  // 流式输出期间，在 requestAnimationFrame 中平滑维持滚动到底部
  useEffect(() => {
    if (!isStreaming) return;

    let active = true;
    const updateScroll = () => {
      if (!active) return;
      const container = scrollContainerRef.current;
      if (container && shouldAutoScrollRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      requestAnimationFrame(updateScroll);
    };

    requestAnimationFrame(updateScroll);
    return () => {
      active = false;
    };
  }, [isStreaming]);

  return {
    handleScroll,
    shouldAutoScrollRef,
  };
}
