# Hermes-Agent：xAI Grok 与 OpenAI Codex OAuth 登录实现深度分析

> 调研仓库：`/Users/suntc/project/hermes-agent`（截止 2026-07-09）
> 目标范围：xAI Grok OAuth（`xai-oauth` / SuperGrok / Premium+）与 OpenAI Codex OAuth（`openai-codex`）的登录全链路。
> 范围之外：Google Gemini（仓库里**没有** Gemini OAuth，只支持 API Key）、Nous、Anthropic、Qwen、MiniMax 等其它 provider。
> 阅读对象：要在 Hermes 里扩展 OAuth provider 或排查登录问题的工程师。

---

## 0. TL;DR

- 两家走的是 **同一种架构**：Device Code 设备码授权 + 单文件 `~/.hermes/auth.json` singleton + 内存 `credential_pool` 双层凭据模型。
- **关键差异在协议层**：
  - xAI 是**标准 OAuth 2.0 Device Authorization Grant**（OIDC discovery + 标准 polling 拿 token）。
  - Codex 是 **OpenAI 私有的 4 步流程**（`/usercode` → 轮询 `/deviceauth/token` 拿 `authorization_code` + `code_verifier` → 用 code 换真 token），**不是**标准 grant。
- **共有的"陷阱带"**：单次使用的 refresh token、profile 旋转 hazard、`hermes auth remove` 必须配合 `suppress_credential_source`、`hermes auth add`（Codex 专属）走 `manual:device_code` 而不是 singleton。
- **Web 仪表盘和 CLI 走的是同一套核心 helper**（`hermes_cli/auth.py`），Desktop 通过 IPC 调用本地 `web_server`，**不**另起炉灶。

---

## 1. 共享基础设施

两家的登录都依赖同一套承重墙。理解这些再看每家细节会快很多。

### 1.1 auth.json 与并发保护

| 元素 | 位置 / 值 |
|---|---|
| 主文件 | `~/.hermes/auth.json`（由 `hermes_cli/auth.py::_auth_file_path()` 解析） |
| 进程锁 | `hermes_cli/auth.py::_auth_store_lock()`，走 `flock` + 超时封顶 `AUTH_LOCK_TIMEOUT_SECONDS` |
| Profile 隔离 | `HERMES_HOME` 指向 profile-scoped 子目录；profile 缺失 `xai-oauth` block 时，读写**透明回退到 global root**（`auth.py:1399-1454`） |

锁的关键意义：refresh 是**读-算-写**三步，**没有锁**会出现"两个进程同时刷新同一个 RT"——单次使用的 RT 立刻被打爆，一个进程拿到 `invalid_grant`。

### 1.2 Singleton + Pool 双层模型

| 层级 | 字段 | 写入方 | 读取方 |
|---|---|---|---|
| Singleton | `auth.json.providers.<id>.tokens` | `_save_*_tokens` | `_read_*_tokens`、`_xai_oauth_state_from_store` |
| Pool | `auth.json.credential_pool.<id>[].source` | `load_pool()` → `_seed_from_singletons()` | 运行时 `pool.select()`、`_read_*_access_token` |

**关键不变量**（`agent/credential_pool.py::_seed_from_singletons`）：

- 每次 `load_pool(provider)` **都会**用 singleton 的当前 token 重新 seed 出 `source="device_code"` 的池条目——目的是让 `hermes auth list` 反映 singleton 状态。
- 因此 **删除/移除凭据必须同时调 `suppress_credential_source(provider, "device_code")`**，否则下次 `load_pool` 会把刚删的 entry 复活。xAI 走 `agent/credential_sources.py::_remove_xai_oauth_device_code`，Codex 走 `_remove_codex_device_code`。

### 1.3 三种进入 OAuth 的入口

| 入口 | 触发 | 走的 helper |
|---|---|---|
| CLI 引导 | `hermes model` → 选 xAI / Codex | `hermes_cli/model_setup_flows.py::_model_flow_xai_oauth` / `_model_flow_openai_codex` |
| CLI 显式 | `hermes auth add <provider>` | `hermes_cli/auth_commands.py` 中每家独立分支 |
| Web 仪表盘 | Dashboard POST `/api/providers/oauth/<id>/start` | `hermes_cli/web_server.py::_start_device_code_flow` + 后台 thread poller（`_xai_device_poller`、`_codex_full_login_worker`） |
| Desktop | `startManualProviderOAuth(slug)` → IPC `startOAuthLogin` | 最终仍打本地 `web_server` 的 `/api/providers/oauth/.../start`（**不**另起一套） |

