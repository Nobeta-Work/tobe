# wechat-adapter

基于 `@wechatbot/wechatbot` 的微信 iLink Awareness Adapter。第一版支持持久化会话恢复、显式二维码链接登录、文本接收/发送/回复、输入状态、去重和受限回复缓存。

## 安装

在本目录安装依赖：

```bash
npm install
```

首次扫描会在缺少 `config.json` 时复制受 Git 跟踪的 `config.default.json`，随后正常注册。生成的实例配置与凭证目录不受 Git 跟踪。凭证只能保存到本 Adapter 的 `data/` 内；SDK 要求 Node.js 22 或更高版本。

## 启动语义

`autoStart=true` 只恢复已存在的凭证；无凭证或恢复失败时发布一次 `login.required` 后静默。Agent 显式调用 `login` 才会产生二维码网页链接。扫码成功无需回调，Adapter 会发布 `login.succeeded` 并进入在线状态。

Adapter 会拦截 SDK 在会话过期后的隐式扫码流程，转为一次 `login.required`，随后等待显式 `login`。
