/**
 * 「用系统默认应用打开」与「在文件管理器里定位」。
 *
 * ## 两条硬约束
 *
 * **① 不自己 spawn 进程。** DSH 已经有一套原生打开能力：宿主服务
 * `ctx.sessionController` 暴露 `openPath(path, signal)` / `revealPath(path, signal)` /
 * `canOpenPath()`（实现在 `@deepseek-ai/dsh-native-command` 的 `path-opener`，Windows 上
 * 走文件类型关联；`revealPath` 走 Explorer 定位）。`dsh-host-open-in-app` 的文档把这条
 * 路写得很清楚：「若只需从主机代码用系统默认应用打开一个路径，请用 … 的 `openPath`」。
 * 本插件只调这个服务，不 exec、不 spawn、不拼命令行。
 *
 * **② 只允许打开本插件刚刚报告过的文件。** 打开路由是 POST，但请求体里的 path 必须
 * 命中一份**短时白名单**——白名单由本插件采集任务时自己写入（见 40-tasks.js 的
 * `rememberOpenablePath`）。这样即使有人能发同源请求，也不能把这条路由当成
 * 「启动任意路径」的后门。白名单有 TTL，过期的条目自动失效。
 */

/** 白名单条目的存活时间。 */
const OPENABLE_TTL_MS = 10 * 60 * 1000
/** 白名单最多保留多少条（超出先淘汰最旧的）。 */
const OPENABLE_MAX = 128
/** 原生打开命令的期限。 */
const OPEN_TIMEOUT_MS = 20000
/** 打开路由接受的最大请求体。 */
const OPEN_BODY_LIMIT = 4096

/** path → 最近一次被报告的时间。 */
const OPENABLE_PATHS = new Map()

/**
 * 把一个文件路径记进白名单。采集任务时对每个已知产物调用一次。
 * @param {unknown} target - 绝对路径。
 */
function rememberOpenablePath(target) {
  const path = nonEmptyString(target)
  if (path === undefined) return
  const now = Date.now()
  for (const [key, at] of OPENABLE_PATHS) if (now - at > OPENABLE_TTL_MS) OPENABLE_PATHS.delete(key)
  OPENABLE_PATHS.set(path, now)
  if (OPENABLE_PATHS.size > OPENABLE_MAX) {
    const oldest = [...OPENABLE_PATHS.entries()].sort((left, right) => left[1] - right[1])
    for (const [key] of oldest.slice(0, OPENABLE_PATHS.size - OPENABLE_MAX)) OPENABLE_PATHS.delete(key)
  }
}

/**
 * 这个路径是不是本插件刚报告过的？
 * @param {unknown} target - 请求里的路径。
 * @returns {boolean} 是否在白名单内且未过期。
 */
function isKnownOpenablePath(target) {
  const path = nonEmptyString(target)
  if (path === undefined) return false
  const at = OPENABLE_PATHS.get(path)
  return at !== undefined && Date.now() - at <= OPENABLE_TTL_MS
}

/**
 * 取宿主的会话控制器（提供原生打开能力）。拿不到就返回 undefined，调用方据此隐藏按钮。
 * @param {any} ctx - host 上下文。
 * @returns {any} 服务或 undefined。
 */
function sessionControllerOf(ctx) {
  try {
    const controller = ctx.get('sessionController')
    if (controller === undefined || controller === null) return undefined
    if (typeof controller.openPath !== 'function' && typeof controller.revealPath !== 'function') return undefined
    return controller
  } catch {
    return undefined
  }
}

/**
 * 这个部署能不能用系统默认应用打开路径？
 * @param {any} ctx - host 上下文。
 * @returns {boolean} 可用性。
 */
function canOpenWithDesktop(ctx) {
  const controller = sessionControllerOf(ctx)
  if (controller === undefined) return false
  try {
    return typeof controller.canOpenPath === 'function' ? controller.canOpenPath() === true : true
  } catch {
    return false
  }
}

/**
 * 路径存在吗？只做 `stat`，不读内容。
 * @param {unknown} target - 绝对路径。
 * @returns {{ exists: boolean, isFile: boolean, isDirectory: boolean }} 文件系统事实。
 */
function statOf(target) {
  const fs = builtinModule('node:fs')
  const path = nonEmptyString(target)
  if (fs === undefined || path === undefined) return { exists: false, isFile: false, isDirectory: false }
  try {
    const info = fs.statSync(path)
    return { exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() }
  } catch {
    return { exists: false, isFile: false, isDirectory: false }
  }
}

/**
 * 执行一次打开动作。
 *
 * `signal` 是**必需**的：`revealNativePath` 第一行就是 `signal.throwIfAborted()`。
 * @param {any} ctx - host 上下文。
 * @param {'open'|'reveal'} action - 动作。
 * @param {string} target - 已通过白名单校验的绝对路径。
 * @returns {Promise<string>} `opened` 或 `revealed`。
 */
async function performOpenAction(ctx, action, target) {
  const controller = sessionControllerOf(ctx)
  if (controller === undefined) throw new Error('宿主没有提供原生打开能力（ctx.sessionController 缺失）')
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(OPEN_TIMEOUT_MS)
    : undefined
  if (action === 'reveal') {
    if (typeof controller.revealPath !== 'function') throw new Error('宿主服务不支持定位文件')
    await controller.revealPath(target, signal)
    return 'revealed'
  }
  if (typeof controller.openPath !== 'function') throw new Error('宿主服务不支持打开文件')
  await controller.openPath(target, signal)
  return 'opened'
}

/**
 * 读一个 JSON 请求体（带上限，避免一条请求把内存撑爆）。
 * @param {any} req - HTTP 请求。
 * @returns {Promise<any>} 解析后的 JSON；空体或超限时抛错。
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > OPEN_BODY_LIMIT) {
        reject(new Error(`请求体超过 ${OPEN_BODY_LIMIT} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') { resolve({}); return }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 造出打开路由的描述符。
 * @param {any} ctx - host 上下文。
 * @returns {{ kind: string, path: string, handler: (req: any, res: any) => Promise<void> }} 路由描述符。
 */
function createTaskProgressOpenRoute(ctx) {
  return {
    kind: 'exact',
    path: '/task-progress/open',
    /**
     * @param {any} req - HTTP 请求。
     * @param {any} res - HTTP 响应。
     */
    async handler(req, res) {
      if (!isTrustedRequest(req, trustedHostsOf(ctx))) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method-error', message: '只支持 POST' } })
        return
      }
      try {
        const body = await readJsonBody(req)
        const action = body?.action === 'reveal' ? 'reveal' : (body?.action === 'open' ? 'open' : undefined)
        if (action === undefined) throw new Error('action 必须是 open 或 reveal')
        const target = nonEmptyString(body?.path)
        if (target === undefined) throw new Error('path 必填')
        if (!isKnownOpenablePath(target)) {
          // 白名单是这条路由的全部授权：只有本插件自己刚报告过的产物能被打开。
          sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '这个路径不在本插件报告过的任务里' } })
          return
        }
        const info = statOf(target)
        if (!info.exists) {
          sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '文件已不在磁盘上' } })
          return
        }
        if (action === 'open' && !info.isFile) {
          sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: '目标不是文件' } })
          return
        }
        const outcome = await performOpenAction(ctx, action, target)
        sendJson(res, 200, { ok: true, value: { outcome } })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { ok: false, error: { code: 'internal-error', message } })
      }
    },
  }
}
