# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Agent 개발工作站 MVP

**Shipped:** 2026-06-03
**Phases:** 6 (incl. 2 INSERTED 03.1/03.2) | **Plans:** 21 | **Tasks:** 39
**Quick Tasks:** 25 (8 in same calendar day as close — post-milestone stabilization)
**Sessions:** 1 long-running session spanning multiple Claude Code invocations
**Timeline:** 15 days (2026-05-19 → 2026-06-03)

### What Was Built

- 桌面 Electron + React 19 + Vite 应用骨架
- 多 LLM chat 引擎（OpenAI / Anthropic / Ollama / 自定义，含 streaming + safeStorage 加密）
- deepagents.js 集成 + Agent 资产库 + MCP server (Streamable HTTP) + Skills 系统
- LangGraph.js StateGraph 执行引擎 + ReactFlow 可视化工作流编辑器
- 安全模型：safeStorage 加密 API key、draft workflow 隐藏 + status 校验（防御性）
- patch-package 永久化 LangChain 修复（M3 video + reasoning roundtrip，6 hunks）
- 项目级 GSD tooling（cleanup helper + PreToolUse hook，强制走规范流程）

### What Worked

- **GSD quick task 模式非常适合 bugfix 链** — M3 多轮 roundtrip 一共跑了 5 个 quick task（s29→se4→soe→tiy→u6w），每个原子 commit，能精确回滚任意一步
- **patch-package 是 LangChain 修法的稳健路径** — 修在 node_modules，写 patch 文件锁住；下次 `npm install` 自动应用，跨机器一致
- **TypeScript 端到端测试 + .cjs/.js 双 patch 原则** — 1.4.0 + 1.4.0 模式 + .cjs 是真实生产 Electron 路径，缺一不可
- **user 实测在 b 测试通过后才发现 bug** — 单元测试金字塔盲区：单元绿≠集成绿。这点会驱动未来加 e2e 测试

### What Was Inefficient

- **b 测试通过了但生产是 false positive** — `260603-soe` 的 it 1.2 测 v1 路径用了 `model_provider: "anthropic"`，但 deepagents checkpoint 走一圈后这个字段丢了；fallthrough 路径没覆盖。花了 1 个 real-fix + 1 个 real-fix-2 才彻底补全
- **worktree cleanup 7 次都至少踩 1 个坑** — untracked SUMMARY.md / claude agent locked marker / node_modules symlink。最终靠脚本 + PreToolUse hook 解决，但本应在第一次踩坑时就做
- **2 个 quick task 因为 plan 误判"无需 patch .cjs"漏了一半修复** — 260603-s29 的 .js-only patch 被用户发现温度冲突；260603-tiy 起初也只 patch .js，executor Rule 1 才捕获了 .cjs 同步需求
- **daemon.pid 这种 runtime 噪声文件在 .gitignore 之前要一直 workaround** — 早该在第一次 commit 时就处理

### Patterns Established

- **patch-package 必须同时改 .js 和 .cjs**（executor Rule 1 自动化）—— 适用于所有 LangChain 包路径
- **TDD-RED → GREEN 流程用于 patch 验证** —— 先写测试确认不应用 patch 必失败，再应用 patch 转绿
- **PreToolUse hook 强制走规范脚本** —— 机器级约束比 CLAUDE.md 提示可靠 100 倍
- **multi-layer thinking（用户→project→蕾姆→脚本→executor）递进式细化** —— 每次 user 反馈带出新 bug 时，不回到零，而是从最近一层深挖

### Key Lessons

1. **集成测试必须端到端跑真机** —— b 测试单元绿但生产挂的原因：测的是 LangChain 函数契约，没测 deepagents checkpoint roundtrip。下次 milestone 加 e2e 测试覆盖 roundtrip
2. **patch-package 是 LangChain 修复的事实标准** —— 但**必须 .js + .cjs 双覆盖**，且每个 patch 要有 TDD 测试（不应用 patch 必失败）才能保证升级时不漂移
3. **GSD quick task 是 bugfix 链的好工具** —— 5 个原子 commit（s29→se4→soe→tiy→u6w）可以独立 review/回滚，比 single mega-PR 安全
4. **用户实测是最终真理** —— 5/5 PASS + tsc strict 干净 + push 到 origin 都不算完，必须 Suntc 君在真机跑一遍 M3 多轮确认思考区
5. **机器级强制 > 人记** —— PreToolUse hook 是这次最有 ROI 的投资

### Cost Observations

- Model mix: 100% sonnet（executor）/ 100% opus（planner）
- Sessions: 1 long-running session (today) + many shorter sessions over 15 days
- Notable: 蕾姆每次 fresh context 都"忘"worktree cleanup 流程 → hook 解决了

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~10 | 6 | Established GSD quick task + patch-package + PreToolUse hook patterns |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 16 (anthropic-roundtrip 5 + llm-adapter 10 + video-passthrough 1) | N/A (no coverage tool configured) | patch-package 6-hunk lock |

### Top Lessons (Verified Across Milestones)

1. **patch-package .js + .cjs 双覆盖原则** —— v1.0 内 260601-nzn (video, .js only) → 260603-vht (video, .cjs backfill) → 260603-tiy (reasoning, .js + .cjs) → 260603-u6w (reasoning v1 path, .js + .cjs) 4 次实战验证
2. **unit 测试 ≠ integration 测试** —— b (260603-soe) false positive 教训：unit 测 LangChain 函数契约 = OK；integration 测 deepagents checkpoint roundtrip = 必须加
3. **机器级约束比文档/CLAUDE.md 提示可靠** —— PreToolUse hook (260603-wd4) 0 行后续人工维护，7+ 次 quick task 自动走规范
