# Media

Media 是 ToBe 的双向媒体扩展，当前规范化图片与音频，并为视频与文件保留类型扩展点。

## 边界

- Adapter 负责平台原生媒体的下载、解密、上传和协议转换。
- Media 接收 Adapter 规范化后的 `MediaData`，独立调用识别模型并返回媒体描述与文本解释。
- Media 负责本地媒体库扫描、生成模型调用、生成资产落盘和受约束解析。
- Agent 始终通过文本 Tool Call 编排。支持原生多模态直传的 Adapter 可以自行承诺，但不是 Media 的默认路径。

## 识别与调用

Adapter 传入 Awareness Engine 或 Agent 自身想要查看媒体文件，应当优先将环境消息中传入的 Meida 允许的媒体类型文件调用 Media 模块工具进行识别，将识别结果封装替换该文件上下文传入，并存入本地存储库中。

**识别**: 
- 所有被识别的图片、音频，文件名前缀必须为12位的 `<id>`:`YYYYMMDD-??-`，在 `<id>` 与扩展名之间可以填写简要描述。
- 根据媒体的类型 `<kind>`，存放在不同的目录下。`<kind>:<id>` 构成生成型媒体检索的基本索引 `<key>`，用于引用文件。
- 识别工具允许传入文本 prompt 与多个基于检索型媒体的索引 `<key>`。

**调用**:
- Adapter 与 Agent 在上下文中通过媒体 `<key>` 作为指向存储的媒体索引。替换上下文为：
```json
{"module": "Media", "type": "${Media.type}", "key": "${key}", "desc": "${desc}"}
```
- Adapter 在发送 Agent 指定的媒体消息前，应当使用 Media 模块工具将真实媒体消息导入。

**生成**:
- Agent 可以调用 Media 工具传入发送给生成模型的上下文并生成媒体。
- 上下文支持一定的复杂度、允许通过传入媒体 `<key>` 的方式传入真实媒体。例如，根据某个人设图和细节描述生成新的角色图。
- Media 应承诺生成的图片符合 `<kind>:<id-desc>` 存储与索引，但只将 `<kind>:<id>` 响应 Agent。

> 出于安全性，Adapter 应承诺在向环境发送媒体文件信息前修改文件名为随机命名。

## 双向流程

```text
环境原生媒体 -> Adapter(MediaData) -> Media.recognize -> Adapter(media + text) -> Agent
Agent -> media_list -> Agent -> Adapter interact -> Media.resolve(library) -> Adapter -> 环境
Agent -> media_generate -> mediaId -> Adapter interact -> Media.resolve(artifact) -> Adapter -> 环境
```

`config.default.json` 会在首次加载时复制为不受 Git 跟踪的 `config.json`。图片识别、音频识别、图片生成和音频生成分别配置 API、模型、API Key 与超时。默认模型实现使用 OpenAI-compatible 的四类端点；Media 核心只依赖精简的 `MediaModels` 接口，可直接替换。

## 文件布局与寻址

生成型媒体与检索型媒体物理隔离，且都直接以文件系统为事实来源，不维护内存 Artifact Registry：

```text
media/
  data/<kind>/<id-desc>.<ext>
  lib/<kind>/<category>/<tag>/<file>
```

生成 id 固定为本地日期加两位随机字符，例如 `20260816-8s-`，完整磁盘文件可以是 `data/image/20260816-8s-女孩子的照片.png`；没有描述时是 `data/image/20260816-8s-.png`。Agent 和 Adapter 只获得 `image:20260816-8s-`，解析时只匹配冒号后前 12 位 key。

媒体库按类型列出 `{ "<category>": ["<tag>"] }`。例如 `lib/image/stickers/开心/` 对应：

```json
{ "kind": "image", "categories": { "stickers": ["开心"] } }
```

Adapter 申请该媒体时传入：

```json
{ "source": "library", "kind": "image", "category": "stickers", "tag": "开心" }
```

Adapter 通过 `getMedia()` 获取当前插件实例；插件未加载时，Adapter 的非媒体能力仍应正常工作。

## Agent 工具与安全边界

- `media_list`：按 `kind` 返回当前媒体库真实存在的 category/tag。
- `media_generate`：生成图片或音频并返回不透明的媒体 key；生成成功不代表目标平台已经发送。
- `media_inspect`：检查生成媒体的安全元数据，不返回二进制、本地路径或文件描述。

Agent 可见结果只包含可序列化元数据与媒体 key。Adapter 调用 `resolve` 时必须传入平台允许的类型、MIME、大小及动画等约束，并负责最终上传与消息协议。发送失败后可复用同一媒体 key 重试，不应再次生成相同媒体。

当前模型层只承诺图片和音频的识别/生成；`video`、`file` 仅是媒体库与类型契约的扩展点。模型请求受超时、响应大小及允许下载主机限制，媒体库寻址拒绝路径穿越和符号链接逃逸。
