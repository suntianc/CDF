---
quick_id: 260601-nzn
slug: patch-package-minimax-m3
status: complete
date: 2026-06-01
commits:
  - 7bb83c2: chore(deps): add patch-package to passthrough LangChain video blocks
  - 2514ebd: feat(provider): MiniMax M3 model adaptation (1M context)
---

# Quick Task 260601-nzn: patch-package 解锁 MiniMax M3 视频透传 — Summary

## Goal

使用 patch-package 方案为 MiniMax M3 解锁视频透传能力,避免 LangChain 1.x 默认在两处静默丢弃 video 块。

## What Was Done

### 1. 定位 video 丢弃点(调研)

LangChain `@langchain/anthropic` 在两处静默丢弃 video 块:

| 文件 | 行 | 路径 | 原代码 |
|------|---|------|--------|
| `dist/utils/standard.js` | 267 | v1 assistant 消息 | `} else if (block.type === "video") {}` |
| `dist/utils/message_inputs.js` | 179 | 用户消息 | 没有 video 分支(未匹配 type 静默丢弃) |

**Anthropic SDK (`@anthropic-ai/sdk`) 本身不校验 content 块 type**,只做 HTTP 透传;所以只要 LangChain 不拦截,video 块可原样送达 MiniMax M3 服务端。

### 2. 应用 patch

**`standard.js:267`** — video 块原样入栈:
```js
// 原
} else if (block.type === "video") {} else if (block.type === "text-plain") {
// 改
} else if (block.type === "video") { result.push(block); continue; } else if (block.type === "text-plain") {
```

**`message_inputs.js:179`** — video 块与 `container_upload` 同处理(原样 yield):
```js
// 原
} else if (contentPart.type === "container_upload") yield {
// 改
} else if (contentPart.type === "video" || contentPart.type === "container_upload") yield {
```

### 3. 配置持久化机制

- 安装 `patch-package@^8.0.1` 到 devDependencies
- `node_modules/.bin/patch-package @langchain/anthropic` 生成 patch:
  - 文件: `patches/@langchain+anthropic+1.4.0.patch`
  - 内容: 2 文件 diff,各 1 行变更
- `package.json` postinstall 改为:
  ```json
  "postinstall": "electron-builder install-app-deps && patch-package"
  ```

### 4. 测试验证

- `npm test -- --run` 结果: **93 passed**, 2 failed(预存在的 `file-tools.test.ts` 和 `skill-manager.test.ts` 环境问题)
- 与打 patch 前完全一致:**无回归**
- 新增的 2 个 M3 测试也通过(国内 1M + 海外 sk-cp token)

### 5. 提交

| Commit | 内容 |
|--------|------|
| `7bb83c2` | `chore(deps): add patch-package to passthrough LangChain video blocks` |
| `2514ebd` | `feat(provider): MiniMax M3 model adaptation (1M context)` |

## Files Changed

```
M  package.json                  (新增 patch-package + postinstall)
M  package-lock.json             (新增 patch-package 依赖树)
A  patches/@langchain+anthropic+1.4.0.patch   (新增,19 行)
M  src/main/database.ts          (MiniMax CN/海外默认配置 → M3)
M  src/renderer/src/components/Settings/ModelSettings.tsx  (UI 默认模型)
M  src/main/deepagent/llm-adapter.test.ts  (M3 测试覆盖)
```

## Engineering Trade-offs

### 为什么选 patch-package 而不是其他方案

| 方案 | 缺点 |
|------|------|
| 直接改 node_modules | `npm install` 后被覆盖 |
| Monkey-patch 实例方法 | 依赖 LangChain 私有 API,升级易破坏 |
| 旁路裸 Anthropic SDK | 失去 LangChain 工具链 |
| **patch-package** | ✅ MIT 合法 + 持久化 + 可 review(diff 格式) |

### 副作用分析

修改影响所有 `@langchain/anthropic` 调用路径,但仅当 `contentPart.type === "video"` 时才触发:
- **没有 video 块**:无副作用(代码分支不进入)
- **M3 + video**:✅ 透传成功
- **其他 Anthropic 兼容 provider + video**:服务端 400 错误(用户显式失败,符合"早暴露"原则)

## Outcome

✅ **MiniMax M3 现在支持视频入参**:
- 用户消息中的 video 块原样透传到 Anthropic SDK
- SDK JSON 透传到 MiniMax 服务端
- 服务端原生处理 type:"video" 块(支持 URL / base64 / mm_file:// 三种 source)

📝 **未来升级 LangChain 时**:需要重新跑 `npx patch-package @langchain/anthropic`,可能需要根据新版本的行号微调 patch(若 line 267/179 变动)。