`web_server` 启动时，**Codex / xAI / Nous / MiniMax 共享同一会话池**（`_oauth_sessions`，`web_server.py:8666`），所有 device-code 流程的"开始 → 后台 thread 轮询 → 写 singleton"完全同构。Codex 之所以在 worker 里内联实现而不调用 `_codex_device_code_login`，是因为 dashboard 需要**立即**把 `user_code` 推给前端再开始轮询，而 CLI 是单函数 print-and-block。

### 1.4 Catalog 一致性

`hermes_cli/web_server.py::_OAUTH_PROVIDER_CATALOG`（8017‑8093）手工列出 dashboard 卡片，截取相关条目：

```python
{
    "id": "openai-codex",
    "name": "OpenAI OAuth (ChatGPT)",
    "flow": "device_code",
    "cli_command": "hermes auth add openai-codex",
    "status_fn": None,  # dispatched via auth.get_codex_auth_status
},
{
    "id": "xai-oauth",
    "name": "xAI Grok OAuth (SuperGrok / Premium+)",
    "flow": "device_code",
    "cli_command": "hermes auth add xai-oauth",
    "status_fn": None,  # dispatched via auth.get_xai_oauth_auth_status
},
```

`start_oauth_login`（`web_server.py:9257-9292`）根据 `catalog_entry["flow"]` 派发：

```python
if catalog_entry["flow"] == "device_code":
    return await _start_device_code_flow(provider_id, profile=profile)
```

---

## 2. xAI Grok OAuth（`xai-oauth` / SuperGrok / Premium+）

### 2.1 常量（`hermes_cli/auth.py:110-120`）

```python
XAI_OAUTH_ISSUER                       = "https://auth.x.ai"
XAI_OAUTH_DISCOVERY_URL                = f"{XAI_OAUTH_ISSUER}/.well-known/openid-configuration"
XAI_OAUTH_CLIENT_ID                    = "b1a00492-073a-47ea-816f-4c329264a828"
XAI_OAUTH_SCOPE                        = "openid profile email offline_access grok-cli:access api:access"
XAI_OAUTH_DEVICE_CODE_URL              = f"{XAI_OAUTH_ISSUER}/oauth2/device/code"
XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS  = 3600   # 注意是 1 小时，不是 2 分钟
DEFAULT_XAI_OAUTH_BASE_URL             = "https://api.x.ai/v1"
```

xAI 暴露了 **OIDC discovery**（`/.well-known/openid-configuration`），所以 Hermes 不硬编码 `token_endpoint`——每次 login 拉一次；**refresh 热路径也会**再校验一次（`auth.py:4247-4253` 注释明确说明这是抗 stale 端点的纵深防御）。

### 2.2 设备码三步（`hermes_cli/auth.py:7016-7198`）

#### Step 1：申请 device code（`_xai_oauth_request_device_code`）

```python
response = client.post(
    XAI_OAUTH_DEVICE_CODE_URL,
    headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    data={"client_id": XAI_OAUTH_CLIENT_ID, "scope": scope},
)
# 必须返回 6 个字段: device_code / user_code / verification_uri /
#                    verification_uri_complete / expires_in / interval
# 缺任一字段 → AuthError(code="device_code_invalid")
```

#### Step 2：打印 + 尝试开浏览器（`_xai_oauth_device_code_login:7149-7162`）

```python
print("To continue:")
print(f"  1. Open: {verification_url}")
print(f"  2. If prompted, enter code: {user_code}")
if open_browser and not _is_remote_session() and _can_open_graphical_browser():
    try: opened = webbrowser.open(verification_url)
    ...
```

URL 优先 `verification_uri_complete`（带 user_code 的深链）。`_is_remote_session()` 检测 SSH / `TMUX` / `DISPLAY` 缺失等情况，**自动关掉**浏览器；`_can_open_graphical_browser()` 进一步收紧。

#### Step 3：标准 OAuth 2.0 polling（`_xai_oauth_poll_device_token:7058-7128`）

```python
response = client.post(
    token_endpoint,
    headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    data={
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "client_id": XAI_OAUTH_CLIENT_ID,
        "device_code": device_code,
    },
)
# 200 → 拿 access_token + refresh_token + id_token
# error="authorization_pending" → 睡 interval 继续
# error="slow_down"             → interval + 1（封顶 30s）后继续
# 其他 error                    → AuthError(xai_device_token_failed)
```

**xAI 用的是教科书式的标准 OAuth 2.0 Device Authorization Grant**——这是它和 Codex 的根本区别。

### 2.3 Token 落地（`hermes_cli/auth.py:4003-4031`）

