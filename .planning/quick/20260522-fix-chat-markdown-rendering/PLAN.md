---
slug: fix-chat-markdown-rendering
title: 修复对话 Markdown 渲染问题
created_at: 2026-05-22
status: incomplete
---

# Plan: 修复对话 Markdown 渲染问题

## Goal
修复对话内容中的 Markdown 格式渲染问题，使大模型回复中的加粗、斜体、行内代码、段落换行、多级标题及有序/无序列表等能够正确、美观地渲染出来。

## Proposed Changes

### [ChatArea.tsx](file:///Users/suntc/project/CDF/src/renderer/src/components/ChatArea/ChatArea.tsx)

- 在 `MessageItem` 作用域或模块级定义：
  - `renderInlineMarkdown(text)`: 处理行内 Markdown 元素，如 `**bold**`, `*italic*`, `` `code` ``。
  - `renderMarkdownText(text)`: 按行分割，解析多级标题(`#` 到 `####`)、无序列表(`-` / `*`)、有序列表(`1.`)、段落。支持合并连续列表项以呈现更佳的排版。
- 在 `MessageItem` 组件的 `renderMain` 逻辑中，将原本返回普通 `<p>{trimmed}</p>` 的部分，替换为 `renderMarkdownText(part)`。

## Verification Plan
- 编译并运行项目，在对话区域输入包含标题、加粗、行内代码、列表等的 Markdown 文本，检查前端界面是否能够优雅、正确地渲染。
- 保证流式生成的平滑性。
