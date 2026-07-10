# Hermes-Agent：xAI Grok 与 OpenAI Codex — 登录后使用 & 订阅权益

> 调研仓库：`/Users/suntc/project/hermes-agent`（截止 2026-07-09）
> 配套前篇：`oauth-grok-codex.md`（登录本身：device-code、singleton、pool、refresh、注销）。本篇专注**登录成功后**。
> 目标范围：xAI Grok OAuth（`xai-oauth`）与 OpenAI Codex OAuth（`openai-codex`）的**模型选择、订阅 tier 探测、quota 用量、entitlement 错误分类、特殊模型 slug、限流**。
> 阅读对象：要理解"为什么这个 401/403 不能靠重 login 解决"的工程师；要在 Hermes 里扩展模型选择或加新 provider 的工程师。

---

## 0. TL;DR

- **xAI Grok**：模型清单走 `models.dev`（provider key `xai`）+ `model_metadata.py` 硬编码 context window fallback。**没有**官方 subscription tier 探测——xAI 公开 OAuth 端点**不**返回 tier/plan 字段。**403 几乎一定** = tier denied（SuperGrok / Premium+ 不够格），**不要**触发 re-login。
- **OpenAI Codex**：模型清单**三路并用**——`codex_models.DEFAULT_CODEX_MODELS` 硬编码 fallback + `chatgpt.com/backend-api/codex/models` 实时拉 + `_add_forward_compat_models` 合成新 slug。**有**官方 quota 接口 `/wham/usage`，返回 `plan_type` + `primary_window`（5h）+ `secondary_window`（weekly）。**429** = 配额 cooldown，**401** = 重新走 device-code，**不要**混淆。
- 两家都靠 `error_classifier` + `agent_runtime_helpers` 的 `FailoverReason` 把"subscription 拒"与"token 失效"分开。xAI 的 #29344 是个非常隐蔽的坑：同一条 body 文本可能是 stale token 或 unsubscribed——只有 `[WKE=unauthenticated:...]` 后缀和 `OAuth2 access token could not be validated` 措辞是 stale token 的**权威**信号。
- 配额 cooldown 写到 `PooledCredential.last_error_reset_at`，但**单账号** pool 永远不要靠它（#48415 旋转 hazard 的姐妹问题——`hermes model` 重新登录时必须同步清空）。

---

## 1. 模型清单与选择

### 1.1 共享入口：`models.dev` + `model_metadata.py` 双轨

`agent/models_dev.py:142-180` 是所有 provider 模型元数据的**唯一权威**来源（cache `~/.hermes/models_dev_cache.json`）：

```python
PROVIDER_TO_MODELS_DEV: Dict[str, str] = {
    "xai":       "xai",          # API key 路径
    # xAI OAuth is an authentication/transport path for the same xAI model
    # catalog, so model metadata should resolve through the xAI provider.
    "xai-oauth": "xai",          # OAuth 路径 → 同一个 catalog
    ...
    "openai-codex": ???           # 注释: 不在 models.dev (它不是 models.dev 收录的 provider)
}
```

**关键观察**：
- **`xai-oauth` 复用 `xai` 的 catalog**（注释明确："model metadata should resolve through the xAI provider"）。OAuth 只是鉴权/传输层差异，模型清单共用。
- **`openai-codex` 不在 `PROVIDER_TO_MODELS_DEV`**——Codex 模型是 ChatGPT 私有后端（`chatgpt.com/backend-api/codex`），不是 models.dev 收录的公开 OpenAI 端点。Codex 的 catalog 来源是另一套（见 §1.3）。

`agent/model_metadata.py:285-312` 是**静态 fallback**——当 models.dev 拿不到或 cache miss 时用：

```python
# xAI Grok — xAI /v1/models does not return context_length metadata,
# so these hardcoded fallbacks prevent Hermes from probing-down to
# the default 128k when the user points at https://api.x.ai/v1
# via a custom provider. Values sourced from models.dev (2026-04).
"grok-composer":     200000,    # grok-composer-2.5-fast (Grok Build CLI)
"grok-build-latest": 500000,    # alias of grok-4.5 (early access)
"grok-build":        256000,    # grok-build-0.1
"grok-code-fast":    256000,    # grok-code-fast-1
"grok-2-vision":     8192,
"grok-4-fast":       2000000,   # grok-4-fast-(non-)reasoning
"grok-4.20":         2000000,   # grok-4.20-0309-(non-)reasoning, -multi-agent-0309
"grok-4.5":          500000,    # grok-4.5, grok-4.5-latest — 500K context per docs.x.ai
"grok-4.3":          1000000,   # grok-4.3, grok-4.3-latest — 1M context
"grok-4":            256000,
"grok-3":            131072,
"grok-2":            131072,
"grok":              131072,    # catch-all (grok-beta, unknown grok-*)
```

**关键注释**（`model_metadata.py:296-299`）：

> "OAuth-only slug; absent from GET /v1/models. xAI publishes a 200k usable context window for Composer 2.5 on Grok Build (SuperGrok / Premium+); /v1/responses additionally enforces a ~262144 input+output budget, but the usable context (what we track here) is 200k."

`grok-composer-2.5-fast` 是**SuperGrok 专属**、**仅在 OAuth 后端**可见，公开 `https://api.x.ai/v1/models` 拉不到。

#### 1.1.1 关键实现细节（import 时跑，不走网络）

`hermes_cli/models.py:152-176` 的 `_xai_curated_models()` 是 xAI（以及 `xai-oauth`）模型 catalog 的**实际**生产者：

```python
def _xai_curated_models() -> list[str]:
    """Derive the xAI-direct curated list from models.dev disk cache.

    Reads $HERMES_HOME/models_dev_cache.json directly (no network) so this
    runs at import time without blocking. Falls back to ``_XAI_STATIC_FALLBACK``
    when the cache is empty or unreadable.
    """
    try:
        from agent.models_dev import _load_disk_cache
        data = _load_disk_cache()
        xai = data.get("xai") if isinstance(data, dict) else None
        models = xai.get("models") if isinstance(xai, dict) else None
        if isinstance(models, dict) and models:
            ids = [mid for mid in models.keys() if isinstance(mid, str)]
            if ids:
                return _xai_merge_curated_extras(_xai_promote_top(sorted(ids)))
    except Exception:
        pass
    return _xai_merge_curated_extras(list(_XAI_STATIC_FALLBACK))
```

`_PROVIDER_MODELS`（`hermes_cli/models.py:179-537`）里 `xai`（第 286 行）和 `xai-oauth`（第 248 行）**都**调 `_xai_curated_models()` —— 一份代码服务两条 provider 路径，与 §1.1 的"`xai-oauth` 复用 `xai` 的 catalog"结论**完全自洽**。

**注意**：xai **不**在 `_MODELS_DEV_PREFERRED`（`hermes_cli/models.py:2209+`）里——意味着 `/model` 选 model 时**不会**触发 `_merge_with_models_dev` 在线合流；只读磁盘 cache，cache 缺失就走 `_XAI_STATIC_FALLBACK` 兜底。Codex 走 `_codex_curated_models()` 是同模式但带 `/backend-api/codex/models` 的实时 fallback（见 §1.3）。

