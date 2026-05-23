# PLAN

1. 修正 MiniMax Anthropic 兼容接入逻辑
   - verify: 不再强制把 `api.minimaxi.com` 改写成 `api.minimax.io`
2. 修正 Token Plan 鉴权方式
   - verify: `sk-cp-...` 走 Bearer，而不是 `x-api-key`
3. 实测验证
   - verify: 设置页“测试连接”通过，真实对话能返回内容
