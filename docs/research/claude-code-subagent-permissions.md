# Claude Code 主会话与 subagent `permissionMode` 的继承和覆盖

- 调研日期：2026-07-13
- 证据范围：仅使用 Anthropic 官方 Claude Code 文档、Claude Agent SDK 文档，以及 `anthropics/claude-code` 官方仓库 changelog/issues；issue 仅在标注证据强弱后用于行为旁证。
- 适用范围：当前官方文档描述的 Claude Code / Claude Agent SDK 行为。历史版本在后台审批等方面不同，见下文版本说明。

## 结论摘要

**它不是“父级权限上限、子级只能收紧不能升权”。也不是所有模式都由父级无条件精确覆盖。当前官方规则是一个不对称的特殊值优先模型：**

1. subagent 默认继承主会话的 permission context；通常可以用自身 `permissionMode` 覆盖。
2. 但父级为 `bypassPermissions`、`acceptEdits` 或 `auto` 时，父级模式是粘性的（sticky）：所有 subagent 必须继承，子级 frontmatter 不能覆盖。
3. 因此父级 `bypassPermissions` 时，子级不能改成 `default`、`dontAsk` 或 `plan` 来收紧。
4. 反过来，父级为 `default`、`dontAsk` 或 `plan` 时，官方列出的例外不适用；按官方“可覆盖，except ...”的完整表述，子级可指定 `bypassPermissions`。这说明父级不是权限上限。
5. `permissions.deny`、显式 `permissions.ask`、subagent 的 `tools` / `disallowedTools` 是另一层控制。模式决定基线审批行为，不会让被移除或 deny 的工具重新可用；显式 deny/ask 也能约束 `bypassPermissions`。

官方原文最关键的一句是：

