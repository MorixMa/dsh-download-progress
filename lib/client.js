// dsh-download-progress —— client 半边（由 tools/build.mjs 生成，请勿手改）。
// 宿主模块（react）走 require 外部引用，不打包进产物。
window.__ModuleLoader__.load({
	id: "dsh-download-progress",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;

// ── src/client/00-format.js ──────────────────────────────────────────────────
/**
 * 面板上的数字格式化。全中文，单位用下载器习惯的写法（B / KB / MB / GB，1024 进制），
 * 时间用「2 分 31 秒」而不是 `00:02:31`——侧边栏很窄，中文读起来更快。
 */

/**
 * 非有限数字一律当"没有"。
 * @param {unknown} value - 待检查的值。
 * @returns {number|undefined} 有限数字，否则 undefined。
 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 字节数 → `90.0 MB`。
 * @param {unknown} value - 字节数。
 * @returns {string} 展示文本；无值时空串。
 */
function formatBytes(value) {
  const bytes = num(value)
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1 }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[index]}`
}

/**
 * 速率 → `0.42 MB/s`。
 * @param {unknown} value - 每秒字节数。
 * @returns {string} 展示文本；无值时空串。
 */
function formatSpeed(value) {
  const bytes = num(value)
  if (bytes === undefined || bytes <= 0) return ''
  return `${formatBytes(bytes)}/s`
}

/**
 * 毫秒 → `2 分 31 秒` / `1 小时 2 分`。
 * @param {unknown} value - 毫秒数。
 * @returns {string} 展示文本；无值时空串。
 */
function formatDuration(value) {
  const ms = num(value)
  if (ms === undefined || ms < 0) return ''
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${restMinutes} 分`
}

/**
 * `11 / 47`。
 * @param {unknown} done - 已完成量。
 * @param {unknown} total - 总量。
 * @returns {string} 展示文本；两项不全时渐进降级。
 */
function formatRatio(done, total) {
  const left = num(done)
  const right = num(total)
  if (left !== undefined && right !== undefined) return `${trimNumber(left)} / ${trimNumber(right)}`
  if (left !== undefined) return trimNumber(left)
  return ''
}

/**
 * 去掉没意义的小数尾巴。
 * @param {number} value - 数字。
 * @returns {string} 文本。
 */
function trimNumber(value) {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * 百分比 → `23%` / `23.4%`。
 * @param {unknown} value - 0–100 的百分比。
 * @returns {string} 展示文本；无值时空串。
 */
function formatPercent(value) {
  const percent = num(value)
  if (percent === undefined) return ''
  const clamped = Math.max(0, Math.min(100, percent))
  if (clamped >= 100) return '100%'
  if (clamped >= 10) return `${Math.round(clamped)}%`
  return `${clamped.toFixed(1)}%`
}

/**
 * 时间戳 → `刚刚` / `3 分钟前`。
 * @param {unknown} value - 毫秒时间戳。
 * @param {number} now - 当前时间。
 * @returns {string} 展示文本。
 */
function formatAgo(value, now) {
  const at = num(value)
  if (at === undefined) return ''
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 5) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
}

/**
 * 时钟 → `14:03:21`。
 * @param {unknown} value - 毫秒时间戳。
 * @returns {string} 展示文本。
 */
