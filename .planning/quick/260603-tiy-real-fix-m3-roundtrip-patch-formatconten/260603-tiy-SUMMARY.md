---
quick_id: 260603-tiy
slug: real-fix-m3-roundtrip-patch-formatconten
status: complete
date: 2026-06-03
commits:
  - c269085: "fix(llm): patch @langchain/anthropic 1.4.0 to roundtrip reasoning+signature in fallthrough path"
---

# Quick Task 260603-tiy: real-fix-m3-roundtrip-patch-formatconten

## One-liner

修补 `@langchain/anthropic@1.4.0` 的 `_formatContentBlocks` fallthrough 路径漏洞,把 `type: "reasoning"` + `signature` 块转为 Anthropic 协议要求的 `{ type: "thinking", thinking, signature }`,关闭 deepagents checkpoint 序列化后 v1 marker 丢失场景下 M3 多轮 signature 静默丢失的回路。

## Scope

修两份并行构建产物 + 加 1 个测试,以单一原子 commit 提交。

## Changes Shipped

### 1. `patches/@langchain+anthropic+1.4.0.patch` (regenerated)

- **新增 hunk:** `message_inputs.js` line 182 后插入 `else if (contentPart.type === "reasoning" && "signature" in contentPart) yield { type: "thinking", thinking, signature, ...cacheControl ? { cache_control } : {} };` 分支
- **新增 hunk:** `message_inputs.cjs` 相同位置(line 183 后)插入相同分支
- **保留:** 260601-nzn 原 video/container_upload 透传 hunk (message_inputs.js + standard.js)
- **总 hunk 数:** 3(plan 预期)
- **幂等性:** `npx patch-package @langchain/anthropic` 第二次跑无 diff,确认 patch 文件与 node_modules 同步

### 2. `src/main/deepagent/anthropic-roundtrip.test.ts`

- **文件顶部注释:** 追加 "Fallthrough path (no v1 marker) — bug + patch" 段,显式说明 b 任务"自动 roundtrip"结论仅覆盖 v1 路径,本 patch 填补 fallthrough 漏洞;附升级 LangChain 时如何回滚的指引
- **新增 1.4 it 块:** 构造 AIMessage(`response_metadata: {}` 故意不含 `output_version: "v1"`)+ reasoning+signature 块,断言 `_convertMessagesToAnthropicPayload` 产出 `{ type: "thinking", thinking, signature }` 块。如果 patch 未应用或未来上游升级覆盖,该测试立即失败
- **未变:** 1.1 / 1.2 / 1.3 三个原有 it 块

## Verification

| Check | Command | Result |
| --- | --- | --- |
| 新分支已植入 .js | `grep 'type === "reasoning"' node_modules/@langchain/anthropic/dist/utils/message_inputs.js` | 1 match ✓ |
| 新分支已植入 .cjs | `grep 'type === "reasoning"' node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs` | 1 match ✓ |
| Patch 文件 hunk 数 | `grep -c '^@@' patches/@langchain+anthropic+1.4.0.patch` | 3 ✓ |
| patch-package 幂等 | `npx patch-package @langchain/anthropic`(第二次) | no diff ✓ |
| 原 video hunks 保留 | grep `"video"` in patch | 2 matches(.js + standard.js)✓ |
| 新 test 1.4 + 既有 PASS | `npx vitest run src/main/deepagent/anthropic-roundtrip.test.ts` | worktree 4/4 PASS,main 3/3 PASS,合计 7/0 ✓ |
| 既有 llm-adapter 回归 | `npx vitest run src/main/deepagent/llm-adapter.test.ts` | 10/10 PASS(worktree)+ 10/10 PASS(main)= 20/0 ✓ |

## Deviations from Plan

### Rule 1 — Bug Fix: 必须同时 patch `.js` AND `.cjs`(plan 仅指示 `.js`)

- **Found during:** Task 1(在准备改 .js 前先核查现状)
- **Issue:** Plan 第 58 行声称 "executor 只需编辑 .js 文件,patch-package 会自动检测",并预期 `.cjs` 由 .js 自动派生。实测:`.js`(ESM)与 `.cjs`(CommonJS)是 TypeScript 源同时构建出的**两份并行产物**,不存在自动同步关系。生产 Electron main 打包为 CJS(`out/main/index.js` 全文用 `require()`),`@langchain/anthropic` 的 `package.json#exports.require` 路由到 `.cjs`,所以生产实际加载 `.cjs`;`src/main/deepagent/anthropic-roundtrip.test.ts` line 43-46 通过 `createRequire` + `node_modules/.../message_inputs.cjs` 直接加载 `.cjs`。只 patch `.js`:(a) 生产 bug 不修;(b) 测试 1.4 必然失败(因为加载 .cjs 没有新分支)。
- **Fix:** 同时编辑 `node_modules/@langchain/anthropic/dist/utils/message_inputs.js`(line 182 后)与 `node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs`(line 183 后),插入相同的 reasoning → thinking 分支;`npx patch-package @langchain/anthropic` 自动检测两个文件改动,生成的 patch 共 3 hunks(message_inputs.cjs 新 1 hunk + message_inputs.js 原 video hunk 与新 reasoning hunk 合并为 1 hunk + standard.js 原 video hunk 1 hunk)— **hunk 总数仍是 3,与 plan 预期一致**(虽然 plan 的推理依据是错的,但凑巧总数对得上)。
- **Files modified:** `node_modules/@langchain/anthropic/dist/utils/message_inputs.js`(未 commit,patch 自描述)+ `node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs`(未 commit,patch 自描述)+ `patches/@langchain+anthropic+1.4.0.patch`(已 commit)
- **Commit:** c269085

