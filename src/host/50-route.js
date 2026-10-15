/**
 * 只读状态路由 `GET /task-progress`。
 *
 * 契约（与 DSH 其它 JSON 路由一致的应答信封）：
 *   200 `{ ok: true, value: { generatedAt, pollIntervalMs, sources, tasks } }`
 *   403 非可信来源（浏览器信任围栏）
 *   405 `{ ok: false, error: { code: 'method-error', message } }`
 *   500 `{ ok: false, error: { code: 'internal-error', message } }`
 *
 * 这条路由**没有任何写路径**：不改文件、不杀任务、不推进任何游标。查询参数只认
 * `sessionId`（可选），用来把访问围栏设到某个会话上——不带时只能看见无主任务。
 *
 * 会写的那条（打开文件 / 定位文件夹）在 `60-open.js` 的 `POST /task-progress/open`，
 * 它有独立的白名单授权，与这条分开。
 */

/**
 * 部署声明的可信权威列表（浏览器信任围栏的第二个来源）。
 * @param {any} ctx - host 上下文。
 * @returns {readonly string[]} 可信 Host 列表；拿不到时空数组（于是只允许回环）。
 */
function trustedHostsOf(ctx) {
  try {
    const runtime = ctx.get('webRuntime')
    const hosts = runtime !== undefined ? runtime.trustedHosts : undefined
    return Array.isArray(hosts) ? hosts : []
  } catch {
    return []
  }
}

/**
 * 造出状态路由描述符。
 * @param {any} ctx - host 上下文。
 * @param {{ progressSources: string[], pollIntervalMs: number }} config - 收窄后的配置。
 * @returns {{ kind: string, path: string, handler: (req: any, res: any) => Promise<void> }} 路由描述符。
 */
function createTaskProgressRoute(ctx, config) {
  return {
    kind: 'exact',
    path: '/task-progress',
    /**
     * @param {any} req - HTTP 请求。
     * @param {any} res - HTTP 响应。
     */
    async handler(req, res) {
      if (!isTrustedRequest(req, trustedHostsOf(ctx))) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: { code: 'method-error', message: '只支持 GET' } })
        return
      }
      try {
        const url = new URL(req.url ?? '/task-progress', 'http://dsh.internal')
        const value = collectTasks(ctx, config, url.searchParams.get('sessionId') ?? undefined)
        sendJson(res, 200, { ok: true, value })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { ok: false, error: { code: 'internal-error', message } })
      }
    },
  }
}