function formatClock(value) {
  const at = num(value)
  if (at === undefined) return ''
  const date = new Date(at)
  const pad = input => String(input).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// ── src/client/05-route.js ───────────────────────────────────────────────────
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

// ── src/client/10-sampler.js ─────────────────────────────────────────────────
/**
 * 两帧差分：源里没写速率 / 剩余时间时，用连续两次拉取算出来。
 *
 * 这是面板"有速率、有预计剩余"的主要来源——DSH 的后台任务本身只保留输出字节
 * 与进度行，下载器也未必每秒都打印速度。差分比正则更可靠：只要字节数在涨，
 * 就一定有速率。
 *
 * 指数滑动平均（α=0.4）压抖动；同一个任务连续三次没有增量就停止外推（任务卡住
 * 时把速率清零，而不是一直显示一个旧值）。
 */

/** 滑动平均系数：越大越跟手、越小越平滑。 */
const SAMPLE_ALPHA = 0.4
/** 连续多少次没有增量就把速率清零。 */
const SAMPLE_STALE_TICKS = 3

/**
 * 造一个采样器。每次调用 `sample(tasks, now)` 返回补好速率 / 剩余时间的任务列表。
 * @returns {(tasks: Record<string, any>[], now: number) => Record<string, any>[]} 采样函数。
 */
function createSampler() {
  /** @type {Map<string, { at: number, bytes?: number, done?: number, speed?: number, rate?: number, stale: number }>} */
  const state = new Map()

  return function sample(tasks, now) {
    const alive = new Set()
    const out = tasks.map(task => {
      const id = String(task.id)
      alive.add(id)
      const previous = state.get(id)
      const metrics = task.metrics !== null && typeof task.metrics === 'object' ? task.metrics : {}
      const bytes = num(metrics.bytes)
      const done = num(metrics.done)
      const explicitSpeed = num(metrics.speed)

      let speed = explicitSpeed
      let rate
      if (previous !== undefined) {
        const seconds = (now - previous.at) / 1000
        if (seconds > 0.2) {
          if (bytes !== undefined && previous.bytes !== undefined && bytes >= previous.bytes) {
            const delta = (bytes - previous.bytes) / seconds
            if (delta > 0) {
              rate = previous.rate === undefined ? delta : (previous.rate * (1 - SAMPLE_ALPHA)) + (delta * SAMPLE_ALPHA)
              previous.stale = 0
            } else {
              previous.stale += 1
            }
          } else if (done !== undefined && previous.done !== undefined && done > previous.done) {
            const delta = (done - previous.done) / seconds
            rate = previous.rate === undefined ? delta : (previous.rate * (1 - SAMPLE_ALPHA)) + (delta * SAMPLE_ALPHA)
            previous.stale = 0
          } else {
            previous.stale += 1
          }
          if (previous.stale >= SAMPLE_STALE_TICKS) rate = undefined
          if (explicitSpeed === undefined && previous.speed !== undefined && rate === undefined && previous.stale < SAMPLE_STALE_TICKS) {
            rate = previous.speed
          }
          previous.at = now
          previous.bytes = bytes
          previous.done = done
          previous.speed = rate
          previous.rate = rate
        }
      } else {
        state.set(id, { at: now, bytes, done, speed: explicitSpeed, rate: undefined, stale: 0 })
      }

      let etaMs = num(metrics.etaMs)
      if (etaMs === undefined && rate !== undefined && rate > 0) {
        const bytesTotal = num(metrics.bytesTotal)
        const total = num(metrics.total)
        if (bytesTotal !== undefined && bytes !== undefined && bytesTotal > bytes) etaMs = ((bytesTotal - bytes) / rate) * 1000
        else if (total !== undefined && done !== undefined && total > done && bytes === undefined) etaMs = ((total - done) / rate) * 1000
      }

      const enriched = { ...task, metrics: { ...metrics } }
      if (speed === undefined && rate !== undefined) enriched.metrics.speed = rate
      if (etaMs !== undefined && num(metrics.etaMs) === undefined) enriched.metrics.etaMs = etaMs
      return enriched
    })

    for (const key of [...state.keys()]) if (!alive.has(key)) state.delete(key)
    return out
  }
}

/**
 * 聚合进度：把运行中的任务合成一条总览。字节口径优先（更接近"传输"），
 * 没有任何任务带字节数时退回百分比平均——并且**如实说明**用的是哪种口径。
 * @param {Record<string, any>[]} tasks - 采样后的任务列表。
 * @returns {{ running: number, total: number, percent: number|null, bytes: number|null, bytesTotal: number|null, speed: number|null, etaMs: number|null, basis: 'bytes'|'percent'|'none' }} 聚合结果。
 */
function aggregateTasks(tasks) {
  const running = tasks.filter(task => task.status === 'running' || task.status === 'stopping')
  let bytes = 0
  let bytesTotal = 0
  let speed = 0
  let etaMs = 0
  let byteTasks = 0
  let percentSum = 0
  let percentTasks = 0
  let etaKnown = true

  for (const task of running) {
    const metrics = task.metrics !== null && typeof task.metrics === 'object' ? task.metrics : {}
    const taskBytes = num(metrics.bytes)
    const taskBytesTotal = num(metrics.bytesTotal)
    if (taskBytes !== undefined && taskBytesTotal !== undefined && taskBytesTotal > 0) {
      bytes += taskBytes
      bytesTotal += taskBytesTotal
      byteTasks += 1
    }
    const taskSpeed = num(metrics.speed)
    if (taskSpeed !== undefined && taskSpeed > 0) speed += taskSpeed
    const taskEta = num(metrics.etaMs)
    if (taskEta !== undefined && taskEta >= 0) etaMs = Math.max(etaMs, taskEta)
    else etaKnown = false
    const taskPercent = num(metrics.percent)
    if (taskPercent !== undefined) { percentSum += taskPercent; percentTasks += 1 }
  }

  const basis = byteTasks > 0 ? 'bytes' : (percentTasks > 0 ? 'percent' : 'none')
  let percent = null
  if (byteTasks > 0) percent = (bytes / bytesTotal) * 100
  else if (percentTasks > 0) percent = percentSum / percentTasks

  return {
    running: running.length,
    total: tasks.length,
    percent: percent === null ? null : Math.max(0, Math.min(100, percent)),
    bytes: byteTasks > 0 ? bytes : null,
    bytesTotal: byteTasks > 0 ? bytesTotal : null,
    speed: speed > 0 ? speed : null,
    etaMs: etaKnown ? etaMs : null,
    basis,
  }
}

// ── src/client/20-styles.js ──────────────────────────────────────────────────
/**
 * 组件样式。
 *
 * 规则：
 * - **不写死主题色**：每个视觉值都取 DSH 的 `--dsw-alias-*` 令牌，第二参是兜底；
 * - 数字全部 `font-variant-numeric: tabular-nums`，每 1.5 秒刷一次也不会左右跳；
 * - **动画是内容的一部分**：进度条平滑推进、运行中扫光、未知进度走马灯、
 *   环形进度旋转、弹层与行淡入；`prefers-reduced-motion` 下全部关闭；
 * - 不用 `backdrop-filter`，不引 CSS 框架。
 */

/** 插件样式标签的定位符（重复加载时避免叠加）。 */
const STYLE_SELECTOR = 'style[data-plugin-css="dsh-download-progress"]'

/** 组件 CSS。 */
const PANEL_CSS = `
@keyframes ddp-rotate{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}
@keyframes ddp-dash{0%{stroke-dasharray:1 150;stroke-dashoffset:0}
50%{stroke-dasharray:80 150;stroke-dashoffset:-30}100%{stroke-dasharray:80 150;stroke-dashoffset:-118}}
@keyframes ddp-shimmer{from{transform:translateX(-130%)}to{transform:translateX(330%)}}
@keyframes ddp-stripes{from{background-position:0 0}to{background-position:28px 0}}
@keyframes ddp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.72;transform:scale(.92)}}
@keyframes ddp-pop{from{opacity:0;transform:translateY(-6px) scale(.975)}to{opacity:1;transform:none}}
@keyframes ddp-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes ddp-flash{0%{background-color:var(--dsw-alias-state-success-primary,#2ea043)}100%{background-color:transparent}}
.ddp-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;
width:28px;height:28px;padding:0;border:0;border-radius:8px;cursor:pointer;background:transparent;
color:var(--dsw-alias-label-secondary,#a5a5b0);flex:none}
.ddp-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));
color:var(--dsw-alias-label-primary,#d6d6dd)}
.ddp-trigger[data-open="1"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.2));
color:var(--dsw-alias-label-primary,#d6d6dd)}
.ddp-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.ddp-ring{position:absolute;top:0;left:0;width:28px;height:28px;transform:rotate(-90deg);
pointer-events:none;overflow:visible}
.ddp-ring circle{fill:none;stroke-width:2;stroke-linecap:round}
.ddp-ring-track{stroke:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
.ddp-ring-fill{stroke:var(--dsw-alias-brand-primary,#4d6bfe);
transition:stroke-dashoffset .55s cubic-bezier(.22,.61,.36,1)}
.ddp-ring--spin{animation:ddp-rotate 1.7s linear infinite}
.ddp-ring--spin .ddp-ring-fill{animation:ddp-dash 1.3s ease-in-out infinite;transition:none}
.ddp-glyph{display:block;position:relative;z-index:1}
.ddp-count{position:absolute;top:-3px;right:-4px;min-width:15px;height:15px;padding:0 4px;
border-radius:999px;font-size:9.5px;line-height:15px;text-align:center;font-weight:700;
font-variant-numeric:tabular-nums;color:#fff;background:var(--dsw-alias-brand-primary,#4d6bfe);
box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1,#1b1b22)}
.ddp-count--live{animation:ddp-pulse 1.6s ease-in-out infinite}
.ddp-count--done{background:var(--dsw-alias-state-success-primary,#2ea043)}
.ddp-count--fail{background:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-pop{position:fixed;z-index:60;width:388px;max-width:calc(100vw - 20px);
max-height:min(64vh,540px);display:flex;flex-direction:column;overflow:hidden;border-radius:12px;
background:var(--dsw-alias-bg-layer-1,#1b1b22);color:var(--dsw-alias-label-primary,#d6d6dd);
border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
box-shadow:0 14px 36px rgba(0,0,0,.3);transform-origin:top right;animation:ddp-pop .16s cubic-bezier(.2,.8,.3,1)}
.ddp-head{flex:none;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.ddp-head-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.ddp-title{font-size:13px;font-weight:700}
.ddp-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a95);font-variant-numeric:tabular-nums}
.ddp-track{position:relative;height:6px;border-radius:999px;overflow:hidden;margin:8px 0 2px;
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}
.ddp-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;overflow:hidden;
background-color:var(--dsw-alias-brand-primary,#4d6bfe);
transition:width .55s cubic-bezier(.22,.61,.36,1)}
.ddp-fill--live::after{content:'';position:absolute;top:0;bottom:0;left:0;width:42%;border-radius:999px;
background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);
animation:ddp-shimmer 1.7s ease-in-out infinite}
.ddp-fill--done{background-color:var(--dsw-alias-state-success-primary,#2ea043)}
.ddp-fill--failed{background-color:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-fill--idle{background-color:var(--dsw-alias-label-tertiary,#8a8a95)}
.ddp-track--unknown .ddp-fill{width:100%;
background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.55) 0 8px,transparent 8px 20px);
background-size:28px 100%;animation:ddp-stripes .8s linear infinite}
.ddp-track--unknown .ddp-fill--live::after{display:none}
.ddp-list{flex:1;min-height:0;overflow:auto;padding:6px}
.ddp-icon-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;
padding:0;border:0;border-radius:6px;cursor:pointer;background:transparent;
color:var(--dsw-alias-label-tertiary,#8a8a95)}
.ddp-icon-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#d6d6dd);
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.ddp-icon-btn:disabled{opacity:.4;cursor:default}
.ddp-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.ddp-note{flex:none;padding:6px 12px;font-size:11px;
border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
color:var(--dsw-alias-state-success-primary,#2ea043)}
.ddp-note--bad{color:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-row{padding:8px 8px 9px;border-radius:8px;animation:ddp-rise .2s ease both}
.ddp-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.ddp-row--settled{opacity:.62}
.ddp-row--fresh{animation:ddp-rise .2s ease both,ddp-flash 1.1s ease-out .1s both}
.ddp-row-head{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.ddp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
font-size:12.5px;font-weight:600}
.ddp-name--link{display:block;text-align:left;padding:0;border:0;background:transparent;
font-family:inherit;font-size:12.5px;font-weight:600;color:var(--dsw-alias-brand-primary,#4d6bfe);
cursor:pointer;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:2px;
transition:text-decoration-color .15s ease}
.ddp-name--link:hover{text-decoration-color:currentColor}
.ddp-name--link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px;border-radius:4px}
.ddp-state{flex:none;font-size:10px;line-height:15px;padding:0 6px;border-radius:999px;
border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));color:var(--dsw-alias-label-secondary,#a5a5b0)}
.ddp-state--running{color:var(--dsw-alias-brand-primary,#4d6bfe);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.ddp-state--completed{color:var(--dsw-alias-state-success-primary,#2ea043);
border-color:var(--dsw-alias-state-success-primary,#2ea043)}
.ddp-state--failed,.ddp-state--killed{color:var(--dsw-alias-state-error-primary,#e5534b);
border-color:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-state--stopping{color:var(--dsw-alias-state-warn-primary,#d29922);
border-color:var(--dsw-alias-state-warn-primary,#d29922)}
.ddp-meta{display:flex;flex-wrap:wrap;gap:2px 9px;margin-top:5px;font-size:11px;
color:var(--dsw-alias-label-secondary,#a5a5b0);font-variant-numeric:tabular-nums}
.ddp-pct{font-weight:700;color:var(--dsw-alias-label-primary,#d6d6dd)}
.ddp-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 18px 30px;text-align:center}
.ddp-empty-title{font-size:12.5px;color:var(--dsw-alias-label-secondary,#a5a5b0)}
.ddp-empty-hint{font-size:11px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#8a8a95);text-align:left;max-width:30em}
.ddp-error{margin:8px;padding:8px 10px;border-radius:8px;font-size:11px;word-break:break-word;
border:1px solid var(--dsw-alias-state-error-primary,#e5534b);color:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-foot{flex:none;display:flex;align-items:center;gap:8px;padding:7px 12px;font-size:11px;
border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
color:var(--dsw-alias-label-tertiary,#8a8a95);font-variant-numeric:tabular-nums}
.ddp-foot-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-btn{flex:none;font:inherit;font-size:11px;cursor:pointer;padding:1px 9px;border-radius:6px;
color:var(--dsw-alias-label-secondary,#a5a5b0);background:transparent;
border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24))}
.ddp-btn:hover{color:var(--dsw-alias-label-primary,#d6d6dd);
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
@media (prefers-reduced-motion:reduce){
.ddp-ring--spin,.ddp-ring--spin .ddp-ring-fill,.ddp-fill--live::after,
.ddp-track--unknown .ddp-fill,.ddp-count--live,.ddp-pop,.ddp-row{animation:none}
.ddp-fill{transition:none}
.ddp-ring-fill{transition:none}}
`

/**
 * 注入一次插件样式；fiber 卸载时移除。
 * @param {any} ctx - client 上下文。
 */
function installStyles(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    if (document.querySelector(STYLE_SELECTOR) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-download-progress'
      tag.dataset.pluginCss = 'dsh-download-progress'
      tag.textContent = PANEL_CSS
      document.head.appendChild(tag)
    }
    return () => {
      const existing = document.querySelector(STYLE_SELECTOR)
      if (existing !== null) existing.remove()
    }
  }, 'dsh-download-progress: styles')
}

