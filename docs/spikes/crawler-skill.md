# Crawler Skill Spike Report

本报告记录 issue #29 的案头调研与实现决策。目标不是引入新的爬虫运行时，而是为 CDF 的内置 Crawler Skill 提炼策略规范：如何描述目标、提取规则、分页计划、反爬处理和输出纪律，并由现有 Obscura Browser Tool 执行单页读取。

调研日期：2026-07-05。

## Decision

- CDF 采用分层方案：`obscura_browse` 是原子读取工具，Crawler Skill 是策略层。
- Skill 不包含执行代码、不 shell 调 Obscura CLI、不新增 wrapper scripts。
- 本轮只覆盖单页读取、链接发现、cookie/asset/source inspection 和 Agent 编排循环；批量并发、页面脚本、登录态/点击会话留给后续 issue。
- 默认合规姿态：`stealth` 可作为浏览器一致性设置，但默认遵守 robots.txt、低并发、请求间隔和访问控制。

## Source Review

| Source | Useful patterns | CDF takeaway |
| --- | --- | --- |
| [Browser Use CLI](https://docs.browser-use.com/open-source/browser-use-cli) / [Open Source docs](https://docs.browser-use.com/open-source/introduction) | 给 coding agent 一个可直接操作浏览器的 Skill/CLI surface；区分本地浏览器、云浏览器、CDP endpoint；强调 agent-ready setup。 | 证明 Skill 可以只负责“何时/如何使用工具”的 progressive disclosure。但 CDF 不采用其 shell/CLI 直连模式，因为 ADR 0045 要求所有读取经 `obscura_browse`。 |
| [Crawl4AI Quick Start](https://docs.crawl4ai.com/core/quickstart/) / [No-LLM extraction](https://docs.crawl4ai.com/extraction/no-llm-strategies/) | 把 browser config、run config、Markdown 生成和 extraction strategy 分开；优先 CSS/XPath/schema 等确定性抽取，LLM 只用于复杂非结构化内容。 | Crawler Skill 应先要求用户/Agent 定字段 schema 和证据来源，再抽取；能用页面结构时不要让模型自由生成字段。 |
| [Firecrawl API Introduction](https://docs.firecrawl.dev/api-reference/v2-introduction) / [Scrape endpoint](https://docs.firecrawl.dev/api-reference/endpoint/scrape) | 产品层把 scrape、crawl、map、search、browser session 分为不同能力；单页 scrape 可返回 Markdown、HTML、links、images、screenshot、JSON 等格式。 | CDF 本轮只把可结构化、单页、原子读的格式放进 `obscura_browse`，把 site-wide crawl/map/search 级别的 workflow 留在 Skill 编排。 |
| [Jina Reader API](https://jina.ai/reader/) | Reader 面向 LLM-friendly 页面输入，提供 selector、wait-for、links/images summary、token budget、cookie/proxy 等控制。 | Crawler Skill 应要求控制输出预算、按 selector/证据定位抽取、记录 links/assets 摘要，并把 cookie/proxy 视为显式访问姿态而非默认行为。 |

## Four-Question Skill Shape

### 1. Target

Agent 在第一次读取前必须明确：

- seed URL 或 URL pattern；
- 目标页面类型：列表页、详情页、资产页或组合；
- 停止条件：数量、页数、日期范围、分类、URL prefix 或无新增记录；
- 是否需要 JS 渲染。静态页面优先使用 Fetch Tool，需要浏览器环境再用 Obscura Browser Tool。

### 2. Extraction Rules

Agent 必须先定义字段 schema，再提取数据：

- 每个字段要说明来源证据，例如 heading、table cell、link text、metadata、asset URL 或附近正文；
- 每条记录必须包含 `sourceUrl`；
- 缺失字段保持 nullable，不补造；
- 优先确定性结构抽取；只有页面结构弱或语义判断必要时才让模型参与归纳。

### 3. Pagination And Discovery

Agent 使用 `obscura_browse` 的原子格式组织循环：

- `format: "links"`：从 seed/listing page 发现分页和详情链接；
- `format: "markdown" | "text" | "html"`：读取目标内容；
- `format: "assets"`：收集 PDF、图片或其他资源 URL；
- `format: "original"`：排查抽取失败或验证原始渲染源；
- 维护 visited set、去重 URL、低速串行或近似串行请求；
- 达到停止条件、分页结束或没有新记录时停止。

### 4. Access Posture

默认策略：

- 遵守 robots.txt；
- 设置明确 timeout；
- 限制请求频率和范围；
- `stealth: true` 只作为浏览器指纹一致性设置；
- 不绕过登录墙、付费墙、CAPTCHA、rate limit 或其他访问控制，除非用户明确说明拥有正当权限并要求继续。

## Output Discipline

- 先定 schema，再爬取；
- 逐条落 JSONL 或 Markdown，取决于当次任务目标；
- 每条记录附 `sourceUrl` 和必要证据片段；
- 周期性汇报 fetched/skipped/extracted/failed 计数；
- 对失败 URL 记录原因，不把失败静默吞掉；
- 未指定输出位置时，不创建项目产物，只在回复中返回摘要和记录。

## Rejected Options

- 让 Crawler Skill 直接 shell 调 Obscura CLI：会绕过 `validateWebUrl`、结构化 JSON 返回、统一 exitCode/stderr 处理和跨平台路径解析。
- 本轮引入 batch crawl/concurrency 参数：这属于 workflow 或后续 tool surface，不是单页原子读取。
- 本轮支持页面脚本或登录态会话：风险和状态边界明显更大，需单独设计。

## Handoff

- Tool 层：扩展 `obscura_browse` 的 `format` 到 `markdown|text|html|links|cookies|assets|original`。
- Skill 层：内置 `crawler/SKILL.md` 只描述策略，所有读取通过 `obscura_browse`。
- 测试层：覆盖 Obscura 新格式的 Agent tool schema，以及 Skill Manager 能加载内置 Crawler Skill。
