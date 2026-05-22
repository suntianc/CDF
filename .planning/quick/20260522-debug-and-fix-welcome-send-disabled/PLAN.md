# Plan: Fix and Debug Welcome Send Button Disabled Issue

## Goal
解决欢迎页面输入内容后，发送按钮依然因为某种状态卡顿置灰的问题。通过添加挂载时状态强制初始化和 console 状态日志来排查与修复。

## Checklist
- [x] 1. 在 `ChatArea.tsx` 中添加挂载时的 `useEffect` 强制将 `isStreaming` 重置为 `false`。
- [x] 2. 在 `ChatArea.tsx` 渲染体中添加 console 调试输出以监视关键渲染状态。
- [x] 3. 运行 `npm run build` 和 `npm run test` 进行静态与单元测试校验。
