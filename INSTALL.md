# 安装与验证

本文件给的是**可直接复制执行**的步骤（Windows / PowerShell）。

> 本文里的 `<仓库绝对路径>` 指本仓库在你机器上的位置，例如
> `D:\code\dsh-download-progress`；`<DSH_HOME>` 通常是你自己的 `~\.dsh`。
> 示例脚本在仓库的 [`examples/`](./examples/) 里。

所有命令里的 profile 名以 `desktop` 为例（那是最常见的宿主），插件目录即
`<仓库绝对路径>`。换成别的 profile 名照样成立。

---

## 0. 前置

| 项 | 要求 |
|---|---|
| DSH | 0.2.0-rc.2（`@deepseek-ai/dsh` peer 锚定 `>=0.2.0-rc.1 <0.2.1`） |
| Node | ≥ 22.3（host 半边用 `process.getBuiltinModule` 取 Node 内建模块；更低版本只有"进度源文件"这一路降级） |
| 配套插件 | **无**。本插件只用 DSH 核心的 `ctx.slots`（客户端）与 `ctx.webServer`（宿主），不依赖任何第三方插件 |
| 产物 | 已随包构建（`lib/index.js` + `lib/client.js`）。**不需要**你跑构建 |

确认前置：

```powershell
node --version
Test-Path '<仓库绝对路径>\lib\client.js'
```

> `dsh` 命令不在 PATH 上（desktop profile 由 Electron 应用独占管理，见 §1.1），
> 所以这里不列 `dsh --version`。

---

## 1. 安装

### 1.1 desktop profile 的安装入口（**重要**）

DSH 0.2.0-rc.2 把 `desktop` profile 划给 Electron 应用独占管理。在终端里直接跑
`dsh plugin --profile desktop ...` 会被**设计性拒绝**：

```
$ dsh plugin --profile desktop list
error: profile "desktop" is managed exclusively by the Electron application
```

源码位置：`@deepseek-ai/dsh/lib/bin.js` 的 `rejectElectronProfile()`——它只在
`manageDesktopProfile` 为真时放行，而这个标志只有桌面应用自带的插件管理器
（`@deepseek-ai/dsh-plugin-manager`）会传。命令行本身是好的：

```
$ dsh --version
0.2.0-rc.2
```

**所以 desktop profile 请走应用内的插件管理器**，它执行的正是同一条
`runPlugin(profile, args, packageManager)` 路径（也就是 `dsh plugin` 的实现），产出的
结果逐字一致：`dependencies` 加一条、`dsh.profile.bundles` 追加一项。

| 入口 | 做法 |
|---|---|
| **AI 助手（本会话）** | 调用 `plugin_manager` 工具，`action: install_bundle`，`target: link:<仓库绝对路径>` |
| **DSH GUI** | 「设置 → 插件」里的插件管理器，安装入口填同一个 `link:` 规格 |
| **其它 profile（非 desktop）** | 终端直接 `dsh plugin --profile <名字> add link:<仓库绝对路径>` |

> 有人问「我能不能自己改 profile 的 `package.json` 绕过它」——可以，但**不推荐**：
> 你还要自己跑一次 `pnpm install` 建软链，而且漏了任何一半（依赖或 bundles）都会
> 得到"装了但没生效"。本插件不依赖任何手工改动。

### 1.2 这条命令做了什么

1. 在 `<DSH_HOME>\profiles\desktop\package.json` 的 `dependencies` 里写入
   `"dsh-download-progress": "link:<仓库绝对路径>"`；
2. 把 `dsh-download-progress` 追加进同一个文件的 `dsh.profile.bundles` 数组（**末尾**，
   在 `dsh-better-sidebar` 之后）；
3. 在 profile 目录里跑 pnpm 安装，把软链建到 `profile\node_modules\dsh-download-progress`。

**实测输出**（`installed` + `enabled`，`exitCode: 0`）：

```
dependencies:
+ dsh-download-progress link:<仓库绝对路径>
Done in 1.6s using pnpm v11.7.0
```

---

## 2. 重启 DSH（**必需**）

host 半边（路由 `/download-progress`）是在插件装载时注册的，**必须重启 DSH** 才生效。
客户端半边会随页面重新拉取，重启后**硬刷新浏览器**（Ctrl+Shift+R）最稳妥。

---

## 3. 验证

### 3.1 自检脚本

```powershell
cd <仓库绝对路径>
node tests\verify-install.mjs
```

期望：逐行 `OK`，最后一行 `全部安装自检通过。`，退出码 0。
（任一 `FAIL` 都会打印失败项并以退出码 1 结束。）

### 3.2 路由通不通

```powershell
curl.exe -s "http://127.0.0.1:19387/download-progress" | ConvertFrom-Json | Select-Object -ExpandProperty value | Select-Object generatedAt, pollIntervalMs
```

期望拿到 `{ ok: true, value: { … } }` 信封。**404** = host 半边没装上（回去看第 2 步
是否真的重启了）；**403** = 信任围栏拦下（见 README 第七节）；**500** = 装载成功但
采集时抛错，错误原文在响应体的 `error.message` 里。

### 3.3 会话头的图标

1. 打开任意一个会话（对话页）；
2. 看**会话头右上角**——「导出会话日志」图标与 better-sidebar 的面板开关之间，
   应该有一个**下载图标**；