`_xai_merge_curated_extras`（`models.py:140-149`）负责把**Hermes 私藏**的 slug（如 `grok-composer-2.5-fast` 这类公开 `/v1/models` 拉不到、但 SuperGrok Build CLI 资格下可用的）**插到第一位**——这就是 §1.1 "grok-composer 仅 OAuth 可见"在 catalog 层的工作机制。

### 1.2 xAI 必须**显式**传 model（`agent/auxiliary_client.py:2408-2431`）

```python
def _build_xai_oauth_aux_client(model: str) -> Tuple[Optional[Any], Optional[str]]:
    """Build a CodexAuxiliaryClient for an xAI Grok OAuth-authenticated session.

    xAI's ``/v1/responses`` endpoint speaks the OpenAI Responses API, so we
    wrap a plain ``OpenAI`` client in ``CodexAuxiliaryClient`` to translate
    ``chat.completions.create()`` calls into ``responses.stream()`` requests.

    The caller must pass an explicit model — pinning a default for Grok
    would silently rot when xAI's allowlist drifts.
    """
    if not model:
        logger.warning(
            "Auxiliary client: xai-oauth requested without a model; "
            "pass model explicitly (auxiliary.<task>.model in config.yaml)."
        )
        return None, None
    ...
    return CodexAuxiliaryClient(real_client, model), model
```

**陷阱**：
- `_build_xai_oauth_aux_client` **不**有 model 默认值——`logger.warning` 后 `return (None, None)`，调用方必须显式传（`auxiliary.<task>.model` 在 config.yaml）。
- 同样的禁令适用于 `_build_codex_client`（`auxiliary_client.py:2434-2458`）：`"There is no auto-selection of the Codex model: the ChatGPT-account Codex endpoint's accepted model list is an undocumented, drifting allow-list, so any hardcoded default we pick goes stale."`

**为什么**？xAI / OpenAI 都会随订阅 tier 动态调整允许的 slug——昨天能用的 `grok-4.3` 可能下周就变 404。硬编码默认会让"sink default silently rot"。

### 1.3 Codex 模型清单：硬编码 + 实时 + 合成（`hermes_cli/codex_models.py`）

Codex 的模型来源**三路并用**：

#### A. 硬编码 fallback（`DEFAULT_CODEX_MODELS` 14-44）

```python
DEFAULT_CODEX_MODELS: List[str] = [
    "gpt-5.5",
    "gpt-5.4-mini",
    "gpt-5.4",
    "gpt-5.3-codex",
    # gpt-5.3-codex-spark is in research preview and is exposed *only* via
    # the Codex CLI / OAuth backend (chatgpt.com/backend-api/codex/models)
    # for ChatGPT Pro subscribers. It is NOT available in the public OpenAI
    # API, so it intentionally stays out of the "openai" provider catalog
    # in hermes_cli/models.py — only the openai-codex (OAuth) provider
    # surfaces it. The Codex backend reports ``supported_in_api: false`` for
    # this slug; that flag describes API availability, not Codex backend
    # availability, so the fetch/cache code paths below intentionally do
    # not filter on it. PR #12994 removed this entry on the assumption it
    # was unsupported — that was wrong; restored here. Keep it in the
    # curated fallback so Pro users still see Spark in `/model` when live
    # discovery is unavailable (offline first run, transient API failure).
    "gpt-5.3-codex-spark",
    # NOTE: gpt-5.2-codex / gpt-5.1-codex-max / gpt-5.1-codex-mini were
    # previously listed here but the chatgpt.com Codex backend returns
    # HTTP 400 "The '<model>' model is not supported when using Codex with
    # a ChatGPT account." for all three on every ChatGPT Pro account we've
    # tested (verified live 2026-05-27).
]
```

**关键观察**：
- **`gpt-5.3-codex-spark` 仅 Codex-OAuth 可见**——`supported_in_api: false` 是**公开 OpenAI API** 的 flag，**不**是 Codex 后端 flag。所以 Hermes 故意不 filter 这个 flag，否则会把 Spark 误杀。
- **`gpt-5.2-codex` / `gpt-5.1-codex-max` / `gpt-5.1-codex-mini` 故意从 fallback 移除**——在 ChatGPT Pro 账号上**必然 400**。注释里写"verified live 2026-05-27"。这跟 Claude Code / OpenAI 直连不一样：Codex-OAuth 后端的 allowlist **不是**公开 OpenAI API 的 allowlist。

#### B. 实时拉取（`_fetch_models_from_api` 82-119）

```python
resp = httpx.get(
    "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
    headers={"Authorization": f"Bearer {access_token}"},
    timeout=10,
)
data = resp.json()
entries = data.get("models", [])
for item in entries:
    slug = item.get("slug")
    visibility = item.get("visibility", "")
    if visibility.strip().lower() in {"hide", "hidden"}: continue
    priority = item.get("priority")
    rank = int(priority) if isinstance(priority, (int, float)) else 10_000
    sortable.append((rank, slug))
sortable.sort(key=lambda x: (x[0], x[1]))
return _add_forward_compat_models([slug for _, slug in sortable])
```

**关键**：
- `client_version=1.0.0` query param——OpenAI 用它来路由模型清单版本。
- 只 filter `visibility == "hide"/"hidden"`，**不** filter `supported_in_api`（见 A 的注释）。
- **必须**有 access_token（ChatGPT 账号 OAuth bearer）——意味着 401 拿不到，runner 走 `DEFAULT_CODEX_MODELS` fallback。

#### C. 合成 forward-compat 模型（`_add_forward_compat_models` 58-79）

```python
_FORWARD_COMPAT_TEMPLATE_MODELS: List[tuple[str, tuple[str, ...]]] = [
    ("gpt-5.5", ("gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex")),
    ("gpt-5.4-mini", ("gpt-5.3-codex",)),
    ("gpt-5.4", ("gpt-5.3-codex",)),
    # Surface Spark whenever any compatible Codex template is present so
    # accounts hitting the live endpoint with an older lineup still see
    # Spark in the picker. Backend gates real availability by ChatGPT Pro
    # entitlement; Hermes does not.
    ("gpt-5.3-codex-spark", ("gpt-5.3-codex",)),
]
```

仿 Clawdbot 的"合成 catalog"行为：后端没返回新 slug，但用户已有兼容的旧 slug 时，**也展示**新 slug。后端真正按 ChatGPT Pro 资格 gating，Hermes 不做。

### 1.4 CLI 引导（`hermes_cli/model_setup_flows.py`）

`_model_flow_xai_oauth`（597-678）和 `_model_flow_openai_codex`（509-595）流程相似：

