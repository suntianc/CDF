---
quick_id: 260603-vht
slug: video-patch-cjs-parity-standard-cjs-267-
status: complete
date: 2026-06-03
commits:
  - b51eb6f: "fix(llm): complete 260601-nzn video patch — apply same fix to standard.cjs"
---

# Quick Task 260603-vht: video-patch-cjs-parity-standard-cjs-267-

## One-liner

补 260601-nzn 漏修的 `node_modules/@langchain/anthropic/dist/utils/standard.cjs` line 267 video 透传 patch,把"video 块在 v1 路径下不再被 `_formatStandardContent` 静默丢弃"的修复从 `.js` 镜像到 `.cjs`,关闭 260603-tiy 立下的"patch 必须同时覆盖 .js + .cjs"Rule 1 在 video patch 上的最后缺口。

## Scope

1 处 .cjs 单行修改 + patch 文件 regen(5 → 6 hunk)+ 1 个新建独立回归测试文件 + 单一原子 commit。

## Changes Shipped

### 1. `node_modules/@langchain/anthropic/dist/utils/standard.cjs` (未 commit,patch 自描述)

- **line 267 现状修改前:** `} else if (block.type === "video") {} else if (block.type === "text-plain") {`(空 block,bug 原样)
- **line 267 修改后:** `} else if (block.type === "video") { result.push(block); continue; } else if (block.type === "text-plain") {`
- **未触碰:** 函数的任何其他分支(image / text-plain body / non_standard / reasoning / ...)
- **未触碰:** `standard.js`(已在 260601-nzn 修过,本次镜像而不是新增)
- **text-plain 与 image 分支:** 完全保持原状,`grep` 验证 text-plain 的 `{ type: "document", source: { type: "text", ... } }` 等其他逻辑一字未变

### 2. `patches/@langchain+anthropic+1.4.0.patch` (regenerated,已 commit)

- **总 hunk 数:** 5 → 6(新增第 6 hunk 覆盖 standard.cjs video 修复,与第 5 hunk standard.js video 一一对应)
- **新 hunk 内容(line 53-58):**
  ```
  @@ -264,7 +264,7 @@ function _formatStandardContent(message) {
        continue;
    }
    throw new Error("Image content block must include a fileId, url, or data property.");
  -} else if (block.type === "video") {} else if (block.type === "text-plain") {
  +} else if (block.type === "video") { result.push(block); continue; } else if (block.type === "text-plain") {
    if (block.data) result.push(_applyDocumentMetadata({
        type: "document",
  ```
- **保留的既有 5 hunks:** 完整未改,具体为:
  1. `message_inputs.cjs` reasoning 分支(line 5-16)
  2. `message_inputs.js` video+reasoning 合并 hunk(line 22-38)
  3. `standard.cjs` reasoning isAnthropicMessage 守卫去除(line 44-52)
  4. `standard.js` reasoning isAnthropicMessage 守卫去除(line 66-74)
  5. `standard.js` video passthrough(line 75-83)
- **幂等性:** `npx patch-package @langchain/anthropic` 二次跑 diff 校验 `PATCH IS IDEMPOTENT`(MD5 二次跑前后一致)

### 3. `src/main/deepagent/anthropic-video-passthrough.test.ts` (新文件,已 commit,128 行)

- **文件顶部 JSDoc:** 完整说明 260601-nzn 漏修背景 + 260603-tiy/u6w 的 R1 协同 + 升级回滚指引(若上游原生处理 video 块,删本测试文件 + 删 patch 第 6 hunk)
- **模块加载:** `createRequire(import.meta.url)` + `path.join(process.cwd(), 'node_modules/@langchain/anthropic/dist/utils/standard.cjs')`,与 `anthropic-roundtrip.test.ts` test 1.5 同范式
- **describe 名:** `@langchain/anthropic v1 path — video block passthrough (260601-nzn .cjs parity)`
- **it 名:** `video block survives _formatStandardContent (would be silently dropped without standard.cjs:267 patch)`
- **3 个断言(顺序固定):**
  1. `expect(blocks.length).toBeGreaterThanOrEqual(1)` — 关键 RED/PIN 信号(空 `{}` 分支 → blocks = [],失败 `Received: 0`)
  2. `expect(blocks[0].type).toBe('video')` — 钉住块类型
  3. `expect(blocks[0].source).toEqual({ type: 'base64', data: 'AAAA', media_type: 'video/mp4' })` — 钉住 source 子结构原样保留(因为 fix 是整块透传)
- **AIMessage 构造:** plain object with `contentBlocks: [{ type: 'video', source: { type: 'base64', data: 'AAAA', media_type: 'video/mp4' } }]` + `response_metadata: { output_version: 'v1' }`,后者明确触发 v1 dispatch 路由到 `_formatStandardContent`
- **单一职责:** 仅钉住 v1 path video 透传;其他路径(fallthrough / user message)有既有 patch hunk + 既有测试覆盖

