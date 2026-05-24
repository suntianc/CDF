# Plan: Bind pure chat sessions to Master Agent

## Goal
让纯聊天/临时会话在创建时直接绑定项目默认 Master Agent，避免会话先以未绑定 Agent 状态保存。

## Checklist
- [x] 1. 定位纯聊天会话创建和发送链路。
- [x] 2. 在会话创建时确保项目默认 Master Agent 存在并优先绑定。
- [x] 3. 运行测试和构建验证。
