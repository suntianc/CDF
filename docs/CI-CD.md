# CI/CD 工作流

> 自动化检查、构建与发布流程。所有 workflow 位于 `.github/workflows/`。

## 工作流一览

| 文件 | 触发时机 | 用途 |
|------|---------|------|
| `ci.yml` | push / PR 到 `master` 或 `main` | 跨平台 lint + typecheck + test |
| `release.yml` | 推送 `v*` 标签 / 手动触发 | 构建全平台全架构安装包并发布到 GitHub Releases |

## CI（`ci.yml`）

- **触发**：`push` 或 `pull_request` 到默认分支
- **矩阵**：`ubuntu-latest` / `windows-latest` / `macos-latest`
- **步骤**：安装依赖 → 原生模块 rebuild → patch-package → lint → typecheck → test
- **并发控制**：同一 ref 的运行自动取消上一次

### Typecheck

`pnpm typecheck` 是阻塞性的（CI 失败会阻断合并）。它对 `tsconfig.node.json` 和 `tsconfig.web.json` 各跑一次 `tsc --noEmit`。

历史上有过一批 shadcn 组件缺失、@/ 路径别名未配置、JSON module 声明缺失等遗留问题，**已全部清理**。如果未来 typecheck 报错，请按错误文件所在 tsconfig 对应修复。

## 发布（`release.yml`）

构建目标矩阵：

| 目标 | 平台 | 架构 | 安装包格式 | Runner |
|------|------|------|------------|--------|
| `mac-x64` | macOS | x64 (Intel) | `.dmg` | `macos-13` |
| `mac-arm64` | macOS | arm64 (Apple Silicon) | `.dmg` | `macos-14` |
| `win-x64` | Windows | x64 | `.exe` (NSIS) | `windows-latest` |
| `win-arm64` | Windows | arm64 | `.exe` (NSIS) | `windows-latest` |
| `linux-x64` | Linux | x64 | `.AppImage` | `ubuntu-latest` |
| `linux-arm64` | Linux | arm64 | `.AppImage` | `ubuntu-22.04-arm64` |

所有目标构建完成后，自动汇总到 GitHub Release 页面。

### 触发方式

```bash
# 方式 1：推送语义化版本标签
git tag v1.2.3
git push origin v1.2.3

# 方式 2：在 GitHub Actions 页面手动触发（可指定 tag）
```

### 产物命名

构建产出会附加架构后缀，便于用户区分：

- `CDF-1.0.0-mac-x64.dmg`
- `CDF-1.0.0-mac-arm64.dmg`
- `CDF-1.0.0-win-x64.exe`
- `CDF-1.0.0-win-arm64.exe`
- `CDF-1.0.0-linux-x64.AppImage`
- `CDF-1.0.0-linux-arm64.AppImage`

## 必需的 Secrets

CI 流程**不需要任何**额外 secret。默认 `GITHUB_TOKEN` 已自动注入。

可选（启用代码签名时）：

| Secret | 用途 |
|--------|------|
| `MAC_CERT_P12` | macOS 代码签名证书（base64） |
| `MAC_CERT_PASSWORD` | 证书密码 |
| `APPLE_ID` | Apple ID（用于公证） |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 |
| `APPLE_TEAM_ID` | Apple 开发者 Team ID |
| `WIN_CERT_PFX` | Windows 代码签名 PFX（base64） |
| `WIN_CERT_PASSWORD` | PFX 密码 |

> 当前 release workflow 注释掉了签名相关环境变量，按需取消注释并配置 secrets 即可启用。

## 本地验证 workflow 语法

```bash
# 安装 act（本地运行 GitHub Actions）
brew install act

# 列出所有 workflow
act -l

# 干跑 CI（不真正执行步骤）
act -n pull_request
```

## 版本号约定

遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)：
- `v1.0.0` — 破坏性变更 → 主版本
- `v1.1.0` — 新增功能 → 次版本
- `v1.0.1` — 修复 → 修订版本

## 故障排查

- **macOS arm64 runner 拉取慢**：首次构建需 ~10 分钟缓存依赖，后续会被 pnpm 缓存命中
- **Windows arm64 构建**：当前矩阵复用 `windows-latest`（x64 runner），electron-builder 通过交叉编译生成 arm64 安装包
- **Linux arm64**：使用原生 arm64 runner `ubuntu-22.04-arm64`，避免 QEMU 仿真