// ── src/client/30-view.js ────────────────────────────────────────────────────
/**
 * 组件视图：DSH 会话头（右侧工具区）里的一个**下载指示器**，点开是一个进度弹层。
 *
 * 形态对齐 Chrome 的下载按钮：常驻的小图标 + 环形进度 + 数量角标；点开是任务列表，
 * 每条一个**动画进度条**，没有百分比就走走马灯。
 *
 * 两条硬约束：
 * - **不渲染源里的 markdown 原文**。进度块只作为数据被解析成条 / 数字 / 速率，
 *   原文留在 host 响应的 `raw` 字段里供 curl 排查，界面上一律不出。
 * - **不依赖任何其它插件**：只用 DSH 核心的 Slot 服务与宿主只读路由。
 */

/** 环形进度的几何（viewBox 28×28，半径 12）。 */
const RING_RADIUS = 12
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** 客户端默认轮询间隔（毫秒）；服务端会在响应里回一个权威值。 */
const DEFAULT_POLL_MS = 1500
/** 兜底钳制范围，与 host 的 Config 对齐。 */
const POLL_MIN_MS = 500
const POLL_MAX_MS = 60000
/** 「刚完成」高亮保留多久（毫秒）。 */
const FRESH_MS = 10000

/**
 * 下载图标（箭头入托盘）。
 * @returns {any} React 节点。
 */