```python
def _save_xai_oauth_tokens(tokens, *, discovery=None, redirect_uri="",
                            last_refresh=None, auth_mode="oauth_device_code"):
    with _auth_store_lock():
        auth_store = _load_auth_store()
        write_through_to_root = not _profile_has_own_xai_oauth_state(auth_store)  # profile → root
        state = _load_provider_state(auth_store, "xai-oauth") or {}
        state["tokens"] = tokens
        state["last_refresh"] = last_refresh
        state["auth_mode"] = auth_mode
        if discovery:  state["discovery"]  = discovery
        if redirect_uri: state["redirect_uri"] = redirect_uri
        _save_provider_state(auth_store, "xai-oauth", state)
        _save_auth_store(auth_store)
        if write_through_to_root:
            _write_through_xai_oauth_to_global_root(state)   # 多 profile 旋转 hazard (#43589)
```

`auth.json` 里的形态：

```json
{
  "providers": {
    "xai-oauth": {
      "tokens": {
        "access_token":  "<JWT>",
        "refresh_token": "<single-use opaque>",
        "id_token":      "<OIDC id_token>",
        "expires_in":    3600,
        "token_type":    "Bearer"
      },
      "last_refresh":  "2026-07-09T08:11:00Z",
      "auth_mode":     "oauth_device_code",
      "discovery": {
        "authorization_endpoint": "https://auth.x.ai/oauth2/authorize",
        "token_endpoint":         "https://auth.x.ai/oauth2/token"
      },
      "redirect_uri": ""
    }
  }
}
```

**关键设计**：

- **不带 `account_id`**——xAI 的 OAuth 没有这个概念（不像 ChatGPT 那个 `ChatGPT-Account-Id` 头）。
- **profile → root 写穿**（`_write_through_xai_oauth_to_global_root`，`auth.py:3958-4000`）是修 #43589 的关键。xAI 每次 refresh 都换新 `refresh_token`（**单次使用**），profile A 刷一次后 root 里旧的 RT 就废了；这条写穿保证 root 永远拿到最新链。函数**吞所有错误**（best-effort），不阻断 profile save——写穿失败时降级到原行为（root stale），至少不影响本 profile。

### 2.4 刷新的"主动 + 防呆"（`auth.py:4370-4462`）

`resolve_xai_oauth_runtime_credentials`：

1. 读 singleton（**singleton → global fallback** 两层读）
2. 算**主动刷新窗口**（`_xai_proactive_refresh_skew_seconds`，`auth.py:4052-4083`）——根据当前 AT 的 JWT `exp` **动态调整**：

   ```python
   max_skew = XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS  # 3600
   # 解 JWT 取 exp；如果 AT 寿命 < max_skew + skew，就用更短的窗口
   # 避免每次 resolve 都 refresh → 烧单次 RT
   ```

3. **取锁 → 二次检查 → refresh**（双重检查 + flock 防止两个进程同时刷同一个 RT）
4. `refresh_xai_oauth_pure` 失败 → `_is_terminal_xai_oauth_refresh_error`（`auth.py:4858-4872`）→ **隔离**：清空 `tokens` 字段、写入 `last_auth_error`、下次会话直接失败不再 retry

`_is_terminal_xai_oauth_refresh_error`：

```python
return (
    isinstance(exc, AuthError)
    and exc.provider == "xai-oauth"
    and exc.code in {"xai_refresh_failed", "xai_auth_missing_refresh_token"}
    and bool(exc.relogin_required)
)
```

### 2.5 客户端构造（运行时 + 辅助客户端）

**主运行时**（`hermes_cli/runtime_provider.py:1791-1795`）：

```python
"api_mode":  "codex_responses",
"base_url":  (creds.get("base_url") or "").rstrip("/") or DEFAULT_XAI_OAUTH_BASE_URL,
"api_key":   creds.get("api_key", ""),   # = access_token
"source":    creds.get("source", "hermes-auth-store"),
"last_refresh": creds.get("last_refresh"),
```

→ `api.x.ai/v1` 走 **Responses API 路径**（grok 模型族只吃这个）。

**辅助客户端**（`agent/auxiliary_client.py:1706-1758` `_resolve_xai_oauth_for_aux`）：

```python
# 1. pool 优先（匹配主运行时的 status 路径）
pool = load_pool("xai-oauth")
if pool.has_credentials():
    entry = pool.select()
    if entry is not None:
        api_key = entry.runtime_api_key or entry.access_token
        base_url = _xai_validate_inference_base_url(env_ovr, fallback=DEFAULT_XAI_OAUTH_BASE_URL)
        if api_key and base_url: return api_key, base_url
# 2. 落 singleton runtime resolver
creds = resolve_xai_oauth_runtime_credentials()
```

