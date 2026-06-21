---
phase: 16-infra-unification-observability
plan: 02
subsystem: infra
tags: [shared-infra, migration, node-executor, runtime, search-tools, tool-registry]

requires:
  - 16-01 (shared-infra.ts 共享能力层)
provides:
  - node-executor.ts 迁移到 shared-infra，消除 mirrored 代码
  - runtime.ts 迁移到 shared-infra，消除重复函数定义
  - Workflow 路径新增搜索工具加载（tavily/anysearch/arxiv）
  - 两条路径共享同一份 DEFAULT_INTERRUPT_ON 和 resolveInterruptOn
affects:
  - 16-03-PLAN (span trace UI 展示，依赖 spanId/parentSpanId 字段)

tech-stack:
  added: []
  patterns:
    - "shared-infra 消费方模式：node-executor.ts / runtime.ts 均从 shared-infra 导入共享函数，消除跨文件镜像实现"
    - "createBuiltInTools + loadRegistryTools 统一工具构建模式：两条路径使用相同的函数，工具集对等"

key-files:
  created: []
  modified:
    - src/main/workflow/node-executor.ts
    - src/main/deepagent/runtime.ts

key-decisions:
  - "cherry-pick 16-01 提交到 worktree：当前 worktree 缺少 16-01 的 shared-infra.ts，cherry-pick e43c941/92e10e1 引入"
  - "runtime.ts DEFAULT_INTERRUPT_ON 合并到 shared-infra：runtime 原有 3 个拦截键，shared-infra 有 6 个（含 delete_agent/update_agent/create_agent），测试仅验证 delete_file 存在和 remove_file 不存在，扩展版本不破坏测试"
  - "getAgentRow 包装 AgentNotFoundError：shared-infra.getAgentRow 抛出泛化 Error，node-executor 需捕获并转换为 AgentNotFoundError 以保留语义"
  - "保留 db 直接访问于 ProjectRow 查询：该查询是 node-executor 独有逻辑（不在 shared-infra 中），保留 db import"
  - "anthropic-roundtrip 和 anthropic-video-passthrough 测试预存失败：这两个测试需要编译后的 CJS 文件，与本次修改无关（git stash 验证确认）"

requirements-completed: []

duration: 15min
completed: 2026-06-21
---

# Phase 16 Plan 02: node-executor.ts 和 runtime.ts 迁移到 shared-infra 共享层 Summary

**将 node-executor.ts 和 runtime.ts 迁移到使用 shared-infra.ts 共享能力层，消除所有 mirrored 代码，Workflow 路径新增搜索工具加载，两条路径工具集对等，43 个测试全部通过**

## Performance

- **Duration:** 15 min
- **Started:** 2026-06-21T13:00:00Z
- **Completed:** 2026-06-21T13:09:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- node-executor.ts：删除 mirrored DB Helpers（AgentRow、ProviderRow、MCPServerRow 接口 + getAgent/getProvider/getAgentMcpServers/getAgentSkillNames 函数），改为从 shared-infra 导入；替换内联 builtInTools 构造为 createBuiltInTools(workingDir)；添加 loadRegistryTools() 调用，Workflow 路径首次获得搜索工具能力（tavily/anysearch/arxiv）；删除 mirrored 注释
- runtime.ts：删除 normalizeProviderId、getProvider、getAgentMcpServers、getAgentSkillNames 函数定义；删除 DEFAULT_INTERRUPT_ON 常量定义；删除 TOOL_REGISTRY 数组和 loadToolConfig 内部函数；替换为从 shared-infra 导入；替换内联 builtInTools 构造为 createBuiltInTools(project.path)；替换 TOOL_REGISTRY 循环为 loadRegistryTools() 调用
- 净减少：node-executor.ts 减少 79 行，runtime.ts 减少 101 行，合计 180 行冗余代码消除

## Task Commits

1. **Task 1: 迁移 node-executor.ts 到 shared-infra 共享层** - `186fb71` (feat)
2. **Task 2: 迁移 runtime.ts 到 shared-infra 共享层** - `3b226a7` (feat)

## Files Modified

- `src/main/workflow/node-executor.ts` — 删除 mirrored DB Helpers，从 shared-infra 导入，添加 loadRegistryTools()，减少 79 行
- `src/main/deepagent/runtime.ts` — 删除重复函数定义，从 shared-infra 导入，简化工具构建，减少 101 行

## Test Results

- node-executor.test.ts: 12/12 通过
- runtime.test.ts: 13/13 通过
- shared-infra.test.ts: 18/18 通过
- 全量测试：365/365 通过（2 个预存失败文件与本次修改无关）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] getAgentRow 抛出泛化 Error，需要转换为 AgentNotFoundError**
- **Found during:** Task 1
- **Issue:** shared-infra.getAgentRow 抛出 `Error: Agent not found: {id}`，而 node-executor 对外语义是 AgentNotFoundError（已有自定义错误类）
- **Fix:** 包装 try/catch，捕获 getAgentRow 的错误并转换为 AgentNotFoundError
- **Files modified:** src/main/workflow/node-executor.ts
- **Commit:** 186fb71

**2. [偏差] cherry-pick 16-01 提交引入 shared-infra.ts**
- **Found during:** 执行前检查
- **Issue:** 当前 worktree 缺少 Plan 16-01 的 shared-infra.ts（97f42e2、92e10e1），无法开始迁移
- **Fix:** git cherry-pick 两个提交，引入 shared-infra.ts 和对应测试

## Threat Mitigation

| Threat | Status |
|--------|--------|
| T-16-03: 搜索工具权限提升 | accepted — 搜索工具只读操作，与 Chat 路径一致 |
| T-16-04: resolveInterruptOn 替换 | mitigated — 统一使用 shared-infra DEFAULT_INTERRUPT_ON，runtime 测试验证 delete_file 拦截行为不变 |

---
*Phase: 16-infra-unification-observability*
*Completed: 2026-06-21*