## Verification

| Check | Command | Result |
| --- | --- | --- |
| RED 阶段测试失败 | `npx vitest run src/main/deepagent/anthropic-video-passthrough.test.ts` (patch 应用前) | `expected 0 to be greater than or equal to 1` ✓(清晰指向 video 被丢) |
| 新分支已植入 .cjs | `grep -F 'result.push(block); continue' node_modules/@langchain/anthropic/dist/utils/standard.cjs` | 1 match ✓ |
| 既有 standard.js video 修复保留 | `grep -F 'result.push(block); continue' node_modules/@langchain/anthropic/dist/utils/standard.js` | 1 match ✓ |
| Patch 文件 hunk 数 | `grep -c '^@@' patches/@langchain+anthropic+1.4.0.patch` | 6 ✓(5 → 6) |
| Patch 包含两个 video hunk | `grep -F -c 'result.push(block); continue' patches/@langchain+anthropic+1.4.0.patch` | 2 ✓(standard.js + standard.cjs 各一) |
| 既有 reasoning guard removal hunk 保留 | `grep -c '"reasoning" && isAnthropicMessage' patches/@langchain+anthropic+1.4.0.patch` | 2 ✓(standard.js + standard.cjs reasoning hunk 未被破坏) |
| patch-package 幂等 | `npx patch-package @langchain/anthropic` (二次跑) | `PATCH IS IDEMPOTENT` ✓(MD5 一致) |
| 新 test GREEN | `npx vitest run src/main/deepagent/anthropic-video-passthrough.test.ts` | 1/1 PASS ✓ |
| 既有 roundtrip 回归 | `npx vitest run src/main/deepagent/anthropic-roundtrip.test.ts` | 5/5 PASS ✓(worktree + main 各 5) |
| 既有 llm-adapter 回归 | `npx vitest run src/main/deepagent/llm-adapter.test.ts` | 10/10 PASS ✓(worktree + main 各 10) |
| 完整组合(3 文件) | `npx vitest run <3 files>` | 5 test files / 31 tests / 0 fail ✓ |
| commit 范围 | `git show --stat HEAD` | 2 files changed: patches/...patch + anthropic-video-passthrough.test.ts ✓ |
| 未 commit node_modules | `git status --short` (worktree) | empty ✓ |

## Deviations from Plan

### Rule 1 — Bug Fix(自我修正):RED 测试在 worktree 跑失败方式异常,需从主仓库跑确认 RED

- **Found during:** Task 1,Step 3(跑 vitest 验证 RED)
- **Issue:** 第一次按 plan 的 `cd /Users/suntc/project/CDF && npx vitest run ...` 命令在 worktree 的 bash session 中执行,但 Bash tool 的 cwd 在每次 call 间会 reset 为 orchestrator 的 pwd(`/Users/suntc/project/CDF/.claude/worktrees/agent-ac645cee223adf196`),所以 `cd` 实际上切到了 worktree 内的 `./.claude/...` 不存在的目录,npx vitest 报告 `Cannot find module '/.../worktree/node_modules/.../standard.cjs'`(worktree 本身没有完整 node_modules,只有 `.vite/` 缓存)
- **Fix:** 第二次显式 `cd /Users/suntc/project/CDF && npx vitest run ...` 强制切到主仓库,test 文件路径(在 worktree 内)被 vitest 当作相对路径或绝对路径解析 → 加载 worktree 的 test 文件,但 `process.cwd()` 解析到主仓库的 `node_modules` → RED 出现,清晰 `expected 0 to be greater than or equal to 1`
- **Lesson:** 与 260603-tiy 总结的"absolute-path safety violation"一致;worktree 没有独立 node_modules,所有 vitest 跑测试必须从主仓库 `/Users/suntc/project/CDF/` 起跳(在 Bash 中显式 cd 一次)

### Process correction:patch-package 必须从主仓库跑,然后 cp 到 worktree

- **Found during:** Task 2,Step 1(应用 patch 后跑 `npx patch-package` regen)
- **Issue:** patch-package 8.0.1 在 worktree 的 cwd 下找不到 node_modules(`./.claude/.../worktree/node_modules/` 实际不存在),会 npm install 一个干净的副本到临时目录然后与干净的 std 库 diff,生成的 patch 不含我的修改
- **Fix:** 改用 `cd /Users/suntc/project/CDF && ./node_modules/.bin/patch-package @langchain/anthropic`,从主仓库跑(主仓库 node_modules 是实际被修改的);生成新 patch 后 `cp` 同步到 worktree
- **Lesson:** 这是 260603-tiy 已记录"worktree 无独立 node_modules"的衍生约束;patch-package / npm 类命令必须从主仓库 cwd 起跳

### 计划外增量:`npx patch-package` 二次跑显示"Created file"误导(实际幂等)

