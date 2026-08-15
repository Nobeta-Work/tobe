# Media

Media 是 ToBe 的双向媒体扩展，当前规范化图片与音频，并为视频与文件保留类型扩展点。

## 边界

- Adapter 负责平台原生媒体的下载、解密、上传和协议转换。
- Media 接收 Adapter 规范化后的 `MediaData`，独立调用识别模型并返回媒体描述与文本解释。
- Media 负责本地媒体库索引、生成模型调用、生成资产缓存和受约束解析。
- Agent 始终通过文本 Tool Call 编排。支持原生多模态直传的 Adapter 可以自行承诺，但不是 Media 的默认路径。

## 双向流程

```text
环境原生媒体 -> Adapter(MediaData) -> Media.recognize -> Adapter(media + text) -> Agent
Agent -> media_list -> Agent -> Adapter interact -> Media.resolve(library) -> Adapter -> 环境
Agent -> media_generate -> mediaId -> Adapter interact -> Media.resolve(artifact) -> Adapter -> 环境
```

`config.default.json` 会在首次加载时复制为不受 Git 跟踪的 `config.json`。图片识别、音频识别、图片生成和音频生成分别配置 API、模型、密钥环境变量与超时。HTTP Provider 使用 OpenAI-compatible 的四类端点，但 Media 核心只依赖 `MediaModelProvider`，可替换为任意实现。

Adapter 通过进程级 capability `tobe.media.v1` 获取 `MediaService`。插件未加载时，Adapter 的非媒体能力仍应正常工作。