`_build_xai_oauth_aux_client`（`auxiliary_client.py:2408-2450`）用 `CodexAuxiliaryClient` 包装 `OpenAI` 客户端，因为 `api.x.ai/v1/responses` 协议就是 OpenAI Responses。**调用方必须显式传 model**——`grok-composer-2.5-fast` 这种 slug 会被 xAI 拒接，pin 默认值会"silent rot"。

**`_xai_validate_inference_base_url` 守卫**（`auth.py:4127-4180`）：

```python
# 强约束: host 必须是 x.ai 或 *.x.ai，且必须是 https
if host != "x.ai" and not host.endswith(".x.ai"):
    logger.warning("Refusing xAI base_url override ...")
    return fallback
# 拒绝 → 用 fallback 并 log warning（不抛异常，防死锁）
```

这是防"被恶意 .env 把 `XAI_BASE_URL=https://attacker.example` 让 bearer 泄露给第三方"的关键守卫。

### 2.6 401 → 刷新 → 重试

`agent/conversation_loop.py:2709-2719`：

```python
if (
    agent.api_mode == "codex_responses"
    and agent.provider in {"openai-codex", "xai-oauth"}
    and status_code == 401
    and not _retry.codex_auth_retry_attempted
):
    _retry.codex_auth_retry_attempted = True
    if agent._try_refresh_codex_client_credentials(force=True):
        _label = "xAI OAuth" if agent.provider == "xai-oauth" else "Codex"
        agent._buffer_vprint(f"🔐 {_label} auth refreshed after 401. Retrying request...")
        continue
```

**xAI 和 Codex 共享同一条 refresh-on-401 路径**——`codex_responses` 适配器一鱼两吃。注意 `_retry.codex_auth_retry_attempted` 是一次性 flag：**每个失败回合只刷一次**，不进入"refresh → 再失败 → 再 refresh"的死循环。

### 2.7 注销 / 移除（`agent/credential_sources.py:267-285`）

`_remove_xai_oauth_device_code`：

1. 清空 `providers.xai-oauth`（不只是 `tokens`，**整个 block**）
2. 让 `auth_remove_command` 自动调 `suppress_credential_source("xai-oauth", "device_code")`
3. 提示用户用 `hermes model` 重新走 device-code

**关键注释**（`auth.py:6999-7007`）：`_login_xai_oauth` 显式交互重登时**必须** `unsuppress_credential_source("xai-oauth", "device_code")`——否则 `remove → re-login` 后 `hermes auth list` 还是空的（singleton 重建但 pool 看不到）。这步**故意不**放在 `_save_xai_oauth_tokens` 里，因为那个 helper 也被 refresh 热路径调用——**refresh 路径永远不能动 suppression 状态**。

### 2.8 xAI 陷阱点

1. **403 = tier denied，不是 refresh_token 失效**（`refresh_xai_oauth_pure` 4267‑4288）。xAI 在某些 tier 上虽然 OAuth 登录成功但拒绝 API access，必须报 `code="xai_oauth_tier_denied"`、`relogin_required=False`，引导用户改用 `XAI_API_KEY` 走 `provider="xai"` 路径。
2. **`XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 3600` + `_xai_proactive_refresh_skew_seconds` 双层**：device-code 流的 AT 经常只有 ~15 分钟（不是 SuperGrok 那种 6h），硬套 1h 主动窗口会导致"每次 resolve 都 refresh"→ **单次 RT 被打爆** → 并发 race 出 `invalid_grant`。
3. **profile 旋转 hazard**：profile 没自己的 xai-oauth block 时，刷新必须回写 root。`_write_through_xai_oauth_to_global_root` 吞所有错误（best-effort），不阻断 profile save。
4. **OIDC discovery 端点也要校验**（`_xai_validate_oauth_endpoint`）——防"老 Hermes 写入的 auth.json 里的 token_endpoint 被攻击者替换"。这条防线在 refresh 热路径上每次都跑（`auth.py:4253`）。
5. **`_login_xai_oauth` 必须 `unsuppress_credential_source`**；`refresh_xai_oauth_pure` / `_save_xai_oauth_tokens` **永远不能** 改 suppression 状态。

---

## 3. OpenAI Codex OAuth（`openai-codex`）

### 3.1 与 xAI 的根本差异

Codex 的登录流程是 **OpenAI 自定义的两步式 device-code**——**不**是标准 OAuth 2.0 device-code grant（标准 grant 一次轮询拿 token，Codex 多了个 `device_auth_id` + `authorization_code + code_verifier` 的 PKCE-like 中间步）。这是 OpenAI 私有协议，注释里写明：

