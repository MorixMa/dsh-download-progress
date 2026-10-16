# 安全策略

## 报告漏洞

**请不要开公开 issue。** 用 GitHub 的私密渠道：

- [Security Advisories → Report a vulnerability](https://github.com/MorixMa/dsh-download-progress/security/advisories/new)

如果这个入口不可用，就在 issue 里只写「我想报告一个安全问题，请给我一个私密联系方式」，
不要带任何细节。我们会在 72 小时内回你。

请在报告里尽量带上：DSH 版本、操作系统、复现步骤、以及你认为的攻击面。

## 这个插件的攻击面（供参考）

本插件在宿主上挂两条路由，两者都是**本机**可达的（DSH 的 web token 只护它自己的
`/api*`，插件路由不受它保护——这是平台约定）：

| 路由 | 副作用 | 授权 |
|---|---|---|
| `GET /download-progress` | 无 | 浏览器信任围栏（回环 Host 或部署声明的 `trustedHosts`；拒 `Sec-Fetch-Site: cross-site`；带 `Origin` 时须与 Host 同名或是桌面壳的 `dsh-app://app`） |
| `POST /download-progress/open` | 让宿主用系统默认应用打开文件 / 在文件管理器里定位 | 信任围栏 **+ 短时白名单** |

`open` 路由的白名单是**插件自己在采集任务时写入**的已知产物绝对路径（TTL 10 分钟、
上限 128 条）。不在白名单里的路径一律 403，连 `stat` 都不做——所以它不能被当作
「启动任意路径」的后门使用。

插件**不 spawn 任何进程**：打开与定位走 DSH 自己的宿主服务
`ctx.sessionController` 的 `openPath` / `revealPath`。

已知的、被接受的行为：

- `GET /download-progress` 会暴露任务标签，而 DSH 后台任务的标签常常是**整行命令行**。
  这是本机可达的只读信息，与 DSH 自带的任务抽屉一致。界面侧只显示文件名，但**接口本身
  仍然会返回完整标签**——这是刻意保留的（排查问题时需要它）。
- 任务产物的**绝对路径**会出现在 `GET /download-progress` 的响应里（`filePath` 字段），
  因为选中它才能打开 / 定位。界面不渲染它。

## 支持范围

只对**最新发布版本**修安全问题。DSH 宿主请保持在 `>=0.2.0-rc.1 <0.2.1`。
