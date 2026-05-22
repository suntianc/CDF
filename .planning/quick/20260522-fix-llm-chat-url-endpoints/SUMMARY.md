# Summary: Fix LLM chat URL endpoints concatenation

本次修复解决了在自定义 `apiUrl` 时发生的 404 页面未找到问题。

## 修复概述
当用户在前端配置自定义 `apiUrl` 时（例如将 DeepSeek、OpenAI 代理地址填写在 API URL 中），系统在发起 `llm:chat` 运行时调用时，直接使用了该 API 基地址，而不是拼接具体的 API endpoint 路径（例如 `/chat/completions` 或 `/messages`），导致请求发送给目标服务商后响应 `404 page not found`。

修改方案：
- 针对 `openai` 和 `custom` 类型提供商：若 `apiUrl` 未以 `chat/completions` 或 `chat/completions/` 结尾，则自动拼接该路径。
- 针对 `anthropic` 类型提供商：若 `apiUrl` 未以 `messages` 或 `messages/` 结尾，则自动拼接该路径。

## 验证与测试
- 运行测试 `npm run test` 全部成功通过。
- 运行构建 `npm run build` 成功完成 Electron 编译打包。
