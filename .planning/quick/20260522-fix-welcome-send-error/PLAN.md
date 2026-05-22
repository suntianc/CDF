# Plan: Fix welcome send ReferenceError and UI/UX issues in Phase 2

## Goal
修复 `ChatArea.tsx` 的 `handleWelcomeSend` 函数中由于使用 `project.id` 导致的 `ReferenceError` 错误，并对 `ModelSettings.tsx` 和 `ChatArea.tsx` 进行 UI/UX 体验优化（添加无障碍 aria-label，规范字号和间距）。

## Checklist
- [x] 1. 修改 `src/renderer/src/components/ChatArea/ChatArea.tsx` 中的 `project.id` 为 `projectId`。
- [x] 2. 补全 `ChatArea.tsx` 和 `ModelSettings.tsx` 中图标按钮的 `aria-label` 属性。
- [x] 3. 优化 `ChatArea.tsx` 和 `ModelSettings.tsx` 中的非标准字号和间距（将 `text-[10px]`、`text-[13px]` 和 `min-h-[20px] max-h-[120px]` 替换为 Tailwind 标准样式类）。
- [x] 4. 运行 `npm run build` 和 `npm run test` 进行项目构建和测试验证，确保修改没有引入编译错误或破坏已有功能。