```python
# auth.py:7208-7211
# Step 1: Request device code. OpenAI's auth endpoint rate-limits this
# request (HTTP 429) when login is attempted too often from the same
# IP/account — retry with capped backoff (honoring ``Retry-After``)
# before surfacing a clear, actionable message instead of a bare status.
```

### 3.2 常量（`hermes_cli/auth.py:102-108`）

```python
CODEX_OAUTH_CLIENT_ID  = "app_EMoamEEZ73f0CkXaXp7hrann"
CODEX_OAUTH_TOKEN_URL  = "https://auth.openai.com/oauth/token"
CODEX_OAUTH_USER_AGENT = "hermes-cli/<version>"           # 关键: 不是默认 UA
CODEX_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 120             # 比 xAI 紧得多
DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
```

### 3.3 设备码四步（`hermes_cli/auth.py:7201-7397`）

完整流程——**和 xAI 完全不一样**，**不能**复用 xAI 的 polling 代码：

```
1. POST https://auth.openai.com/api/accounts/deviceauth/usercode
   body (JSON): {"client_id": "app_EMoamEEZ73f0CkXaXp7hrann"}
        → {"user_code": "ABCD-1234", "device_auth_id": "...", "interval": 5}

2. 打印
   "Open this URL in your browser: https://auth.openai.com/codex/device"
   "Enter this code: ABCD-1234"

3. POST https://auth.openai.com/api/accounts/deviceauth/token
   body (JSON): {"device_auth_id": "...", "user_code": "..."}
        轮询直到 200 → {"authorization_code": "...", "code_verifier": "..."}
        403/404 → 继续轮询（用户还没授权）
        其他    → AuthError(device_code_poll_error)

4. POST https://auth.openai.com/oauth/token
   form: grant_type=authorization_code
         code=<authorization_code>
         redirect_uri=https://auth.openai.com/deviceauth/callback
         client_id=...
         code_verifier=<code_verifier>
        → {"access_token": "...", "refresh_token": "..."}
```

**为什么这么绕**？第 3 步返回的是 **`authorization_code`**（不是 token），再用这个 code + server-side `code_verifier` 换真 token。Codex 的 polling 不是标准 grant，是 **OpenAI 私货**。

### 3.4 限流处理（`auth.py:7213-7257`）

`/usercode` 端点被 OpenAI 严格 429 限流（同一 IP/账户短时间内反复 login）。Hermes 实现：

- **最多 4 次重试**，指数退避（2/4/8s），但**优先 server 给的 `Retry-After`**
- 退避封顶 60s
- 4 次仍 429 → `AuthError(code=CODEX_RATE_LIMITED_CODE, relogin_required=False)`——**特意不**让用户重 login（重 login 也救不了，是 OpenAI 端配额）

`_xai_oauth_request_device_code` 失败时是直接 `AuthError(device_code_request_failed)`，**没有** 4 次重试——**xAI 端不限流**。

### 3.5 Token 落地的两条路径

Codex **有两条落地路径**，取决于怎么 login：

#### 路径 A：`hermes model` → `_login_openai_codex`（`auth.py:6874-6945`）

```python
creds = _codex_device_code_login()
_save_codex_tokens(creds["tokens"], creds.get("last_refresh"))   # 写 singleton
```

`_save_codex_tokens`（`auth.py:3361-3386`）：

- 在 `_auth_store_lock` 下写 `providers.openai-codex.tokens`，`auth_mode="chatgpt"`
- 同步调 `_sync_codex_pool_entries` 把 singleton 同步成 pool 里 `source="device_code"` 的 entry
- **捕获 `previous_singleton_tokens`**：用于区分"原本就是这个 singleton 派生出来的 pool 旧 entry"vs"用户 `hermes auth add` 出来的独立账户"——独立账户的 tokens **不能**被 singleton 刷新覆盖（#39236）

#### 路径 B：`hermes auth add openai-codex`（`auth_commands.py:310-345`）

```python
entry = PooledCredential(
    provider="openai-codex",
    id=uuid.uuid4().hex[:6],
    label=label,
    auth_type=AUTH_TYPE_OAUTH,
    priority=0,
    source=SOURCE_MANUAL_DEVICE_CODE,         # "manual:device_code"
    access_token=creds["tokens"]["access_token"],
    refresh_token=creds["tokens"].get("refresh_token"),
    base_url=creds.get("base_url"),
    last_refresh=creds.get("last_refresh"),
)
pool.add_entry(entry)   # 独立的 pool 条目，不走 singleton!
if first_credential:
    auth_mod.mark_provider_active_if_unset(provider)
```

