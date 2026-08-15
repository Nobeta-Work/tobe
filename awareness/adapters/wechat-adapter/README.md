# wechat-adapter

基于 `@wechatbot/wechatbot` 的可信微信 iLink Awareness Adapter。支持持久化会话恢复、显式二维码链接登录、文本与图片/语音输入、Media 图片/音频输出、输入状态、去重和受限回复缓存。

所有入站消息在 Awareness 中固定映射为用户 `0`，并使用 `actor=user`、`trust=high`、`attention=high`。真实微信用户 ID 只保存在 SDK storage 中用于发送路由。

图片使用微信原生图片消息。当前 iLink 普通 Bot 无法稳定投递原生语音气泡，因此音频输出使用可靠的可播放文件附件；输入语音仍按原生 voice 消息下载和识别。

## 安装

在本目录安装依赖：

```bash
npm install
```

首次扫描会在缺少 `config.json` 时复制受 Git 跟踪的 `config.default.json`，随后正常注册。生成的实例配置与凭证目录不受 Git 跟踪。凭证只能保存到本 Adapter 的 `data/` 内；SDK 要求 Node.js 22 或更高版本。

## 启动语义

`autoStart=true` 只恢复已存在的凭证；无凭证或恢复失败时发布一次 `login.required` 后静默。Agent 显式调用 `login` 才会产生二维码网页链接。扫码成功无需回调，Adapter 会发布 `login.succeeded` 并进入在线状态。

Adapter 会拦截 SDK 在会话过期后的隐式扫码流程，转为一次 `login.required`，随后等待显式 `login`。
