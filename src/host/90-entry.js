/**
 * dsh-task-progress —— host 半边入口。
 *
 * 挂两条路由到宿主 webServer：
 * - `GET  /task-progress`       只读状态（数据来自三路：dsh-ops/background 服务 →
 *                               宿主 `ctx.jobs` 注册表 → 配置的进度源文件）
 * - `POST /task-progress/open`  用系统默认应用打开产物 / 在文件管理器里定位它。
 *                               这条有副作用，所以带一份"只认本插件刚报告过的文件"
 *                               的短时白名单（见 60-open.js）。
 *
 * 依赖面刻意只有 `webServer` 一个硬依赖：`ctx.jobs`、`ctx.sessionController`（原生打开
 * 能力）、`ctx.webRuntime`（信任围栏）全部走 `ctx.get()` 可选读取——缺了哪个就少一块
 * 能力，插件照常工作，不静默变空。
 *
 * 导出面只有 `inject` / `Config` / `apply` 三个**命名**导出，没有 default：
 * 函数插件混用 default 会让 Loader 丢掉命名空间（DSH 源码树里的
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`）。
 */

/** webServer 只在 Web 宿主存在；没有它就没有可挂的路由。 */
const inject = ['webServer']

/**
 * 插件 host 主体。
 * @param {any} ctx - host 上下文。
 * @param {unknown} config - 装载行的 `config`；Loader 已用 `Config` 校验并规范化，
 *   这里再收窄一次，保证 `apply` 被直接调用（测试、其它组装）时同样安全。
 */
function apply(ctx, config) {
  const resolved = narrowConfig(config)
  ctx.effect(
    () => ctx.webServer.register(createTaskProgressRoute(ctx, resolved)),
    'dsh-task-progress: GET /task-progress',
  )
  ctx.effect(
    () => ctx.webServer.register(createTaskProgressOpenRoute(ctx)),
    'dsh-task-progress: POST /task-progress/open',
  )
  const logger = ctx.logger
  if (logger !== undefined && typeof logger.info === 'function') {
    const sources = resolved.progressSources.length
    const desktop = canOpenWithDesktop(ctx) ? '可用' : '不可用'
    logger.info(`dsh-task-progress: /task-progress 就绪（轮询 ${resolved.pollIntervalMs}ms，进度源 ${sources} 个，原生打开${desktop}）`)
  }
}
