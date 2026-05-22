# Plan: Fix assistant-ui Uncaught TypeError

## Goal
移除 `ChatArea.tsx` 中未使用且会在 React 19 下引发 `Uncaught TypeError: Cannot read properties of undefined (reading 'type')` 错误的 `@assistant-ui/react` 运行环境包装。

## Checklist
- [x] 1. 修改 `src/renderer/src/components/ChatArea/ChatArea.tsx`，移除 `@assistant-ui/react` 的导入。
- [x] 2. 移除 `threadMessages` 和 `runtime` 相关的 state 初始化。
- [x] 3. 移除 JSX 中的 `<AssistantRuntimeProvider>` 组件包装。
- [x] 4. 运行 `npm run build` 和 `npm run test` 确保无编译错误且测试通过。
