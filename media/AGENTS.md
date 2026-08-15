# Media Contract

1. Agent 可见结果只能包含可序列化媒体元数据和媒体 key；不得暴露二进制、本地路径、生成文件的 `desc`、API Key 或模型返回的临时鉴权 URL。
2. 入站媒体由 Adapter 完成平台下载与解密，再以 `MediaData` 调用 `MediaService.recognize`。Observation 必须同时保留媒体类型和文本解释；识别失败不得把媒体伪装成普通文本。
3. 检索出站先按 `kind` 调用 `media_list`，再由 Adapter 把返回的 `kind/category/tag` 原样交给 `MediaService.resolve`；列表与解析均以调用当时的文件系统为准。
4. 生成出站先调用 `media_generate`，再由 Adapter 使用原样的 `<kind>:<12位key>` 调用 `MediaService.resolve`。磁盘文件可附加仅供人工查看的 `desc`，但检索只匹配 key，发送重试不得重复生成。
5. Adapter 必须把平台 MIME、大小及动画等约束传给 `resolve`，并负责最终平台上传和消息协议。
6. 当前只承诺图片与音频识别/生成；`video`、`file` 是契约扩展点，不得在没有 Provider 时宣称可识别或生成。
7. 所有模型请求必须受超时、响应大小和允许下载主机约束。媒体库 category/tag 必须防止路径穿越和符号链接逃逸。不得建立与文件系统重复的内存媒体索引。
