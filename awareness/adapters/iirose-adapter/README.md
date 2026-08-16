# iirose-adapter

IIROSE 聊天室的 Awareness Adapter。覆盖登录、文本消息、按月消息日志、最近十条上下文触发、主动响应、切房/跟随、点赞、welcome 与点歌。

## 结构

```text
iirose-adapter/
├── ADAPTER.ts          # 生命周期、路由顺序和 Engine 边界
├── config.default.json # 受 Git 跟踪的默认配置
├── config.json         # 首次实例化时生成的实例配置
├── classifier.ts       # 最近十条消息的 trust / attention 分类
├── message-log.ts      # logs/YYYYMM 消息日志与历史分页
├── protocol.ts         # IIROSE 帧编解码
├── scripts/            # 登录、监听、发送、切房、点赞与官方媒体上传
├── tools/              # 按账号/基础/社交/管理分类的 action 描述
├── plugins/            # welcome、music、active 与 room 本地插件
└── SKILL.md            # 场景、工具参数与结果
```

## 路由顺序

1. WebSocket 原始帧在 `protocol.ts` 转为包含 `userId` 的 `IIroseEvent`。
2. 未被本地回显消费的消息先写入当月 `logs/YYYYMM`。
3. 白名单命令和确定性插件先执行；命中即停止传播。
4. 管理员消息、@用户名、别名或引用消息形成基础触发；active 插件可延长触发窗口。
5. 触发时读取同一来源最近十条消息，附在 `Observation.content.history` 并计算等级；`off` 不发送 Engine。

welcome 会比较进入事件的 `userId` 与 `credentials.uid`。机器人自身上线产生的进入事件会被静默消费，不欢迎自己，也不继续推送给 Agent。

IIROSE actor 判定：

- `adminsIds` 中的 UID → `user`。
- `credentials.uid` → `assistant`，表示 ToBe 信息。
- 其他参与者 UID → `service`，表示除用户之外其他人参与形成的实际场景。
- Adapter 启停事件 → `adapter`。

命令和插件在 trust 分类及 Observation 构造之前执行。它们产生的本地响应会记录 IIROSE `messageId`；聊天室回显时精确消费一次，不进入 Engine，也不推送 Agent。正常的 ToBe 发言即使文本相同也不会被误拦截。

群聊等级只有 `off / low / medium / high`：

- `off`：没有管理员、@/别名、引用或 active 插件触发，不进入 Engine。
- `low`：已触发，最近十条内没有管理员消息。
- `medium`：已触发，最近十条内同时有管理员和普通用户消息。
- `high`：已触发，最近十条全是管理员消息。

私聊单独处理：管理员私聊固定为 `high`；普通用户私聊固定为 `off`。

## 配置

首次扫描会在缺少 `config.json` 时复制 `config.default.json`，随后正常注册。编辑生成的 `config.json`，至少填写 `credentials.username/password/roomId/uid`、`adminsIds`，再将 `enabled` 设为 `true`。`adminsIds` 是用户唯一键列表，不使用显示名鉴权。密码仅在内存中转换为 MD5 登录字段；实例配置不受 Git 跟踪。

默认 `autoStart=false`。消息日志始终开启，目录由 `logging.directory` 指定且必须位于本 Adapter 的 `data/` 内；文件名为本地月份 `YYYYMM`，内容是逐行 JSON。`history` action 只查询当月，不接受文件或月份参数；`start=11,end=20` 表示读取距最新第 11 至 20 条。

Agent 不直接注册 IIROSE 专属 function tools。它先通过全局 `awareness_observe/list_adapters` 取得 ID 和 action，再用全局 `awareness_observe` 或 `awareness_interact` 调用。

## Nickname 与插件命令

`nickname` 是 ToBe 在当前 IIROSE 环境中的别名，不替代登录用的 `credentials.username`。支持命令匹配的插件使用以下字段：

- `prefix`：普通字符串时要求消息以它开头；`{name}` 同时接受 IIROSE mention ` [*username*] ` 和 nickname。
- `adminOnly`：是否只允许 `adminsIds` 中的用户执行。无权限的匹配消息仍由插件消费，不进入 Engine。
- `whiteList`：该插件允许的命令字符串或字符串数组。

例如 username 为“菲比啾比”、nickname 为“菲比”时，` [*菲比啾比*] 点歌稻香` 和 `菲比点歌稻香` 都匹配点歌插件。`/help` 会从启用插件的配置动态展示这些命令。

## 主动响应与切房

- `/active off|low|medium|high`：关闭、长窗口、短窗口、每句触发；对应 tool 为 `set_active`。
- `/room {roomId}`：手动切房；对应 tool 为 `switch_room`，可选房间密码。
- `/follow true|false`：切换是否跟随任一管理员的切房事件；对应 tool 为 `set_follow`。
- `like_user` 使用 IIROSE 点赞协议，仅接受普通用户 UID。

`low`/`medium` 主动等级只会在管理员、@、别名或引用形成基础触发后开启相应来源的长/短窗口；`high` 才会让每条公屏消息触发。主动响应不改变私聊规则。命令和对应 tool 的切换只影响当前 Adapter 实例，重新注册后从配置重新读取。

## 点歌

`plugins.music` 使用网易云公开搜索结果的第一首，通过参考插件的 IIROSE 双帧协议发送媒体卡片 `m__4@0...` 与播放事件 `&1{...}`。搜索地址、音源地址、音质、码率和颜色均在配置中。Agent 可通过 `awareness_interact` 调用 `request_music`，参数为 `{ "name": "歌名" }`。

协议参考：[IIROSE MEDIA bundle](https://1309510434-2avmc4sr11.ap-guangzhou.tencentscf.com/bundle.js)。

## 增量边界

`send_media` 的图片和 MediaInput 音频会把 Media 服务解析出的字节，以 `credentials.uid` 作为 multipart 的 `i` 字段、文件作为 `f[]` 上传到 IIROSE 官方 `file_upload.php`；图片响应为 `i/...`，音频响应为 `m/...`，两者都会与 `http://r.iirose.com/` 拼接。图片使用 `[URL#e]`；音频则把上传得到的完整 MP3 URL 作为普通消息直接发送，不再发送 `m__4`/`&1` 音乐卡片双帧，也不附加 caption。该 action 只发送到当前公屏，不提供私聊媒体参数。撤回、服务发现与完整 IIROSE 富文本仍可增量实现。

协议实现参考 [adapter-iirose](https://github.com/iirose-plugins/adapter-iirose) 与 [IIROSE 插件文档](https://iirose-plugins.github.io/iirose-plugins-docs/)；本实现没有复制 Koishi 运行时。