**这是 #39236 的关键修复**：以前 `hermes auth add openai-codex` 走 singleton 路径，**第二个加的账号会覆盖第一个**。现在每个 `auth add` 都是独立 `manual:device_code` pool entry，**自己刷自己的 RT**，不需要 singleton 影子。

**xAI 不需要这条**——它只有 `hermes model` 路径，singleton 唯一。

### 3.6 Codex CLI（`~/.codex/auth.json`）的"半双向"关系

`agent/credential_sources.py:288-295` 的注释说"refresh_codex_oauth_pure() writes both every time"，但 **`_codex_device_code_login`（返回 `"source": "device-code"`，`auth.py:7382-7396`）只返回 tokens**，**不再**写 `~/.codex/auth.json`（注释明确"no longer writes to `~/.codex/`"）。这条注释属于"文档漂移"。

实际现状：

| 方向 | 行为 | 代码 |
|---|---|---|
| Hermes → `~/.codex/auth.json` | **不写**（CLI 自己用） | `auth.py:7382` 注释 |
| `~/.codex/auth.json` → Hermes | **可读**（login 时询问是否 import） | `_import_codex_cli_tokens` `auth.py:3583-3614` |
| Hermes refresh 失败 → 从 CLI 文件自愈 | **会**（防止 cross-client RT 竞争） | `_recover_codex_tokens_from_cli` `auth.py:3389-3402` |
| Hermes refresh 成功 → 回写 `~/.codex/auth.json` | **不**（单向 keep-out） | 设计选择 |

**为什么删掉"双向写"**？因为如果 Hermes 和 Codex CLI 各自持有一份 token，**每次 refresh 都会把对方的 RT 消耗掉**——OpenAI refresh_token 也是单次使用，**两份独立持有可能在 race 下双 401**。`auth.py:3554-3573` 注释详细解释了这个"self-heal from CLI file"机制：refresh 失败 → 从 CLI 文件 import 一次（拿到最新链），而不是回写。

`_import_codex_cli_tokens` 还会做 **expiry check**：

```python
if _codex_access_token_is_expiring(access_token, 0):
    logger.debug("Codex CLI tokens at %s are expired — skipping import.", auth_path)
    return None
```

——避免把过期的 CLI token import 进 Hermes 后变成"Login successful! 但实际不能跑"。

### 3.7 `ChatGPT-Account-Id` 头（`agent/account_usage.py:428-510`）

Codex 在 `/wham/usage`（quota 接口）请求时**必须**带 `ChatGPT-Account-Id` 头（如果账号支持 multi-workspace）。来源：

- `_read_codex_tokens()` 读 `providers.openai-codex.tokens.account_id` 字段
- **pool-only 的 entry 没有 `account_id` 概念**（`account_usage.py:485-488`）——这条头在 pool 路径下**故意不**带

xAI 没有这个概念——`xai-oauth` tokens 结构里**永远不**有 `account_id`。

### 3.8 refresh + 401 重试

`refresh_codex_oauth_pure`（`auth.py:3405-3536`）的 `relogin_required` 判断比 xAI 复杂：

```python
# 1. 429 → 区分 quota exhausted (relogin_required=False) vs 真正的失败
if response.status_code == 429:
    raise AuthError(..., code=CODEX_RATE_LIMITED_CODE, relogin_required=False)

# 2. 解析两种错误 shape
#    OpenAI 私有:  {"error": {"code": "...", "message": "...", "type": "..."}}
#    OAuth spec:   {"error": "code_str", "error_description": "..."}

# 3. refresh_token_reused 是专属 code → 提示用户在 Codex CLI 跑一次
if code == "refresh_token_reused":
    message = ("Codex refresh token was already consumed by another client "
               "(e.g. Codex CLI or VS Code extension). ...")
    relogin_required = True

# 4. 401/403 + 上面没 catch 住 → 强制 relogin
if response.status_code in {401, 403} and not relogin_required:
    relogin_required = True
```

`_is_terminal_codex_oauth_refresh_error`（`auth.py:4875-4895`）覆盖：

```python
exc.code in {
    "codex_refresh_failed",
    "codex_auth_missing_refresh_token",
    "invalid_grant",
    "invalid_token",
    "refresh_token_reused",
}
```

401 重试路径**与 xAI 共享**（`conversation_loop.py:2709-2719`）。

### 3.9 Codex 陷阱点