1. `get_xai_oauth_auth_status()` / `get_codex_auth_status()` 检查已登录
2. 提示 reauth / cancel 三选一
3. 调用对应的 `_login_*`
4. 选模型（xai 走硬编码 catalog，codex 走 `codex_models.get_codex_model_ids(access_token=...)`）
5. 写 `config.yaml` 的 `model.model` + `model.provider`

**Codex 特有**（`_model_flow_openai_codex` 581-589）：

```python
codex_models = get_codex_model_ids(access_token=_codex_token)
selected = _prompt_model_selection(
    codex_models,
    current_model=current_model,
    confirm_provider="openai-codex",
    confirm_base_url=DEFAULT_CODEX_BASE_URL,    # 写死
    confirm_api_key=_codex_token or "",         # 提示但不持久化
)
```

`DEFAULT_CODEX_BASE_URL` = `https://chatgpt.com/backend-api/codex` 硬绑。

### 1.5 模型选择陷阱速查

| Provider | 来源 | 默认 model | 必须显式传？ | 隐藏规则 |
|---|---|---|---|---|
| `xai` (API key) | models.dev (`xai`) | 用户 config | 否（但 `grok-4.5-latest` 等可能不在公开 catalog） | 无 |
| `xai-oauth` (OAuth) | models.dev (`xai`) 复用 + `model_metadata.py` fallback | 用户 config | **是**（辅助客户端警告） | `grok-composer-2.5-fast` 仅 OAuth 可见，公开 `/v1/models` 拉不到 |
| `openai-codex` (OAuth) | 硬编码 `DEFAULT_CODEX_MODELS` + 实时 `/models` + 合成 forward-compat | 用户 config | **是**（同上） | `supported_in_api: false` **不** filter；`gpt-5.2/5.1` 已从 fallback 移除（400 on Pro） |

---

## 2. 订阅 tier 与 quota 探测

### 2.1 共享骨架：`AccountUsageSnapshot` / `AccountUsageWindow`（`agent/account_usage.py:25-46`）

```python
@dataclass(frozen=True)
class AccountUsageWindow:
    label: str           # 例: "Session" / "Weekly" / "Subscription"
    used_percent: Optional[float] = None
    reset_at: Optional[datetime] = None
    detail: Optional[str] = None

@dataclass(frozen=True)
class AccountUsageSnapshot:
    provider: str        # 例: "openai-codex" / "nous" / "openrouter"
    source: str          # 例: "usage_api" / "portal-account" / "credits_api"
    fetched_at: datetime
    title: str = "Account limits"
    plan: Optional[str] = None           # 例: "Pro" / "Plus" / "Free"
    windows: tuple[AccountUsageWindow, ...] = ()
    details: tuple[str, ...] = ()
    unavailable_reason: Optional[str] = None
```

`render_account_usage_lines`（95-120）渲染到 `/usage` / `/credits` 视图：

```
📈 Account limits
Provider: openai-codex (Pro)
Session: 35% remaining (65% used) • resets in 2h 14m (2026-07-09 12:34 +08)
Weekly: 82% remaining (18% used) • resets in 3d 4h (2026-07-12 14:34 +08)
```

`fetch_account_usage` dispatcher（678-696）：

```python
def fetch_account_usage(provider, *, base_url=None, api_key=None) -> Optional[AccountUsageSnapshot]:
    normalized = str(provider or "").strip().lower()
    if normalized in {"", "auto", "custom"}:
        return None
    try:
        if normalized == "openai-codex":
            return _fetch_codex_account_usage(base_url=base_url, api_key=api_key)
        if normalized == "anthropic":
            return _fetch_anthropic_account_usage()
        if normalized == "openrouter":
            return _fetch_openrouter_account_usage(base_url, api_key)
    except Exception:
        return None
    return None
```

**xAI 不在 dispatcher 里**——仓库**没有** `_fetch_xai_account_usage`。这是核心事实之一（见 §2.4）。

### 2.2 Codex 实时 quota（`agent/account_usage.py:428-542`）

#### URL 推断（`_resolve_codex_usage_url` 428-436）

```python
def _resolve_codex_usage_url(base_url: str) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    if not normalized:
        normalized = "https://chatgpt.com/backend-api/codex"
    if normalized.endswith("/codex"):
        normalized = normalized[: -len("/codex")]
    if "/backend-api" in normalized:
        return normalized + "/wham/usage"          # 官方路径
    return normalized + "/api/codex/usage"        # 自建 / 镜像路径
```

**两套 endpoint**：
- **`/wham/usage`**：OpenAI 官方 Codex backend 用这个（`/backend-api` 路径下）。
- **`/api/codex/usage`**：第三方 / 镜像网关用（比如 `codex.nekos.me`，`error_classifier.py:300-302` 提到过）。

#### 凭据获取（`_resolve_codex_usage_credentials` 439-494）— 三层 fallback

```python
def _resolve_codex_usage_credentials(base_url, api_key):
    # Tier 1: 显式传进来的 key (live agent path)
    if explicit_key: return explicit_key, base_url, None

    # Tier 2: 运行时 resolver (它已经 fallback 到 pool)
    try:
        creds = resolve_codex_runtime_credentials(refresh_if_expiring=True)
        account_id = _read_codex_tokens().get("tokens", {}).get("account_id")
        return creds["api_key"], creds["base_url"], account_id
    except AuthError:
        ...

    # Tier 3: 直接从 pool 选
    pool = load_pool("openai-codex")
    entry = pool.select()
    if entry is None:
        raise RuntimeError("No available openai-codex credential in credential pool")
    return entry.runtime_api_key, entry.runtime_base_url, None   # pool 没 account_id
```

**关键**：**`ChatGPT-Account-Id` 头**只有 Tier 1/2 拿得到（singleton 才有 `account_id`），Tier 3（pool-only）**故意不**带（`account_usage.py:485-488`）——pool entry 没有这个概念。

#### HTTP 调用（`_fetch_codex_account_usage` 497-542）

```python
headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/json",
    "User-Agent": "codex-cli",                  # 模仿 Codex CLI
}
if account_id:
    headers["ChatGPT-Account-Id"] = account_id
with httpx.Client(timeout=15.0) as client:
    response = client.get(_resolve_codex_usage_url(resolved_base_url), headers=headers)
    response.raise_for_status()
payload = response.json() or {}
rate_limit = payload.get("rate_limit") or {}
windows: list[AccountUsageWindow] = []
for key, label in (("primary_window", "Session"), ("secondary_window", "Weekly")):
    window = rate_limit.get(key) or {}
    used_pct = window.get("used_percent")
    if used_pct is None: continue
    windows.append(AccountUsageWindow(
        label=label,
        used_percent=float(used_pct),
        reset_at=_parse_dt(window.get("reset_at")),
    ))
details: list[str] = []
credits = payload.get("credits") or {}
if credits.get("has_credits"):
    balance = credits.get("balance")
    if isinstance(balance, (int, float)):
        details.append(f"Credits balance: ${float(balance):.2f}")
    elif credits.get("unlimited"):
        details.append("Credits balance: unlimited")
return AccountUsageSnapshot(
    provider="openai-codex",
    source="usage_api",
    fetched_at=_utc_now(),
    plan=_title_case_slug(payload.get("plan_type")),
    windows=tuple(windows),
    details=tuple(details),
)
```

