# feishu-adapter

飞书 IM 的 Awareness Adapter。v0.1 使用飞书官方 Node SDK 长连接，覆盖私聊/群聊消息接收、owner 身份识别、@Bot 策略、去重、防刷、本地命令、文本发送和回复。

## 结构

```text
feishu-adapter/
├── ADAPTER.ts       # 生命周期、路由和 Observation 构造
├── config.ts/json   # 配置及校验
├── protocol.ts      # 飞书事件类型与消息内容解析
├── actor.ts         # Awareness actor 映射
├── classifier.ts    # trust / attention 参与窗口
├── scripts/         # SDK 网关、监听、发送和本地命令
├── tools/           # connection / message action 描述
└── SKILL.md         # Agent 场景与 action 契约
```

## 飞书后台前置条件

1. 创建企业自建应用并启用机器人能力。
2. 为应用添加接收和发送消息所需权限，并完成版本发布。
3. 事件订阅选择长连接，订阅 `im.message.receive_v1`。
4. 将 owner 的 `open_id` 填入 `identity.adminsIds`。

Adapter 默认 `autoStart=false`，extension 会扫描注册但不会连接。缺少凭证时仍会正常注册，并在状态中标记为未配置，不会阻断 Awareness 或其他 Adapter；只有执行 `connect`、发送或回复时才返回明确的配置错误。通过 `awareness_interact/connect` 启动，或确认配置后开启自动启动。

## Credentials

正式环境建议：

```json
{
  "credentials": {
    "appId": "cli_xxx",
    "appSecretEnv": "TOBE_FEISHU_APP_SECRET"
  }
}
```

运行进程中设置同名环境变量。为方便早期测试，如果找不到该环境变量，当前加载器会把 `appSecretEnv` 的值当作临时字面 secret；这不是推荐的长期存储方式，也不得在日志、Observation 或工具结果中返回它。

## 路由

消息先进行事件去重、会话与消息类型过滤，再执行 `help/status/ping` 本地命令。命令命中后直接回复，不进入 Engine。群聊默认要求 @Bot；配置了 `identity.botOpenId` 时按其精确识别，否则按 `nickname` 匹配飞书 mention 名称。私聊直接进入参与度分类并主动推送 Agent。

飞书事件字段全部放在 `Observation.content`，没有向 Awareness 公共类型加入 `chatId/messageId/openId`。官方长连接的真实性保存在 `transportVerified`，不用于直接提升 trust；trust 仍由 owner 参与窗口决定。

当前不包含表情、卡片回调、媒体下载、云文档、日历、任务、多维表格和用户 OAuth。这些能力可以按独立 tools 分类增量加入，不改变全局 `interact/observe` 入口。