> “If the parent uses `bypassPermissions` or `acceptEdits`, this takes precedence and can't be overridden. If the parent uses auto mode, the subagent inherits auto mode and any `permissionMode` in its frontmatter is ignored.”  
> — [Create custom subagents: Permission modes](https://code.claude.com/docs/en/sub-agents#permission-modes)

Agent SDK 文档用更直接的方式重述：

> “When the parent uses `bypassPermissions`, `acceptEdits`, or `auto`, all subagents inherit that mode and it cannot be overridden per subagent.”  
> — [Agent SDK: Configure permissions — Available modes](https://code.claude.com/docs/en/agent-sdk/permissions#available-modes)

## 逐项核实表

| 问题 | 结论 | 官方原文摘录 | 证据强度 |
| --- | --- | --- | --- |
| 1. frontmatter 可选值 | `default`、`acceptEdits`、`auto`、`dontAsk`、`bypassPermissions`、`plan`；v2.1.200+ 还接受 `manual`，它只是 `default` 的别名。plugin subagent 会忽略该字段。 | “`default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, or `manual` as an alias for `default`.” — [Supported frontmatter fields](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields)；“plugin subagents don't support ... `permissionMode` ... These fields are ignored” — [scope note](https://code.claude.com/docs/en/sub-agents#choose-the-subagent-scope) | 明确 |
| 1. 省略时的默认语义 | 文档没有为 frontmatter 单独指定一个固定默认值；它表述为 subagent 继承主会话 permission context。因此“省略”应理解为继承有效父级上下文，而不是固定变为 `default`。 | “Subagents inherit the permission context from the main conversation and can override the mode...” — [Permission modes](https://code.claude.com/docs/en/sub-agents#permission-modes) | 明确到继承；未给单独伪代码 |
| 1. `default` 的含义 | 标准/Manual 审批行为；读取默认不询问，其他未预批准操作进入审批。permissions 页另称“first use of each tool”会询问，因此它并不等于“每次所有工具调用都询问”。 | “Standard behavior: prompts for permission on first use of each tool.” — [Configure permissions](https://code.claude.com/docs/en/permissions#permission-modes)；“Reads only” — [Choose a permission mode](https://code.claude.com/docs/en/permission-modes) | 明确 |
| 2. parent 与 child 优先级 | 一般是 child frontmatter 可覆盖；三个父级模式例外：`bypassPermissions`、`acceptEdits`、`auto` 总是父级胜出。 | “can override the mode, except when the parent mode takes precedence...” 以及上文关键原文 — [Subagents: Permission modes](https://code.claude.com/docs/en/sub-agents#permission-modes) | 明确 |
| 3. parent=`bypassPermissions`，child 能否更严格 | **不能通过 child `permissionMode` 收紧。** child 写 `default` / `dontAsk` / `plan` 都不会覆盖父级 bypass。仍可用显式 ask/deny、工具移除、hook 或 sandbox 形成其他约束。 | “all subagents inherit that mode and it cannot be overridden per subagent” — [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions#available-modes) | 明确 |
| 4. parent=`default` 时，child 能否 `bypassPermissions` | **按官方规则可以。** `default` 不在父级强制优先的三个例外中，而 `bypassPermissions` 是合法 child 值。官方没有给出这一组合的运行示例或完整矩阵，因此这是对其穷举式规则的直接推论。Claude Code 没有名为 `strict` 的官方 mode；若“strict”指 CDF 模式，不能直接套用这个名字。 | “can override ... except” + 只列出 `bypassPermissions` / `acceptEdits` / `auto` 三个父级例外 — [Subagents: Permission modes](https://code.claude.com/docs/en/sub-agents#permission-modes) | 高；组合本身未示例 |
| 5. parent=`acceptEdits` | 父级精确模式覆盖，child 不能改成更严的 `plan`/`dontAsk`，也不能改成更宽的 bypass。 | “If the parent uses ... `acceptEdits`, this takes precedence and can't be overridden.” — [Subagents](https://code.claude.com/docs/en/sub-agents#permission-modes) | 明确 |
| 5. parent=`dontAsk` | 不在粘性例外中；child 可覆盖为其他合法 mode，包括 bypass。若 child 未覆盖，`dontAsk` 对未预批准工具自动 deny，不弹审批。 | “`dontAsk`: Auto-deny permission prompts (explicitly allowed tools still work)” — [Subagents](https://code.claude.com/docs/en/sub-agents#permission-modes) | 覆盖结论为高；无组合示例 |
| 5. parent=`plan` | 不在粘性例外中；child 可覆盖为其他合法 mode，包括 bypass。若 child 继承/指定 `plan`，它是只读探索模式。 | “`plan`: Plan mode (read-only exploration)” — [Subagents](https://code.claude.com/docs/en/sub-agents#permission-modes) | 覆盖结论为高；无组合示例 |
| 5. child 指定 `acceptEdits` / `dontAsk` / `plan` | 父级不是三个粘性值时，child override 生效；父级是三个粘性值时不生效。不是按“哪个更严格”比较。 | 同上两条继承规则 | 明确规则；无全矩阵 |
| 6. allow/ask/deny 与 mode | mode 是审批基线；rules 叠加在其上。规则顺序为 deny → ask → allow。deny 和显式 ask 适用于所有模式，包括 bypass；在 `dontAsk` 中，需要询问的调用会被拒绝而不是弹窗。 | “Modes set the baseline. Layer permission rules on top...” 和 “Deny rules and explicit ask rules apply in every mode, including `bypassPermissions`.” — [Permission modes](https://code.claude.com/docs/en/permission-modes)；“deny rules first, then ask, then allow” — [Settings](https://code.claude.com/docs/en/settings#permission-settings) | 明确 |
| 6. allow 是否限制 bypass | **不限制。** allow 只做预批准，不是能力白名单；未列出的工具仍会落到 mode，而 bypass 会批准它们。需要阻止工具必须用 deny / `disallowedTools`。 | “`allowed_tools` does not constrain `bypassPermissions`.” — [SDK permissions: allow and deny rules](https://code.claude.com/docs/en/agent-sdk/permissions#allow-and-deny-rules) | 明确 |
| 6. subagent `tools` / `disallowedTools` | 这是 subagent 可见工具集合的能力约束：默认继承 parent 可用工具；`tools` 是 allowlist；`disallowedTools` 会移除工具。两者同时存在时先移除，再从剩余集合解析 allowlist。 | “Subagents inherit ... tools available in the main conversation by default.”；“use the `tools` field as an allowlist or the `disallowedTools` field as a denylist.” — [Available tools](https://code.claude.com/docs/en/sub-agents#available-tools) | 明确 |
| 6. deny 与 bypass | bare deny 可直接移除工具；带 specifier 的 deny 在每个 mode 中都拒绝匹配调用，包括 bypass。 | “Calls matching `rm *` are denied in every permission mode, including `bypassPermissions`.” — [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions#allow-and-deny-rules) | 明确 |
| 7. foreground 审批 | foreground subagent 阻塞主会话；审批请求实时传递给用户。 | “Permission prompts are passed through to you as they come up.” — [Foreground or background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background) | 明确 |
| 7. background / 并发审批 | v2.1.186+，background subagent 需要审批时，prompt 显示在主会话并标明是哪个 subagent 请求；批准后继续，Esc 只拒绝该次 tool call，不停止 subagent。v2.1.186 之前会自动拒绝所有本应询问的调用。 | “the prompt surfaces in your main session and names the subagent that is asking ... press Esc to deny that one tool call without stopping the subagent.” — [Foreground or background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background)；官方 [CHANGELOG v2.1.186](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) 也记录了同一变更 | 明确，带版本界限 |
| 7. background 默认行为 | v2.1.198+ subagent 默认后台运行；需要结果后才能继续时才前台运行。前后台只改变调度，不改变权限，后台仍把每个 permission prompt 提到主会话。 | “The default changes where a subagent runs, not what it's allowed to do.” — [Foreground or background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background) | 明确，带版本界限 |

## 模式矩阵

下表只表达 `permissionMode` 的继承/覆盖，不包含显式 ask/deny、工具集合、hook、sandbox 和 managed policy：

| parent mode | child 未指定 | child 指定任意其他 mode | 结果 |
| --- | --- | --- | --- |
| `bypassPermissions` | 继承 bypass | 忽略 child override | 始终 bypass |
| `acceptEdits` | 继承 acceptEdits | 忽略 child override | 始终 acceptEdits |
| `auto` | 继承 auto | 忽略 child override | 始终 auto，classifier 使用 parent session 的 block/allow rules |
| `default` | 继承 default | child override 生效 | 可升到 bypass，也可改为 plan/dontAsk 等 |
| `dontAsk` | 继承 dontAsk | child override 生效 | 可升到 bypass，也可改为其他 mode |
| `plan` | 继承 plan | child override 生效 | 可升到 bypass，也可改为其他 mode |

因此，若必须在题目的两个模型中选一个：

- **排除“父级权限上限”模型。** 两个反例都由官方规则直接产生：父级 bypass 时 child 不能收紧；父级 default/plan/dontAsk 时 child 又能指定 bypass 升权。
- **“父级精确策略覆盖”只对 `bypassPermissions`、`acceptEdits`、`auto` 三个父级模式成立，不能泛化到全部模式。**

## 工具规则与 permission mode：不要混淆三种“allow”

### 1. subagent frontmatter `tools`

这是能力集合 allowlist。没列出的工具不提供给该 subagent。它可以真正收紧能力范围。

### 2. settings / SDK 的 `permissions.allow` 或 `allowedTools`

这是审批预批准列表，不是能力集合上限。官方 SDK 特别警告，`allowedTools: ["Read"]` 配合 `bypassPermissions` 仍会批准 Bash、Write、Edit 等未列出工具。

### 3. `permissions.deny` / `disallowedTools`

这是硬约束层。bare tool deny 会移除工具；带参数的 deny 会在调用时拒绝，即使 mode 是 bypass。显式 `ask` 也会穿透 bypass 并要求审批（但在 `dontAsk` 下转为拒绝）。

另一个边界是 subagent frontmatter `mcpServers`：官方允许它给 subagent 增加主会话没有的 MCP server；managed MCP restrictions 仍应用于所有 subagent。由此也不能把“parent 当前可见工具”简单理解为绝对能力上限。见 [Scope MCP servers to a subagent](https://code.claude.com/docs/en/sub-agents#scope-mcp-servers-to-a-subagent)。

## CDF `strict | agent_decides | bypass` 的证据化映射建议

### CDF 当前本地语义（事实）

CDF 源码把三种模式定义为：

> `strict = 全量 DEFAULT_INTERRUPT_ON；agent_decides = 提示词引导；bypass = 不拦截。`

见 [`src/shared/agent-runtime.ts`](../../src/shared/agent-runtime.ts)；当前 `resolveInterruptOn()` 中，`strict` 和 `agent_decides` 都使用 `DEFAULT_INTERRUPT_ON + MCP tools`，`bypass` 返回空配置，见 [`src/main/deepagent/shared-infra.ts`](../../src/main/deepagent/shared-infra.ts)。UI 对 `agent_decides` 的表述是“仅对检测到的风险操作请求批准”。这些是 CDF 事实，不是 Claude Code 官方语义。

### 建议映射（建议，不是上游事实）

| CDF mode | 建议 | 证据边界与风险 |
| --- | --- | --- |
| `strict` | **不要只映射为 parent `default` 就声称获得严格上限。** 可以把 `default` 作为交互基线，但应由 CDF host 校验/移除 subagent 的 `permissionMode` override，并对必须审批的工具配置显式 `ask` 或统一的 PreToolUse / host callback；还可设置 `disableBypassPermissionsMode: "disable"`。 | `default` 只保证标准 Manual 流程，不等于 CDF 的每个 `DEFAULT_INTERRUPT_ON` 都始终询问；而 child 可从 parent default 覆盖成 bypass。`disableBypassPermissionsMode` 官方称可阻止 bypass 被激活，但没有专门展示“subagent frontmatter bypass 被拒”的例子，所以关键安全边界仍宜由 CDF 自己验证。 |
| `agent_decides` | 若产品目标真的是“独立安全分类器判断风险并尽量自动执行”，最接近的是 parent `auto`；parent auto 会强制所有 subagent 继承同一 classifier 规则。若 CDF 所谓“提示词引导”只是让工作模型自行决定何时请求批准，则**没有官方 mode 与之精确等价**，不要把它标成 Claude Code auto。 | 官方 `auto` 使用“a separate classifier model”，不是单纯 prompt guidance；它还有账号、模型和 provider 可用性要求，并明确“不保证安全”。见 [Auto mode](https://code.claude.com/docs/en/permission-modes#eliminate-prompts-with-auto-mode)。 |
| `bypass` | 可直接映射 parent `bypassPermissions`，但 UI/文档必须明确：所有 subagent 也会被强制 bypass，不能逐 agent 收紧；只建议在隔离容器/VM 中使用。 | 这是三者中名称和行为最接近的映射，但仍不是绝对“无拦截”：显式 ask/deny 继续生效，根目录/家目录删除有 circuit breaker。 |

补充建议：不要把 `dontAsk` 映射成 CDF `strict`。`dontAsk` 的语义是“未预批准就拒绝且不询问”，与交互式请求批准不同。

## 官方未明确或未完整展示的点

1. 官方没有发布完整的 parent × child 实测矩阵，也没有给 `default → bypassPermissions`、`plan → bypassPermissions`、`dontAsk → bypassPermissions` 的单独示例。本文对这些组合的判断来自官方“可覆盖，只有三个父级例外”的穷举式规则。
2. “permission context”没有在 subagent 页逐项定义。文档没有明确列出：会话内一次性批准、动态写入的 remembered approvals、运行中新增 rules 是否以何种快照时点传给已经运行的 subagent。`auto` 只明确说使用 parent session 的相同 block/allow rules。
3. 文档没有说明 parent 在 subagent 运行期间切换 mode 后，已运行 child 是否实时改变 mode。
4. nested subagent 的 sticky mode 是从直接父级还是根主会话重新计算，官方当前页没有给算法级说明；只使用“parent”一词。
5. `disableBypassPermissionsMode` 文档说“prevent ... mode from being activated”，但没有专门展示它与 custom subagent frontmatter 冲突时的 UI、错误或 fallback 行为。
6. CLI 文档明确描述并发/background prompt 在主会话中的呈现；SDK 文档说明 `canUseTool` callback 会暂停对应执行，但没有承诺多个并发 subagent 请求的 UI 排队顺序或去重策略。CDF 不应自行假定。
7. 官方 Claude Code 没有 `strict` 或 `agent_decides` 这两个 mode；任何映射都属于 CDF 产品设计，不是上游兼容性事实。

## 一手来源

1. [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
2. [Choose a permission mode](https://code.claude.com/docs/en/permission-modes)
3. [Configure permissions](https://code.claude.com/docs/en/permissions)
4. [Claude Code settings](https://code.claude.com/docs/en/settings)
5. [Hooks reference](https://code.claude.com/docs/en/hooks)
6. [Agent SDK: Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
7. [Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
8. [Agent SDK: Handle approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)
9. [Anthropic official `claude-code` changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

---

## 追加调研：进程退出、崩溃、重启与 session resume 对 subagent / 审批的影响

- 追加调研日期：2026-07-13
- 核实版本：官方在线文档与 `anthropics/claude-code` `CHANGELOG.md` 最新可见版本 v2.1.207。
- 术语边界：本节的 **background subagent** 是一个主会话内部通过 `Agent` 工具启动的子任务；**background session / background agent** 是 `claude agents` / `--bg` 交给独立 supervisor 托管的完整 Claude Code 会话。二者不是一回事。官方明确说 subagent “work within a single session”，且 agent view 不把一个会话内部的 subagent 列为独立 session row。见 [Subagents](https://code.claude.com/docs/en/sub-agents) 与 [Agent view](https://code.claude.com/docs/en/agent-view)。

### 先给结论：必须拆成 A / B / C / D 四层

| 层 | 官方实际承诺 | 结论 |
| --- | --- | --- |
| **A. 主会话 transcript/session 恢复** | CLI 持续把会话写入本地 transcript；`--continue` 恢复当前目录最近会话，`--resume` 按 picker/name/ID 恢复，运行中可用 `/resume` 切换。Agent SDK 也把 prompt、tool call/result、response 写入 session transcript，可用 `continue` 或 `resume: sessionId` 在进程重启后恢复。 | **明确支持。**恢复的是对话历史，不是原 OS 进程，也不是未完成任务自动继续。 |
| **B. subagent transcript/context 恢复** | 每个可恢复 subagent 有 agent ID 和独立 JSONL：`.../{sessionId}/subagents/agent-{agentId}.jsonl`。同一主 session 被恢复后，可继续按该 ID resume subagent；历史 tool calls、results、reasoning 保留。Explore/Plan 是 one-shot，不返回 ID，不能恢复。SDK 外部 `SessionStore` 若要支持 subagent resume，必须实现 `listSubkeys` 并恢复 `subagents/agent-<id>` 子键。 | **明确支持，且独立于 A 的 compaction。**但这仍是 context/transcript 恢复。 |
| **C. 正在运行的 subagent process/task 是否继续** | 普通 foreground/background subagent 都属于当前 session。直接退出时，CLI 会显示 `Background work is running`，只有选择 **Move to background and exit** 或先 `/background`，才把会话交给 background-session supervisor；该交接会启动一个 fresh process，并把可迁移的 subagent 工作带过去。普通 `--resume` / `/resume` 没有被文档定义为自动复活所有正在运行 child task。显式 resume 一个 subagent 会“start a new run under the same ID”。 | **原 process 不继续。**普通会话退出/崩溃后，仅凭 A/B 不等于 task 自动继续；手工 subagent resume 是同 ID 的新 run。只有先交给 supervisor 的 background session 有额外的 task-level handoff / restart 能力。 |
| **D. 尚未响应的 permission prompt 是否持久并可重启后继续** | CLI 文档说明 foreground/background subagent 的 prompt 在当前主会话实时浮出；agent view 可把 background session 标为 `Needs input`，其含义包括等待 permission decision，且 blocked row 即使 process 已退出仍可列出。但官方没有明确承诺：一个普通 interactive permission dialog 或其 approval token/回调，在应用/CLI/OS 重启后仍以同一 pending request 继续并接受原决策。Agent SDK 的普通 `canUseTool` callback 只在 query 活着时暂停；query 被取消便取消等待。SDK 提供的跨进程方案是显式 **`defer`**：把单个 pending tool call 写入 transcript、进程以 `tool_deferred` 退出，之后 `--resume` 令同一 tool call 再次触发 hook。 | **普通 pending approval 跨重启：未文档化，不能声称支持。**SDK `defer` 是明确支持的“持久化待处理 tool call”协议，但它不是把一个仍未返回的 permission callback/dialog 原样保存下来。 |

### A. 主会话 resume 恢复了什么

CLI 官方 [Manage sessions](https://code.claude.com/docs/en/sessions) 的表述是 session “saved continuously”，退出后可用：

- `claude --continue`：恢复当前目录最近 session；
- `claude --resume` / `claude --resume <name>`：picker 或指定名称；
- `claude --resume <session-id>`：可直接恢复 ID，包含 `-p` / Agent SDK 创建但不出现在 picker 中的 session；
- `/resume`：在当前运行会话内切换到另一个 conversation。

Agent SDK [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions) 更明确地区分了 transcript 与运行态：session 包含 prompt、每次 tool call、tool result 和 response，并自动写盘；进程重启后可用 `continue: true` 或捕获到的 `session_id` 做 `resume`。同时官方强调：“Sessions persist the **conversation**, not the filesystem.” 这也没有承诺保存 OS process、Promise、socket、正在执行的 shell/MCP call 或内存回调。

因此 A 能回答“模型之后还能看到什么”，不能单独回答 C/D。

### B. subagent resume 是同 ID 的新 run，不是旧进程复活

官方 [Resume subagents](https://code.claude.com/docs/en/sub-agents#resume-subagents) 同时给出了两组容易被混淆的事实：

1. “Resumed subagents retain their full conversation history”，并称会从停止处继续；主 session 重启后，只要恢复同一 session，subagent transcript 仍可恢复。
2. “Resuming starts a new run of the agent under the same ID”。也就是说，延续的是 ID + transcript/context；实现上是新 run，不应解释为旧执行栈或旧进程被冻结后原地继续。

subagent transcript 独立存放，主会话 compaction 不影响它，默认受 `cleanupPeriodDays`（30 天）清理。Agent SDK [Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage) 进一步把这件事暴露为存储接口：`SessionKey.subpath` 可指向 `subagents/agent-<id>`；resume 时若 store 没有 `listSubkeys`，只恢复主 transcript，**不会恢复 subagent transcripts**。这证明“主 session 可恢复”与“child context 可恢复”在存储层也是两个不同要求。

### C. 按退出/故障路径区分 process 与 task

#### 1. 普通 interactive session：foreground 与 background subagent 都没有独立 daemon 保活承诺

foreground 只表示阻塞主 conversation；background 只表示主 conversation 可并发继续。官方 [Run subagents in foreground or background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background) 明说默认变化“changes where a subagent runs, not what it's allowed to do”，并未把 background subagent 定义成脱离主 session 的守护进程。

退出有三条显式路径：

- **Stay**：不退出，原运行继续；
- **Move to background and exit**：把整个 session 交给 background-session supervisor；
- **Exit anyway**：官方没有承诺 child task 继续，不能把它等同于 background handoff。

agent view 文档写得很具体：backgrounding “starts a fresh process that resumes from the saved conversation”，然后把 background shell、backgrounded subagent、workflow 等可迁移工作交给新 process。若正在运行 subagent，v2.1.203+ 默认会等待工作可迁移；用户强制立即 background 时，文档说 subagent 会“restarts ... from the beginning”。这再次说明没有原进程透明存活保证。

#### 2. 已交给 `claude agents` supervisor 的 background session：有额外的 task-level 容错

这是比普通 `/resume` 更强的另一套运行时：

- 关闭 agent view、关闭 shell 或没有 terminal attached，session 仍运行；
- session state 持久到磁盘，可跨 auto-update 和 supervisor restart；
- process 无响应时，v2.1.200+ supervisor 会重启 process，并让 session 继续 interrupted response；
- 机器 shutdown/restart 会停止运行 session；之后 attach/peek/reply 会从停止处重启；
- background session 后续产生的 subagent 在 detach/reattach 之间继续运行。

见 [Agent view: From inside a session](https://code.claude.com/docs/en/agent-view#from-inside-a-session)、[How background sessions are hosted](https://code.claude.com/docs/en/agent-view#how-background-sessions-are-hosted) 和 [Sessions show as failed after shutdown](https://code.claude.com/docs/en/agent-view#sessions-show-as-failed-after-shutdown)。`CHANGELOG` v2.1.196 也记录了 long-running commands/workflows 跨 session process stop/restart/update，以及 daemon restart 后 worker 自动恢复；v2.1.203 记录了返回 agent view 不再停止正在运行的 subagents。

这里仍应说“新 process 对 task 做 supervisor-managed recovery”，不能说“原 subagent process 跨 crash 存活”，也不能外推成普通 interactive `/resume` 具备相同行为。官方仓库 [issue #75438](https://github.com/anthropics/claude-code/issues/75438) 报告 CLI process restart 后 background subagent/workflow completion notification 可能丢失；这是**弱行为证据（用户报告、未确认、不能覆盖官方文档）**，但足以提醒 CDF 不要假设 transcript + restart 自动带来 exactly-once completion/reconciliation。

### D. permission prompt 的跨重启边界

#### 普通 CLI prompt

当前文档只明确：

- foreground subagent 的 prompt 实时传给用户；
- v2.1.186+ background subagent 的 prompt 浮到主 session，批准后继续，Esc 只拒绝该 tool call；
- background session 可持久显示 `Needs input` / `blocked` 状态，其中包括 permission decision。

**没有官方段落明确规定一个尚未作答的 interactive permission prompt，在普通 CLI 退出、CLI crash、Electron/app restart 或 OS restart 后仍保存同一 request ID、同一 tool input、同一 approval callback，并允许用户直接回答。**因此这里必须记为“未文档化”，不能从“session transcript 可 resume”推断为 D 支持。

#### Agent SDK 普通 callback 与显式 `defer`

Agent SDK [Handle approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input) 明说 `canUseTool` callback 可无限 pending，但执行只在该 callback 返回前保持暂停，SDK 在 query 被取消时取消等待。若等待可能长到 process 不应继续存活，官方建议返回 [`defer`](https://code.claude.com/docs/en/hooks#defer-a-tool-call-for-later)：

1. `PreToolUse` 返回 `permissionDecision: "defer"`；
2. tool 不执行，process 以 `stop_reason: "tool_deferred"` 退出，pending tool call 写入 transcript；
3. host 持久保存 `session_id` 与 `deferred_tool_use`，在自己的 UI 中等用户；
4. `claude -p --resume <session-id>` 后同一 tool call 再触发 `PreToolUse`；
5. hook 此时返回 allow/deny，agent 才继续。

该协议没有 timeout（只受 transcript retention），但只支持该 turn 的**单个** tool call。这是官方对 D 最接近且最明确的设计：不是持久化一个活 Promise，而是把“待决 tool call”做成可恢复的 durable state transition。

### 针对 CDF #139：MemorySaver 是否足够

#### 结论

- 如果 #139 的验收范围被明确限定为：**Electron 主进程始终存活的单次运行内**，worker 遇到 `interruptOn` 后能暂停、主 UI 显示来源、用户审批后 `Command({ resume })` 继续，那么每个 worker 使用独立 `MemorySaver` **可以满足这个窄范围**。
- 如果“对齐 Claude Code”还包含本节 B，或产品希望 CDF 重启/崩溃后仍找回 waiting approval 并继续 worker，那么 `MemorySaver` **不够**。它只解决“LangGraph interrupt 需要 checkpointer”，不解决进程终止后的 checkpoint、worker identity、pending approval 与 resume routing。
- Claude Code 普通 pending approval 跨重启本身未文档化，所以不能以“上游明确支持 D”为理由强行扩大 #139；但若 CDF 自己承诺该 UX，就必须做 durable checkpoint。反过来，也不能用 Claude Code 的 A/B transcript persistence 为“MemorySaver 已完全对齐”背书。

CDF 当前主图已经使用持久化 `SqliteSaver`（`src/main/deepagent/runtime.ts` 的 `deepagents-checkpoints.db`），而 #139 的 worker 目前没有 checkpointer。建议不要把 worker 都塞进同一个 `thread_id + checkpoint_ns`；至少为每次 delegated invocation / parallel worker 分配稳定的 child thread/namespace，并持久化以下最小关联：

1. parent session/run/request ID；
2. worker/subagent ID、task ID、checkpoint thread/namespace；
3. pending approval ID、tool call ID、tool name/input、来源 worker、状态；
4. approval resolution 的幂等键；
5. restart reconciliation 状态（waiting/running/completed/failed），防止重复执行或 completion 丢失。

**推荐拆成两档交付：**

- **#139 最小闭环**：MemorySaver + per-worker resume channel + 并发审批归属；文档明确“不跨应用重启”，只对齐 Claude Code 活会话内 prompt routing。
- **耐久化闭环（推荐作为 #139 验收或紧随其后的任务）**：复用/扩展 SQLite checkpointer，启动时重建 pending approval 列表，并从 child checkpoint resume。其语义应表述为“new run/process from durable checkpoint”，不要表述为“原进程继续”。

若 CDF 的产品承诺是离线桌面工作站可恢复任务，建议直接选择第二档；否则 MemorySaver 会让审批 UI 看似可用，但 app crash 正好发生在 waiting approval 时，图 checkpoint 与内存中的 `pendingApprovals` resolver 会一起丢失，无法满足该承诺。

### 本次新增一手来源

10. [Manage sessions](https://code.claude.com/docs/en/sessions)
11. [CLI reference](https://code.claude.com/docs/en/cli-reference)
12. [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
13. [Manage multiple agents with agent view](https://code.claude.com/docs/en/agent-view)
14. [Agent SDK: Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
15. [Agent SDK: Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting)
16. [Agent SDK: Persist sessions to external storage](https://code.claude.com/docs/en/agent-sdk/session-storage)
17. [Hooks reference: Defer a tool call for later](https://code.claude.com/docs/en/hooks#defer-a-tool-call-for-later)
18. [Official changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
19. [Official repository issue #75438](https://github.com/anthropics/claude-code/issues/75438)（弱行为证据：用户报告，未确认）

---

## 追加调研：一个模型响应包含多个需审批 tool calls 时的审批与执行顺序

- 追加调研日期：2026-07-13
- 核实版本：官方在线文档与 `anthropics/claude-code` `CHANGELOG.md` 最新可见版本 v2.1.207。
- 证据边界：本节只使用 Claude Code / Agent SDK 官方文档、Anthropic API 官方 tool-use 文档和官方 changelog。官方仓库 issue 仅作为弱行为旁证，不把 issue 作者观察写成产品保证。

### 核心结论

**“主流 Agent 都是逐个审批，批准一个就立即执行，执行完再显示下一个”不能被现有一手资料完整证实。**官方资料支持的是一个更细的三层模型：

1. **审批单位是单个 tool call。**`PreToolUse`、`PermissionRequest`、`canUseTool` 都接收单个工具的名称和输入并返回该调用的决定，不是一个 decisions 数组。
2. **执行可以逐调用释放，但不是所有工具都串行。**Agent SDK 明确说只读调用可并发，`Edit` / `Write` / `Bash` 等变更状态的调用串行；`canUseTool` 对某一调用返回 allow 后，该调用获准执行。官方没有定义“先收齐本批全部 permission decisions，才允许任何工具开始”的内建 barrier。
3. **下一次模型推理仍是 batch barrier。**一个 assistant turn 的全部 tool calls 都解析后，才进入下一次模型调用；Anthropic API 要求把全部 `tool_result` 放在同一个下一条 user message 中，Claude Code 的 `PostToolBatch` 也只在整批调用全部 resolved 后触发。因此“批准后该工具开始执行”和“模型等整批结果后统一继续”可以同时成立。
4. **CLI 多 prompt 的 UI 排队及切换时机未文档化。**文档只说 foreground prompt “as they come up”、background 每个 prompt 都会浮到主会话，并定义当前 dialog 的 approve/decline；没有承诺 FIFO、LIFO、批量对话框，或“第一项执行完才展示第二项”。不能从 SDK callback 的单调用形状反推 CLI TUI 顺序。

可把官方可证实的运行顺序概括为：

> 同一 assistant turn 产生 N 个 tool calls → 每个调用独立经过 hook / rule / mode / `canUseTool` 权限流 → 获准调用按工具类别并发或串行执行，拒绝调用产生自己的拒绝结果 → N 个调用全部 resolved → `PostToolBatch` → 把整批结果交给模型进行下一轮推理。

这里的“全部 resolved”包含成功、失败、拒绝和未执行错误，不等于“全部批准”。

### 八个问题逐项核实

| 问题 | 结论 | 一手证据与边界 | 证据强度 |
| --- | --- | --- | --- |
| 1. 模型是否可在一个 response 中发多个 `tool_use` | **可以，且默认允许。**一个 assistant turn 可含多个 `tool_use` blocks；设置 `tool_choice.disable_parallel_tool_use: true` 才把 `auto` 限成每个 response 至多一个调用。 | [Anthropic API: Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use#execution-semantics)：“can contain several `tool_use` blocks in a single assistant turn”；[Agent SDK agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop#the-agent-loop) 也写“request one or more tool calls”。 | 明确 |
| 2. 工具是否并行执行 | **不由模型响应本身决定。**裸 API 不规定执行顺序，host 可并发、按出现顺序串行或混合。Claude Agent SDK 的具体策略是：只读工具可并发；`Edit`、`Write`、`Bash` 等变更状态工具串行；custom tool 默认串行，带 `readOnlyHint` 才可并发。 | [API execution semantics](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use#execution-semantics)；[Agent SDK: Parallel tool execution](https://code.claude.com/docs/en/agent-sdk/agent-loop#parallel-tool-execution)。`CHANGELOG` v2.1.161 另确认 Claude Code 存在“same batch”并让各调用独立返回结果。 | 明确 |
| 3. `PermissionRequest` / `canUseTool` / `PreToolUse` 是单调用还是批量 | **都是单调用入口。**`PreToolUse` 每个 tool call 触发，输入含单个 `tool_name`、`tool_input`、`tool_use_id`；`PermissionRequest` 在一个 permission dialog 将显示时触发，输入是单个 `tool_name` / `tool_input`，且官方特别说明它没有 `tool_use_id`；`canUseTool(toolName, input, context)` 每次只返回该请求的 allow/deny。唯一明确的 batch hook 是事后的 `PostToolBatch`。 | [Hooks lifecycle / PreToolUse / PermissionRequest](https://code.claude.com/docs/en/hooks)、[Agent SDK: Handle approvals](https://code.claude.com/docs/en/agent-sdk/user-input)、[PostToolBatch](https://code.claude.com/docs/en/hooks#posttoolbatch)。 | 明确 |
| 4. UI 同时多个 prompt 是队列、批量还是逐个 | **未文档化。**官方文档使用单数 permission dialog，并说 foreground prompts “as they come up”、background “every permission prompt” 浮到主会话，但没有定义 FIFO/LIFO、批量展示、并发 dialog 数量或稳定顺序。 | [Subagents: foreground or background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background) 只定义路由，不定义队列。官方 issue [#65910](https://github.com/anthropics/claude-code/issues/65910)（open、`bug`/`has repro`，v2.1.167 Linux）报告多 agent prompt 会以 LIFO 方式替换当前 prompt；这是**弱行为证据/bug 报告**，只能证明不能依赖稳定 FIFO，不能当作设计规范。 | UI 顺序未文档化；issue 为弱证据 |
| 5. approve 第一项后是否立即执行，再显示下一项 | **SDK 的单调用语义是 allow 后该调用执行；CLI 的“下一项何时显示”未文档化。**`canUseTool` 文档明确写 allow 时 tool executes、deny 时 tool doesn't execute，但没有说明同批多个 callback/dialog 的切换顺序，也没有说必须等第一项执行完成才显示第二项。 | [Agent SDK: Respond to tool requests](https://code.claude.com/docs/en/agent-sdk/user-input#respond-to-tool-requests)。官方 issue [#64170](https://github.com/anthropics/claude-code/issues/64170) 的单调用 hook 日志报告用户 allow 后进入工具执行、完成后才有 `PostToolUse`；这是弱行为旁证，且不能回答多个 prompt 的 UI 顺序。 | 单调用执行语义明确；CLI 多项顺序未文档化 |
| 6. reject / Esc 是否只影响当前 tool call | **单调用 deny 明确只拒绝该调用。**`canUseTool` deny 令该工具不执行并把拒绝消息给 Claude。background subagent 文档最明确：Esc “deny that one tool call without stopping the subagent”。CLI keybindings 也把 permission dialog 中的 `N` / `Escape` 定义为 decline current action。至于同批其他 pending dialogs 的显示/重排，官方未说明。 | [Agent SDK approvals](https://code.claude.com/docs/en/agent-sdk/user-input#respond-to-tool-requests)、[Subagents](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background)、[Keybindings: Confirmation actions](https://code.claude.com/docs/en/keybindings#confirmation-actions)。`CHANGELOG` v2.1.161 说明同批调用各自返回结果，Bash 失败不再取消 siblings，也支持“调用结果相互隔离”而非“一项失败全批取消”。 | 当前调用明确；其他 dialog UI 未文档化 |
| 7. foreground / background subagent 是否不同 | **权限单位和工具执行规则没有文档化差异，区别主要是调度与 prompt 路由。**foreground 阻塞主 conversation，prompt 实时传给用户；background 与主 conversation 并发，v2.1.186+ prompt 浮到主会话并标明来源，Esc 只拒绝该调用。v2.1.198+ 默认后台运行。 | [Subagents: foreground or background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background) 与官方 `CHANGELOG` v2.1.186。文档没有为 background 定义另一种 batch permission protocol。 | 明确到调度/路由；内部 UI 排队未说明 |
| 8. 是否存在“收齐全部 decisions 后一次恢复” | **存在“收齐整批 tool results 后再调用模型”的 barrier；没有文档化“收齐全部 permission decisions 后才开始执行工具”的 barrier。**API 要求一个 `tool_result` 对应一个 `tool_use`，全部放进同一个下一条 user message；`PostToolBatch` 在全批 resolved 后、下一次模型调用前只触发一次。 | [API: Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use#execution-semantics)、[Hooks: PostToolBatch](https://code.claude.com/docs/en/hooks#posttoolbatch)。不要把“统一恢复模型”误写成“统一释放工具执行”。 | 明确 |

### 为什么这不等于“逐个审批、逐个完整执行、再看下一个”

对两个需要 permission 的调用 A / B，官方资料允许或明确描述的层次是：

- **决定层**：A 和 B 各自有单调用 permission decision；没有 bulk `canUseTool([calls])`。
- **执行层**：若它们是只读调用，可并发；若是 `Write` / `Edit` / `Bash` 等变更状态调用，Agent SDK 串行执行。即使串行，也没有官方文字保证 B 的 permission dialog 必须等 A **执行完成**后才出现。
- **模型层**：无论中间如何审批和调度，下一次模型推理要等这一批全部 resolved，再接收整批 results。

所以用户提出的说法只有中间一部分得到支持：**“每个调用单独决定，批准会释放该调用”有官方依据；“UI 始终逐个 FIFO，且批准一项后必须先执行完才展示下一项”没有官方依据。**并发 subagent 还可能同时产生来自不同执行上下文的 prompt，官方只承诺标明来源与逐调用 Esc，不承诺全局队列顺序。

### CDF 方案 A / B：证据化建议与 LangGraph batch interrupt 代价

CDF 当前主审批路径把 deepagents interrupt 的 `actionRequests[]` 投影为一个 approval request，等待 `AgentApprovalResolution.decisions[]`，然后只调用一次：

```ts
new Command({ resume: { decisions: resolution.decisions } })
```

见 [`src/main/llm.ts`](../../src/main/llm.ts)。这是 CDF / LangGraph 当前事实，不是 Claude Code 的官方 UI 语义。

| 方案 | 与上游证据的关系 | 对当前 LangGraph batch interrupt 的代价 | 建议 |
| --- | --- | --- | --- |
| **A. 逐项决定、收齐后统一恢复** | 与 Anthropic API 的“整批 results 后统一进入下一模型轮次”和 Claude Code `PostToolBatch` barrier 相容；但如果统一恢复前任何已批准工具都不执行，它比 Agent SDK 的“allow 后该调用执行”更保守，不能宣传为 Claude CLI 的精确复刻。 | **低。**保留一个 interrupt、一个 `decisions[]`、一次 `Command({ resume })`。UI 可逐项展示并锁定当前项，最终一次提交；天然避免 prompt 被异步替换，也容易保证混合 approve/reject 的索引对应关系。代价是第一个批准动作到实际执行之间有等待，慢工具无法与后续人工审批重叠。 | **建议作为 CDF 当前默认实现。**理由是官方未承诺 CLI prompt 顺序，而当前 runtime 本来就是 batch resume；应把它明确命名为 CDF 的“批次审查后执行”安全策略，而不是声称“与 Claude Code 完全一致”。 |
| **B. 逐项批准即执行** | 更接近 Agent SDK 对单个 `canUseTool` allow 的语义，也能降低首个工具启动延迟；但官方仍未证明 CLI 一定执行完一项才展示下一项。 | **高。**当前单次 batch interrupt 不能仅靠先写入一个 decision 就安全实现。需要把每个 action 变成独立可恢复执行单元，或在图外增加 per-tool permission/execution scheduler；维护稳定 tool-call ID、per-call 状态和幂等执行；按 read-only / state-changing 规则调度；隔离 reject/Esc；收集每个 result；最后仍要在 batch barrier 处一次把整批结果交回模型。还要防止 partial resume 重新执行已完成副作用。 | 只有产品明确要求“点批准即开始执行”并接受更高 exactly-once / checkpoint / 调度复杂度时再选。先做最小原型验证 deepagents/LangGraph 是否支持真正的 per-action partial resume；若不支持，不应伪造多次 `Command({ resume })`。 |

**推荐落点：先选 A，但把 UI 做成稳定 FIFO 的逐项审查，并显示“本批还有 N 项；全部决定后开始执行”。**这既避免把未文档化的 Claude CLI 行为当规范，也与 CDF 当前 batch interrupt 最匹配。若以后切换 B，UI 文案应改成“批准后立即开始”，并以 per-call durable state + 幂等执行为前置条件，而不是只改按钮回调。

另一个重要边界：无论选 A 还是 B，**模型本身都不应在半批 results 上继续推理**。Anthropic API 的官方格式要求整批 `tool_result` 同消息返回；B 优化的是工具开始时间，不是取消 batch result barrier。

### 本次新增一手来源

20. [Anthropic API: Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use)
21. [Anthropic API: Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
22. [Agent SDK: How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop)
23. [Agent SDK: Handle approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)
24. [Agent SDK: Intercept and control behavior with hooks](https://code.claude.com/docs/en/agent-sdk/hooks)
25. [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
26. [Claude Code keybindings](https://code.claude.com/docs/en/keybindings)
27. [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
28. [Official `anthropics/claude-code` changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
29. [Official repository issue #65910](https://github.com/anthropics/claude-code/issues/65910)（弱行为证据：用户报告；虽有 `has repro` 标签，仍非规范）
30. [Official repository issue #64170](https://github.com/anthropics/claude-code/issues/64170)（弱行为证据：用户日志；仅说明单调用 allow → execute，不证明多 prompt UI 顺序）
