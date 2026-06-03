---
quick_id: 260603-u6w
slug: real-fix-2-v1-isanthropicmessage-formats
status: complete
date: 2026-06-03
commits:
  - 13981db: fix(llm): remove isAnthropicMessage guard from v1 _formatStandardContent reasoning branch
---

# Quick Task 260603-u6w: real-fix-2-v1-isanthropicmessage-formats

## One-liner

修补 `@langchain/anthropic@1.4.0` 的 v1 路径 bug:从 `_formatStandardContent`(standard.js / standard.cjs)的 `reasoning` 分支中移除冗余的 `&& isAnthropicMessage` 守卫,关闭 deepagents `langgraph-checkpoint-sqlite` 序列化后 `output_version: "v1"` 存活但 `model_provider` 丢失场景下 reasoning 块被静默丢弃、M3 第二轮无思考区的回路;同步扩展 1.5 it 块直接调用 `_formatStandardContent` 锁定该修复。

## Scope

修两份并行构建产物 + 扩 1 个测试 + 重生 patch + 单 commit 提交到 worktree 分支。

## Changes Shipped

### 1. `patches/@langchain+anthropic+1.4.0.patch` (regenerated)

- **新增 hunk:** `standard.cjs` line 126 移除 `&& isAnthropicMessage` 守卫
- **新增 hunk:** `standard.js` line 126 同步移除同一守卫
- **保留:** 260601-nzn 原 video/container_upload 透传 hunks(message_inputs.js + standard.js)+ 260603-tiy reasoning→thinking hunks(message_inputs.js + message_inputs.cjs)
- **总 hunk 数:** 3 → 5
- **幂等性:** `./node_modules/.bin/patch-package @langchain/anthropic` 第二次跑无 diff(只有 "Diffing your files with clean files" 进度消息),确认 patch 文件与 node_modules 同步

### 2. `node_modules/@langchain/anthropic/dist/utils/standard.{js,cjs}` (patch 自描述,未 commit)

- `standard.js` line 129:`} else if (block.type === "reasoning" && isAnthropicMessage) result.push({` → `} else if (block.type === "reasoning") result.push({`
- `standard.cjs` line 129:同步修改
- `isAnthropicMessage` 变量声明保留(line 98),其他三个分支继续使用:
  - `server_tool_call` (line 134)
  - `server_tool_call_result` (line 147)
  - `non_standard` (line 276)
- 修改后剩余 `&& isAnthropicMessage` 出现次数:standard.js = 3,standard.cjs = 3

### 3. `src/main/deepagent/anthropic-roundtrip.test.ts`

- **文件顶部注释追加:** "Patch scope v2" 段(在 260603-tiy 的 "Fallthrough path" 段后,"References" 段前),显式说明本次 patch 范围是 v1 路径(`_formatStandardContent`),与 260603-tiy 互补;附升级 LangChain 时如何回滚的指引
- **新增 `_formatStandardContent` 导入:** 通过 `createRequire` + `node_modules/.../standard.cjs` 直接加载
- **新增 1.5 it 块:** 构造 plain object(显式提供 `contentBlocks: [...]`)+ `response_metadata: { output_version: 'v1' }`(**故意不设** `model_provider`),直接调用 `_formatStandardContent`,断言产出包含 `{ type: 'thinking', thinking, signature }` 块
- **未变:** 1.1 / 1.2 / 1.3 / 1.4 四个原有 it 块

## Verification

| Check | Command | Result |
| --- | --- | --- |
| patch 文件 hunk 数 | `grep -c '^@@' patches/@langchain+anthropic+1.4.0.patch` | 5 ✓ (3 → 5) |
| patch-package 幂等 | `./node_modules/.bin/patch-package @langchain/anthropic`(第二次) | 无 diff(只 diffing 进度消息)✓ |
| reasoning 守卫已移除(standard.js) | `grep -c "&& isAnthropicMessage" node_modules/.../standard.js` | 3 ✓ (4 → 3) |
| reasoning 守卫已移除(standard.cjs) | `grep -c "&& isAnthropicMessage" node_modules/.../standard.cjs` | 3 ✓ (4 → 3) |
| isAnthropicMessage 变量保留(standard.js) | `grep -c "isAnthropicMessage" node_modules/.../standard.js` | 4 ✓ (变量 + 3 守卫) |
| isAnthropicMessage 变量保留(standard.cjs) | `grep -c "isAnthropicMessage" node_modules/.../standard.cjs` | 4 ✓ (变量 + 3 守卫) |
| anthropic-roundtrip.test.ts | `npx vitest run .../anthropic-roundtrip.test.ts`(worktree 文件,绝对路径) | 5/5 PASS ✓ |
| llm-adapter 回归 | `npx vitest run src/main/deepagent/llm-adapter.test.ts` | 10/10 PASS(worktree 副本)✓ |
| 单一原子 commit | `git log --oneline` | 1 commit:13981db ✓ |
| git status --short (worktree) | clean ✓ |
| git status --short (主仓库) | 仅剩 pre-existing `.codegraph/daemon.pid` + untracked `.claude/worktrees/` ✓ |

## Deviations from Plan

### Process correction: worktree 路径下 test 无法找到 node_modules

