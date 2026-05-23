# SUMMARY

- 去掉了对 MiniMax 中国区域名 `api.minimaxi.com` 的错误归一化，保留用户原始配置域名。
- 新增 MiniMax Anthropic Token Plan 识别：当 key 为 `sk-cp-...` 时，聊天和“测试连接/获取模型”统一走 Bearer 鉴权。
- 本地激活 provider 已恢复为 `https://api.minimaxi.com/anthropic/v1`。
- 已完成验证：
  - `npm test`：6 个测试文件、11 个测试全部通过
  - 设置页“测试接口连接”成功，检测到 7 个模型
  - 真实对话“请只回复‘收到’”返回“收到”
