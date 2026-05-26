---
status: resolved
trigger: "使用输入法输入英文使用回车后，自动发送消息出去"
created: "2026-05-25"
updated: "2026-05-25"
---

# Debug Session: IME Enter Send

## Symptoms

- Expected behavior: 输入法场景下，Enter 用于确认候选/结束组合输入，不应触发发送消息。
- Actual behavior: 使用输入法输入英文后按 Enter，消息被自动发送。
- Error messages: 无。
- Timeline: 当前对话框输入体验中发现。
- Reproduction: 在聊天输入框中启用输入法输入英文，按 Enter 确认输入。

## Current Focus

- hypothesis: 现有 Enter 发送逻辑只检查 React `e.isComposing` 和短暂 `compositionend` 标记，部分输入法/浏览器组合下确认 Enter 事件到达时该值已为 false，导致误触发发送。
- test: 为输入框补齐 composition lifecycle ref、nativeEvent.isComposing 和 keyCode/which 229 判定后执行类型检查/测试。
- expecting: 输入法确认 Enter 不发送，普通 Enter 仍发送，Shift+Enter 保持换行。
- next_action: patch ChatArea Enter handling and verify.

## Evidence

- 2026-05-25: `src/renderer/src/components/ChatArea/ChatArea.tsx` 中 welcome 与主 composer 都在 Enter 且非 Shift 时直接发送，仅有 `e.isComposing` 和 `justFinishedComposingRef` 防护。

## Eliminated

None.

## Resolution

- root_cause: 输入法确认 Enter 的 keyboard event 在部分运行环境中不会稳定暴露为 React `e.isComposing`，原逻辑可能在组合输入刚结束时把 Enter 当作普通发送键处理。
- fix: 在 `ChatArea.tsx` 中增加 composition lifecycle ref，统一欢迎页和主 composer 的 `compositionstart/end` 处理，并在 keydown 中同时检查 ref、`nativeEvent.isComposing` 和 `keyCode/which === 229`。
- verification: `npm run build` 通过；`npm test` 通过。`npm test -- --runInBand` 不适用于 Vitest，因未知参数被拒。
- files_changed: `src/renderer/src/components/ChatArea/ChatArea.tsx`
