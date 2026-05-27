---
status: complete
---

# Quick Task 260527-jt8: ArXiv 工具 UI 集成与开关控制

## Changes Made

### 1. arxiv-tool.ts — 适配 SearchProviderConfig 模式
- `createArxivTool` 函数签名改为接受 `SearchProviderConfig | null` 参数
- 当 config 为 null 时返回友好错误提示
- 从 config.config 中读取 `max_results` 覆盖默认值

### 2. runtime.ts — 从 tool_configs 条件加载
- 从 `builtInTools` 数组中移除硬编码的 `createArxivTool()`
- 新增 `loadFreeToolConfig` 函数（不需要 API Key 校验）
- 在 search tools 加载逻辑旁添加 ArXiv 工具的条件加载

### 3. ToolSettings.tsx — UI 集成
- 在 `INTEGRATED_TOOLS` 数组中添加 arxiv 条目
- `ToolMeta` 接口新增 `requiresApiKey` 可选字段（默认 true）
- arxiv 设为 `requiresApiKey: false`，无需 API Key 即可启用
- 修改 `handleToggle`、`handleSaveConfig`、`isToolConfigured` 逻辑支持无 Key 工具
- 配置抽屉中隐藏 API Key 输入框和"申请 API Key"链接

## Result
ArXiv 论文搜索工具现在与 Tavily/AnySearch 一样，在设置界面中可见、可配置、可开关控制。由于 arXiv 是免费 API，无需 API Key 即可启用使用。
