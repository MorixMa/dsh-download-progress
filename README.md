# dsh-task-progress

**DSH 任务进度指示器** —— 会话头里一个常驻的下载图标（Chrome 下载按钮那种），自动发现
正在跑的后台任务与下载任务，用环形进度、动画进度条、速率和预计剩余时间实时呈现。

> **English**: A download-style task-progress indicator for
> [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness): a persistent
> icon in the session header that discovers running background jobs and downloads on its own,
> and renders them as a progress ring, animated bars, transfer speed and ETA.
> Full English documentation: **[README.en.md](./README.en.md)**.

[![License: MIT](https://img.shields.io/badge/License-MIT-334EAC.svg)](./LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1%20%3C0.2.1-081F5C.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.3-7096D1.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-2ea043.svg)](#八开发)
[![CI](https://github.com/MorixMa/dsh-task-progress/actions/workflows/ci.yml/badge.svg)](https://github.com/MorixMa/dsh-task-progress/actions/workflows/ci.yml)

---

## 它解决什么

后台任务跑起来之后，你只能盯着终端或者反复问模型「下完了没」。这个插件把那个问题变成
**一眼可见**：会话头右上角一个图标，有任务在跑时外圈亮起环形进度弧、右下角出现数量角标；
点开是一份任务清单，每条一行动画进度条。下载完了，点一下文件名就能打开。

它**不启动任务、不杀任务、不写文件**——是一个纯粹的观察者（唯一的例外是「打开文件 /
打开文件夹」，那需要你明确点击，而且只对面板上正在显示的那几个文件生效）。

## 特性

- **零第三方插件依赖**：客户端的 Slot 注册表与宿主的 webServer 都是 DSH 核心能力。
  `dsh-better-sidebar` 之类的插件装没装都不影响它。
- **零运行时依赖**：`package.json` 里 `dependencies` 是空的，包内不含 `node_modules`。
- **零构建依赖**：`node tools/build.mjs` 就是全部构建步骤，产物随仓库提交，
  安装端不需要构建。
- **只显示文件名**：界面里没有目录、没有盘符、没有整行命令行。
- **真实数据、绝不编造**：源里没写速率就不显示速率；用两帧差分算出真实速率与剩余时间，
  任务卡住时停止外推而不是一直显示一个旧值。
- **能读真实下载器的输出**：curl `--progress-bar`（`\r` 刷新的进度表）、
  wget（`45%[===>  ] 7.98M 1.21MB/s eta 8s`）、aria2、各类 `已传输 x / y` 写法。

---

## 一、安装

### 从 GitHub 安装

```powershell
dsh plugin --profile <profile 名> add github:MorixMa/dsh-task-progress
```

产物（`lib/`）随仓库提交，所以安装端**不需要**跑构建，也不需要联网装依赖。

### 从本地目录安装（开发）

```powershell
dsh plugin --profile <profile 名> add link:<本仓库绝对路径>
```

> `desktop` profile 由 Electron 应用独占管理，命令行会被设计性拒绝
> （`error: profile "desktop" is managed exclusively by the Electron application`）。
> 那个 profile 请用应用内插件管理器，填同一个 `github:` 或 `link:` 规格。

装完**需要重启 DSH**（host 半边要重新装载），然后硬刷新页面（Ctrl+Shift+R）。
会话头右上角就会出现下载图标。

卸载与逐步验证见 [INSTALL.md](./INSTALL.md)。

---

## 二、界面

### 图标（常驻）

| 状态 | 样子 |
|---|---|
| 空闲 | 灰化的下载图标，无角标 |
| 有任务在跑 | 图标外圈一条**环形进度弧**，平滑推进（`stroke-dashoffset` 过渡 0.55s）；右下角一个蓝色数量角标，带缓慢呼吸动画 |
| 进度未知（源里没有百分比） | 环变成**旋转 + 伸缩的走马灯弧** |
| 只剩失败任务 | 角标转红，显示失败数 |

### 弹层（点一下）

- 顶部：标题「下载与任务」+ `N 个运行中`，下面一条**总览进度条**与聚合数字
- 列表：每条一行——
  - **只有文件名 + 后缀**（`live-ls-lR.gz`）。下载位置、目录、盘符、整行命令行一律
    不进 UI——连鼠标悬浮的 title 里都没有
  - 动画进度条：运行中时有一道**扫光**从填充段掠过；未知进度是**走马灯斜纹**；完成转绿、失败转红
  - 数字行：`100% · 36.71 MB / 36.71 MB · 48.1 MB/s`
  - 刚完成的任务会**绿色闪一下**再落回静默态
- **文件操作**（宿主有原生打开能力时才出现）：
  - **单击文件名 → 用系统默认应用打开它**（只在任务已完成、且文件确实在盘上时可点——
    避免点开一个半截文件）
  - **行尾的文件夹图标 → 在资源管理器里定位**（任务还在跑也能点）
  - 结果反馈显示在弹层底部一行状态里
- 底部：最后刷新时间、可用数据源数量、手动「刷新」

所有动画在 `prefers-reduced-motion: reduce` 下自动关闭。

### 关于「不显示 markdown」

界面**不渲染源里的原文**。进度块（长得像 markdown 的那种）只作为**数据**被解析成
条 / 数字 / 速率；原文仍留在 host 响应的 `raw` 字段里，方便 `curl` 排查，但一行都不会
出现在 UI 上。

### 文件名与路径是两条线

| | 用在哪 | 从哪来 |
|---|---|---|
| `fileName` | **给人看**，就是那一行标题 | 产物路径的 basename → 进度块行首的 wget 式文件名 → 进度源写的 label → 被**擦掉所有本地路径**的命令行首行 |
| `filePath` | **不显示**，只用于"打开 / 定位" | 命令行里的 `-o` / `--output` / `-OutFile` 开关；认不到就退回最后一个非脚本绝对路径 |

路径解析带两条防误判：`(?<![A-Za-z0-9])` 让 `https://…` 里的 `s://` 不被当成盘符；
POSIX 分支的 `(?<![\w:/])` 让 URL 里切不出 `/host/a/b.gz` 来。

---

## 三、数据从哪来

按固定优先级看三个来源，并在空态里如实报告每个来源的可用性：

| 顺序 | 来源 | 说明 |
|---|---|---|
| ① | `dsh-ops/background` | **结构探测**：找到发布 `list()` 的服务就用，找不到就报「未发布服务扩展点」。详见「已知限制」 |
| ② | DSH 后台任务 | 宿主 `ctx.jobs` 注册表（`@deepseek-ai/dsh-jobs-local`）。按会话读，读的是**非消耗**接口 `list()` + `readAt()`——不移动模型自己的 `job_output` 游标，也不触发任何完成通知 |
| ③ | 进度源文件 | 配置项 `progressSources` 里的绝对路径。文件按扩展名解析；目录**浅扫描**一层，取 `*.md / *.markdown / *.txt / *.json / *.jsonl / *.progress` |

### 支持的进度写法

**进度块**（多行文本逐行抽取，后出现的字段覆盖先出现的）：

```
# 字体包下载
进度 ██████░░░░ 11/47 (23%)
体积 90.0 MB / 100.0 MB
速度 0.42 MB/s
剩余 00:02:31
```

认得的东西：百分比（`23%` / `(23%)`）、比例（`11/47`）、进度条（`██████░░░░`、
`[####------]`）、字节数（`90.0 MB` / `1.2GiB` / `94371840 B`）、速率（`0.42 MB/s` /
`512 KBps` / `3 MiB per second`）、剩余时间（`00:02:31` / `1m30s` / `2 分 31 秒`）。
标签取标题行 / `**加粗**` / 第一行无指标的文本。

**通用 JSON**：

```json
{ "label": "模型权重", "total": 47, "done": 11, "bytes": 94371840, "bytesTotal": 104857600, "speed": 440401, "eta": 24000 }
```

也接受 `{ "tasks": [ … ] }` 数组形态（一个文件携带多项任务）与顶层数组。
`eta` 是毫秒数或时长字符串。

**不猜**：源里没写速率就不显示速率（而不是显示 0）。速率与剩余时间的兜底来自
**两帧差分**——客户端记住上一次的字节数，用 `Δ字节 / Δ时间` 算出真实速率（指数滑动
平均 α=0.4 压抖动），再用 `剩余字节 ÷ 速率` 推剩余时间。同一个任务连续三次没有增量
就停止外推（任务卡住时不会一直显示一个旧速率）。

---

## 四、配置

配置落在插件 Loader 行的 `config:` 上。默认值写在插件自带的
[cordis.patch.yml](./cordis.patch.yml) 里，也可以写在 profile 的 patch 层里。

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `progressSources` | `string[]` | `[]` | 进度源路径（绝对路径）。目录浅扫描一层 |
| `pollIntervalMs` | `number` | `1500` | 客户端拉取间隔，钳制在 500–60000 |

```yaml
- id: task-progress
  name: dsh-task-progress
  config:
    progressSources:
      - 'D:\字体_进度.md'
      - 'D:\downloads\progress'
    pollIntervalMs: 1500
```

> **改了必须重启 DSH。** 配置在插件装载时被读一次并收窄；改了 `config` 会让 Loader
> 重挂这一行，正在跑的 host 半边不会热更新。

### 关于「设置页里的表单」

`ctx.settings.register(ns, schema)` 在 **DSH 0.1.7 起已经整体删除**。替代品是宿主
`SettingsForms`：**命名空间 = 插件 Loader 行的 entry id（这里是 `task-progress`），
表单 schema = 插件模块导出的 `Config`**。本插件照这条规则导出了 `Config`，Loader 的
装载期校验认它。

代价说清楚：`Config` 用的是 **Standard Schema** 形状，不是宿主内建的 schemastery
形状。前者能被 Loader 正常校验（插件照常装载、`config` 照常生效），但宿主设置页**不会**
为它生成自动表单——Inspect 的 Config 通道里本条目显示 `unsupported`。

不换 schemastery 的原因是硬约束：host 产物**零 import / 零 require**，而
`@deepseek-ai/schemastery` 在 `link:` 安装下从插件目录解析不到（Node 走软链 realpath，
往上没有 `node_modules/@deepseek-ai`）。两者不可兼得，这里选了"插件一定能装上"。

---

## 五、故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 会话头里没有下载图标 | 客户端半边没加载。确认 `dsh.profile.bundles` 里有 `dsh-task-progress`，然后**硬刷新**（Ctrl+Shift+R）；还不行就重启 DSH |
| 图标在，点开报「读取任务进度失败：Failed to fetch」 | host 半边的路由没挂上，**重启 DSH**。host 半边改动一律要重启才生效 |
| 报「路由返回 HTTP 403」 | 信任围栏拦下了。桌面版正常不会出现（`dsh-app://app` 已放行）；出现说明请求来自别的源，或 GUI 被反代到了非回环地址——后者需要把该权威加进部署的 `trustedHosts` |
| 一直「现在没有运行中的任务」 | 弹层空态里会列出每个来源为什么是空的 |
| 进度条一直是走马灯（未知进度） | 该任务的输出里没有可识别进度。`curl "http://127.0.0.1:19387/task-progress"` 看那条任务的 `raw` 字段 |
| 速率一直是空 | 源没写速率，而且两次拉取之间字节数没变（差分没有基线）。需要 2 个采样点 |
| 进度条停在某个数字不动 | 正常——进度来自源；源不更新就不会动。看弹层底部的「刷新于」确认轮询还活着 |
| 解析出来的数字不对 | 对照上面「支持的进度写法」；要么改源，要么提 issue 带上那几行原文 |

---

## 六、已知限制

- **`dsh-ops/background` 目前没有服务扩展点**。它的 `dsh` 组件只注册
  `run_background` / `job_output` / `job_list` / `job_kill` 四个工具，不 `provide`
  任何 cordis 服务，所以来源 ① 在本机上是"不可用"（空态里会写明）。这一格保留了结构
  探测：一旦它（或别的插件）发布带 `list()` 的服务，立刻会用上，不必改代码。真正的
  数据来自来源 ②。
- **指示器只在会话头**。打开会话（对话页）时可见；纯设置页 / 空态没有会话头，图标不在。
  想要**全屏常驻**的浮层版本，把 `src/client/90-entry.js` 的 `SLOT_NAME` 换成
  `shell.overlay` 即可（`shell.overlay` 是根作用域的浮层，那份 slot 的说明里明确写着
  "a badge, a toast stack or a status pill all belong here"）——代价是它不带 `sessionId`，
  会退化成不带会话围栏的全局视图。
- **图标是常驻的**，不是"有任务才出现"。空闲时它只是灰着不碍事。
- **DSH 自己的内部任务也会出现在列表里**。面板列的是 `ctx.jobs` 名册的**全部**内容——
  包括它的常驻 PowerShell/POSIX 会话（名字是那行命令的首行，例如
  `$ErrorActionPreference='SilentlyContinue'`），它没有可识别进度，所以显示为"未知进度"
  的走马灯条。DSH 自己的任务抽屉里同样列着它们。觉得吵的话可以在
  `src/host/40-tasks.js` 的 `collectJobTasks` 里按 `kind` 过滤，但那属于按喜好筛选，
  默认不替用户决定。
- **进度源目录只浅扫描一层**，不递归。
- **进度源文件最多读 256 KB 的尾部**；超过时丢掉可能被截断的首行。
- **任务输出最多回读 8 KB 尾部**（进度行几乎总在末尾）。
- 一次响应最多 64 条任务；结算超过 2 分钟的任务不再显示。
- **不杀任务、不写文件、不推进任何游标**——没有任何写路径。
- 不做 i18n：UI 文案固定中文。

---

## 七、安全

### 两条路由，两种权限

| 路由 | 副作用 | 授权 |
|---|---|---|
| `GET /task-progress` | **无**（不改文件、不杀任务、不推游标） | 浏览器信任围栏 |
| `POST /task-progress/open` | 会让宿主用系统默认应用打开一个文件 / 在资源管理器里定位它 | 信任围栏 **+ 白名单** |

围栏规则（与 DSH `/api` 网关同款）：`Host` 必须是回环或部署声明的 `trustedHosts`；
`Sec-Fetch-Site: cross-site` 一律拒绝；带 `Origin` 时必须是桌面壳的 `dsh-app://app`
或与 Host 同名。非可信 Host 返回 **403**。

### 打开路由的白名单

**只认本插件自己刚报告过的文件。** 采集任务时把每个已知产物的绝对路径写进一份
**10 分钟 TTL、最多 128 条**的白名单；`POST /task-progress/open` 收到的 `path` 不在
白名单里一律 **403**，连 `stat` 都不做。

这条设计的意义：即使有人能发同源请求，也不能把这条路由当成「启动任意路径」的后门——
他只能打开面板上此刻正在显示的那几个文件。

### 不自己 spawn 进程

打开与定位走 DSH 自己的原生能力：宿主服务 `ctx.sessionController` 的
`openPath(path, signal)` / `revealPath(path, signal)` / `canOpenPath()`
（实现在 `@deepseek-ai/dsh-native-command` 的 `path-opener`）。**本插件不 exec、不 spawn、
不拼命令行**。宿主没有这个服务时（非桌面部署），面板上两个按钮直接不出现，而不是点了报错。

### 关于围栏的边界

**围栏是这两条路由唯一的门。** 实测 DSH 的 web token 只作用于它自己的 `/api*`
（`GET /api/modules` 无 token → 401，插件注册的 `GET /task-progress` → 200），所以任何
**本机**进程都能读到任务列表。这是平台约定；不想要就别装。

---

## 八、开发

```powershell
node tools/build.mjs            # 构建 lib/（唯一构建步骤，零依赖）
node tests/test-parsers.mjs     # host 逻辑单测（解析器 / 围栏 / 三路合成 / 进度源）
node tests/test-client.mjs      # client 冒烟（ModuleLoader + React 替身真跑产物）
node tests/verify-install.mjs   # 门禁：上面两个套件 + 安装/产物/dsh 字段检查
```

### 源码结构

```
src/host/    00-runtime.js  →  内建模块垫片 + JSON 应答 + 信任围栏
             10-config.js   →  Config（Standard Schema）+ 收窄
             20-parse.js    →  进度解析（进度块 / 通用 JSON）
             30-sources.js  →  进度源文件扫描
             40-tasks.js    →  三路数据合成任务列表
             50-route.js    →  GET /task-progress
             90-entry.js    →  apply / inject
src/client/  00-format.js   →  数字格式化（中文）
             05-route.js    →  宿主路由 URL 解析（壳传输基底 / baseURI）
             10-sampler.js  →  两帧差分 + 聚合
             20-styles.js   →  CSS + 全部 @keyframes
             30-view.js     →  图标 / 弹层 / 任务行（React.createElement）
             90-entry.js    →  ctx.slots 注册
tools/build.mjs              →  碎片拼接（零依赖构建）
```

碎片按文件名编号装载，共享同一个模块作用域——所以**源码里一条 `import` 都没有**。

### 为什么 client 只有 react 一条 require

client 产物是 `window.__ModuleLoader__.load({ id, factory })` 包装，`factory(require)` 里
只 `require("react")`（宿主自带）。**一个第三方插件都不 require**：Slot 服务经
`ctx.slots` 注入，HTTP 路由自己按传输基底解析。`dsh.client.inject` 因此只需声明
`@deepseek-ai/dsh-client-ui-slots` 一个包做装载排序。

### 为什么 host 半边零 import

`link:` 安装下，host 产物里任何对宿主包的 import 都会在**链接期**失败，而 DSH 不会
为此报错：插件只是永远停在未激活状态。所以 host 产物**零 import / 零 require**，
Node 内建模块经全局函数 `process.getBuiltinModule()` 取；运行时不支持它时（Node < 22.3）
只有「进度源文件」这一路降级为不可用，插件照常启动。

### 为什么不用打包器

两个产物、零依赖、没有 JSX（用 `React.createElement`）。`tools/build.mjs` 就是
"按固定顺序拼接 + 套一层 ModuleLoader 包装"，可读、可复现，也省掉一整套
`devDependencies`——而"包内不得有 node_modules"这条硬约束让打包器的收益进一步归零。

---

## 许可

MIT
