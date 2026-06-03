---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - node_modules/@langchain/anthropic/dist/utils/standard.cjs
  - patches/@langchain+anthropic+1.4.0.patch
  - src/main/deepagent/anthropic-video-passthrough.test.ts
autonomous: true
user_setup: []
requirements:
  - VHT-01

must_haves:
  truths:
    - "生产 Electron main(走 .cjs 路由)在 v1 路径下,video 块不再被 `_formatStandardContent` 静默丢弃"
    - "`patches/@langchain+anthropic+1.4.0.patch` 同时覆盖 `standard.js:267` 与 `standard.cjs:267` 的 video 透传修复(完成 260601-nzn 漏修)"
    - "新增的回归测试在 `standard.cjs:267` 退回空分支状态时立即失败"
    - "260601-nzn 的 `standard.js:267` video 透传 hunk + 260603-tiy/u6w 的 reasoning 修复全部保留"
  artifacts:
    - path: "src/main/deepagent/anthropic-video-passthrough.test.ts"
      provides: "v1 路径 video 块透传回归测试"
      contains: "_formatStandardContent"
    - path: "patches/@langchain+anthropic+1.4.0.patch"
      provides: "patch-package 持久化修复"
      min_hunks: 6
    - path: "node_modules/@langchain/anthropic/dist/utils/standard.cjs"
      provides: "运行时已应用 video 透传"
      contains: "result.push(block); continue"
  key_links:
    - from: "patches/@langchain+anthropic+1.4.0.patch"
      to: "node_modules/@langchain/anthropic/dist/utils/standard.cjs"
      via: "patch-package postinstall"
      pattern: "diff --git.*standard.cjs"
    - from: "src/main/deepagent/anthropic-video-passthrough.test.ts"
      to: "node_modules/@langchain/anthropic/dist/utils/standard.cjs"
      via: "createRequire(import.meta.url)(absolute path)"
      pattern: "_formatStandardContent"
---

<objective>
补 260601-nzn 漏修的 `.cjs` 平行修复:`node_modules/@langchain/anthropic/dist/utils/standard.cjs` 第 267 行的 v1 path video 分支仍是空 block(`} else if (block.type === "video") {}`),与已修的 `standard.js:267` 不对称。生产 Electron main bundle 走 CommonJS 路径(`@langchain/anthropic` 的 `package.json#exports.require` 路由到 `.cjs`),所以**生产路径仍丢 video 块**而测试通过(测试加载 `.js` 或单测早期未覆盖 v1 video 路径)。本次按 260603-tiy 立下的 "Rule 1 — patch 必须同时覆盖 .js + .cjs" 原则,只补 1 行 `.cjs` 修改 + 重新生成 patch(5 hunk → 6 hunk)+ 1 个独立回归测试文件,单一原子 commit。

**关键事实(executor 直接信任,无需重新调研):**
- 目标 line:`node_modules/@langchain/anthropic/dist/utils/standard.cjs` line 267
- 现状文本(已 Read 确认):`} else if (block.type === "video") {} else if (block.type === "text-plain") {`
- 修改后文本:`} else if (block.type === "video") { result.push(block); continue; } else if (block.type === "text-plain") {`
- 修改是 **1 行内的字符串替换**(把空 `{}` 改为 `{ result.push(block); continue; }`),与已修的 `standard.js:267` 一一对应(已 Read 确认)
- **不要**修改 `_formatStandardContent` 函数的任何其他分支(image / text-plain / non_standard / reasoning / ...)
- **不要**触碰 `standard.js`,它在 260601-nzn 已经修好(已 Read 确认)
- 既有 patch 文件当前 hunk 数 = 5(`grep -c '^@@'` 已确认):
  - message_inputs.cjs reasoning 分支 (260603-tiy)
  - message_inputs.js video + reasoning 合并 hunk (260601-nzn + 260603-tiy)
  - standard.cjs reasoning isAnthropicMessage 守卫去除 (260603-u6w)
  - standard.js reasoning isAnthropicMessage 守卫去除 (260603-u6w)
  - standard.js video 透传 (260601-nzn) ← 本次补 standard.cjs 对应 hunk