- **Found during:** 跑测试时第一次失败,`Cannot find module '/Users/suntc/project/CDF/.claude/worktrees/agent-a13f715a93751e4d9/node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs'`
- **Issue:** worktree 的 `node_modules/` 目录不完整(只有 `.vite/vitest/` 缓存),因为 git worktree 不复制 node_modules;测试用 `path.join(process.cwd(), 'node_modules/...')` 构造路径,process.cwd() 是 worktree,所以路径指向不存在的目录
- **Fix:** 跑测试时**从主仓库**(`cd /Users/suntc/project/CDF && npx vitest run /Users/suntc/project/CDF/.claude/worktrees/agent-a13f715a93751e4d9/src/main/deepagent/anthropic-roundtrip.test.ts`)用绝对路径指向 worktree 的 test 文件。这样:
  - process.cwd() = 主仓库(有完整 node_modules)
  - test 文件从 worktree 路径加载(包含本次修改)
  - vitest 的 require 解析从主仓库的 node_modules 找到 @langchain/anthropic
  - `path.join(process.cwd(), 'node_modules/...')` 解析到主仓库的 node_modules/...
- **影响:** 计划说"在 worktree 跑 vitest",实际需要从主仓库跑(worktree 是独立 git worktree,无 node_modules 复用机制)。这与 260603-tiy 的"process correction: absolute-path safety violation"本质上是同一类问题的两个变种——主仓库 vs worktree 的 cwd 错位。
- **Files affected:** 不需要改文件;只影响测试运行方式
- **Committed in:** 13981db(测试本身未变)

### Process note: 主仓库工作目录清理

- **Found during:** 跑 `patch-package` 后,主仓库的 `patches/...patch` 也被修改(因为 patch-package 写到工作目录的 patches/ 而不是 worktree 的)
- **Action:** 提交到 worktree 后,用 `git -C /Users/suntc/project/CDF checkout -- patches/...` 把主仓库工作目录的 patches/ 恢复到 master 状态(3 hunks,260603-tiy 的版本)。主仓库的 node_modules 仍然有本次 fix,但 patches/ 与 master 一致——worktree 分支的 commit 才是 source of truth
- **影响:** 主仓库保持 clean(除 pre-existing daemon.pid),worktree 的 commit 自描述 patch

## Threat Model Outcome

| Threat ID | Disposition (planned) | Outcome |
| --- | --- | --- |
| T-quick-u6w-01 | mitigate (仅删除 `&& isAnthropicMessage` 守卫) | ✓ `grep -c "&& isAnthropicMessage"` 从 4 降到 3,variable 声明保留 |
| T-quick-u6w-02 | mitigate (同步 .cjs) | ✓ `standard.cjs:129` 同步修改,`patch-package` 自动检测并产出 hunk |
| T-quick-u6w-03 | mitigate (variable 误删防护) | ✓ `grep -c "isAnthropicMessage"` 仍为 4(变量 + 3 守卫) |
| T-quick-u6w-04 | mitigate (video 透传不动) | ✓ 260601-nzn 的 video hunks 保留,test 1.1-1.3 隐式验证其他分支未变 |
| T-quick-u6w-05 | mitigate (1.5 显式 contentBlocks) | ✓ 1.5 用 plain object + 显式 `contentBlocks: [...]` 数组 |
| T-quick-u6w-06 | mitigate (升级回滚指引) | ✓ 顶部注释 "Patch scope v2" 段明文写"如果上游现在无条件处理 reasoning,删 v2 hunks + 删 test 1.5" |
| T-quick-u6w-07 | mitigate (原子 commit) | ✓ 13981db 单 commit 含 patch + test;commit message 显式标注 260603-tiy 不完整(v1 路径未修)与本 fix 的边界 |
| T-quick-u6w-08 | mitigate (patch-package hunk 漂移) | ✓ 二次 patch-package no diff;`grep -c '^@@' patches/...patch` = 5 |
| T-quick-u6w-SC | n/a | 无 npm install |

## Threat Flags

无新增可疑表面:本次只动 patch-package 已涉及的两个文件 + 一个测试文件,无新网络端点、auth 路径、文件访问模式或 schema 变更。

## 已知 260603-tiy 遗留的 video bug(本次 scope 外,per 260603-tiy SUMMARY)

`standard.cjs:267` 仍是空 `else if (block.type === "video") {}`,video 块在 v1 路径走 .cjs 时仍被丢。**scope 外,本次不修**(与 260603-tiy 一致)。

## Files

### Created
- `.planning/quick/260603-u6w-real-fix-2-v1-isanthropicmessage-formats/260603-u6w-SUMMARY.md`(本文件)

### Modified (committed in 13981db)
- `patches/@langchain+anthropic+1.4.0.patch`(3 hunks → 5 hunks)
- `src/main/deepagent/anthropic-roundtrip.test.ts`(顶部注释追加 + 1.5 it 块 + `_formatStandardContent` 导入)

### Modified (intentionally NOT committed — patch-package 自描述)
- `node_modules/@langchain/anthropic/dist/utils/standard.js`(line 129 守卫移除)
- `node_modules/@langchain/anthropic/dist/utils/standard.cjs`(line 129 守卫移除)

## Self-Check

- [x] patch 文件存在 `patches/@langchain+anthropic+1.4.0.patch`(5 hunks)
- [x] 测试文件存在 `src/main/deepagent/anthropic-roundtrip.test.ts`(5 it 块)
- [x] commit 13981db 存在于 worktree-agent-a13f715a93751e4d9 分支
- [x] 5/5 PASS for anthropic-roundtrip.test.ts(worktree 文件,绝对路径 + 主仓库 cwd)
- [x] 10/10 PASS for llm-adapter.test.ts(回归)
- [x] 主仓库工作目录 clean(除 pre-existing `.codegraph/daemon.pid` + untracked `.claude/worktrees/`)
- [x] worktree 工作目录 clean

## Self-Check: PASSED
