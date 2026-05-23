# Plan: Fix MiniMax compatible URL normalization

## Goal
修复 MiniMax 兼容接口因错误域名 `api.minimaxi.com` 导致 `llm:chat` 返回 404 / MODEL_NOT_FOUND 的问题。

## Checklist
- [x] 1. 新增共享 URL 归一化工具，自动将已知错误的 MiniMax 域名修正为官方域名。
- [x] 2. 修改主进程 `llm` 调用与供应商保存逻辑，运行时和保存时都使用归一化后的 URL。
- [x] 3. 增加最小回归测试，并运行 `npm test` 验证。
