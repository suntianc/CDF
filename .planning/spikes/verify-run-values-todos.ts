/**
 * 验证 run.values 是否包含 todos 字段
 *
 * 运行方式：在 Electron 主进程中执行，或用 ts-node 直接运行
 * 预期：run.values 产出的 state 快照中包含 todos 数组
 */

import { createDeepAgent, CompositeBackend, StateBackend, FilesystemBackend } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';

async function verifyRunValuesTodos() {
  console.log('=== 验证 run.values 是否包含 todos ===\n');

  const model = new ChatOpenAI({ model: 'gpt-4o-mini' });

  const agent = createDeepAgent({
    model,
    backend: new CompositeBackend(new StateBackend(), {
      '/workspace/': new FilesystemBackend({ rootDir: '/tmp/test', virtualMode: true }),
    }),
    systemPrompt: 'You are a test agent. Use write_todos to create a simple todo list with 2 items.',
  });

  try {
    const run = await agent.streamEvents(
      { messages: [{ role: 'user', content: 'Create a todo list with 2 tasks' }] },
      { version: 'v3' }
    );

    let snapshotCount = 0;
    let todosFound = false;

    // run.values 是 AsyncIterable，产出 state 快照
    for await (const state of run.values) {
      snapshotCount++;
      const hasTodos = 'todos' in state;
      const todosValue = hasTodos ? (state as any).todos : undefined;

      console.log(`[Snapshot ${snapshotCount}] hasTodos=${hasTodos}, type=${typeof todosValue}`);

      if (hasTodos && Array.isArray(todosValue) && todosValue.length > 0) {
        todosFound = true;
        console.log(`  ✓ todos 内容:`, JSON.stringify(todosValue, null, 2));
      }
    }

    console.log(`\n=== 结果 ===`);
    console.log(`总快照数: ${snapshotCount}`);
    console.log(`todos 字段存在: ${todosFound ? '✓ YES' : '✗ NO'}`);

    if (todosFound) {
      console.log('\n✓ 验证通过：run.values 包含 todos，可替代轮询机制');
    } else {
      console.log('\n✗ 验证失败：run.values 未包含 todos，可能需要其他方式');
    }
  } catch (err: any) {
    console.error('验证失败:', err.message);
    console.error('可能原因: 需要有效的 API Key 或在 Electron 环境中运行');
  }
}

verifyRunValuesTodos();
