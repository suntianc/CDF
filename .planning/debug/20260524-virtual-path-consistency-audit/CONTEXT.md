# 虚拟路径一致性系统排查

## Scope

排查 DeepAgents runtime 中宿主机绝对路径与虚拟项目根 `/` 混用的问题。

## Findings

- `memory` 已修为 `/AGENTS.md`，不再传 `/Users/.../AGENTS.md`。
- 系统提示已不再暴露宿主机项目路径。
- Skills source 仍返回 `.cdf/skills` 这类相对路径。DeepAgents 可加载，但技能列表会把相对路径展示给模型；模型后续调用 `read_file` 时需要绝对路径，存在权限校验失败风险。

## Success Criteria

- Runtime 传给 DeepAgents 的 memory 和 skills 均为虚拟绝对路径。
- 测试覆盖 Skills source 以 `/` 开头。
- 定向测试、node 类型检查和构建通过。
