/**
 * 宿主半边的运行时垫片。
 *
 * 自包含约束：本插件的 host 产物**不许有任何 import / require**（见 README
 * 「为什么 host 半边零 import」）。`link:` 安装下，任何对宿主包的静态 import
 * 都会让插件在链接期失败、而且 DSH 不报错，只是插件永远停在未激活状态。
 *
 * 但进度源回退分支（③）必须读磁盘。做法是用 Node 自带的
 * `process.getBuiltinModule()`（Node ≥ 22.3）：它是**全局函数调用**，不产生
 * import 记录，也不受解析器影响；拿不到时整条分支降级为"不可用"，绝不让宿主
 * 半边的链接期出问题。
 */

/** 内建模块缓存：一次解析，之后复用。 */
const BUILTIN_CACHE = new Map()

/**
 * 取一个 Node 内建模块。
 * @param {string} name - 形如 `node:fs` / `node:path` 的模块名。
 * @returns {any} 模块对象；运行时不支持 `getBuiltinModule` 时返回 undefined。
 */
function builtinModule(name) {
  if (BUILTIN_CACHE.has(name)) return BUILTIN_CACHE.get(name)
  let value
  try {
    const get = typeof process === 'object' && process !== null ? process.getBuiltinModule : undefined
    value = typeof get === 'function' ? get.call(process, name) : undefined
  } catch {
    value = undefined
  }
  BUILTIN_CACHE.set(name, value)
  return value
}

/**
 * 写出一个 JSON 响应。
 * @param {any} res - 响应对象（`node:http` 的 ServerResponse）。
 * @param {number} status - HTTP 状态码。
 * @param {unknown} body - 响应体（序列化为 JSON）。
 */
function sendJson(res, status, body) {
  let text
  try {
    text = JSON.stringify(body)
  } catch {
    text = '{"ok":false,"error":{"code":"encode-error","message":"响应无法序列化"}}'
    status = 500
  }
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/**
 * 把任意值收窄成有限数字。
 * @param {unknown} value - 待检查的值。
 * @returns {number|undefined} 有限数字，否则 undefined。
 */
function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 把任意值收窄成非空字符串。
 * @param {unknown} value - 待检查的值。
 * @returns {string|undefined} 去空白后的非空字符串，否则 undefined。
 */
function nonEmptyString(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 收窄到正的安全整数（用于字节数、毫秒数一类计数）。 */
function positiveInteger(value) {
  const number = finiteNumber(value)
  if (number === undefined || number <= 0) return undefined
  return Math.min(Math.floor(number), Number.MAX_SAFE_INTEGER)
}

/**
 * 读一个请求头（Node 会给出 string 或 string[]）。
 * @param {any} headers - `req.headers`。
 * @param {string} name - 小写头名。
 * @returns {string|undefined} 头值。
 */
function headerOf(headers, name) {
  const value = headers === undefined || headers === null ? undefined : headers[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

/**
 * 主机名是不是本机回环。
 * @param {string} hostname - URL 的 hostname。
 * @returns {boolean} 是否回环。
 */
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = String(hostname).split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Electron 桌面壳的应用页 origin。壳把 GUI 从 `dsh-app:` 方案送出，页面发起的请求
 * 因此带着这个 origin 而目标是 Host 的回环权威——按权威比对**必然不相等**。壳自己的
 * 请求转发器正好放行这一个非空 origin 并拒绝其余，所以这里也必须认它，否则桌面版
 * 面板会稳定 403。取值与 better-sidebar `src/trust-fence.ts` 的 `SHELL_APP_ORIGIN` 一致。
 */
const SHELL_APP_ORIGIN = 'dsh-app://app'

/**
 * 浏览器信任围栏——与 DSH `/api` 网关和 better-sidebar 的 `/sidebar/*` 同一条规则。
 *
 * 为什么本插件也要有：任务 label 常常就是**整行命令行**，可能带上 token、内网地址
 * 这类东西。路由本身是只读的，但只要有人把 GUI 反代到非回环地址上，没有围栏就等于
 * 把它公开了。
 *
 * 规则：`Host` 必须是回环或部署声明的 `trustedHosts`；跨站抓取（`Sec-Fetch-Site:
 * cross-site`）一律拒绝；浏览器带了 `Origin` 时，要么是桌面壳的应用 origin，要么其
 * hostname 与 Host 一致（比 hostname 不比 host——某些 Chromium 版本会省略非默认端口；
 * 字面量 `null` 是不透明 origin，拒绝）。
 *
 * @param {any} req - HTTP 请求。
 * @param {readonly string[]} trustedHosts - 部署声明的可信权威。
 * @returns {boolean} 是否放行。
 */
function isTrustedRequest(req, trustedHosts) {
  const headers = req === undefined || req === null ? undefined : req.headers
  const host = headerOf(headers, 'host')
  if (host === undefined) return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) {
    const trusted = Array.isArray(trustedHosts) ? trustedHosts : []
    const allowed = trusted.some(entry => {
      if (typeof entry !== 'string') return false
      try {
        return new URL(entry.includes('://') ? entry : `https://${entry}`).hostname === hostUrl.hostname
      } catch {
        return false
      }
    })
    if (!allowed) return false
  }
  if (headerOf(headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = headerOf(headers, 'origin')
  if (origin === undefined || origin === SHELL_APP_ORIGIN) return true
  if (origin === 'null') return false
  try {
    return new URL(origin).hostname === hostUrl.hostname
  } catch {
    return false
  }
}