function TaskGlyph() {
  return h('svg', {
    className: 'ddp-glyph', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
  h('path', { d: 'M8 2.4v7.2' }),
  h('path', { d: 'M5.1 6.9 8 9.8l2.9-2.9' }),
  h('path', { d: 'M2.9 11.1v1.3a1.3 1.3 0 0 0 1.3 1.3h7.6a1.3 1.3 0 0 0 1.3-1.3v-1.3' }))
}

/**
 * 文件夹图标（「打开所在文件夹」）。
 * @returns {any} React 节点。
 */
function FolderGlyph() {
  return h('svg', {
    width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
  h('path', { d: 'M1.8 4.2a1.2 1.2 0 0 1 1.2-1.2h2.7l1.4 1.7h6.9a1.2 1.2 0 0 1 1.2 1.2v6.1a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z' }))
}

/**
 * 环形进度。已知百分比时是平滑推进的弧；未知时旋转 + 伸缩的走马灯弧。
 * @param {{ percent: number|null, spin: boolean }} props - 百分比与是否走马灯。
 * @returns {any} React 节点。
 */
function ProgressRing(props) {
  const percent = num(props.percent)
  const offset = percent === undefined ? RING_CIRCUMFERENCE : RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, percent)) / 100)
  return h('svg', {
    className: `ddp-ring${props.spin ? ' ddp-ring--spin' : ''}`,
    viewBox: '0 0 28 28', width: 28, height: 28, 'aria-hidden': 'true',
  },
  h('circle', { className: 'ddp-ring-track', cx: 14, cy: 14, r: RING_RADIUS }),
  h('circle', {
    className: 'ddp-ring-fill', cx: 14, cy: 14, r: RING_RADIUS,
    style: { strokeDasharray: `${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`, strokeDashoffset: offset },
  }))
}