#### 响应字段映射

| `/wham/usage` 字段 | Hermes 字段 | 含义 |
|---|---|---|
| `plan_type` | `AccountUsageSnapshot.plan` | 订阅 tier slug（`"pro"`/`"plus"`/`"team"`/`"free"`），`_title_case_slug` 转 `"Pro"`/`"Plus"`/`"Team"`/`"Free"` |
| `rate_limit.primary_window.used_percent` | `AccountUsageWindow(label="Session")` | 5h 会话配额（已用百分比） |
| `rate_limit.primary_window.reset_at` | `AccountUsageWindow.reset_at` | 5h 窗口重置时间（绝对时间戳字符串） |
| `rate_limit.secondary_window.used_percent` | `AccountUsageWindow(label="Weekly")` | 周配额 |
| `rate_limit.secondary_window.reset_at` | 同上 | 周窗口重置时间 |
| `credits.has_credits` | `details` 列表追加一行 | 是否有 API credits（独立于订阅） |
| `credits.balance` | `details: "Credits balance: $X.XX"` | 美元余额 |
| `credits.unlimited` | `details: "Credits balance: unlimited"` | Pro 团队 / 企业无上限 |

### 2.3 Codex Pool quota cooldown（`hermes_cli/auth.py:3733-3803`）

当 pool-only Codex 凭据被标记 `STATUS_EXHAUSTED` 时，`_codex_pool_rate_limit_status` 读 `last_error_reset_at` 判断是否还在 cooldown：

```python
def _codex_pool_rate_limit_status() -> Optional[Dict[str, Any]]:
    def _parse_reset_at(value):
        # 支持 unix-ms (1e12+) / unix-s / ISO 8601 字符串
        ...
    try:
        with _auth_store_lock():
            auth_store = _load_auth_store()
        entries = auth_store["credential_pool"]["openai-codex"]
        for entry in entries:
            if entry.get("last_status") != "exhausted": continue
            code = entry.get("last_error_code")
            reason = str(entry.get("last_error_reason") or "").lower()
            message = str(entry.get("last_error_message") or "").lower()
            is_rate_limited = (
                code == 429
                or "rate_limit" in reason
                or "usage_limit" in reason
                or "quota" in reason
                or "rate limit" in message
                or "usage limit" in message
                or "quota" in message
            )
            if not is_rate_limited: continue
            reset_at = _parse_reset_at(entry.get("last_error_reset_at"))
            if reset_at is not None and reset_at <= now: continue
            return {"label": ..., "last_refresh": ..., "reset_at": reset_at, ...}
    except Exception: ...
    return None
```

被 `resolve_codex_runtime_credentials` 调用：singleton 缺失时若发现 pool 在 cooldown，**直接抛 `AuthError(CODEX_RATE_LIMITED_CODE, relogin_required=False)`**——告诉用户"配额还在冷却中，重 login 没用"。

### 2.4 xAI **没有**官方 tier/quota 探测

**决定性证据**：

1. `agent/account_usage.py::fetch_account_usage` 的 dispatcher（678-696）**只有** `openai-codex / anthropic / openrouter` 三个分支，**没有 `xai-oauth`**。
2. 整个 `agent/` 目录没有 `_fetch_xai_account_usage` / `_xai_oauth_tier` / 类似函数。
3. `agent/gemini_native_adapter.py::probe_gemini_tier` 的"调一个便宜模型，看 rate-limit 头"模式**没**被 xai/codex 复用。
4. `auth.py::refresh_xai_oauth_pure` 的 403 错误码是 `xai_oauth_tier_denied`（不是 quota 数值），**不**包含 tier 名 / 重置时间。
5. `xai-oauth` 的 `tokens` 结构**没有** `plan_type` 字段（`auth.py::refresh_xai_oauth_pure` 4190-4326 处理的是 `access_token / refresh_token / id_token / expires_in / token_type`）。

**为什么 xAI 不做？** 注释推断：
- xAI 的 OAuth discovery 端点 `https://auth.x.ai/.well-known/openid-configuration` 不返回 `tier` 字段（标准 OIDC 不含）。
- xAI 的 `/v1/responses` 端点在 403 时**不**返回 `plan_type` 或 `quota_reset_at`（`_decorate_xai_entitlement_error` 注释 `run_agent.py:2040-2093` 显示 xAI 返回的 body 是 `"You have either run out of available resources or do not have an active Grok subscription. Manage subscriptions at https://grok.com/?_s=usage or subscribe at https://grok.com/supergrok"`——给用户**看**的链接，不给 API 解析的字段）。
- xAI 的 subscription gating 在**模型级别**而不是**账户级别**——同一个 SuperGrok 账号下，`grok-4.3` 可能够、`grok-2-vision` 可能 200K 但受限、`grok-composer-2.5-fast` 必须 Grok Build CLI 资格。model_metadata.py 的硬编码窗口是这种"模型级别 entitlement"的间接证据。

**因此**：xAI 的 "entitlement" 判断**只能**靠错误分类（§3）来推断。

---

## 3. 错误分类：entitlement vs auth fail vs rate limit

### 3.1 三种 `FailoverReason` 的核心区分

`agent/error_classifier.py::classify_api_error`（**priority-ordered pipeline** 526-529）：

1. 特殊 case（thinking sigs、tier gates）
2. HTTP 状态码 + 消息感知
3. Body 错误码
4. 消息模式（billing vs rate_limit vs context vs auth）

`FailoverReason` 主要值：`auth` / `rate_limit` / `billing` / `context_length` / `model_not_supported` / `thinking_signature` / `long_context_tier` / `oauth_long_context_beta_forbidden` / `llama_cpp_grammar_pattern` / `unknown`。

### 3.2 关键 pattern 集合（`error_classifier.py:103-188`）

```python
_BILLING_PATTERNS = [
    "insufficient credits",
    "insufficient_quota",
    "insufficient balance",
    ...
]
_USAGE_LIMIT_PATTERNS = [
    "usage limit",
    "quota",
    "limit exceeded",
    ...
]
_USAGE_LIMIT_TRANSIENT_SIGNALS = [     # 表明 "usage limit" 是临时的（rate limit）而非 billing
    "try again",
    "retry",
    "resets at",
    ...
]
```

**关键**：`has_usage_limit and has_transient_signal` → `FailoverReason.rate_limit`（**retryable**），否则 `billing`（**non-retryable**）。这条规则给 Codex 的 429 / weekly window 关键。

### 3.3 xAI entitlement 双重模式（`error_classifier.py:714-742`）