- 修补完成后 patch 文件应为 **6 hunk**(新增 1 个 hunk 覆盖 standard.cjs video 修复)

Purpose: 260601-nzn 原始 patch 把"video 透传"只打到 `.js`,但生产 Electron main bundle 是 CJS 输出 + LangChain `exports.require` 路由到 `.cjs`,所以**生产实际加载的是没修过的 .cjs**;v1 path AIMessage(`output_version === "v1"`)在 `_convertMessagesToAnthropicPayload` 第 215-218 行路由到 `_formatStandardContent`,在 .cjs 命中第 267 行空分支,video 块被 silently dropped — 用户体感"M3 多模态 video 入参看似发出去但模型没收到"。本次填补这条单线 bug,完成 260603-tiy Rule 1 在 video patch 上的对齐(reasoning 已在 260603-tiy 同步对齐过两份产物,video 此前只对齐过一份)。

Output:
- `node_modules/@langchain/anthropic/dist/utils/standard.cjs` 第 267 行已修(`} else if (block.type === "video") { result.push(block); continue; } else if (block.type === "text-plain") {`)
- `patches/@langchain+anthropic+1.4.0.patch` 重新生成,hunk 数 5 → 6,新 hunk 描述 `standard.cjs` 第 267 行 video 分支
- `src/main/deepagent/anthropic-video-passthrough.test.ts` 新建文件,通过 `createRequire` 直接加载 `standard.cjs` 并调用 `_formatStandardContent`,断言 video 块在 v1 路径下原样保留(不被 silently dropped)
- 单一原子 commit 落在 master,commit message 显式引用 260601-nzn(原始 partial patch)与 260603-tiy(Rule 1 lesson)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260603-tiy-real-fix-m3-roundtrip-patch-formatconten/260603-tiy-SUMMARY.md
@.planning/quick/260601-nzn-patch-package-minimax-m3/260601-nzn-SUMMARY.md
@patches/@langchain+anthropic+1.4.0.patch
@node_modules/@langchain/anthropic/dist/utils/standard.cjs
@node_modules/@langchain/anthropic/dist/utils/standard.js
@src/main/deepagent/anthropic-roundtrip.test.ts

# 关键事实(executor 直接信任,无需再 Read/Grep)

# 1) standard.cjs 当前 line 267(待修)
#   267: 	} else if (block.type === "video") {} else if (block.type === "text-plain") {
# 改后 line 267: 	} else if (block.type === "video") { result.push(block); continue; } else if (block.type === "text-plain") {

# 2) standard.js 当前 line 267(已修,本次不动,作为参考)
#   267: 	} else if (block.type === "video") { result.push(block); continue; } else if (block.type === "text-plain") {

# 3) 既有 patch 文件 hunk 列表(grep -c '^@@' = 5,grep 输出已确认):
#   line  5: @@ -181,6 +181,12 @@ function* _formatContentBlocks  ← message_inputs.cjs reasoning
#   line 22: @@ -176,10 +176,16 @@ function* _formatContentBlocks ← message_inputs.js video+reasoning
#   line 44: @@ -126,7 +126,7 @@ function _formatStandardContent  ← standard.cjs reasoning guard removal
#   line 57: @@ -126,7 +126,7 @@ function _formatStandardContent  ← standard.js reasoning guard removal
#   line 66: @@ -264,7 +264,7 @@ function _formatStandardContent  ← standard.js video passthrough (260601-nzn)
# 本次新增第 6 hunk 应为 standard.cjs 第 264 行附近(video 分支),mirror standard.js 第 5 hunk

# 4) v1 dispatch 路由确认(message_inputs.cjs 第 215-218 行):
#   if (_langchain_core_messages.AIMessage.isInstance(message) && message.response_metadata?.output_version === "v1") return {
#     role,
#     content: require_standard._formatStandardContent(message)
#   };
# → AIMessage 带 output_version: "v1" 时确实走 _formatStandardContent