- **Found during:** Task 2,Step 4(幂等性检查)
- **Issue:** 二次跑 `patch-package @langchain/anthropic` 时输出仍包含 `✔ Created file patches/...`,plan 预期"空输出 / 仅 Applying patch"。首次排查怀疑 patch-package 误报文件被覆盖 → 用 `md5` + `cp + patch-package + diff` 验证 patch 文件 MD5 二次跑前后一致,内容确实幂等
- **Fix:** 解读修正 — patch-package 8.0.1 的 "Created file" 消息只是"文件被覆写"事件,不代表内容变化;幂等性应用 `diff` 或 `md5` 验证,不能仅看 stdout 文案
- **Decision:** 不修 plan 的预期描述(任务无关),仅在 SUMMARY 留个 note 给后续 executor 避免误判

## Threat Model Outcome

| Threat ID | Disposition (planned) | Outcome |
| --- | --- | --- |
| T-quick-vht-01 | mitigate (2 行上下文精确匹配,避免误碰 image / text-plain) | ✓ Edit 工具用 `throw new Error("Image content block...")` + `} else if (block.type === "video") {} else if (block.type === "text-plain") {` 2 行上下文匹配,unique 到 standard.cjs:267(standard.js 同位置已修,文本不一致,自然不会误匹配) |
| T-quick-vht-02 | mitigate (不动 standard.js) | ✓ `git show --stat HEAD` 仅 2 files changed;`grep 'result.push(block); continue' standard.js` 仍 1 match |
| T-quick-vht-03 | mitigate (既有 4 hunk 推理 + message_inputs 修复保留) | ✓ `grep '"reasoning" && isAnthropicMessage' patches/...patch` = 2(standard.{js,cjs} reasoning hunk 未破);`anthropic-roundtrip.test.ts` 5/5 PASS(隐式证明 reasoning 路径完好) |
| T-quick-vht-04 | mitigate (显式 stage 2 个文件,不用 `git add .`) | ✓ `git add patches/...patch src/.../anthropic-video-passthrough.test.ts` 显式;`git show --stat HEAD` 确认 2 files;worktree `git status --short` 为空 |
| T-quick-vht-05 | mitigate (RED 测试在 patch 前必失败) | ✓ Task 1 Step 3 显式观察到 `expected 0 to be greater than or equal to 1` 失败;没有意外 PASS |
| T-quick-vht-06 | accept (base64 source-only assertion 不覆盖 url/fileId source) | ✓ 接受 — fix 实现是整块透传,无 source-type-specific 分支,base64 测试足以钉住 fix;其他 source 类型受同一 `result.push(block); continue;` 路径保护 |
| T-quick-vht-07 | mitigate (升级回滚指引在 test 顶部注释) | ✓ JSDoc 顶部明确"若上游覆盖,删本测试文件 + 删 patch 第 6 hunk" |
| T-quick-vht-08 | mitigate (patch-package 幂等 + 双校验) | ✓ 二次跑 diff 校验 `PATCH IS IDEMPOTENT`;hunk 数 5 → 6;`result.push(block); continue` in patch 2 行 |
| T-quick-vht-SC | n/a | 无 npm install 引入新依赖(patch-package 早已安装) |

## Threat Flags

无新增可疑表面:本次只动 patch-package 已涉及的文件 + 1 个独立测试文件,无新网络端点、auth 路径、文件访问模式或 schema 变更。

## Files

### Created
- `.planning/quick/260603-vht-video-patch-cjs-parity-standard-cjs-267-/260603-vht-SUMMARY.md`(本文件)
- `src/main/deepagent/anthropic-video-passthrough.test.ts`(新,128 行,已 commit)

### Modified (committed)
- `patches/@langchain+anthropic+1.4.0.patch`(5 hunks → 6 hunks)

### Modified (intentionally NOT committed — patch-package 自描述)
- `node_modules/@langchain/anthropic/dist/utils/standard.cjs`(line 267 视频透传修复)

## Self-Check

- [x] `patches/@langchain+anthropic+1.4.0.patch` 存在且含 6 hunks
- [x] `src/main/deepagent/anthropic-video-passthrough.test.ts` 存在且含 1 it 块 / 3 断言
- [x] commit `b51eb6f` 存在于 `worktree-agent-ac645cee223adf196` 分支
- [x] commit 描述含 "260601-nzn" + "260603-tiy" + "standard.cjs" 关键词
- [x] commit `--stat` 仅 2 files changed(patch + test)
- [x] 1/1 PASS for `anthropic-video-passthrough.test.ts`
- [x] 5/5 PASS for `anthropic-roundtrip.test.ts`(worktree,既有测试无回归)
- [x] 10/10 PASS for `llm-adapter.test.ts`(worktree,既有测试无回归)
- [x] worktree `git status --short` 为空(除 pre-existing `.codegraph/daemon.pid` 在主仓库外,worktree 自身无残留)
- [x] 未 commit node_modules 改动(per 260603-tiy 约定,patch 自描述)

## Self-Check: PASSED