3. 点它，弹出「下载与任务」面板；
4. 底部状态行每约 1.5 秒更新一次「刷新于 HH:MM:SS」。

打开开发者工具（Ctrl+Shift+I）确认 **Console 没有未捕获异常**。图标在没任务时是灰的、
没有角标；一旦有任务在跑，外圈会出现环形进度弧、右下角出现蓝色数量角标。

### 3.4 让它显示一个真实进度

最省事的办法：起一个会打印进度块的后台任务。

```powershell
pwsh -File <仓库绝对路径>\examples\demo-download.ps1 -Steps 600 -DelayMs 1000
```
（在 DSH 里就是让助手跑这条命令并放到后台；脚本每步打印一块进度，共 10 分钟。）

或者让它读一个进度文件：

```powershell
@'
# 字体包下载
进度 ██████░░░░ 11/47 (23%)
体积 90.0 MB / 100.0 MB
速度 0.42 MB/s
剩余 00:02:31
'@ | Set-Content -Encoding UTF8 '<工作目录>\demo-progress.md'
```

然后把这个路径写进 profile 的 patch 层 —— `<DSH_HOME>\profiles\desktop\cordis.patch.yml`
（按 Loader 行 id 寻址的覆盖层，追加在文件末尾即可）：

```yaml
- id: download-progress
  name: dsh-download-progress
  config:
    progressSources:
      - '<工作目录>\demo-progress.md'
    pollIntervalMs: 1500
```

重启 DSH，图标亮起，点开就会看到一条「字体包下载」的任务，进度条 23%、`11 / 47`、
`90.0 MB / 100.0 MB`、`430 KB/s`、`剩余 2 分 31 秒`。

> **回滚这一处配置**：把 `progressSources` 改回 `[]`（或整段 `config:` 删掉）即可，
> 插件本身不受影响。

### 3.5 轮询会不会泄漏

指示器是**常驻**的（图标上的环形进度要一直准），所以打开会话时它按服务端下发的
`pollIntervalMs` 一直轮询；**离开会话 / 卸载插件即停**。验证方式：

1. 开发者工具 → Network，过滤 `download-progress`：应有每约 1.5 秒一条；
2. 切到一个没有会话的页面（或切换会话）→ 请求应停止/换到新会话。

（卸载时 `AbortController.abort()` + `clearTimeout`，见 `src/client/30-view.js` 的轮询 effect；
会话切换由 `useEffect` 的 `[sessionId, attempt]` 依赖触发重建。）

---

## 4. 卸载（一条命令）

| 入口 | 做法 |
|---|---|
| **AI 助手（本会话）** | `plugin_manager` 工具，`action: remove_bundle`，`target: dsh-download-progress` |
| **DSH GUI** | 「设置 → 插件」里把本插件移除 |
| **其它 profile（非 desktop）** | 终端 `dsh plugin --profile <名字> remove dsh-download-progress` |

它会从 `dependencies` 与 `dsh.profile.bundles` 里摘掉本插件并跑一次 pnpm。
**插件目录本身不会被删**——那是你的源码：

```powershell
Remove-Item -Recurse -Force '<仓库绝对路径>'
```

**实测**：卸载后 profile 的 `package.json` 里 `dsh-download-progress` 出现次数为 **0**，
依赖回到 13 条、bundles 回到 16 条，`pnpm-lock.yaml` 与 `node_modules/.modules.yaml`
都没有残留，正在跑的 host 半边随即卸载（`GET /download-progress` 从 200 变 **404**），
DSH 全程没有重启也没有报错。

> ⚠️ **一处残留**：`node_modules\dsh-download-progress` 这条**软链**可能不被 pnpm 清掉
> （`link:` 协议在 `nodeLinker: hoisted` 下的行为）。它是惰性的——profile 清单里已经
> 没有它，DSH 不会装载它——但想彻底干净就手动删掉：
>
> ```powershell
> Remove-Item '<DSH_HOME>\profiles\desktop\node_modules\dsh-download-progress' -Force
> ```
>
> （这是**软链**，`Remove-Item` 不带 `-Recurse` 只删链接本身，不会动
> `<仓库绝对路径>`。）

> 若你按 §3.4 改过配置，卸载时插件那一行会一并消失（Bundles 层不再合并它的 patch，
> profile 自己的 patch 层里那条同 id 的覆盖行也就成了孤儿）。孤儿行不影响启动——
> DSH 的 Loader 对找不到对应包的 `-- id:` 行只会记一条警告。

---

## 5. 本次安装实际改动的文件（含回滚）

| 文件 | 改动 | 回滚 |
|---|---|---|
| `<DSH_HOME>\profiles\desktop\package.json` | `dependencies` 增加一条 `link:`；`dsh.profile.bundles` 追加 `dsh-download-progress` | `plugin_manager` → `remove_bundle dsh-download-progress` |
| `<DSH_HOME>\profiles\desktop\pnpm-lock.yaml` | pnpm 自己维护，随上一条命令一起回退 | 同上 |
| `<DSH_HOME>\profiles\desktop\node_modules\dsh-download-progress` | 指向插件目录的软链 | 同上（自动删，偶有残留见 §4） |
| `<DSH_HOME>\profiles\desktop\cordis.patch.yml` | **不动**（本插件自带 patch，由 bundle 层合并） | — |

插件目录内不含 `node_modules`，所以 `link:` 安装不会把依赖树带进 profile。