# 5) 测试加载范式(参考 anthropic-roundtrip.test.ts 第 113-124 行):
#   const standardCjsPath = path.join(process.cwd(),
#     'node_modules/@langchain/anthropic/dist/utils/standard.cjs');
#   const { _formatStandardContent } = require(standardCjsPath) as { ... };
# 这是已被既有测试验证可工作的范式,本任务的新测试文件复用同一范式
</context>

<tasks>

<task type="auto">
  <name>Task 1: 写 RED 回归测试(必须在 patch 应用前失败)</name>
  <files>
    src/main/deepagent/anthropic-video-passthrough.test.ts
  </files>
  <action>
    1. 在执行任何 Write 之前,先用 `git -C /Users/suntc/project/CDF rev-parse --show-toplevel` 确认仓库根路径(per 260603-tiy "Process correction: absolute-path safety violation":Bash cwd 在 call 之间会 reset,所有 Write/Edit/Bash 一律用 `/Users/suntc/project/CDF/...` 绝对路径或 `git -C /Users/suntc/project/CDF`)。本任务在 master 分支直接执行(per constraint 7:no worktree-isolated commits)。

    2. 用 Write 工具新建文件 `/Users/suntc/project/CDF/src/main/deepagent/anthropic-video-passthrough.test.ts`,内容结构与 `anthropic-roundtrip.test.ts` test 1.5 范式一致(同一 createRequire pattern,同一 absolute path 解析,同一 plain-object-as-AIMessage 构造手法),核心要点:

       (a) 顶部 docstring(JSDoc 风格 `/** ... */`)说明:本测试为 260601-nzn 漏修的 `.cjs` 平行修复回归测试;v1 path video 块不应被 silently dropped;若 `standard.cjs:267` 退回空分支或未来 LangChain 升级覆盖,本测试立即失败;升级 `@langchain/anthropic` 时如何回滚的指引(如果上游原生处理 video 块,删本测试文件 + 删 patch 第 6 hunk)。docstring 风格对齐 `anthropic-roundtrip.test.ts` 第 1-83 行的注释规格(每行 ` *` 缩进 + 一个空格,引用具体 line 与 commit/quick task id)。

       (b) imports:
           - `import { describe, expect, it } from 'vitest';`
           - `import { createRequire } from 'module';`
           - `import path from 'path';`

       (c) 模块加载块(放在 describe 之前的 module scope):
           - 用 `createRequire(import.meta.url)` 构造 require
           - `const standardCjsPath = path.join(process.cwd(), 'node_modules/@langchain/anthropic/dist/utils/standard.cjs');`
           - `const { _formatStandardContent } = require(standardCjsPath) as { _formatStandardContent: (message: { contentBlocks: Array<Record<string, unknown>>; response_metadata?: Record<string, unknown>; }) => Array<Record<string, unknown>>; };`
           - 加 eslint-disable 注释 `// eslint-disable-next-line @typescript-eslint/no-require-imports` 紧跟在 `const { _formatStandardContent }` 上一行(对齐 anthropic-roundtrip.test.ts 第 102 行 / 第 118 行的既有风格)

       (d) describe 块名:`'@langchain/anthropic v1 path — video block passthrough (260601-nzn .cjs parity)'`

       (e) it 块名:`'video block survives _formatStandardContent (would be silently dropped without standard.cjs:267 patch)'`,it body:
           - 构造 plain object `message`,含:
             - `contentBlocks: [{ type: 'video', source: { type: 'base64', data: 'AAAA', media_type: 'video/mp4' } }]`
             - `response_metadata: { output_version: 'v1' }`(明确触发 v1 path 进入 `_formatStandardContent`)
           - 用 `as unknown as Parameters<typeof _formatStandardContent>[0]` 类型断言绕过 contentBlocks 字段类型(同 anthropic-roundtrip.test.ts test 1.5 第 363 行做法)
           - 调用 `const blocks = _formatStandardContent(message);`
           - 断言三连(顺序固定):
             1. `expect(blocks.length).toBeGreaterThanOrEqual(1);`  ← 在未 patch 状态下 blocks 会是 `[]`(空数组,因为 for 循环执行完后 video 块没被 push),失败信号:`Received: 0`,清晰指向 video 被丢
             2. `expect(blocks[0].type).toBe('video');`  ← 确认是 video 块(不是其它意外块)
             3. `expect(blocks[0].source).toEqual({ type: 'base64', data: 'AAAA', media_type: 'video/mp4' });`  ← 确认 source 子结构原样保留(因为 patch 后的实现是 `result.push(block); continue;`,整个 block 透传)

       (f) 不写第二个 it 块。本测试单一职责:钉住 v1 path video 透传。其它路径(fallthrough / 用户消息)有既有 patch hunk + 既有测试覆盖,不重复。

    3. 在执行 patch 前**先跑测试,确认 RED**:
       ```
       cd /Users/suntc/project/CDF && npx vitest run src/main/deepagent/anthropic-video-passthrough.test.ts
       ```
       预期:1 failed。失败行应为 `expect(blocks.length).toBeGreaterThanOrEqual(1)`(received 0)或 `expect(blocks[0]).toBe('video')`(undefined)。**如果测试意外 PASS**,极可能是:
         - `standard.cjs:267` 在某次 npm install / postinstall 中被意外修复 → 用 `grep -n 'block.type === "video"' /Users/suntc/project/CDF/node_modules/@langchain/anthropic/dist/utils/standard.cjs` 确认现状(应仍是空 `{}`),如果已修则停下来追问用户
         - 或 require 路径解析错文件 → 检查 `console.log(standardCjsPath)` 输出(应为绝对路径,且文件存在)
       不要在 RED 阶段做"修测试让它 PASS"的事;RED 是设计的一部分,证明 bug 存在。

    4. RED 确认后**不要**改任何文件,直接交给 Task 2 处理 patch。
  </action>
  <verify>
    <automated>cd /Users/suntc/project/CDF && npx vitest run src/main/deepagent/anthropic-video-passthrough.test.ts 2>&1 | tail -20 | grep -E 'Tests +1 failed|FAIL' | head -2</automated>
  </verify>
  <done>
    - 文件 `src/main/deepagent/anthropic-video-passthrough.test.ts` 已创建
    - 文件顶部含 JSDoc 注释(说明 260601-nzn 漏修背景 + 升级回滚指引)
    - 模块 scope 用 `createRequire` + `process.cwd()` 加载 `standard.cjs` 的 `_formatStandardContent`(范式与 anthropic-roundtrip.test.ts test 1.5 一致)
    - 单一 it 块包含 3 个断言(blocks.length / blocks[0].type / blocks[0].source)
    - **测试在当前 .cjs 状态下失败**(received 0 或 undefined)— 这就是 RED 信号,证明 bug 存在
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 应用 .cjs patch、regen patch 文件、转 GREEN、原子 commit</name>
  <files>
    node_modules/@langchain/anthropic/dist/utils/standard.cjs
    patches/@langchain+anthropic+1.4.0.patch
    src/main/deepagent/anthropic-video-passthrough.test.ts
  </files>
  <behavior>
    - 修改后:`grep -c '^@@' patches/@langchain+anthropic+1.4.0.patch` = 6
    - 修改后:`grep 'result.push(block); continue' node_modules/@langchain/anthropic/dist/utils/standard.cjs` 匹配 ≥ 1
    - 修改后:`grep 'result.push(block); continue' node_modules/@langchain/anthropic/dist/utils/standard.js` 仍匹配 ≥ 1(既有 260601-nzn hunk 未被破坏)
    - 修改后:`patches/@langchain+anthropic+1.4.0.patch` 仍含既有 5 hunk 全部内容(reasoning 修复 + standard.js video 修复 + message_inputs.* 修复)
    - 修改后:`anthropic-video-passthrough.test.ts` 1/1 PASS
    - 修改后:`anthropic-roundtrip.test.ts` 仍 5/5 PASS(回归)
    - 修改后:`llm-adapter.test.ts` 仍 10/10 PASS(回归)
    - 修改后:`npx patch-package @langchain/anthropic` 二次执行无 diff 输出(幂等)
  </behavior>
  <action>
    1. **应用 patch 到 .cjs**(用 Edit 工具,绝对路径):
       - 文件:`/Users/suntc/project/CDF/node_modules/@langchain/anthropic/dist/utils/standard.cjs`
       - old_string(精确文本,含上下文 2 行避免误匹配 `standard.js` 的同名结构):
         ```
         		throw new Error("Image content block must include a fileId, url, or data property.");
         	} else if (block.type === "video") {} else if (block.type === "text-plain") {
         ```
       - new_string:
         ```
         		throw new Error("Image content block must include a fileId, url, or data property.");
         	} else if (block.type === "video") { result.push(block); continue; } else if (block.type === "text-plain") {
         ```
       - **不要**触碰该函数的任何其他分支(image / text-plain body / non_standard / reasoning / ...)
       - **不要**触碰 `standard.js`(它在 260601-nzn 已修)

    2. **regen patch 文件**:
       ```
       cd /Users/suntc/project/CDF && npx patch-package @langchain/anthropic
       ```
       预期输出包含 `Created file patches/@langchain+anthropic+1.4.0.patch`(覆盖既有文件)。

    3. **校验 patch 文件正确性**(以下命令应全部 PASS):
       ```
       cd /Users/suntc/project/CDF && grep -c '^@@' patches/@langchain+anthropic+1.4.0.patch
       # 预期输出:6
       ```
       ```
       cd /Users/suntc/project/CDF && grep -A 2 'standard.cjs$' patches/@langchain+anthropic+1.4.0.patch | head -10
       # 预期:能看到两处 standard.cjs 引用(reasoning hunk + 新 video hunk)
       ```
       ```
       cd /Users/suntc/project/CDF && grep 'result.push(block); continue' patches/@langchain+anthropic+1.4.0.patch
       # 预期:2 行匹配(standard.js + standard.cjs 各一行)
       ```
       ```
       cd /Users/suntc/project/CDF && grep '"reasoning" && isAnthropicMessage' patches/@langchain+anthropic+1.4.0.patch
       # 预期:2 行匹配(standard.js + standard.cjs reasoning guard removal 既有 hunk,本次未触碰)
       ```
       如果任何一项不符,**停下来回到 Step 1 检查**(常见错因:Edit 误匹配到 standard.js 的相同上下文导致 .cjs 没改;或 patch-package 检测不到 .cjs 改动)。

    4. **幂等性检查**:
       ```
       cd /Users/suntc/project/CDF && npx patch-package @langchain/anthropic 2>&1
       ```
       预期:第二次跑无任何 "Created file" 或 diff 输出(空输出或仅 "Applying patch ... ✔")。如果有 diff 输出,说明 node_modules 状态与 patch 文件不一致,需排查。

    5. **跑测试转 GREEN**:
       ```
       cd /Users/suntc/project/CDF && npx vitest run src/main/deepagent/anthropic-video-passthrough.test.ts
       ```
       预期:1/1 PASS。如果仍 fail,极可能是:
         - Edit 工具实际未改 .cjs(Bash cwd 漂移问题)→ 用 `grep -n 'block.type === "video"' /Users/suntc/project/CDF/node_modules/@langchain/anthropic/dist/utils/standard.cjs` 直接 confirm 文本
         - 模块缓存问题(vitest 通常不缓存 node_modules .cjs,但理论上可能)→ 加 `--no-cache` flag 重跑

    6. **跑回归测试**:
       ```
       cd /Users/suntc/project/CDF && npx vitest run src/main/deepagent/anthropic-roundtrip.test.ts src/main/deepagent/anthropic-video-passthrough.test.ts src/main/deepagent/llm-adapter.test.ts
       ```
       预期:5/5(roundtrip) + 1/1(video-passthrough) + 10/10(llm-adapter) = 16/0 PASS。任何回归立即停下检查。

    7. **原子 commit**(master 分支,单 commit;**不 commit node_modules 改动** per 260603-tiy SUMMARY 约定 — patch 自描述,node_modules 改动靠 `patch-package` 在其他 checkout 应用):
       ```
       git -C /Users/suntc/project/CDF status --short
       # 预期看到:M patches/@langchain+anthropic+1.4.0.patch + ?? src/main/deepagent/anthropic-video-passthrough.test.ts + M .codegraph/daemon.pid (pre-existing)
       ```
       ```
       git -C /Users/suntc/project/CDF add patches/@langchain+anthropic+1.4.0.patch src/main/deepagent/anthropic-video-passthrough.test.ts
       ```
       ```
       git -C /Users/suntc/project/CDF commit -m "$(cat <<'EOF'
       fix(llm): patch @langchain/anthropic 1.4.0 — add .cjs parity for video passthrough (standard.cjs:267)

       260601-nzn introduced video block passthrough by patching standard.js:267
       (empty `} else if (block.type === "video") {}` → `result.push(block);
       continue;`). The patch was applied to .js ONLY, missing the parallel
       standard.cjs:267. Production Electron main bundles to CommonJS and
       @langchain/anthropic's package.json#exports.require routes to .cjs,
       so production was loading the unpatched .cjs while tests passed against
       a different code path — v1 path AIMessages
       (response_metadata.output_version === "v1") flowed through
       _convertMessagesToAnthropicPayload → _formatStandardContent in .cjs and
       hit the empty branch, silently dropping the video block. User-visible
       symptom: M3 multimodal video inputs appeared to send but the model
       received no video content.

       This fix mirrors the existing standard.js:267 hunk into standard.cjs:267
       (1-line change). Patch file grows from 5 hunks to 6 hunks. The new
       regression test src/main/deepagent/anthropic-video-passthrough.test.ts
       pins the v1 path video passthrough by calling _formatStandardContent
       directly via createRequire (same pattern as anthropic-roundtrip.test.ts
       test 1.5). If standard.cjs:267 reverts to the empty branch (e.g. via
       npm install without patch-package, or a future LangChain upgrade that
       overrides the hunk), the test fails immediately.

       This completes the "always patch BOTH .js and .cjs" pattern that
       260603-tiy established for the reasoning roundtrip fix (Rule 1 in
       260603-tiy SUMMARY), now applied retroactively to the older 260601-nzn
       video patch.

       Refs: 260601-nzn (original partial patch), 260603-tiy (.js+.cjs Rule 1)

       Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
       EOF
       )"
       ```
       ```
       git -C /Users/suntc/project/CDF log --oneline -3
       git -C /Users/suntc/project/CDF show --stat HEAD
       git -C /Users/suntc/project/CDF status --short
       ```
       预期:HEAD = 本次 commit;show --stat 列出 `patches/@langchain+anthropic+1.4.0.patch` 与 `src/main/deepagent/anthropic-video-passthrough.test.ts` 两个文件(2 files changed);status --short 仅剩 `M .codegraph/daemon.pid`(pre-existing,不动)。

    8. **最终自检**(命令组合,全部应 PASS):
       ```
       cd /Users/suntc/project/CDF \
         && grep -c '^@@' patches/@langchain+anthropic+1.4.0.patch \
         && grep -c 'result.push(block); continue' patches/@langchain+anthropic+1.4.0.patch \
         && grep -c 'result.push(block); continue' node_modules/@langchain/anthropic/dist/utils/standard.cjs \
         && grep -c 'result.push(block); continue' node_modules/@langchain/anthropic/dist/utils/standard.js
       ```
       预期输出顺序:6 / 2 / 1 / 1
  </action>
  <verify>
    <automated>cd /Users/suntc/project/CDF && npx vitest run src/main/deepagent/anthropic-roundtrip.test.ts src/main/deepagent/anthropic-video-passthrough.test.ts src/main/deepagent/llm-adapter.test.ts 2>&1 | tail -10 | grep -E 'Tests +16 passed|Test Files +3 passed'</automated>
  </verify>
  <done>
    - `node_modules/@langchain/anthropic/dist/utils/standard.cjs` line 267 已修(空 `{}` → `{ result.push(block); continue; }`)
    - `patches/@langchain+anthropic+1.4.0.patch` 重新生成,hunk 数 6
    - `patches/@langchain+anthropic+1.4.0.patch` 同时含 standard.js 与 standard.cjs 的 video passthrough hunk(grep `'result.push(block); continue'` 匹配 2 行)
    - `npx patch-package @langchain/anthropic` 二次执行幂等,无 diff 输出
    - `anthropic-video-passthrough.test.ts` 1/1 PASS(GREEN 转换达成)
    - `anthropic-roundtrip.test.ts` 5/5 PASS + `llm-adapter.test.ts` 10/10 PASS(无回归)
    - 单一原子 commit 落在 master,commit message 显式引用 260601-nzn(原始 partial patch)与 260603-tiy(Rule 1)
    - `git status --short` 仅剩 pre-existing `.codegraph/daemon.pid`
    - **未 commit** node_modules 改动(per 260603-tiy 约定)
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| LangChain 库代码 → 应用代码 | 修补 node_modules 中的 LangChain 内部函数,影响所有 LangChain 调用方(本次只覆盖 v1 path video 分支,单一职责) |
| `.js` 平行产物 ↔ `.cjs` 平行产物 | 两者由 TypeScript 源同时构建,无自动同步机制(per 260603-tiy Rule 1);本次只动 `.cjs`,`.js` 已在 260601-nzn 修过 |
| patch 文件 → node_modules | patch-package 重新应用是 diff 而非全量替换,hunk 漂移会失败;本次新 hunk 上下文(throw Error + else-if-video)在历史 1.4.x 版本上稳定 |
| 测试代码 → 标准库 .cjs | 测试通过 `createRequire(absolute path)` 直接加载 `.cjs`,绕过 `@langchain/anthropic` 的 exports 路由(与既有 anthropic-roundtrip.test.ts test 1.5 同范式) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-quick-vht-01 | Tampering | `_formatStandardContent` video 分支 (`standard.cjs:267`) | mitigate | Edit 工具用上下文 2 行精确匹配(包含 `throw new Error("Image content block...")` + `} else if (block.type === "video") {} else if (block.type === "text-plain") {`),避免误碰 image / text-plain / non_standard / reasoning 分支;`grep -c '^@@' patches/...patch` = 6 + grep 2 处 `result.push(block); continue` 双重校验 |
| T-quick-vht-02 | Tampering | `standard.js:267`(本次不动) | mitigate | 本任务 files_modified 不含 `standard.js`;commit `--stat` 检查只动 2 文件;grep `result.push(block); continue` in `standard.js` 仍 ≥ 1(既有 260601-nzn hunk 未破坏) |
| T-quick-vht-03 | Tampering | 既有 4 hunk 的 reasoning + message_inputs.* 修复(260603-tiy/u6w) | mitigate | regen patch 后 grep `'"reasoning" && isAnthropicMessage'` 仍 2 行(standard.{js,cjs} reasoning guard removal hunk 上下文)+ grep `'type === "thinking"'` 仍 2 行(message_inputs.{js,cjs} reasoning 新分支);任何回归立即由 `anthropic-roundtrip.test.ts` 5/5 测试钉住 |
| T-quick-vht-04 | Repudiation | 原子 commit 失败 / 漏文件 | mitigate | `git add` 仅显式列出两个目标文件名(不用 `git add .` / `-A`);commit 后 `git show --stat HEAD` 校验 2 files changed;status --short 仅剩 pre-existing `.codegraph/daemon.pid` |
| T-quick-vht-05 | Denial of Service | RED 测试在 patch 已部分应用时意外 PASS | mitigate | Task 1 Step 3 显式校验测试 FAIL;如意外 PASS 则 grep `standard.cjs:267` 现状文本并停下追问 |
| T-quick-vht-06 | Information Disclosure | 测试断言过度耦合到 video 块内部 source 结构 | accept | 断言用 `toEqual({ type: 'base64', data: 'AAAA', media_type: 'video/mp4' })`,仅覆盖最常用的 base64 source;如未来用户用 URL / mm_file:// source 仍能命中 `result.push(block); continue` 路径(整块透传),不会因 base64-only 测试漏掉其他 source 类型 — 因为修复实现本身无 source-type-specific 分支 |
| T-quick-vht-07 | Elevation of Privilege | 上游升级回滚指引 | mitigate | 测试文件顶部 JSDoc 显式写"若上游覆盖,删本测试文件 + 删 patch 第 6 hunk";commit message 显式 refs 260601-nzn + 260603-tiy,便于追溯 |
| T-quick-vht-08 | Tampering | patch-package hunk 漂移 / 顺序不稳定 | mitigate | regen 后 `npx patch-package @langchain/anthropic` 二次跑确认幂等;hunk 数 5 → 6 + grep `result.push(block); continue` 2 行双重校验;hunk 文件路径用 `diff --git a/node_modules/...standard.cjs b/...` 标记,与现有 4 hunk 风格一致 |
| T-quick-vht-SC | Tampering | npm/pip/cargo installs | n/a | 本次不引入新依赖(patch-package 早在 260601-nzn 已安装),无需 package legitimacy gate;slopcheck 不适用 |