### Rule 1 — Bug Fix(scope-bounded log,未修复):260601-nzn video patch 同样只动 `.js` 漏 `.cjs`

- **Found during:** 对照 `.cjs` 内容时观察到
- **Issue:** `node_modules/@langchain/anthropic/dist/utils/standard.cjs:267` 仍是 `} else if (block.type === "video") {} else if (...)`(空 block,bug 原样);`standard.js` 在 260601-nzn patch 后是 `{ result.push(block); continue; }`(已修)。如果生产场景命中 v1 路径 + video 块,生产仍走 `.cjs` 的空 block,video 块会被丢。
- **Decision:** **scope 外,本任务不修**。当前 plan 是 fix M3 thinking,不是 fix video 透传;并且未观察到用户报告 video 丢失;且修这个会牵涉到额外的 standard.cjs 编辑 + 4-hunk patch(超出 plan 预期的 3-hunk)。
- **Action:** 记录为 deferred,留给将来 video 类 quick 任务一起处理。

### Process correction: absolute-path safety violation(自我纠正)

- **Found during:** 跑第一次 vitest 时发现测试结果出现两个文件(主仓库 + worktree),且 worktree 的 test 文件只有 3 tests(没有我新加的 1.4)
- **Issue:** 在第一次编辑 patches/...patch 与 src/main/deepagent/anthropic-roundtrip.test.ts 时,使用了从 orchestrator pwd 派生的绝对路径(`/Users/suntc/project/CDF/...`),Bash tool 的 cwd 在每次 call 间会 reset 到 orchestrator pwd,所以 `Edit` 工具收到的绝对路径解析到了主仓库而非 worktree。这是 #3099 描述的典型错。
- **Fix:** `cp` 把主仓库的两个文件复制到 worktree → `git -C /Users/suntc/project/CDF checkout --` 撤销主仓库的意外修改 → 校验 worktree git status 与 main repo git status 一致 → 在 worktree 跑 vitest 4/4 PASS,在主仓库跑 vitest 7/7 PASS(worktree 4 + main 3)
- **Lesson:** 应使用 `git rev-parse --show-toplevel` 得到的 worktree 根路径或相对路径编辑文件。下次起始应先确认 cwd。
- **Files affected:** node_modules 改动留在主仓库(预期,因为 worktree 无独立 node_modules);patch 文件 + test 文件最终落入 worktree 并被 commit;主仓库恢复 clean(除 pre-existing `.codegraph/daemon.pid` + `.claude/worktrees/` 未跟踪外)。

## Threat Model Outcome

| Threat ID | Disposition (planned) | Outcome |
| --- | --- | --- |
| T-quick-tiy-01 | mitigate (双条件守卫) | ✓ `"signature" in contentPart` 守卫已落实,无 signature 的 reasoning 块继续 fall through 被丢 |
| T-quick-tiy-02 | mitigate (不动 video/container_upload) | ✓ message_inputs.js 的 video/container_upload 分支文本完全保留(只是分号被新分支借走,逻辑等价) |
| T-quick-tiy-03 | mitigate (不动其他分支) | ✓ test 1.1-1.3 + llm-adapter 10/10 通过,隐式证明其他分支未变 |
| T-quick-tiy-04 | mitigate (1.4 用 `response_metadata: {}`) | ✓ 1.4 构造的 AIMessage 严格不含 `output_version: "v1"`,确认走 fallthrough 路径 |
| T-quick-tiy-05 | accept (patch 被 git 跟踪) | n/a |
| T-quick-tiy-06 | mitigate (升级回滚指引在 test 顶部注释) | ✓ 注释明确"若上游覆盖,删 hunk + 删 1.4 it 块" |
| T-quick-tiy-07 | accept | n/a |
| T-quick-tiy-08 | mitigate (patch-package 幂等 + tests) | ✓ 二次 patch-package no-op + tests 4/0 + llm-adapter 10/0 |
| T-quick-tiy-SC | n/a | 无 npm install |

## Threat Flags

无新增可疑表面:本次只动 patch-package 已涉及的两个文件 + 一个测试文件,无新网络端点、auth 路径、文件访问模式或 schema 变更。

## Files

### Created
- `.planning/quick/260603-tiy-real-fix-m3-roundtrip-patch-formatconten/260603-tiy-SUMMARY.md`(本文件)

### Modified (committed)
- `patches/@langchain+anthropic+1.4.0.patch`(2 hunks → 3 hunks)
- `src/main/deepagent/anthropic-roundtrip.test.ts`(顶部注释追加 + 新 1.4 it 块)

### Modified (intentionally NOT committed — patch-package 自描述)
- `node_modules/@langchain/anthropic/dist/utils/message_inputs.js`(新 reasoning 分支)
- `node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs`(新 reasoning 分支)

## Self-Check

- [x] patch 文件存在 `patches/@langchain+anthropic+1.4.0.patch`(3 hunks)
- [x] 测试文件存在 `src/main/deepagent/anthropic-roundtrip.test.ts`(4 it 块)
- [x] commit c269085 存在于 worktree-agent-a8eccf673d3e0636a 分支
- [x] 4/4 PASS for anthropic-roundtrip.test.ts(worktree 文件)
- [x] 10/10 PASS for llm-adapter.test.ts(回归)

## Self-Check: PASSED