```python
# xAI Grok subscription entitlement errors.
#
# xAI returns "You have either run out of available resources or do not
# have an active Grok subscription" through two distinct code paths:
#
#   • HTTP 403 — status_code is set; _classify_by_status (step 2) routes
#     it to FailoverReason.auth correctly, and _is_entitlement_failure
#     then prevents the credential-refresh loop.
#
#   • SSE ``type=error`` frame — surfaced as _StreamErrorEvent with
#     status_code=None.  _classify_by_status is skipped entirely, and
#     "grok subscription" / "out of available resources" appear in none
#     of the message-pattern lists below.  Without this guard the error
#     falls through to FailoverReason.unknown (retryable=True), burning
#     max_retries before the agent stops.
#
# Both X Premium+ and SuperGrok subscribers hit this path when their
# subscription tier does not cover the requested model or feature.
if (
    "do not have an active grok subscription" in error_msg
    or ("out of available resources" in error_msg and "grok" in error_msg)
):
    return _result(
        FailoverReason.auth,        # 走 auth 分支 → 后续 _is_entitlement_failure 兜住
        retryable=False,            # 不重试
        should_fallback=True,
    )
```

**为什么必须在 step 1 处理 SSE frame？** 注释解释得很清楚：`status_code=None` 时 `step 2 (status code classification)` 直接被跳过，**没有 status code 的 SSE 错误会落进 `FailoverReason.unknown` 并被 retryable=True 处理**——结果是把 entitlement 错误**当作可重试的未知错误**，烧完 max_retries 才停。**这次修复让长 session 不再被无意义的 retry 循环拖到 401 失败**。

### 3.4 `_is_entitlement_failure` 与 #29344 WKE 异常（`run_agent.py:1970-2036`）

```python
@staticmethod
def _is_entitlement_failure(error_context, status_code) -> bool:
    """Detect subscription/entitlement 403s that masquerade as auth failures.

    Returned True only when the body text matches a known entitlement
    shape AND the status is 401/403.  Refreshing an OAuth token cannot
    fix an unsubscribed account, so callers should surface the error
    instead of looping the credential pool.

    Current matches:
      * xAI OAuth: "do not have an active Grok subscription" /
        "out of available resources" / "does not have permission" + "grok"

    Disambiguator for xAI (#29344): the same ``code`` text ("The caller
    does not have permission to execute the specified operation") is
    returned for BOTH an unsubscribed account AND a stale OAuth access
    token.  xAI ships an explicit signal in the ``error`` field that
    tells the two apart: a ``[WKE=unauthenticated:...]`` suffix (and/or
    the ``OAuth2 access token could not be validated`` phrasing) means
    the credentials failed validation — that's recoverable by refreshing
    the token, NOT by surfacing an entitlement message.
    """
    if status_code not in {401, 403, None}: return False
    if not isinstance(error_context, dict): return False
    message = str(error_context.get("message") or "").lower()
    reason = str(error_context.get("reason") or "").lower()
    code = str(error_context.get("code") or "").lower()
    err = str(error_context.get("error") or "").lower()
    haystack = f"{message} {reason} {code} {err}"
    if not haystack.strip(): return False
    # xAI's authoritative disambiguator for "stale token" vs
    # "unsubscribed account".  Both conditions share the same
    # permission-denied ``code`` text; only one carries this suffix.
    if "[wke=unauthenticated:" in haystack: return False
    if "oauth2 access token could not be validated" in haystack: return False
    if "do not have an active grok subscription" in haystack: return True
    if "out of available resources" in haystack and "grok" in haystack: return True
    if "does not have permission" in haystack and "grok" in haystack: return True
    return False
```

**#29344 的本质**：xAI 的 `/v1/responses` 端点对**两类失败**返回**完全相同**的 body（`code` 文本都是 `"The caller does not have permission to execute the specified operation"`）：

- **Case A**：stale OAuth access token → 应该**刷 token**（refresh 路径，recoverable）。
- **Case B**：账号没订阅或订阅不够 → 应该**停止并提示用户**（不要无限 refresh）。

xAI 在 `error` 字段里塞了**唯一可区分**的信号：`[WKE=unauthenticated:...]` 后缀和/或 `OAuth2 access token could not be validated` 措辞。**这俩** → Case A，**否则** → Case B。`_is_entitlement_failure` 在 entitlement 关键词检查**之前**就 `return False`，让 refresh 路径有机会跑。

**没有这条防线**（commented #29344 提到）→ 长 TUI session 拿 stale token 时会被错误归为 entitlement，refresh 路径被绕过，session 一直死锁直到用户退出再重开。

### 3.5 防御性 `agent_runtime_helpers.py:857-913`

```python
if effective_reason == FailoverReason.auth:
    is_entitlement = agent._is_entitlement_failure(error_context, status_code)
    _auth_haystack = " ".join(
        str(error_context.get(k) or "").lower()
        for k in ("message", "reason", "code", "error")
        if isinstance(error_context, dict)
    )
    # Anthropic 组织级禁 OAuth
    if not is_entitlement and status_code == 403 \
            and "oauth authentication is currently not allowed for this organization" in _auth_haystack:
        is_entitlement = True
    # Anthropic OAuth + anthropic_messages 模式下，403 默认就是 entitlement
    if not is_entitlement and status_code == 403 \
            and (agent.provider or "") == "anthropic" \
            and getattr(agent, "api_mode", "") == "anthropic_messages":
        is_entitlement = True
    # xAI: 任何 403 默认 entitlement（除非 WKE 异常）
    if not is_entitlement and status_code == 403 and (agent.provider or "") == "xai-oauth":
        _is_xai_auth_failure = (
            "[wke=unauthenticated:" in _auth_haystack
            or "oauth2 access token could not be validated" in _auth_haystack
        )
        if not _is_xai_auth_failure:
            is_entitlement = True
    if is_entitlement:
        # 不刷 token、不切 pool entry；直接 surface 给用户
        return False, has_retried_429
    refreshed = pool.try_refresh_current()
    ...
```

**三层 defense-in-depth**：
1. **基础**：`_is_entitlement_failure`（关键词匹配）。
2. **Anthropic 兜底**：an organization-level ban 关键词 + `anthropic` + `anthropic_messages` API 模式时 403 一律 entitlement。
3. **xAI 兜底（#26847）**：标准 SuperGrok 订阅可能 403 但 body 关键词不匹配——**任何** 403 都按 entitlement 处理（除非 WKE 后缀豁免）。

### 3.6 401 路径的"提示用户"分支（`conversation_loop.py:3775-3794`）

```python
elif _provider in {"openai-codex", "xai-oauth", "nous"} and status_code == 401:
    if _provider == "openai-codex":
        agent._vprint(f"💡 Codex OAuth token was rejected (HTTP 401). Your token may have been")
        agent._vprint(f"   refreshed by another client (Codex CLI, VS Code). To fix:")
        agent._vprint(f"   1. Run `codex` in your terminal to generate fresh tokens.")
        agent._vprint(f"   2. Then run `hermes auth` to re-authenticate.")
    elif _provider == "xai-oauth":
        agent._vprint(f"💡 xAI OAuth token was rejected (HTTP 401). To fix:")
        agent._vprint(f"   re-authenticate with xAI Grok OAuth (SuperGrok / Premium+) from `hermes model`.")
    else:  # nous
        ...
```

