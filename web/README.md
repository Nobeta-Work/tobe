# ToBe Web

ToBe Web 是仓库内的单用户控制台。它维护一个名称固定为 `tobe` 的长期 Pi Session，提供对话、Awareness Adapter 配置和 Memory 文本审查。

## 启动

在仓库根目录安装依赖后运行：

```bash
npm start
```

默认监听 `0.0.0.0:2222`。首次启动会从 `web/config.default.json` 复制出不受 Git 跟踪的 `web/config.json`，运行数据和 Session 保存在 `web/data/`。

Pi 启动时会忽略机器上全局安装的 extensions，并显式加载根 `package.json` 中 `pi.extensions` 声明的仓库模块。这样更新仓库后重新启动 Web 即使用当前版本，避免旧全局 extension 产生工具冲突。

## 访问控制

`allowedIps` 接受精确 IP 或 CIDR，例如：

```json
{
  "allowedIps": ["203.0.113.8", "10.10.0.0/16"]
}
```

空数组表示允许任意 IP。默认不限制为本机访问，适合远程部署。

不填写密码时直接开放访问，不存在 `/setup` 页面。设置密码可以在 `web/config.json` 临时填写：

```json
{
  "password": "change-me"
}
```

下次启动会自动把明文替换为随机盐和 scrypt 哈希。也可以使用 `TOBE_WEB_PASSWORD` 环境变量，密码不会写入文件。

反向代理默认不受信任。只有 Web 的直接上游是可信代理时才设置 `trustProxy: true`，此时白名单将使用 `X-Forwarded-For` 中第一个地址。

可用的环境变量：

- `TOBE_WEB_HOST`
- `TOBE_WEB_PORT`
- `TOBE_WEB_PASSWORD`

Web 启动后不会自动运行 Agent。请在会话页面明确点击“运行 Agent”。

## Adapter 配置

Web 扫描 `awareness/adapters/*-adapter`。每个 Adapter 必须以自身目录内的 `config.schema.json` 承诺配置结构和敏感字段；Web 只负责读取该契约并生成表单。没有 schema 的新 Adapter 会显示在列表中，但 Web 不读取或修改其配置，直到 Adapter 补充该文件。

缺少 `config.json` 时，首次打开配置会复制 `config.default.json`。保存操作直接更新文件，但不会热重载已经实例化的 Adapter。可以在会话中要求 Agent 使用 `awareness_engine` 注销并重新注册该 Adapter。

标记为 `x-sensitive: true` 的字段不会通过 API 回传实际值。空白输入保持原值，用户可以显式选择清除。

## Memory

Web 提供 BASE、IDENTITY、SELF、USER、最近一次 Dream 以及现有 active/candidates Skills 的纯文本审查。BASE 只读，其余实例文件可编辑；未创建的 IDENTITY、SELF、USER 会在首次保存时创建。
