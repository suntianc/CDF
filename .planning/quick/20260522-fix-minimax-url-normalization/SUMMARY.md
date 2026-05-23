# Summary: Fix MiniMax compatible URL normalization

## Problem
当前激活的 MiniMax 供应商配置为：

- `provider_type = anthropic`
- `api_url = https://api.minimaxi.com/anthropic/v1`
- `default_model = MiniMax-M2.7-highspeed`

这里有两个兼容性问题：

1. 保存的域名写成了 `api.minimaxi.com`，而 MiniMax 官方兼容 Anthropic API 文档使用的是 `api.minimax.io`。
2. 当前 key / 资源对 `MiniMax-M2.7-highspeed` 返回 `404 MODEL_NOT_FOUND`，需要自动回退到标准模型 `MiniMax-M2.7`。

## Changes

1. **修正已知错误域名**
   - 新增 `src/shared/provider-url.ts`
   - 统一把 `api.minimaxi.com` 归一化成官方域名 `api.minimax.io`
   - 主进程 `llm` 运行时和 `db:saveProvider` 保存时都使用归一化后的 URL

2. **增加 MiniMax highspeed 自动回退**
   - 当 MiniMax 兼容接口请求 `*-highspeed` 模型返回 `404` 时，自动回退到对应标准模型
   - 例如 `MiniMax-M2.7-highspeed -> MiniMax-M2.7`

3. **修正本地现存配置**
   - 已直接更新本地数据库中的供应商记录，将
     `https://api.minimaxi.com/anthropic/v1`
     改为
     `https://api.minimax.io/anthropic/v1`

## Verification

- `npm test` 通过，共 `6` 个测试文件、`9` 个测试全部通过。
- 新增 `src/shared/provider-url.test.ts`，验证 URL 归一化与 highspeed 回退映射。
- 新增 `src/main/llm.test.ts`，验证 MiniMax/Anthropic 链路第一次 `404` 后会自动回退并正常完成流式输出。
