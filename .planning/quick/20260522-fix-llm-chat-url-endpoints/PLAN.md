# Plan: Fix LLM chat URL endpoints concatenation

## Goal
修复 `src/main/llm.ts` 中当配置了自定义 `apiUrl` 时, 由于未正确拼接 `/chat/completions` (针对 OpenAI/Custom) 或 `/messages` (针对 Anthropic) 导致请求发送至基地址产生 404 错误的问题。

## Checklist
- [x] 1. 修改 `src/main/llm.ts` 中的 `openai` 和 `custom` 分支, 确保在配置了 `apiUrl` 时正确拼接 `/chat/completions`。
- [x] 2. 修改 `src/main/llm.ts` 中的 `anthropic` 分支, 确保在配置了 `apiUrl` 时正确拼接 `/messages`。
- [x] 3. 运行 `npm run build` 和 `npm run test` 验证修改并确保项目正常编译和通过测试。
