/**
 * Spike 001: 子代理事件隔离
 *
 * 验证目标：agent.stream() + subgraphs: true 能否通过 namespace 区分主代理和子代理事件
 *
 * 测试方法：
 * 1. 创建一个带子代理的 deepagent
 * 2. 用 stream() + subgraphs: true 获取事件流
 * 3. 检查 namespace 是否能区分主代理 vs 子代理
 */

import { createDeepAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';

// 模拟一个简单的子代理
const subagent = {
  name: 'test-subagent',
  description: 'A test subagent that echoes input',
  systemPrompt: 'You are a test subagent. Echo back the user input.',
  tools: [],
  responseFormat: undefined,
};

// 创建主代理
const model = new ChatOpenAI({ model: 'gpt-4o-mini' });

const agent = createDeepAgent({
  model,
  systemPrompt: 'You are a test agent. When asked to echo, delegate to the subagent.',
  subagents: [subagent],
});

async function testStream() {
  console.log('=== Spike 001: 子代理事件隔离测试 ===\n');

  const events: Array<{ namespace: string[]; type: string; data: any }> = [];

  try {
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: 'Please echo: hello world' }] },
      {
        streamMode: ['updates', 'messages'],
        subgraphs: true,
      }
    );

    for await (const chunk of stream) {
      // stream() 返回 [namespace, data] 元组
      const [namespace, data] = chunk;
      const nsArray = Array.isArray(namespace) ? namespace : [namespace];

      const eventInfo = {
        namespace: nsArray,
        type: typeof data === 'object' && data !== null ? Object.keys(data).join(',') : typeof data,
        data: JSON.stringify(data).slice(0, 200),
      };

      events.push(eventInfo);
      console.log(`[Event] namespace=${JSON.stringify(nsArray)} type=${eventInfo.type}`);
      console.log(`  data: ${eventInfo.data}\n`);
    }

    // 分析结果
    console.log('\n=== 分析结果 ===');
    const mainEvents = events.filter((e) => e.namespace.length === 0);
    const subagentEvents = events.filter((e) => e.namespace.length > 0);

    console.log(`主代理事件数: ${mainEvents.length}`);
    console.log(`子代理事件数: ${subagentEvents.length}`);

    if (subagentEvents.length > 0) {
      console.log('\n✓ 子代理事件可以通过 namespace 区分');
      const namespaces = [...new Set(subagentEvents.map((e) => JSON.stringify(e.namespace)))];
      console.log(`  子代理 namespace: ${namespaces.join(', ')}`);
    } else {
      console.log('\n✗ 未检测到子代理事件 — 可能需要子代理实际执行工具调用');
    }

    // 检查是否有 tools: 前缀的 namespace（deepagents 文档提到的模式）
    const toolsNs = events.filter((e) => e.namespace.some((ns) => ns.startsWith('tools:')));
    if (toolsNs.length > 0) {
      console.log(`✓ 检测到 tools: 前缀的 namespace（${toolsNs.length} 个事件）`);
    }
  } catch (err: any) {
    console.error('测试失败:', err.message);
    console.error('可能原因: 需要有效的 API Key 或网络连接');
    console.error('\n替代方案: 检查 deepagents 源码中 stream() 的实现');
  }

  return events;
}

testStream();