1. **协议非标准**：不是 OAuth 2.0 device-code grant。复用 xAI 的 polling 代码会爆。
2. **`/usercode` 限流**（429）→ 最多 4 次重试，但**不要**让用户重 login（`relogin_required=False`）。
3. **`refresh_token_reused` 是专属 code**——意味着别的客户端（Codex CLI、VS Code 扩展）抢在你之前刷了 RT。提示用户**先在 Codex CLI 跑一次** `codex` 让它产生新 token，**再** `hermes auth`。
4. **Context window cap**：Codex 路径在 chatgpt.com/backend-api/codex 上是 **272K**（`agent/auxiliary_client.py:319-322`），不是 OpenAI 直连 1M+。`gpt-5.3-codex-spark` 是 **128K**（Codex-OAuth-only 限制）。
5. **stream watchdog**：`chat_completion_helpers.py:387-393` 对 `codex_responses` 强制提 `openai_codex_stale_timeout_floor`（按估算 token 数分级），因为 chatgpt 后端间歇性"接受连接但不 emit 任何 SSE 事件"。
6. **`hermes auth add` 不再走 singleton**（#39236 修复）——多账号场景下每个 entry 是独立的 `manual:device_code`，singleton 只供 `hermes model` 单账号路径用。
7. **`gpt-5.4` / `gpt-5.5` 触发 auto-raise** compaction 阈值到 75%（`auxiliary_client.py:402-433`），`gpt-5.3-codex-spark` 70%——这些都是 Codex-OAuth-only 现象。
8. **`refresh_codex_oauth_pure` 注释漂移**：`credential_sources.py:288-295` 仍说"writes both every time"，但**实际上不**再写 `~/.codex/auth.json`。新写逻辑时应忽略旧注释、参考 `_codex_device_code_login` 的实际行为。

---

## 4. 对比与决策树

```
用户说"我想用 Grok/Codex"
  │
  ├─ provider = "xai-oauth"
  │    → 走 device-code singleton + pool
  │    → 标准 OAuth 2.0 Device Authorization Grant
  │    → singleton 写 providers.xai-oauth (含 discovery + tokens)
  │    → pool 通过 _seed_from_singletons 物化 device_code 条目
  │    → refresh_xai_oauth_pure 处理单次 RT 旋转 + 403 tier 检测
  │    → 401 → _try_refresh_codex_client_credentials (共享路径)
  │    → 注销 → 清 singleton + suppress "device_code"
  │
  └─ provider = "openai-codex"
       → 走 device-code singleton + pool
       → OpenAI 私有 4 步协议 (/usercode → /token → /oauth/token)
       → /usercode 4 次重试
       → singleton 写 providers.openai-codex (含 account_id)
       → pool: 单一账号走 device_code / 多账号走 manual:device_code
       → refresh_codex_oauth_pure 处理单次 RT + refresh_token_reused
       → CLI 共享 ~/.codex/auth.json (单向 read-only + 失败自愈)
       → /wham/usage 需要 ChatGPT-Account-Id
       → 272K context cap; gpt-5.3-codex-spark 128K
```

| 维度 | xAI Grok | OpenAI Codex |
|---|---|---|
| 协议 | 标准 OIDC + device-code grant | OpenAI 私货 4 步流程 |
| discovery | ✅ 每次 login / refresh 拉 | ❌ 端点硬编码 |
| AT 寿命 | ~15min（device-code）~6h（SuperGrok） | ~数小时 |
| RT 旋转 | 每次 refresh 换新 | 每次 refresh 换新 |
| 多账户 | singleton 唯一 | singleton（`hermes model`）**或** 独立 `manual:device_code`（`hermes auth add`） |
| 外部 Client 关系 | 无 | 共享 `~/.codex/auth.json`（只读 import、refresh 失败可自愈） |
| 推理 endpoint | `api.x.ai/v1`（host 强约束 `*.x.ai`） | `chatgpt.com/backend-api/codex` |
| Account-Id 头 | 无 | `ChatGPT-Account-Id`（仅 singleton 路径） |
| 限流 | `/usercode` 不限流 | `/usercode` 严格 429 限流 |
| 403 含义 | tier denied（不重 login） | refresh 失败（重 login） |
| 注销 → suppress | 是 | 是（且不动 `~/.codex/`） |

---

## 5. 关键陷阱速查

### xAI (`xai-oauth`)

1. **403 = tier denied**，不是 RT 失效。`relogin_required=False`，引导用户改 `XAI_API_KEY`。
2. **Profile 旋转 hazard**：profile 没自己的 block 时刷新必须回写 root（`_write_through_xai_oauth_to_global_root`，best-effort）。
3. **`XAI_BASE_URL` 强校验 host = `x.ai` 或 `*.x.ai`**——防 .env 篡改泄露 bearer。
4. **设备码 AT 的 JWT `exp` 极短**（~15min），主动刷新窗口必须**自适应**（`_xai_proactive_refresh_skew_seconds`），不能用 3600s 固定值。
5. **`_login_xai_oauth` 必须 `unsuppress_credential_source`**，refresh 热路径（`refresh_xai_oauth_pure` / `_save_xai_oauth_tokens`）**绝不能**改 suppression。