/**
 * 一条动画进度条。运行中扫光；未知进度走马灯；完成 / 失败换色。
 * @param {{ task: Record<string, any> }} props - 任务。
 * @returns {any} React 节点。
 */
function TaskBar(props) {
  const task = props.task
  const metrics = task.metrics ?? {}
  const percent = num(metrics.percent)
  const running = task.status === 'running' || task.status === 'stopping'
  const variant = task.status === 'completed' ? ' ddp-fill--done'
    : (task.status === 'failed' || task.status === 'killed') ? ' ddp-fill--failed'
      : running ? ' ddp-fill--live' : ' ddp-fill--idle'
  if (percent === undefined) {
    return h('div', {
      className: 'ddp-track ddp-track--unknown', role: 'progressbar',
      'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': '进度未知',
    }, h('i', { className: `ddp-fill${variant}` }))
  }
  const clamped = Math.max(0, Math.min(100, percent))
  return h('div', {
    className: 'ddp-track', role: 'progressbar',
    'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(clamped),
  }, h('i', { className: `ddp-fill${variant}`, style: { width: `${clamped}%` } }))
}

/**
 * 单个任务一行。**只渲染结构化的数字**，不显示源里的 markdown 原文。
 * @param {{ task: Record<string, any>, now: number }} props - 任务与当前时间。
 * @returns {any} React 节点。
 */
