---
quick_id: 260601-nzn
slug: patch-package-minimax-m3
description: 使用 patch-package 方案为 MiniMax M3 解锁视频透传能力
created: 2026-06-01
---

# Quick Task 260601-nzn: patch-package 解锁 MiniMax M3 视频透传

## Background

MiniMax M3 服务端支持 `type:"video"` 内容块,但 `@langchain/anthropic` 在 `dist/utils/standard.js:267` 对 video 块是空块处理(`} else if (block.type === "video") {}`),导致 LangChain ChatAnthropic 调用 M3 时**静默丢失** video 入参。

唯一对应到用户消息路径的 video 转换是 `_formatContentBlocks`(`message_inputs.js:63-184`),该函数**没有 `non_standard` 旁路**——所以 monkey-patch 难度大,且需要 hook 私有方法。

## Solution: patch-package

直接在 `node_modules/@langchain/anthropic/dist/utils/standard.js` 修改 video 块的处理逻辑(改为原样透传),用 `patch-package` 工具把修改保存为 `.patch` 文件,在 `package.json` 配置 `postinstall` 脚本,确保 `npm install` 时自动应用。

## Why patch-package

| 方案 | 缺点 |
|------|------|
| 改 node_modules(直接) | `npm install` 后被覆盖,不可持续 |
| 项目内 monkey-patch 实例方法 | 依赖 LangChain 内部 API 名(`_streamResponseChunks`),升级易破坏 |
| 旁路裸 SDK | 失去 LangChain 工具链 |
| **patch-package** | ✅ 合法(MIT)+ 持久化 + 可 review(diff 格式) |

## Tasks

### Task 1: 修改 standard.js:267 video 空块
- **files:** `node_modules/@langchain/anthropic/dist/utils/standard.js`
- **action:** 把 `} else if (block.type === "video") {}` 改为 `} else if (block.type === "video") result.push(block); continue;`(原样透传 block)
- **verify:** grep 修改后的行
- **done:** video 块不再被静默丢弃

### Task 2: 生成 patch 文件
- **files:** `patches/@langchain+anthropic+*.patch`
- **action:** `npx patch-package @langchain/anthropic`
- **verify:** `patches/` 目录存在 patch 文件,内容包含 standard.js 改动
- **done:** patch 文件已生成,描述清晰

### Task 3: 配置 postinstall 自动应用
- **files:** `package.json`
- **action:** 把 `postinstall` 改为 `patch-package`(已经存在 `electron-builder install-app-deps`,需要保留)
- **verify:** `cat package.json | grep postinstall`
- **done:** 未来 `npm install` 时自动应用 patch

### Task 4: 安装 patch-package 依赖
- **files:** `package.json`
- **action:** 已有 `patch-package` 检查,无则 `npm i -D patch-package`
- **verify:** `node_modules/patch-package` 存在
- **done:** 工具可用

### Task 5: 跑测试验证
- **files:** N/A
- **action:** `npm test -- --run`
- **verify:** 所有测试通过(允许预存在的 file-tools.test.ts / skill-manager.test.ts 失败)
- **done:** 至少 93 个测试通过(包含 M3 适配测试)

### Task 6: 提交变更
- **files:** 上述
- **action:** `git add patches/ package.json package-lock.json` + 提交
- **verify:** `git log` 显示新提交
- **done:** 变更可被 review

## Success Criteria

- [ ] `node_modules/@langchain/anthropic/dist/utils/standard.js:267` 已修改为 video 透传
- [ ] `patches/` 目录包含 `+@langchain+anthropic+*.patch` 文件
- [ ] `package.json` 的 `scripts.postinstall` 包含 `patch-package`
- [ ] `npm test` 至少 93 个测试通过(无回归)
- [ ] git 提交清晰描述变更
