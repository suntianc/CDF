# 异步视频 Capability 真实 Provider 验证手册

## 目的与证据边界

本手册用于用户在明确知晓计费风险后，以自己的 MiniMax Token Plan 或 xAI Grok OAuth 权益验证异步视频生成。它覆盖 Provider 状态、Background Capability Job 状态、Conversation continuation、本地 MP4 artifact，以及鉴权或权益错误。

仓库中的 Vitest 用例只使用 fixture 响应。**fixture 通过不得记录为真实 Provider 成功。** 实现 Agent 不执行真实计费调用，也不得把 mock、fixture、录屏或既有 artifact 冒充本次真实调用。

每个真实场景都必须单独留下按本文模板填写的记录。只有 Provider 实际接受请求、CDF 跟踪到成功、下载本次结果并生成可播放的本地 MP4，才可将该场景记为“真实 Provider 成功”。

## 前置条件

1. 使用可承担测试费用的账号和独立测试 Project；确认账号套餐、地区、配额与视频生成权益。
2. 使用 `pnpm run dev:electron` 启动应用。不要在日志、截图或记录中保存 Token Plan key、OAuth access token、Provider Task ID、临时下载 URL 或首帧 Data URL。
3. 在 Settings 中完成对应连接，并启用该连接的 `video.generate` capability：
   - MiniMax Token Plan；
   - xAI Grok OAuth。
4. 准备一张获授权使用的首帧图片。建议 PNG、1600×900、远小于 20 MB；不要使用隐私或受限内容。
5. 打开 Activity / TaskPanel，并保留来源 Conversation。提交后记录 CDF `jobId`，不要记录 Provider Task ID。
6. 了解状态语义：
   - `queued`：仅本地排队，尚未产生 Provider 创建请求；
   - `submission_pending`：正在进行唯一一次不安全创建调用；
   - `submission_unknown`：创建结果不确定，CDF 不会自动重试；
   - `submitted` / `running` / `downloading`：远端任务已存在或正在下载；
   - `blocked`：冻结连接暂时不可用或安全重试耗尽；
   - `tracking_stopped`：只停止本地跟踪，不代表远端取消或停止计费；
   - `completed` / `failed` / `canceled`：终态。

## 场景 A：MiniMax 6 秒 768P 文生视频

向 Agent 明确要求使用 MiniMax，并让其调用公共 `generate_video` 能力。用于核对的公共请求意图如下；不要添加 model 参数：

```json
{
  "prompt": "A paper boat drifting across a calm ink-blue pond, fixed camera, subtle ripples",
  "mode": "text",
  "route_hint": "minimax-token-plan",
  "duration": 6,
  "resolution": "768P"
}
```

检查并记录：

1. 工具回执只包含 CDF `jobId`、`video.generate` 和 `queued`，不包含 credential、Provider Task ID 或临时 URL。
2. TaskPanel route 固定为 MiniMax Token Plan；同一连接同时最多一个已提交视频 Job，其余保持 `queued`。
3. 可观察到的 Provider 进度按实际响应映射为 preparing、queueing、processing，随后进入下载；不要求每次都出现所有中间状态。
4. Job 最终为 `completed`，artifact MIME type 为 `video/mp4`，路径位于当前 Project 的 `.cdf/artifacts/videos/`。
5. 本地 MP4 存在、非空并可播放；文件内容属于本次 prompt，而不是旧 fixture 或旧 artifact。
6. 来源 Conversation 只出现一次终态完成事件；continuation 最终为 `consumed`。若 continuation 失败，记录错误，不能把 Job 成功等同于 continuation 成功。

## 场景 B：MiniMax 6 秒 768P 首帧图生视频

使用同一张明确授权的本地图片，要求 Agent 通过 MiniMax 生成视频。用于核对的公共请求意图：

```json
{
  "prompt": "Animate the opening frame with a gentle forward camera move and natural water motion",
  "mode": "first-frame",
  "images": [
    { "role": "first-frame", "source": "/absolute/path/to/authorized-opening.png" }
  ],
  "route_hint": "minimax-token-plan",
  "duration": 6,
  "resolution": "768P"
}
```

除场景 A 的检查项外，再检查：

1. Job 创建后修改或移走源图片；本次任务仍应使用创建时冻结的输入快照。
2. TaskPanel 只展示非敏感摘要：`first-frame`、MIME、尺寸、比例、大小和短 hash；不得显示原始路径、Data URL 或图片字节。
3. 输出视频的首帧构图与输入一致。CDF 不应静默消费 MiniMax 不支持的 `aspect_ratio`。
4. 本次真实记录写明实际图片格式、尺寸、大小和授权来源，但不要附图片内容或 Data URL。