### Codex (`openai-codex`)

1. **协议非标准 OAuth device-code grant**——不能照搬 xAI polling 代码。必须 4 步：`/usercode` → 打印 → `/token` 轮询 → `/oauth/token` 交换。
2. **`/usercode` 429 限流**：4 次重试，**不要**让用户重 login（`relogin_required=False`）。
3. **`refresh_token_reused` 是专属 code**——意味着 Codex CLI / VS Code 抢了 RT。提示用户**先在 Codex CLI 跑一次** `codex` 让它产生新 token，**再** `hermes auth`。
4. **多账号**：必须用 `hermes auth add openai-codex`（`source="manual:device_code"`），**不能**指望 singleton 隔离。
5. **Context cap**：Codex OAuth 272K、`gpt-5.3-codex-spark` 128K（OpenAI 直连是 1M+）。
6. **`/wham/usage` 必须带 `ChatGPT-Account-Id`**——只有 singleton 路径能拿到 account_id，pool 路径**故意不**带。
7. **`credential_sources.py:288-295` 注释漂移**——`refresh_codex_oauth_pure` 已**不**再写 `~/.codex/auth.json`。

---

## 6. 关键文件索引

| 主题 | 路径 | 行号 |
|---|---|---|
| **xAI 常量** | `hermes_cli/auth.py` | 110-120 |
| **xAI 设备码 3 步** | `hermes_cli/auth.py` | 7016-7198 |
| **xAI token 落地 + 多 profile 写穿** | `hermes_cli/auth.py` | 3958-4031, 4127-4180 |
| **xAI 刷新 + 隔离** | `hermes_cli/auth.py` | 4232-4462, 4858-4872 |
| **xAI 客户端构造** | `agent/auxiliary_client.py` | 1706-1758, 2408-2450 |
| **xAI 注销** | `agent/credential_sources.py` | 267-285 |
| **xAI web dashboard 后台 poller** | `hermes_cli/web_server.py` | 8839-8873, 9026-9088 |
| **Codex 常量** | `hermes_cli/auth.py` | 102-108 |
| **Codex 设备码 4 步** | `hermes_cli/auth.py` | 7201-7397 |
| **Codex 限流重试** | `hermes_cli/auth.py` | 7213-7257 |
| **Codex singleton 写** | `hermes_cli/auth.py` | 3361-3386 |
| **Codex pool 写（多账号）** | `hermes_cli/auth_commands.py` | 310-345 |
| **Codex CLI 双向关系（self-heal）** | `hermes_cli/auth.py` | 3389-3614, 3554-3573 |
| **Codex `ChatGPT-Account-Id`** | `agent/account_usage.py` | 428-510 |
| **Codex refresh 错误分类** | `hermes_cli/auth.py` | 3405-3536, 4875-4895 |
| **Codex 注销** | `agent/credential_sources.py` | 287-320 |
| **Codex web dashboard worker** | `hermes_cli/web_server.py` | 9138-9254 |
| **401 → refresh 共享路径** | `agent/conversation_loop.py` | 2709-2719, 3775-3794 |
| **Singleton seed → pool** | `agent/credential_pool.py` | 2028-2093 |
| **suppress / unsuppress** | `hermes_cli/auth.py` | 1399-1454 |
| **Web catalog（xAI + Codex）** | `hermes_cli/web_server.py` | 8017-8093 |
| **Web 启动入口** | `hermes_cli/web_server.py` | 9257-9292 |
| **CLI 引导** | `hermes_cli/model_setup_flows.py` | 509-595 (Codex), 597-678 (xAI) |
| **Desktop 走 web 的 IPC** | `apps/desktop/src/app/hermes.ts` | 477-487 |
| **Desktop onboarding 状态机** | `apps/desktop/src/store/onboarding.ts` | 1-83, 430-490 |

---

## 7. 一句话总结

- **xAI Grok OAuth**：标准 OIDC + device-code grant，singleton 写 `providers.xai-oauth`，profile 旋转写穿 root，host 必须 `*.x.ai`，主动刷新窗口自适应 JWT `exp`，403 视为 tier denied 不重 login。
- **OpenAI Codex OAuth**：OpenAI 私有 4 步 device-code 协议（`/usercode` → `/deviceauth/token` → `/oauth/token`），多账号通过 `manual:device_code` pool entry 隔离，**单向 read-only** 共享 `~/.codex/auth.json`，quota 接口需 `ChatGPT-Account-Id` 头，refresh_token_reused 是专属错误码。
