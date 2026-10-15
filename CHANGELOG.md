# 更新日志

本文件记录所有值得注意的改动。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-10-15

首个公开发布版。

### 新增

- **会话头指示器**：注册进 DSH 自己的 `conversation.session.header.utilities`
  （和「在应用中打开」「导出会话日志」同一排），带环形进度弧与数量角标。
- **进度弹层**：每个任务一行动画进度条——运行中扫光、未知进度走马灯、完成闪绿；
  聚合总览条给出总进度 / 已传输 / 速率 / 剩余时间。
- **三路数据源**：`dsh-ops/background` 服务（结构探测）→ 宿主 `ctx.jobs` 注册表
  （非消耗读，不动模型游标）→ 配置的进度源文件 / 目录。
- **进度解析**：Markdown 进度块（`进度 ██████░░░░ 11/47 (23%)`、`体积 90.0 MB / 100.0 MB`、
  `速度 0.42 MB/s`、`剩余 00:02:31`）与通用 JSON（`{total,done,bytes,bytesTotal,speed,eta,label}`），
  外加 curl `--progress-bar` 的 `\r` 分帧、wget 的 `7.98M` 无后缀单位、
  aria2/curl 的 `已传输 x / y` 等真实写法。
- **两帧差分**：源里没写速率 / 剩余时间时，用连续两次拉取的字节差算真实速率
  （指数滑动平均 α=0.4），再用「剩余字节 ÷ 速率」推剩余时间；连续三次无增量即停止外推。
- **文件操作**：单击已完成任务的文件名用系统默认应用打开；行尾按钮在文件管理器里定位。
  两者都走 DSH 的 `ctx.sessionController`，插件不 spawn 进程。
- **只显示文件名**：行标题只有文件名 + 后缀，目录 / 盘符 / 整行命令行一律不进 UI。
- **设置**：`progressSources`（字符串数组）与 `pollIntervalMs`（钳制 500–60000ms），
  经导出的 `Config`（Standard Schema）由 Loader 在装载期校验。

### 安全

- `GET /task-progress` 带浏览器信任围栏（回环 Host / `trustedHosts`；拒
  `Sec-Fetch-Site: cross-site`；`Origin` 须与 Host 同名或是桌面壳的 `dsh-app://app`）。
- `POST /task-progress/open` 在围栏之外再加一份**短时白名单**（TTL 10 分钟、上限 128 条），
  只认插件自己刚报告过的产物路径，白名单外一律 403。

### 说明

- 不依赖任何第三方插件：客户端只用 DSH 核心的 `ctx.slots`，宿主只用 `ctx.webServer`。
- host 产物零 import / 零 require；client 产物只 require `react`。
- 构建零依赖：`node tools/build.mjs` 是全部构建步骤，产物随仓库提交。

[1.0.0]: https://github.com/MorixMa/dsh-task-progress/releases/tag/v1.0.0
