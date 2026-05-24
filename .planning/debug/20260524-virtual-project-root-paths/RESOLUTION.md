# Resolution

## Changes

- Runtime 项目上下文不再暴露宿主机真实项目路径。
- 系统提示明确 DeepAgents 文件工具的项目根目录是虚拟路径 `/`，路径应写成 `/src/main.ts` 这类形式。
- 文件权限 deny 规则增加 `/Users/**`、`/home/**`、`/private/**`、`/tmp/**`、`/var/**`，防止模型误把宿主机绝对路径当成虚拟路径并在项目内创建多层目录。

## Verification

- `npm run test -- src/main/deepagent/runtime.test.ts src/main/deepagent/skill-manager.test.ts`
- `npx tsc -p tsconfig.node.json --noEmit`