function TaskRow(props) {
  const task = props.task
  const metrics = task.metrics ?? {}
  const running = task.status === 'running' || task.status === 'stopping'
  const settled = !running
  const finishedAt = num(task.finishedAt)
  const fresh = task.status === 'completed' && finishedAt !== undefined && props.now - finishedAt < FRESH_MS

  const parts = []
  const percent = formatPercent(metrics.percent)
  if (percent !== '') parts.push(h('span', { className: 'ddp-pct', key: 'p' }, percent))
  const ratio = formatRatio(metrics.done, metrics.total)
  if (ratio !== '') parts.push(h('span', { key: 'r' }, ratio))
  if (num(metrics.bytes) !== undefined || num(metrics.bytesTotal) !== undefined) {
    parts.push(h('span', { key: 'b' }, `${formatBytes(metrics.bytes) || '—'} / ${formatBytes(metrics.bytesTotal) || '—'}`))
  }
  const speed = formatSpeed(metrics.speed)
  if (speed !== '' && !settled) parts.push(h('span', { key: 's' }, speed))
  const eta = formatDuration(metrics.etaMs)
  if (eta !== '' && !settled) parts.push(h('span', { key: 'e' }, `剩余 ${eta}`))
  if (settled && finishedAt !== undefined) parts.push(h('span', { key: 'f' }, formatClock(finishedAt)))

  // 面板只显示文件名 + 后缀；下载位置一律不进 UI（连 title 都不放）。
  const label = typeof task.fileName === 'string' && task.fileName !== '' ? task.fileName : task.name
  const openable = props.canOpenWithDesktop === true && task.status === 'completed' && task.fileExists === true
  const revealable = props.canOpenWithDesktop === true && task.fileExists === true
  const busy = props.busy === true

  const nameNode = openable
    ? h('button', {
      type: 'button',
      className: 'ddp-name ddp-name--link',
      title: '打开这个文件',
      onClick: () => props.onAction('open', task),
    }, label)
    : h('span', { className: 'ddp-name' }, label)

  return h('div', {
    className: `ddp-row${settled ? ' ddp-row--settled' : ''}${fresh ? ' ddp-row--fresh' : ''}`,
  },
  h('div', { className: 'ddp-row-head' },
    nameNode,
    h('span', { className: `ddp-state ddp-state--${task.status}` }, task.statusLabel ?? task.status),
    revealable
      ? h('button', {
        type: 'button',
        className: 'ddp-icon-btn',
        title: '打开所在文件夹',
        disabled: busy,
        onClick: () => props.onAction('reveal', task),
      }, FolderGlyph())
      : null),
  h(TaskBar, { task }),
  parts.length > 0 ? h('div', { className: 'ddp-meta' }, parts) : null)
}

/**
 * 空态。全部是普通句子——不摆代码块、不放 markdown。
 * @param {{ sources: Record<string, any>[] }} props - 数据源诊断。
 * @returns {any} React 节点。
 */
function EmptyState(props) {
  const sources = Array.isArray(props.sources) ? props.sources : []
  const notes = sources
    .filter(source => source !== null && typeof source === 'object' && source.available !== true && typeof source.reason === 'string')
    .map(source => `${source.label}：${source.reason}`)
  return h('div', { className: 'ddp-empty' },
    h('div', { className: 'ddp-empty-title' }, '现在没有运行中的任务'),
    h('div', { className: 'ddp-empty-hint' },
      h('div', null, '有新任务开始时，这个图标会自动亮起环形进度。'),
      notes.length > 0 ? h('div', null, `尚未就绪的来源：${notes.join('；')}`) : null,
      h('div', null, '想看自己的下载进度，把进度文件或目录的绝对路径填进插件的 progressSources 配置即可。')))
}

