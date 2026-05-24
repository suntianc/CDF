# Resolution

## Audit Result

排查了 runtime、memory、skills、权限规则、delete 工具、IPC 物理 Skill 管理路径：

- `memory` 已使用虚拟绝对路径，例如 `/AGENTS.md`。
- Runtime 系统提示不再暴露宿主机项目绝对路径。
- `FilesystemBackend` 继续使用宿主机 `project.path` 作为 `rootDir`，这是 backend 初始化所需，不会暴露给模型工具参数。
- `delete_file` 接受虚拟路径并在内部解析到项目真实路径，且有项目内与敏感路径保护。
- IPC 中 `listPhysicalSkills/savePhysicalSkill/deletePhysicalSkill(project.path, ...)` 是桌面端物理文件管理，不传给 DeepAgents，属于正常使用。

## Fix

- 将 DeepAgents Skills source 从相对路径 `.cdf/skills` 改为虚拟绝对路径 `/.cdf/skills`。
- 绑定单个 Skill 时同样输出 `/.cdf/skills/name` 或 `/.cdf/.runtime/global-skills/name`。
- 测试覆盖 Skills source 必须以 `/` 开头。

## Verification

- `npm run test -- src/main/deepagent/runtime.test.ts src/main/deepagent/skill-manager.test.ts src/main/deepagent/file-tools.test.ts src/main/llm.test.ts`
- `npx tsc -p tsconfig.node.json --noEmit`
- `npm run build`