**关键**：401（不是 403）走"重 login"提示，**403 走 entitlement 提示**——这两个完全不同的修复路径。

### 3.7 401 → 刷新 → 重试（共享）（`conversation_loop.py:2709-2719`）

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

**注意**：`_try_refresh_codex_client_credentials` 内部已经经过 `_is_entitlement_failure` 检查——如果 401 其实是被 `_is_entitlement_failure` 误分类为 auth（不是 stale token），这里会**拒绝**刷 token 并直接 surface 错误。

---

## 4. 限流（429）与 cooldown

### 4.1 `CODEX_RATE_LIMITED_CODE` —— 区分 quota vs auth

`hermes_cli/auth.py`（从错误模式反推）：

```python
# 在 refresh_codex_oauth_pure (3405-3507):
if response.status_code == 429:
    retry_after = _parse_retry_after_seconds(getattr(response, "headers", None))
    if retry_after is not None:
        message = (f"Codex provider quota exhausted (429); retry after {retry_after}s. "
                   "Credentials are still valid.")
    else:
        message = ("Codex provider quota exhausted (429). Credentials are still valid; "
                   "retry after the usage limit resets.")
    raise AuthError(
        message,
        provider="openai-codex",
        code=CODEX_RATE_LIMITED_CODE,
        relogin_required=False,            # 关键: 不让用户重 login (重 login 也救不了)
    )
```

**`relogin_required=False`** 的语义：上游**配额**用完，**重 login 不能解决**——错误归类器会走 `FailoverReason.rate_limit` 而不是 `FailoverReason.auth`，不会触发 refresh 循环。

### 4.2 Pool-level cooldown（`agent/credential_pool.py`）

**字段**（145-146）：

```python
@dataclass
class PooledCredential:
    ...
    last_error_message: Optional[str] = None
    last_error_reset_at: Optional[float] = None    # unix 时间戳
```

**写入路径**（592-597）：

```python
self._replace_entry(entry, updated := replace(entry,
    last_error_message=normalized_error.get("message"),
    last_error_reset_at=normalized_error.get("reset_at"),
))
```

**解析路径**（`credential_pool.py:320-345`）：

```python
def _normalize_error_for_pool(status_code, error_context, error_obj):
    ...
    reset_at = (error_context.get("reset_at")
                or error_context.get("resets_at")
                or error_context.get("retry_until"))
    parsed_reset_at = _parse_absolute_timestamp(reset_at)
    if parsed_reset_at is None and isinstance(message, str):
        retry_delay_seconds = _extract_retry_delay_seconds(message)
        if retry_delay_seconds is not None:
            parsed_reset_at = time.time() + retry_delay_seconds
    if parsed_reset_at is not None:
        normalized["reset_at"] = parsed_reset_at
    return normalized

def _next_attempt_at(entry, _exhausted_ttl) -> Optional[float]:
    if not entry: return None
    reset_at = _parse_absolute_timestamp(getattr(entry, "last_error_reset_at", None))
    if reset_at is not None: return reset_at
    if entry.last_status_at:
        return entry.last_status_at + _exhausted_ttl(entry.last_error_code)
    return None
```

**TTL 默认值**（111-115）：

```python
EXHAUSTED_TTL_401_SECONDS    = 5 * 60       # 5 分钟
EXHAUSTED_TTL_429_SECONDS    = 60 * 60      # 1 小时
EXHAUSTED_TTL_DEFAULT_SECONDS = 60 * 60     # 1 小时
```

**重点**：401 → 5 分钟冷却（适合"刷一下 token 再试"），429 → 1 小时（**覆盖** server 给的 reset_at 如果更短）。

**`last_error_reset_at` 怎么被解析**：见 `agent_runtime_helpers.py:3011-3071` 的 `_extract_api_error_context`——会从多个源拼出来：
- `error_context.reset_at` / `resets_at` / `retry_until`
- `headers["Retry-After"]`
- `headers["x-ratelimit-reset"]`
- body 文本里的 `quotaResetDelay: 123ms` / `resets in 2h 30m` / `retry after 60 seconds` 等正则

**陷阱**（`credential_pool.py:656-665`）：

> "Meanwhile the user may run `hermes model` / `hermes auth` which performs a fresh device-code login and writes new tokens to `auth.json` under `_auth_store_lock`. Without this sync the pool entry stays frozen until `last_error_reset_at` elapses — even though fresh credentials are sitting on disk — and every request fails with 'no available entries (all exhausted or empty)'."

→ 修在 `credential_pool.py:1400-1470` 的 "device_code sync"：当 singleton 被新登录重写时，**主动**把 pool entry 的 `last_error_message` / `last_error_reset_at` 清空。

### 4.3 Codex 路径的 stream watchdog（`chat_completion_helpers.py:131-147`）

```python
def openai_codex_stale_timeout_floor(est_tokens: int) -> float:
    """Minimum wall-clock stale timeout for openai-codex by estimated context.

    Gateway/Telegram sessions routinely ship ~15–25k tokens of tools +
    instructions before the first user message. Subscription-backed Codex can
    legitimately spend several minutes in backend admission/prefill at that
    size; the generic 90s non-stream stale default aborts healthy calls.
    """
    if est_tokens > 100_000: return 1200.0
    if est_tokens > 50_000:  return 900.0
    if est_tokens > 10_000:  return 600.0
    return 0.0
```

**应用**（`chat_completion_helpers.py:387-393`）：

```python
_codex_watchdog_enabled = agent.api_mode == "codex_responses"
_openai_codex_backend = _is_openai_codex_backend(agent)
_est_tokens_for_codex_watchdog = estimate_request_context_tokens(api_kwargs)
if _codex_watchdog_enabled and _openai_codex_backend:
    _codex_floor = openai_codex_stale_timeout_floor(_est_tokens_for_codex_watchdog)
    if _codex_floor:
        _stale_timeout = max(_stale_timeout, _codex_floor)
```

**含义**：Codex 后端在大型请求（>10K tokens）下经常 prefill 几分钟，通用 90s stale timeout 会**误杀健康请求**。ChatGPT 订阅的 Codex 必须**用更大的 timeout floor**。

### 4.4 xAI reasoning timeout floor（`reasoning_timeouts.py:107-114`）

```python
# xAI Grok reasoning variants.  Explicit reasoning-only keys
# plus one for the ``non-reasoning`` variant so users picking
# the fast variant don't get the 300s floor.  Bare ``grok-3``,
# ``grok-4`` etc. don't match — only the explicit reasoning /
# non-reasoning pairs.
("grok-4-fast-reasoning", 300),
("grok-4.20-reasoning", 300),
("grok-4-fast-non-reasoning", 180),
```

**陷阱**：
- `grok-4-fast` / `grok-4` 等**不带** `-reasoning` 后缀的**不**匹配 → 用通用 180s（太短？可能误杀）。
- **必须显式** `grok-4-fast-reasoning` / `grok-4-fast-non-reasoning` 才生效。

