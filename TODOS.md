# TODOS

## File Management

### IPC 通道命名统一整改

**What:** 把现有的 db:openFile/db:revealFile/db:selectDirectory/db:selectFile 统一重命名为 fs: 前缀。

**Why:** 同一套文件操作分属 db: 和 fs: 两个前缀，增加开发者认知负担。新的文件管理 IPC 已统一用 fs: 前缀（D9 审查决定），但老的 db: 前缀通道需要后续整改。

**Context:** 现有 ipc-handlers.ts 中 db:openFile (line 782)、db:revealFile (line 803)、db:selectDirectory (line 390)、db:selectFile (line 397) 需要迁移。preload/index.ts 中对应的 API 也需要同步更新。整改时需要全局搜索这些通道名的所有使用点。

**Effort:** S
**Priority:** P3
**Depends on:** Phase 1 文件管理完成后再做，避免影响现有功能

### Markdown 预览安全模型

**What:** 为 Markdown 预览功能定义威胁模型，处理远程图片、链接、HTML 和协议处理。

**Why:** 本地文件的 Markdown 可能包含远程图片（信息泄露）、恶意 HTML（XSS）、非标准协议链接（突破离线预期）。Outside Voice #14 发现设计缺失此安全策略。

**Context:** CDF 使用 streamdown 渲染 Markdown，已有基本 CSP 保护。但文件管理的 Markdown 预览场景不同于对话消息 — 用户打开的可能是来源不可信的文件。需要决定：是否禁止远程资源加载、是否 strip HTML 标签、是否限制协议类型（只允许 file://）。参考现有 SVG XSS guard (commit d464170)。

**Effort:** S
**Priority:** P2
**Depends on:** Phase 1b（Markdown 预览功能）实施前确定

## Completed
