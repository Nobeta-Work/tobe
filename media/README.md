# Media

Media 是 ToBe 的双向媒体扩展，当前规范化图片与音频，并为视频与文件保留类型扩展点。

## 边界

- Adapter 负责平台原生媒体的下载、解密、上传和协议转换。
- Media 接收 Adapter 规范化后的 `MediaData`，独立调用识别模型并返回媒体描述与文本解释。
- Media 负责本地媒体库扫描、生成模型调用、生成资产落盘和受约束解析。
- Agent 始终通过文本 Tool Call 编排。支持原生多模态直传的 Adapter 可以自行承诺，但不是 Media 的默认路径。

## 双向流程

```text
环境原生媒体 -> Adapter(MediaData) -> Media.recognize -> Adapter(media + text) -> Agent
Agent -> media_list -> Agent -> Adapter interact -> Media.resolve(library) -> Adapter -> 环境
Agent -> media_generate -> mediaId -> Adapter interact -> Media.resolve(artifact) -> Adapter -> 环境
```

`config.default.json` 会在首次加载时复制为不受 Git 跟踪的 `config.json`。图片识别、音频识别、图片生成和音频生成分别配置 API、模型、密钥环境变量与超时。默认模型实现使用 OpenAI-compatible 的四类端点；Media 核心只依赖精简的 `MediaModels` 接口，可直接替换。

## 文件布局与寻址

生成型媒体与检索型媒体物理隔离，且都直接以文件系统为事实来源，不维护内存 Artifact Registry：

```text
media/
  data/<kind>/<key-desc>.<ext>
  lib/<kind>/<category>/<tag>/<file>
```

生成 key 固定为本地日期加两位随机字符，例如 `20260816-8s-`，完整磁盘文件可以是 `data/image/20260816-8s-女孩子的照片.png`；没有描述时是 `data/image/20260816-8s-.png`。Agent 和 Adapter 只获得 `image:20260816-8s-`，解析时只匹配冒号后前 12 位 key。`desc` 仅供人工查看文件，不进入 Tool Result、检查结果或 Adapter 媒体对象。

媒体库按类型列出 `{ "<category>": ["<tag>"] }`。例如 `lib/image/stickers/开心/` 对应：

```json
{ "kind": "image", "categories": { "stickers": ["开心"] } }
```

Adapter 申请该媒体时传入：

```json
{ "source": "library", "kind": "image", "category": "stickers", "tag": "开心" }
```

Adapter 通过 `getMedia()` 获取当前插件实例；插件未加载时，Adapter 的非媒体能力仍应正常工作。