---

## 5. 特殊模型 slug & Compaction

### 5.1 Codex：compaction auto-raise（`agent/auxiliary_client.py:325-335`）

```python
# gpt-5.5 sessions use the window they actually have.
_CODEX_GPT54_GPT55_COMPACTION_THRESHOLD = 0.85

# gpt-5.3-codex-spark is Codex-OAuth-only (ChatGPT Pro entitlement) with a
# native 128K context window.  The default 50% compaction trigger fires at
# ~64K — wasting half the usable window, often before the session has enough
# turns to summarize meaningfully.
_CODEX_SPARK_COMPACTION_THRESHOLD = 0.70
```

**判断函数**（`_is_codex_gpt54_or_gpt55` 338、`_is_codex_spark` 362-374）：

```python
def _is_codex_gpt54_or_gpt55(model, provider=None) -> bool:
    prov = (provider or "").strip().lower()
    if prov != "openai-codex": return False    # 关键: 只在 Codex-OAuth 路径生效
    bare = (model or "").strip().lower().rsplit("/", 1)[-1]
    return (...)

def _is_codex_spark(model, provider=None) -> bool:
    prov = (provider or "").strip().lower()
    if prov != "openai-codex": return False    # Codex-OAuth-only
    bare = (model or "").strip().lower().rsplit("/", 1)[-1]
    return bare == "gpt-5.3-codex-spark"
```

**应用**（402-433）：

```python
def model_specific_compression_threshold(model, provider=None, *, allow_codex_gpt55_autoraise=True):
    if _is_codex_gpt54_or_gpt55(model, provider) and allow_codex_gpt55_autoraise:
        return _CODEX_GPT54_GPT55_COMPACTION_THRESHOLD    # 0.85
    if _is_codex_spark(model, provider):
        return _CODEX_SPARK_COMPACTION_THRESHOLD          # 0.70
    return None
```

**含义**：
- **`gpt-5.4` / `gpt-5.5` 在 Codex-OAuth 后端 272K cap**（`auxiliary_client.py:319-322`），50% compaction 在 136K 触发，**浪费**。auto-raise 到 85% 在 ~232K 触发。
- **`gpt-5.3-codex-spark` 128K native 窗口**，50% 在 64K 触发更浪费 → 70% 在 ~90K 触发。
- 这些都**只在 `provider == "openai-codex"` 路径生效**——OpenAI 直连 1M+ 不会触发。

### 5.2 Codex 一次性 auto-raise 提示（`agent/agent_init.py:71-167`）

```python
def _build_codex_gpt5_autoraise_notice(autoraise: Dict[str, Any]) -> str:
    """Build the one-time notice shown when Codex gpt-5.x raises compaction."""
    model = str(autoraise["model"] or "gpt-5.4/5.5").strip().lower().rsplit("/", 1)[-1]
    cap = "128K" if model.startswith("gpt-5.3-codex-spark") else "272K"
    from_pct = int(round(autoraise["from"] * 100))
    to_pct = int(round(autoraise["to"] * 100))
    return (
        f"...summarizing.\n"
        f"  Opt back out: hermes config set compression.codex_gpt55_autoraise false"
    )
```

**用户**可关：`hermes config set compression.codex_gpt55_autoraise false`。

### 5.3 xAI：`grok-composer-2.5-fast` 与 Grok Build CLI（`model_metadata.py:296-303`）

```python
# OAuth-only slug; absent from GET /v1/models. xAI publishes a 200k
# usable context window for Composer 2.5 on Grok Build (SuperGrok /
# Premium+); /v1/responses additionally enforces a ~262144 input+output
# budget, but the usable context (what we track here) is 200k.
"grok-composer":     200000,    # grok-composer-2.5-fast (Grok Build CLI)
"grok-build-latest": 500000,    # alias of grok-4.5 (early access)
"grok-build":        256000,    # grok-build-0.1
```

**xAI 端没有**特殊 compaction 策略——grok 系列的 context window 全部由 `model_metadata.py` 静态覆盖，compaction 用全局默认。

### 5.4 必杀陷阱：`grok-composer-2.5-fast` 必须显式传

`_build_xai_oauth_aux_client`（见 §1.2）**没有 model 默认值**。如果用户用 xAI OAuth 但**没**在 `config.yaml` 写 model，会**回退到全局默认**（通常是 `gpt-4o` 或 `claude-sonnet-4-5`），但 runtime provider 检测到 `provider="xai-oauth"` 会**改 base_url 到 `api.x.ai/v1`**——结果是用错模型 slug 打错 endpoint。

---

## 6. 状态展示：desktop / web 怎么告诉用户

### 6.1 `_resolve_provider_status`（`web_server.py:8096-8186`）

`_OAUTH_PROVIDER_CATALOG` 中 `status_fn=None` 的项会在 `_resolve_provider_status` 里**按 provider_id 派发**到对应的 status helper：

```python
if provider_id == "openai-codex":
    raw = hauth.get_codex_auth_status()
    return {
        "logged_in": bool(raw.get("logged_in")),
        "source": raw.get("source") or "openai_codex",
        "source_label": raw.get("auth_mode") or "OpenAI Codex",
        "token_preview": _truncate_token(raw.get("api_key")),
        "expires_at": None,
        "has_refresh_token": False,
    }
```

**返回字段**：`logged_in` / `source` / `source_label` / `token_preview` / `expires_at` / `has_refresh_token`。

**xAI 路径**（同样 dispatcher）调 `get_xai_oauth_auth_status`——只返回 `logged_in` / `auth_store` / `last_refresh`（**没有** plan/expires_at）：

```python
# auth.py:6174-6181
try:
    creds = resolve_xai_oauth_runtime_credentials()
    return {
        "logged_in": True,
        "auth_store": str(_auth_file_path()),
        ...
    }
```

→ desktop 显示的 xAI 状态**没有**过期时间、**没有** plan——只有"logged in"。

### 6.2 `providers-settings.tsx`（desktop）

`apps/desktop/src/app/settings/providers-settings.tsx` 渲染 OAuth 卡片：

- `OAuthProvider.status.logged_in`（bool）→ 决定显示 "Sign in" 按钮还是 "Disconnect" 按钮
- `OAuthProvider.status.source_label` → 显示 "auth_mode"（例如 "oauth_device_code" / "chatgpt"）
- `OAuthProvider.flow`（`pkce` / `device_code` / `external`）→ 决定 modal 是 URL 弹窗还是 user_code 显示

xAI / Codex 都是 `flow: "device_code"`，dashboard 显示 user_code + verification URL（同 §1.4 / §1.5）。

---

## 7. 关键陷阱速查

### xAI (`xai-oauth`)

