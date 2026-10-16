/**
 * dsh-download-progress —— client 半边入口。
 *
 * 只做一件事：把「下载与任务指示器」注册进 **DSH 自己的**会话头右侧工具区
 * （`conversation.session.header.utilities`）。这是宿主核心的 Slot，**不依赖任何
 * 第三方插件**——不再需要 better-sidebar 的注册表，也不再注册侧边栏 tab。
 *
 * 为什么是 `ctx.slots.inject(...)` 而不是 `ctx.effect(() => ctx.slots.register(...))`：
 * Slot 的 `inject` 本身就是 cordis 的注入作用域，注册返回的 disposer 由它持有并在
 * fiber 卸载时撤销。DSH 核心的 `@deepseek-ai/dsh-client-ui-jobs` 在同一个 slot 上就是
 * 这么写的（`id: 'job-list'`, `order: 20`）——照它写，不照凭空的写法写。
 *
 * `inject = ['slots']` 让 Cordis 在客户端 Slot 服务就绪后才激活本插件；没有它就
 * 什么都不注册，也不会报错。
 */

/** 挂载点：DSH 自己的会话头右侧工具区。 */
const SLOT_NAME = 'conversation.session.header.utilities'

/** 服务依赖：客户端 Slot 注册表（宿主核心提供）。 */
const inject = ['slots']

/**
 * 客户端插件主体。
 * @param {any} ctx - Web Client 根上下文。
 */
function apply(ctx) {
  installStyles(ctx)
  const slots = ctx.slots
  if (slots === undefined || slots === null) return

  ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
    name: SLOT_NAME,
    id: 'dsh-download-progress:indicator',
    // 该 slot 现有 order：open-in-app -10、session-log-download 0、
    // better-sidebar 的面板开关 10 —— 插在系统项与第三方项之间。
    order: 5,
    label: () => '任务进度',
  }, TaskProgressIndicator))
}