## scope 外的相关项(明确不修)

- `message_inputs.cjs` / `message_inputs.js` 中 video 块的处理路径:260601-nzn 已在 `message_inputs.js:179` 加 `contentPart.type === "video" || contentPart.type === "container_upload"` 守卫;260603-tiy 时合并到 message_inputs.* 的 reasoning hunk 中。本次任务**不动** message_inputs.* — 用户/assistant 消息的 fallthrough video 路径已被覆盖,只剩 v1 path standard.cjs 这一处。
- 其他可能丢块的分支(audio / file / 其他 multimodal 类型):未观察到用户报告,且本次单一职责是补 260601-nzn 漏修,不扩 scope。如未来需追加,另起 quick task。
</threat_model>

<verification>
- [ ] `grep -c '^@@' patches/@langchain+anthropic+1.4.0.patch` = 6
- [ ] `grep -c 'result.push(block); continue' patches/@langchain+anthropic+1.4.0.patch` = 2(standard.js 既有 + standard.cjs 新)
- [ ] `grep -c 'result.push(block); continue' node_modules/@langchain/anthropic/dist/utils/standard.cjs` = 1
- [ ] `grep -c 'result.push(block); continue' node_modules/@langchain/anthropic/dist/utils/standard.js` = 1(未被破坏)
- [ ] `grep -c '"reasoning" && isAnthropicMessage' patches/@langchain+anthropic+1.4.0.patch` = 2(260603-u6w 既有 hunk 未被破坏)
- [ ] `npx patch-package @langchain/anthropic` 二次执行无 diff(幂等)
- [ ] `src/main/deepagent/anthropic-video-passthrough.test.ts` 1/1 PASS
- [ ] `src/main/deepagent/anthropic-roundtrip.test.ts` 5/5 PASS(回归无破坏 260603-tiy/u6w)
- [ ] `src/main/deepagent/llm-adapter.test.ts` 10/10 PASS(回归)
- [ ] git HEAD commit 描述含 "260601-nzn" + "260603-tiy" + "standard.cjs:267" 关键词
- [ ] `git status --short` 仅剩 pre-existing `M .codegraph/daemon.pid`
- [ ] commit 含且仅含 2 个文件(`patches/@langchain+anthropic+1.4.0.patch` + `src/main/deepagent/anthropic-video-passthrough.test.ts`)
</verification>

<success_criteria>
260601-nzn 的 video 透传修复在 `.cjs` 平行产物上达成对称:生产 Electron main(走 CJS + `@langchain/anthropic exports.require`)在 v1 path 下 AIMessage 携带 video 块时,`_formatStandardContent` 不再静默丢弃。patch 文件从 5 hunk 扩为 6 hunk,新独立测试 `anthropic-video-passthrough.test.ts` 钉住该修复 — 任何后续 npm install 漂移 / 上游升级覆盖立即由测试失败暴露。单一原子 commit 落 master,commit message 显式引用 260601-nzn(原始 partial patch)与 260603-tiy(.js+.cjs Rule 1 lesson),完成"always patch both .js and .cjs"模式在 video patch 上的对齐。
</success_criteria>

<output>
Create `.planning/quick/260603-vht-video-patch-cjs-parity-standard-cjs-267-/260603-vht-SUMMARY.md` when done(per 既有 quick task 惯例;summary 内容含本 plan 的 Verification 全部校验 + Threat Register 处置结果 + 任何 Deviation from Plan)。
</output>