1. **403 = entitlement 几乎确定**（除非 WKE 后缀 / OAuth2 措辞）。`relogin_required=False` 永远不该触发——**任何** 403 在 `xai-oauth` 上一律视为 entitlement，`_is_entitlement_failure` 拒绝刷 token。
2. **#29344**：`[WKE=unauthenticated:...]` 后缀和 `OAuth2 access token could not be validated` 措辞是**唯一**能区分 stale token vs unsubscribed 的信号——必须**先**判它再判 entitlement 关键词。
3. **必须显式传 model**（尤其在辅助客户端调用里）——`grok-composer-2.5-fast` 仅 OAuth 可见，公开 `/v1/models` 拉不到。
4. **没有官方 tier/quota 探测**——`_decorate_xai_entitlement_error` 注释明确说 xAI 不返回 plan_type / quota_reset_at，只能**靠错误分类**推断。
5. **X Premium+ 不包含 API access**（`run_agent.py:2054-2057`）——用户最常见的踩坑：在 X app 看到 Grok 以为可以，结果 403。**提示文案必须 lead with this**。
6. **Active 刷新窗口必须自适应**——device-code 流 AT 经常只有 ~15min，固定 3600s 会**烧 RT**。
7. **`grok-composer-2.5-fast` 是 Grok Build CLI 资格**，不是普通 SuperGrok 资格——subscription 看起来够但 403。
8. **`grok-4-fast-reasoning` / `grok-4-fast-non-reasoning` 是 reasoning timeout 唯一匹配项**——bare `grok-4` / `grok-4-fast` 不匹配，会用通用 180s。

### Codex (`openai-codex`)

1. **`supported_in_api: false` 不 filter**——`gpt-5.3-codex-spark` 在 Codex-OAuth 上**可**用，只是公开 OpenAI API 上没有。**PR #12994 曾误删** Spark，注释里写得很清楚已恢复。
2. **`gpt-5.2-codex` / `gpt-5.1-codex-max` / `gpt-5.1-codex-mini` 已从 fallback 移除**——在 ChatGPT Pro 账号上必然 400（verified live 2026-05-27）。
3. **272K cap**（`gpt-5.4` / `gpt-5.5`）+ **128K cap**（`gpt-5.3-codex-spark`）——**只在 Codex-OAuth 路径**生效，OpenAI 直连是 1M+。`_is_codex_gpt54_or_gpt55` / `_is_codex_spark` 显式检查 `provider == "openai-codex"`。
4. **Compaction auto-raise 是 opt-out**——`hermes config set compression.codex_gpt55_autoraise false` 可关。
5. **`/wham/usage` 需 `ChatGPT-Account-Id` 头**（singleton 路径才有），pool-only 路径**故意不**带。
6. **429 ≠ re-login**：`CODEX_RATE_LIMITED_CODE, relogin_required=False` 告诉用户"配额用完，re-login 没用"。
7. **`refresh_token_reused` 是专属 code**——意味着 Codex CLI / VS Code 抢了 RT。提示用户**先在 Codex CLI 跑一次** `codex` 让它产生新 token，**再** `hermes auth`。
8. **Stream watchdog 阈值**：>10K tokens → 600s，>50K → 900s，>100K → 1200s。ChatGPT 订阅的 prefill 慢，通用 90s 会误杀。
9. **`get_codex_model_ids` 必须传 access_token**——否则拿不到实时 catalog，只能用 `DEFAULT_CODEX_MODELS` fallback。
10. **`hermes auth add openai-codex` 走 `manual:device_code` 而不是 singleton**——多账号场景下每个 entry 独立 RT 生命周期。

---

## 8. 关键文件索引

| 主题 | 路径 | 行号 |
|---|---|---|
| **模型元数据** | `agent/models_dev.py` | 142-180 |
| **xAI 静态 fallback** | `agent/model_metadata.py` | 285-312 |
| **Codex 三路 catalog** | `hermes_cli/codex_models.py` | 14-44, 82-119, 58-79 |
| **必须显式传 model** | `agent/auxiliary_client.py` | 2408-2431 (xAI), 2434-2458 (Codex) |
| **CLI 引导** | `hermes_cli/model_setup_flows.py` | 509-595 (Codex), 597-678 (xAI) |
| **AccountUsage dataclass** | `agent/account_usage.py` | 25-46 |
| **Codex 实时 quota** | `agent/account_usage.py` | 428-542 |
| **Codex pool cooldown** | `hermes_cli/auth.py` | 3733-3803 |
| **xAI 403 = entitlement** | `agent/error_classifier.py` | 714-742 |
| **#29344 WKE 异常** | `run_agent.py` | 1970-2036 |
| **entitlement defense-in-depth** | `agent/agent_runtime_helpers.py` | 857-913 |
| **xAI entitlement 文案** | `run_agent.py` | 2038-2093 |
| **401 → 提示用户** | `agent/conversation_loop.py` | 3775-3794 |
| **401 → 刷 token → 重试** | `agent/conversation_loop.py` | 2709-2719 |
| **Codex 限流（429）** | `hermes_cli/auth.py::refresh_codex_oauth_pure` | 3405-3507 |
| **Pool last_error_reset_at 写入** | `agent/credential_pool.py` | 320-345, 592-597 |
| **Pool TTL 默认** | `agent/credential_pool.py` | 111-115 |
| **reset_at 解析** | `agent/agent_runtime_helpers.py` | 3011-3071 |
| **Stream watchdog** | `agent/chat_completion_helpers.py` | 131-147, 387-393 |
| **Reasoning timeout** | `agent/reasoning_timeouts.py` | 107-114 |
| **Compaction auto-raise** | `agent/auxiliary_client.py` | 325-335, 338-433 |
| **Auto-raise 提示** | `agent/agent_init.py` | 71-167 |
| **桌面状态展示** | `hermes_cli/web_server.py` | 8096-8186 |
| **`/wham/usage` URL 推断** | `agent/account_usage.py` | 428-436 |
| **三层凭据 fallback** | `agent/account_usage.py` | 439-494 |
| **`ChatGPT-Account-Id` 头** | `agent/account_usage.py` | 485-488, 507-508 |
| **Test #29344** | `tests/run_agent/test_codex_xai_oauth_recovery.py` | 319, 521-558, 713-764 |

---

## 9. 一句话总结

- **xAI Grok OAuth**：模型来自 `models.dev` (`xai`) 复用 + `model_metadata.py` 硬编码 fallback。**没有官方 tier/quota 探测**。403 = entitlement（除非 WKE 后缀），**不要 re-login**。模型必须**显式**传（`grok-composer-2.5-fast` 等仅 OAuth 可见）。
- **OpenAI Codex OAuth**：模型来自硬编码 `DEFAULT_CODEX_MODELS` + 实时 `/backend-api/codex/models` + 合成 forward-compat。**有官方 quota 接口** `/wham/usage` 返回 `plan_type` + `primary_window`（5h）+ `secondary_window`（weekly）。429 ≠ re-login，401 = refresh 后重试。`gpt-5.3-codex-spark` 仅 OAuth 可见但 backend 报 `supported_in_api: false`——必须**不** filter 该 flag。`gpt-5.4` / `gpt-5.5` 在 272K cap 下，compaction 阈值 auto-raise 到 85%（opt-out）。
