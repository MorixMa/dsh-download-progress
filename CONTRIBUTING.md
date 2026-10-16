# 贡献指南

感谢你愿意花时间。这个仓库很小，规则也少，但有几条是硬的——它们来自 DSH 的加载契约，
不是风格偏好。

## 快速开始

```powershell
git clone https://github.com/MorixMa/dsh-download-progress.git
cd dsh-download-progress

node tools/build.mjs            # 构建 lib/（唯一构建步骤，零依赖）
node tests/verify-install.mjs   # 完整门禁（会顺带跑下面两个套件）
node tests/test-parsers.mjs     # host 逻辑单测
node tests/test-client.mjs      # client 冒烟（真跑产物）
```

不需要 `npm install` / `pnpm install`：**这个仓库没有依赖**。

想真机验证，用 `link:` 把它装进一个 DSH profile：

```powershell
# desktop profile 由 Electron 应用独占管理，请用应用内的插件管理器
# 其它 profile 可以直接用命令行：
dsh plugin --profile <名字> add link:<本仓库绝对路径>
```

## 硬性约束（改之前请先读）

### 1. host 产物必须零 import / 零 require

`src/host/` 里的碎片由 `tools/build.mjs` 直接拼成 `lib/index.js`，**源码里一条 `import`
都没有**。`link:` 安装时，host 产物里任何对宿主包的 import 都会在链接期失败，而 DSH
不会为此报错——插件只是**永远停在未激活状态**，排查成本极高。

需要 Node 内建模块时用全局函数 `process.getBuiltinModule('node:fs')`，
见 `src/host/00-runtime.js`。

### 2. client 产物只允许 require `react`

`lib/client.js` 是 `window.__ModuleLoader__.load({ id, factory })` 包装，`factory(require)`
里只能 `require("react")`（宿主自带）。**不依赖任何第三方插件**：Slot 服务经
`ctx.slots` 注入，HTTP 路由自己按页面基底解析（见 `src/client/05-route.js`）。
`tests/verify-install.mjs` 会断言 `require` 次数恰好为 1。

### 3. 产物随仓库提交，且必须与源码同步

`lib/` 是提交进去的。改了 `src/` 必须重新跑 `node tools/build.mjs`，
CI 会用 `git diff --exit-code -- lib` 抓「改了源码忘了构建」。

### 4. 包内不得有 `node_modules`

会破坏 pnpm 的 `link:` 安装。`.gitignore` 已挡住。

### 5. 面向 DSH 插件市场的约束

- `dependencies` / `peerDependencies` / `optionalDependencies` **一律不得出现 `cordis`**
  （本插件的 peer 只有可选的 `@deepseek-ai/dsh`）；
- `scripts` **不得含 install 类钩子**（`preinstall` / `install` / `postinstall`）；
- `package.json` 的 `dsh` 字段形状不要改：`dsh.bundle.patch` 指向 `cordis.patch.yml`，
  `dsh.client.platform` 为 `web`。

### 6. 不要在插件里 spawn 进程

打开文件与定位目录走 DSH 自己的宿主服务 `ctx.sessionController` 的
`openPath` / `revealPath`。新增任何有副作用的能力，请给它配一条**只认插件自己刚报告过的
路径**的短时白名单——`src/host/60-open.js` 是范例。

## 改动流程

1. 开分支：`feat/<主题>` 或 `fix/<主题>`；
2. 改 `src/`，**不要手改 `lib/`**（它是生成物）；
3. 跑 `node tools/build.mjs && node tests/verify-install.mjs`，必须 191 项全 OK、退出码 0；
4. 新增行为请**同时加断言**。这个仓库的测试是「拿源码碎片拼出同一个模块作用域来跑」，
   测的就是随包发布的那份代码，见 `tests/test-parsers.mjs` 顶部注释；
5. 提交信息用祈使句，说明**为什么**而不只是**做了什么**；
6. 开 PR，把门禁输出贴进描述。

## 报告问题

- **功能缺陷 / 想法**：用 issue 模板；
- **安全漏洞**：走 [SECURITY.md](./SECURITY.md) 的私密渠道，**不要**开公开 issue。

带上下面的信息会快很多：

- DSH 版本（`dsh --version`）与操作系统；
- `curl http://127.0.0.1:19387/download-progress` 的响应（它会带上 `raw` 字段，
  也就是解析器的输入原文——排查解析问题全靠它）；
- 你在面板里看到的、以及你期望看到的。

## 许可

贡献即表示你同意以 [MIT](./LICENSE) 许可发布你的贡献。