/**
 * 主组件：图标 + 弹层。
 *
 * Slot 契约：注册在 `conversation.session.header.utilities`（DSH 自己的会话右侧工具区），
 * 框架会把 `sessionId` 作为标准 prop 传进来，不需要任何第三方插件的中介。
 *
 * @param {Record<string, any>} props - Slot 组件 props（含 `sessionId`）。
 * @returns {any} React 节点。
 */
function TaskProgressIndicator(props) {
  const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
  const [snapshot, setSnapshot] = React.useState({ phase: 'loading', tasks: [], payload: null, error: null, at: null })
  const [open, setOpen] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const [anchor, setAnchor] = React.useState(null)
  const [now, setNow] = React.useState(() => Date.now())
  const [busyId, setBusyId] = React.useState(null)
  const [actionNote, setActionNote] = React.useState(null)
  const samplerRef = React.useRef(null)
  const triggerRef = React.useRef(null)
  const popRef = React.useRef(null)
  const intervalRef = React.useRef(DEFAULT_POLL_MS)
  if (samplerRef.current === null) samplerRef.current = createSampler()

  // 轮询：打开与关闭都一样跑（图标上的环形进度要一直准）。卸载 / 会话切换即停。
  React.useEffect(() => {
    let disposed = false
    let timer = null
    const controller = new AbortController()
    const url = taskProgressRouteUrl(sessionId)

    const pull = async () => {
      try {
        const response = await fetch(url, {
          method: 'GET', signal: controller.signal, cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        const body = await response.json().catch(() => null)
        if (disposed) return
        if (body === null || body.ok !== true || body.value === null || typeof body.value !== 'object') {
          const message = typeof body?.error?.message === 'string' ? body.error.message : `路由返回 HTTP ${response.status}`
          setSnapshot(previous => ({ ...previous, phase: 'error', error: message, at: Date.now() }))
          return
        }
        const stamp = Date.now()
        const serverInterval = num(body.value.pollIntervalMs)
        if (serverInterval !== undefined) intervalRef.current = Math.min(Math.max(serverInterval, POLL_MIN_MS), POLL_MAX_MS)
        setSnapshot({
          phase: 'ready',
          payload: body.value,
          tasks: samplerRef.current(Array.isArray(body.value.tasks) ? body.value.tasks : [], stamp),
          error: null,
          at: stamp,
        })
      } catch (error) {
        if (disposed || error?.name === 'AbortError') return
        setSnapshot(previous => ({ ...previous, phase: 'error', error: error instanceof Error ? error.message : String(error), at: Date.now() }))
      } finally {
        if (!disposed) timer = setTimeout(pull, intervalRef.current)
      }
    }

    void pull()
    return () => {
      disposed = true
      controller.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [sessionId, attempt])

  // 每 10 秒推一次「现在」，让"刚完成"的高亮自然过期（不额外打请求）。
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(id)
  }, [])

  // 弹层定位：fixed 到触发器正下方并右对齐，绕开宿主头的 overflow 裁剪。
  React.useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined
    const place = () => {
      const element = triggerRef.current
      if (element === null || typeof element.getBoundingClientRect !== 'function') return
      const rect = element.getBoundingClientRect()
      setAnchor({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) })
    }
    place()
    const onKey = event => { if (event.key === 'Escape') setOpen(false) }
    const onDown = event => {
      const target = event.target
      const inTrigger = triggerRef.current !== null && triggerRef.current.contains(target)
      const inPop = popRef.current !== null && popRef.current.contains(target)
      if (!inTrigger && !inPop) setOpen(false)
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  const agg = aggregateTasks(tasks)
  const sources = Array.isArray(snapshot.payload?.sources) ? snapshot.payload.sources : []
  const canOpenWithDesktop = snapshot.payload?.canOpenWithDesktop === true
  const failed = tasks.filter(task => task.status === 'failed' || task.status === 'killed').length
  const hasRunning = agg.running > 0
  const ringPercent = hasRunning ? agg.percent : null
  const spin = hasRunning && agg.percent === null

  // 「打开 / 打开所在文件夹」走 host 的 POST /download-progress/open；宿主只接受它自己
  // 刚报告过的路径（短时白名单），客户端拿不到别的入口。
  const runAction = async (action, task) => {
    if (typeof task.filePath !== 'string' || task.filePath === '') return
    setBusyId(String(task.id))
    setActionNote(null)
    try {
      const response = await fetch(taskProgressOpenUrl(), {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, path: task.filePath }),
      })
      const body = await response.json().catch(() => null)
      if (body === null || body.ok !== true) {
        const message = typeof body?.error?.message === 'string' ? body.error.message : `路由返回 HTTP ${response.status}`
        setActionNote({ ok: false, text: `打开失败：${message}` })
      } else {
        setActionNote({ ok: true, text: action === 'reveal' ? '已在文件管理器中定位' : '已用默认应用打开' })
      }
    } catch (error) {
      setActionNote({ ok: false, text: `打开失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setBusyId(null)
    }
  }

  const badgeClass = hasRunning ? ' ddp-count--live' : (failed > 0 ? ' ddp-count--fail' : '')
  const badgeText = hasRunning ? (agg.running > 99 ? '99+' : String(agg.running)) : (failed > 0 ? String(failed) : null)

  const summary = []
  if (agg.percent !== null && agg.percent !== undefined) summary.push(`总进度 ${formatPercent(agg.percent)}`)
  if (agg.bytesTotal !== null) summary.push(`${formatBytes(agg.bytes)} / ${formatBytes(agg.bytesTotal)}`)
  if (agg.speed !== null) summary.push(formatSpeed(agg.speed))
  if (agg.etaMs !== null && agg.etaMs > 0) summary.push(`剩余约 ${formatDuration(agg.etaMs)}`)

  const footParts = []
  if (snapshot.at !== null) footParts.push(`刷新于 ${formatClock(snapshot.at)}`)
  if (sources.length > 0) footParts.push(`数据源 ${sources.filter(source => source?.available === true).length}/${sources.length}`)

  const body = (() => {
    if (snapshot.phase === 'error' && snapshot.payload === null) {
      return h('div', null,
        h('div', { className: 'ddp-error' }, `读取任务进度失败：${snapshot.error}`),
        h('div', { className: 'ddp-empty-hint', style: { padding: '0 12px 14px' } },
          'host 半边要重启 DSH 才会挂上路由；确认已重启，再点右下角「刷新」。'))
    }
    if (snapshot.phase === 'loading' && snapshot.payload === null) {
      return h('div', { className: 'ddp-empty' }, h('div', { className: 'ddp-empty-title' }, '正在读取任务进度…'))
    }
    if (tasks.length === 0) return h(EmptyState, { sources })
    return tasks.map(task => h(TaskRow, {
      key: String(task.id),
      task,
      now,
      canOpenWithDesktop,
      busy: busyId === String(task.id),
      onAction: runAction,
    }))
  })()

  return h('div', { style: { display: 'contents' } },
    h('button', {
      type: 'button',
      ref: triggerRef,
      className: 'ddp-trigger',
      'data-open': open ? '1' : '0',
      'aria-haspopup': 'dialog',
      'aria-expanded': open ? 'true' : 'false',
      title: hasRunning ? `任务进度 · ${agg.running} 个运行中` : '任务进度',
      onClick: () => setOpen(value => !value),
    },
    h(ProgressRing, { percent: ringPercent, spin }),
    h(TaskGlyph),
    badgeText !== null ? h('span', { className: `ddp-count${badgeClass}` }, badgeText) : null),

    open ? h('div', {
      ref: popRef,
      className: 'ddp-pop',
      role: 'dialog',
      'aria-label': '任务进度',
      style: anchor === null ? { top: 64, right: 16 } : { top: anchor.top, right: anchor.right },
    },
    h('div', { className: 'ddp-head' },
      h('div', { className: 'ddp-head-top' },
        h('span', { className: 'ddp-title' }, '下载与任务'),
        h('span', { className: 'ddp-sub' }, hasRunning ? `${agg.running} 个运行中` : '空闲')),
      hasRunning ? h(TaskBar, { task: { status: 'running', metrics: { percent: agg.percent } } }) : null,
      summary.length > 0 ? h('div', { className: 'ddp-meta' }, summary.map((text, index) => h('span', { key: index }, text))) : null),
    h('div', { className: 'ddp-list' }, body),
    actionNote !== null
      ? h('div', { className: `ddp-note${actionNote.ok ? '' : ' ddp-note--bad'}` }, actionNote.text)
      : null,
    h('div', { className: 'ddp-foot' },
      h('span', { className: 'ddp-foot-text' }, footParts.join(' · ')),
      h('button', { type: 'button', className: 'ddp-btn', onClick: () => setAttempt(value => value + 1) }, '刷新')))
    : null)
}

// ── src/client/90-entry.js ───────────────────────────────────────────────────
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

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
