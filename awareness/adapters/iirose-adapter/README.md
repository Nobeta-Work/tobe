# iirose-adapter

IIROSE 聊天室的 Awareness Adapter。当前增量覆盖登录、登出、WebSocket 保活与重连、公屏/私聊消息收发、成员进出事件、参与度分类、本地命令、welcome 与点歌插件。

## 结构

```text
iirose-adapter/
├── ADAPTER.ts          # 生命周期、路由顺序和 Engine 边界
├── config.json         # 唯一运行配置（默认禁用且无凭证）
├── classifier.ts       # trust / attention 滑动窗口
├── protocol.ts         # IIROSE 帧编解码
├── scripts/            # 登录、登出、监听、发送、help 等接口请求
├── tools/              # 按账号/基础/社交/管理分类的 action 描述
├── plugins/welcome.ts  # 无模型欢迎响应与防刷
└── SKILL.md            # 场景、工具参数与结果
```

## 路由顺序

1. WebSocket 原始帧在 `protocol.ts` 转为包含 `userId` 的 `IIroseEvent`。
2. `adminsIds` 判断当前事件是否由用户本人参与，滑动窗口同时产生 trust 与 attention。
3. 白名单命令先执行；命中即停止传播。
4. 插件再执行；命中即停止传播。welcome 即使在 `off` 也可作确定性响应。
5. 未被消费的事件才转为 `Observation`；IIROSE 字段位于 `content`，Engine 会拦截 `attention=off`。

welcome 会比较进入事件的 `userId` 与 `credentials.uid`。机器人自身上线产生的进入事件会被静默消费，不欢迎自己，也不继续推送给 Agent。

IIROSE actor 判定：

- `adminsIds` 中的 UID → `user`。
- `credentials.uid` → `assistant`，表示 ToBe 信息。
- 其他参与者 UID → `service`，表示除用户之外其他人参与形成的实际场景。
- Adapter 启停事件 → `adapter`。

命令和插件在 trust 分类及 Observation 构造之前执行。它们产生的本地响应会记录 IIROSE `messageId`；聊天室回显时精确消费一次，不进入 Engine，也不推送 Agent。正常的 ToBe 发言即使文本相同也不会被误拦截。

IIROSE 等级只有 `off / low / medium / high`：

- `off`：窗口没有管理员事件，并且短时事件数超过洪泛阈值。
- `low`：窗口没有管理员事件，但尚未洪泛。
- `medium`：窗口同时包含管理员与其他用户事件。
- `high`：窗口内全部事件均来自管理员。

## 配置

编辑 `config.json` 后，至少填写 `credentials.username/password/roomId/uid`、`adminsIds`，再将 `enabled` 设为 `true`。`adminsIds` 是用户唯一键列表，不使用显示名鉴权。密码仅在内存中转换为 MD5 登录字段；不要提交真实配置。

默认 `autoStart=false`，因此 extension 会扫描注册并分配 `adapter_id`，但不会自动连接网站。日志默认关闭；启用后目录由 `logging.directory` 指定，但当前核心实现不负责持久化日志。

Agent 不直接注册 IIROSE 专属 function tools。它先通过全局 `awareness_observe/list_adapters` 取得 ID 和 action，再用全局 `awareness_observe` 或 `awareness_interact` 调用。

## Nickname 与插件命令

`nickname` 是 ToBe 在当前 IIROSE 环境中的别名，不替代登录用的 `credentials.username`。每个插件可以拥有自己的 `commands`：

- `prefix`：普通字符串时要求消息以它开头；`{name}` 同时接受 IIROSE mention ` [*username*] ` 和 nickname。
- `adminOnly`：是否只允许 `adminsIds` 中的用户执行。无权限的匹配消息仍由插件消费，不进入 Engine。
- `whiteList`：该插件允许的命令字符串或字符串数组。

例如 username 为“菲比啾比”、nickname 为“菲比”时，` [*菲比啾比*] 点歌稻香` 和 `菲比点歌稻香` 都匹配点歌插件。`/help` 会从启用插件的配置动态展示这些命令。

## 点歌

`plugins.music` 使用网易云公开搜索结果的第一首，通过参考插件的 IIROSE 双帧协议发送媒体卡片 `m__4@0...` 与播放事件 `&1{...}`。搜索地址、音源地址、音质、码率和颜色均在配置中。Agent 可通过 `awareness_interact` 调用 `request_music`，参数为 `{ "name": "歌名" }`。

协议参考：[IIROSE MEDIA bundle](https://1309510434-2avmc4sr11.ap-guangzhou.tencentscf.com/bundle.js)。

## 增量边界

当前解析核心文本消息和成员进出，保留未知帧而不猜测。图片、音频、撤回、房间切换、服务发现与完整 IIROSE 富文本可继续在 `protocol.ts` / `scripts` 增量实现，不改变 Engine。

协议实现参考 [adapter-iirose](https://github.com/iirose-plugins/adapter-iirose) 与 [IIROSE 插件文档](https://iirose-plugins.github.io/iirose-plugins-docs/)；本实现没有复制 Koishi 运行时。