## 场景 C：xAI 首帧图生视频

要求 Agent 显式使用 xAI Grok OAuth。用于核对的公共请求意图：

```json
{
  "prompt": "Animate the opening frame with restrained subject motion and a stable cinematic camera",
  "mode": "first-frame",
  "images": [
    { "role": "first-frame", "source": "/absolute/path/to/authorized-opening.png" }
  ],
  "route_hint": "xai-oauth",
  "duration": 6,
  "resolution": "480p"
}
```

检查并记录：

1. route 在持久化前冻结为 xAI Grok OAuth；重启恢复、查询和下载不得改走 MiniMax。
2. 源图片变化不影响已冻结快照；renderer 不出现 `image_url` Data URL、OAuth credential、xAI `request_id` 或临时下载 URL。
3. Job 从远端提交/运行进入下载并完成为本地 MP4；本地文件存在、非空且可播放。
4. 来源 Conversation 恰有一个终态事件，artifact 路径可定位，continuation 最终为 `consumed` 或留下明确失败记录。

## 重启、停止与不确定提交检查

至少选择一个已真实提交且尚未完成的场景执行以下检查；不要为了制造状态重复提交计费请求：

1. 退出并通过 `pnpm run dev:electron` 重启。CDF 应沿冻结 connection 和已有 Provider Task 恢复查询，不产生第二次创建。
2. 对已提交任务执行 `stop_tracking`：状态应为 `tracking_stopped`，界面明确提示远端仍可能继续和计费。
3. 执行 `resume_tracking`：CDF 查询同一远端任务，不重新创建。
4. 如果自然遇到 `submission_unknown`，记录创建调用前后的网络/应用条件。不要自动重试；只有在接受潜在重复计费后才显式 `resubmit`，并记录新旧 CDF `jobId` 的关联。
5. 不要通过断网或强杀专门制造 `submission_unknown`，除非用户已明确接受可能的重复计费。

## 鉴权、权益与输入错误记录

失败也属于有效真实验证结果，但必须准确分类：

| 观察点 | 预期记录 |
|---|---|
| 未连接或 credential 缺失 | 创建 Job 前返回 route unavailable；无远端创建、无收费成功声明 |
| capability 开关关闭 | 创建 Job 前返回 capability disabled；已有已提交任务仍可做最小查询与下载 |
| xAI 权益拒绝 | 记录 HTTP/应用错误与 Settings 中的账号状态；不得把重新登录描述为必然解决权益问题 |
| MiniMax key 失效或配额不足 | 记录 Provider `status_code` / 安全错误摘要与 Job 状态；不得记录 key |
| Provider 临时 429/5xx | 记录安全查询/下载是否退避恢复；创建调用不得自动重试 |
| 输入图片不合规 | 应在 Provider 创建前失败；记录格式、字节数、尺寸或比例类别，不保存图片内容 |
| 下载为空或临时 URL 失效 | Job 应明确失败或 blocked；不得生成或保留伪 MP4 成功记录 |

## 单场景记录模板

```text
日期与应用 commit/tag：
场景：A / B / C
证据类型：真实 Provider（不得填写 fixture）
Provider 与账号状态：connected / unavailable / expired / entitlement denied / quota error / 其他
公开请求参数：mode、route_hint、duration、resolution；首帧仅记录格式/尺寸/大小
CDF jobId：
Job 状态轨迹：
Provider 状态摘要（不含 Provider Task ID、临时 URL、secret）：
是否执行重启恢复或 stop/resume：
Conversation 终态事件数量：
Continuation：pending / running / failed / consumed；错误摘要
本地 artifact：相对 Project 的路径、字节数、是否可播放
鉴权/权益/配额错误：
最终判定：真实 Provider 成功 / 真实 Provider 失败 / 未执行
备注：
```

## 自动化 fixture 证据

自动化回归由以下测试覆盖，但这些结果只能标记为“fixture 通过”：

- `src/main/capabilities/generate-video.test.ts`：迁移前 xAI 同步行为回归；
- `src/main/capabilities/background-capability-jobs.test.ts`：xAI 与 MiniMax 的创建、查询、下载、输入快照、恢复、并发、route 冻结和安全 payload；
- `src/main/capabilities/capability-job-continuations.test.ts`：Conversation 完成事件、合并、恢复与去重；
- `src/main/capabilities/background-capability-job-retention.test.ts`：30 天边界、tombstone、活动 Job 豁免、Conversation 可解释性与 MP4 保留；
- `src/renderer/src/components/TaskPanel/TaskPanel.test.tsx`：加载/空状态、状态事件、route、首帧摘要、控制、Conversation 切换和 tombstone artifact。
