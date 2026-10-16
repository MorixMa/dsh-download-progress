/**
 * 宿主 HTTP 路由的 URL 解析。
 *
 * ## 最容易踩的一脚：HTTP 和 WebSocket 用的**不是同一个基底**
 *
 * - **HTTP 走页面基底 `document.baseURI`。** 桌面壳把 GUI 从 `dsh-app://app/` 送出，
 *   而壳的 `protocol.handle` 会把 `dsh-app://app/<非静态路径>` **同源转发**给宿主——
 *   所以 `dsh-app://app/download-progress` 会真的打到宿主的 `/download-progress` 上。
 * - **不能走壳注入的 `__DSH_TRANSPORT__.streamBaseUrl`。** 它是宿主的**真实 origin**
 *   （`http://127.0.0.1:<port>`），与页面 `dsh-app://app` **不同源**；而宿主上插件注册
 *   的路由不返回任何 `Access-Control-Allow-*` 头，浏览器会在 CORS 检查上直接拒掉，
 *   表现成 `TypeError: Failed to fetch`（不是任何一个 HTTP 状态码）。
 *   实测该路由的响应头确实只有 `content-type` / `cache-control` / `Vary` / `Date` /
 *   `Connection`，没有任何 CORS 头。
 *
 * `streamBaseUrl` 只用于 **WebSocket**：自定义 scheme 承载不了 `ws:`，而
 * `dsh-app://app` 的 host 是字面量 `app`，DNS 永远解析不出来。本插件不开 socket。
 *
 * `document.baseURI` 同时带着反代子路径前缀（`https://host/dataops/proxy/3080/`），
 * 一条规则覆盖「桌面壳」与「反代子路径」两种部署。**绝不写前导斜杠**——带上它就会
 * 甩掉前缀钉到源站根。
 */

/**
 * 宿主 HTTP 路由的基底 URL。
 * @returns {string} 可用作 `new URL(path, base)` 第二参的基底。
 */
function taskProgressBase() {
  try {
    if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI !== '') {
      return document.baseURI
    }
  } catch {
    // 落到传输基底
  }
  // 非 DOM 环境（SSR / 单测）才退回传输基底；真实浏览器里这一支永远不该被走到。
  try {
    const transport = globalThis.__DSH_TRANSPORT__
    if (transport !== null && typeof transport === 'object') {
      const base = transport.streamBaseUrl
      if (typeof base === 'string' && base !== '') return base
    }
  } catch {
    // 落到 '/'
  }
  return '/'
}

/**
 * 把基底归一化成"目录基底"：去掉 query（启动令牌挂在上面）与 hash，再补结尾斜杠。
 *
 * 为什么必须补：`https://host/dataops/proxy/3080` 这种**没有结尾斜杠**的目录 URL，
 * 用 `new URL('download-progress', base)` 会按"替换最后一段"处理，得到
 * `/dataops/proxy/download-progress`——前缀里的 `3080` 就没了。better-sidebar 的
 * `directoryBase()` 就是这么处理的。
 *
 * 唯一的例外：基底看起来指向**文件**（最后一段带 `.`，如 `dsh-app://app/index.html`），
 * 那时保留原样——相对解析替换掉文件名才是对的。
 * @param {string} base - 原始基底。
 * @returns {string} 目录基底。
 */
function taskProgressDirectoryBase(base) {
  let url
  try {
    url = new URL(base === '' ? 'http://dsh.internal/' : base, 'http://dsh.internal/')
  } catch {
    return '/'
  }
  url.search = ''
  url.hash = ''
  const last = url.pathname.split('/').pop() ?? ''
  if (!url.pathname.endsWith('/') && !last.includes('.')) url.pathname += '/'
  return url.href
}

/**
 * 拼一条本插件 host 路由的绝对 URL。
 * @param {string} route - 相对路由（**无前导斜杠**）。
 * @param {string|undefined} sessionId - 会话 id（可选）。
 * @returns {string} 绝对 URL。
 */
function taskProgressUrl(route, sessionId) {
  let url
  try {
    url = new URL(route, taskProgressDirectoryBase(taskProgressBase()))
  } catch {
    url = new URL(`/${route}`, 'http://127.0.0.1')
  }
  if (typeof sessionId === 'string' && sessionId !== '') url.searchParams.set('sessionId', sessionId)
  return url.href
}

/**
 * 状态路由 `GET /download-progress` 的绝对 URL。
 * @param {string|undefined} sessionId - 当前会话，用来把访问围栏设到该会话。
 * @returns {string} 绝对 URL。
 */
function taskProgressRouteUrl(sessionId) {
  return taskProgressUrl('download-progress', sessionId)
}

/**
 * 打开路由 `POST /download-progress/open` 的绝对 URL。
 * @returns {string} 绝对 URL。
 */
function taskProgressOpenUrl() {
  return taskProgressUrl('download-progress/open', undefined)
}

