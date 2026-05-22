# Summary: Fix assistant-ui Uncaught TypeError

由于 `@assistant-ui/react` 内部代码逻辑与 React 19 配合以及在空消息队列状态下存在越界访问缺陷，在页面渲染时会抛出 `Uncaught TypeError: Cannot read properties of undefined (reading 'type')`。

## 修复概述
- 经代码库审查确认，整个项目实际上完全使用了自定义的手写聊天框逻辑（通过 Tailwind CSS & Lucide 渲染，采用 Zustand 进行状态流式同步），并没有使用任何 `@assistant-ui/react` 提供的 UI 组件。
- 移除多余的 `@assistant-ui/react` 的逻辑：
  - 移除了 `ChatArea.tsx` 中的对该库的引用和 `useExternalStoreRuntime` 初始化逻辑。
  - 移除了渲染外层多余的 `<AssistantRuntimeProvider>` 组件包装。

## 验证与测试
- 执行 `npm run test` 所有单元测试通过。
- 执行 `npm run build` 成功通过打包编译，运行无误。
