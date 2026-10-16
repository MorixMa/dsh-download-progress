/* eslint-disable */
// dsh-download-progress —— host 半边（由 tools/build.mjs 生成，请勿手改）。
// 自包含：零 import / 零 require。Node 内建模块经 process.getBuiltinModule() 取。

// ── src/host/00-runtime.js ─────────────────────────────────────────────────
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

// ── src/host/10-config.js ──────────────────────────────────────────────────
/**
 * 装载行配置（`cordis.patch.yml` 里 `config:` 的内容）。
 *
 * DSH 0.1.7 起 `ctx.settings.register(ns, schema)` 已被整体删除，取而代之的是
 * 宿主 `SettingsForms`：**命名空间就是本插件 Loader 行的 entry id，schema 来自
 * 插件模块导出的 `Config`**（见 better-sidebar `docs/external-plugin-guide.md`
 * §8.2）。所以这里导出的是 Standard Schema 形状的对象，而不是调用
 * `settings.register`——照文档写，不照旧 API 写。
 */

/** `pollIntervalMs` 的下限与上限（毫秒）。 */
const POLL_INTERVAL_MIN_MS = 500
const POLL_INTERVAL_MAX_MS = 60000
/** 未配置时的拉取间隔。 */
const POLL_INTERVAL_DEFAULT_MS = 1500
/** 一次响应里最多返回的任务条数。 */
const MAX_TASKS = 64
/** 每个任务最多回读的输出尾部字节数（进度行几乎总在尾部）。 */
const OUTPUT_TAIL_BYTES = 8192
/** 进度源目录一次浅扫描最多取的文件数。 */
const MAX_PROGRESS_FILES = 64
/** 单个进度源文件最多读入的字节数。 */
const MAX_PROGRESS_FILE_BYTES = 256 * 1024
/** 结算超过这么久（毫秒）的任务不再出现在面板里。 */
const RECENT_SETTLED_MS = 120000

/**
 * 校验并规范化一份配置。
 * @param {unknown} value - 装载行的 `config`（未配置时为 undefined）。
 * @returns {{ progressSources: string[], pollIntervalMs: number }} 收窄后的配置。
 */
function narrowConfig(value) {
  const raw = value !== null && typeof value === 'object' ? value : {}
  const sources = Array.isArray(raw.progressSources)
    ? raw.progressSources.map(nonEmptyString).filter(item => item !== undefined)
    : []
  const interval = finiteNumber(raw.pollIntervalMs)
  return {
    progressSources: sources,
    pollIntervalMs: interval === undefined
      ? POLL_INTERVAL_DEFAULT_MS
      : Math.min(Math.max(Math.round(interval), POLL_INTERVAL_MIN_MS), POLL_INTERVAL_MAX_MS),
  }
}

/**
 * 列出配置里的问题；空数组表示合法。
 * @param {unknown} value - 装载行的 `config`。
 * @returns {string[]} 人类可读的问题列表。
 */
function configProblems(value) {
  if (value === undefined) return []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['config 必须是对象']
  const problems = []
  const raw = /** @type {Record<string, unknown>} */ (value)
  if (raw.progressSources !== undefined) {
    if (!Array.isArray(raw.progressSources)) problems.push('progressSources 必须是字符串数组')
    else if (raw.progressSources.some(item => nonEmptyString(item) === undefined)) {
      problems.push('progressSources 的每一项都必须是非空字符串')
    }
  }
  if (raw.pollIntervalMs !== undefined) {
    const interval = finiteNumber(raw.pollIntervalMs)
    if (interval === undefined) problems.push('pollIntervalMs 必须是有限数字')
    else if (interval < POLL_INTERVAL_MIN_MS || interval > POLL_INTERVAL_MAX_MS) {
      problems.push(`pollIntervalMs 必须在 ${POLL_INTERVAL_MIN_MS}–${POLL_INTERVAL_MAX_MS} 之间`)
    }
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'progressSources' && key !== 'pollIntervalMs') problems.push(`不支持的配置字段：${key}`)
  }
  return problems
}

/**
 * 装载行的 `Config`：Standard Schema 形状，Loader 只消费
 * `Config['~standard'].validate(config)`。合法时用返回值替换原始 config，
 * 有问题时抛 ValidationError 并停在装载期（`apply` 不会被调用）。
 */
const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-download-progress',
    /**
     * @param {unknown} value - 装载行的 `config`。
     * @returns {{ value: unknown } | { issues: { message: string }[] }} 校验结果。
     */
    validate(value) {
      const problems = configProblems(value)
      if (problems.length > 0) return { issues: problems.map(message => ({ message })) }
      return { value: narrowConfig(value) }
    },
  },
}

// ── src/host/20-parse.js ───────────────────────────────────────────────────
/**
 * 进度解析：把「任意的进度文本」收窄成一组结构化指标。
 *
 * 输入形态只有两类，都按真实世界里下载器 / 打包器 / 脚本会打印的样子写：
 *
 *  1. **Markdown 进度块**（多行文本，逐行抽取）：
 *       进度 ██████░░░░ 11/47 (23%)
 *       体积 90.0 MB / 100.0 MB
 *       速度 0.42 MB/s
 *       剩余 00:02:31
 *  2. **通用 JSON**：`{ total, done, bytes, bytesTotal, speed, eta, label }`
 *     （`tasks` 数组形态也支持——一个文件可携带多项任务）
 *
 * 解析结果只描述"源里写了什么"：缺失的字段一律留空，由调用方（host 回读输出、
 * client 做两帧差分）去补速率与剩余时间。**绝不猜**——把没写的当成 0 会让进度条
 * 在任务真正跑完之前就显示 100%。
 */

/** ANSI 转义序列（颜色 / 光标控制），进度行里到处都是。 */
const ANSI_PATTERN = /\u001B\[[0-9;?]*[ -/]*[@-~]/g

/** 进度条字符表：`BAR_FILLED` 算已填，`BAR_EMPTY` 算未填。 */
const BAR_FILLED = '█▓▒▰●◉■#'
const BAR_EMPTY = '░▒▱○□=-'

/** 字节单位表（1024 进制，与下载器一致）。 */
const BYTE_UNITS = {
  b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
}

/** `90.0 MB` / `1.2GiB` / `94371840 B`。 */
const BYTES_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)\b/gi
/**
 * 没写 `B` 的字节数：wget 的 `7.98M` / `1.21M`，以及各类下载器的 `512K`。
 *
 * 刻意**要求单位后面不是字母或数字**：这样 `1m30s`（时长）与 `1.21MB/s`（速率，
 * 已经由 SPEED_PATTERN 拿走）都不会被误读成字节数。只在整行找不到带 B 的写法时才用。
 */
const BARE_BYTES_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*([kmgt])(?![A-Za-z0-9])/gi
/** 没写 `B` 的字节单位表。 */
const BARE_BYTE_UNITS = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }
/** `0.42 MB/s` / `512 KBps` / `3 MiB per second`。 */
const SPEED_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)\s*(?:\/\s*|per\s*|p?)s(?:ec|econd)?s?\b/gi
/** `(23%)` / `23.4 %`。 */
const PERCENT_PATTERN = /(\d{1,3}(?:\.\d+)?)\s*%/g
/** `11/47` / `11 / 47`。 */
const RATIO_PATTERN = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/g
/** `00:02:31` / `2:31`。 */
const CLOCK_PATTERN = /(?:^|\D)(\d{1,3}):([0-5]\d)(?::([0-5]\d))?(?!\d)/g
/** `1h2m3s` / `2m31s` / `45s` / `1 小时 2 分`。 */
const UNIT_TIME_PATTERN = /(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|时))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分|分钟))?\s*(?:(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|秒))/i
/** 带方括号的进度条：`[####------]` / `[████░░░░]`。 */
const BRACKET_BAR_PATTERN = /\[([█▓▒░▰▱●○■□#=.-]{4,})\]/
/** 裸进度条：`██████░░░░`（只用块字符，避免把 `## 标题` 读成进度条）。 */
const BARE_BAR_PATTERN = /([█▓▒▰●◉■]{2,}[░▒▱○□]{1,})/

/** 这一行是"总量"。 */
const TOTAL_KEYWORD = /(总量|总共|总计|体积|大小|总大小|total|size|length)/i
/** 这一行是"已完成量"。 */
const DONE_KEYWORD = /(已传|已下载|已完成|已安装|已解压|done|downloaded|received|transferred)/i
/** 含这些关键词的行即便没有数字也算进度块的一部分。 */
const BLOCK_KEYWORDS = /(进度|已传|已下载|已完成|总量|体积|大小|速度|速率|剩余|预计|任务|下载|解压|打包|安装|传输|progress|download|speed|eta|remain|total|size|byte)/i

/** 不带 g 标志的测试用副本（`test()` 在 /g 下会带 lastIndex 状态）。 */
const TEST_PERCENT = new RegExp(PERCENT_PATTERN.source)
const TEST_BYTES = new RegExp(BYTES_PATTERN.source, 'i')
const TEST_BARE_BYTES = new RegExp(BARE_BYTES_PATTERN.source, 'i')
const TEST_CLOCK = new RegExp(CLOCK_PATTERN.source)
const TEST_RATIO = new RegExp(RATIO_PATTERN.source)

// ── 文件名 / 文件路径的提取 ────────────────────────────────────────────────
//
// 面板只显示**文件名 + 后缀**，不显示下载位置；但要把"点开 / 打开文件夹"做出来，
// 宿主侧必须知道绝对路径。两者分开：`fileName` 给人看，`filePath` 只走内部。

/**
 * Windows 绝对路径。前置的 `(?<![A-Za-z0-9])` 是关键：`https://…` 里的 `s://`
 * 也满足 `[A-Za-z]:[\\/]`，没有这个断言就会把 URL 当成盘符路径。
 */
const WINDOWS_PATH_PATTERN = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n"'`|<>*?]+/g
/**
 * POSIX 绝对路径（排除 URL：起点前面是 `/` 或 `:` 的一律不认，否则
 * `https://host/a/b.gz` 会被切出 `/host/a/b.gz` 来）。
 */
const POSIX_PATH_PATTERN = /(?<![\w:/])\/(?:[^\s"'`|<>*?:/]+\/)*[^\s"'`|<>*?:/]+\.[A-Za-z0-9]{1,8}/g
/** 末尾带扩展名的"看起来像文件名"的片段。扩展名必须以**字母**开头，否则 `90.0` 也会被当成文件名。 */
const FILE_TOKEN_PATTERN = /(?<![\w./\\:-])([^\s/\\:"'`|<>*?]*\.[A-Za-z][A-Za-z0-9]{0,7})/g
/** 脚本后缀：命令里出现的这些路径几乎不是下载产物。 */
const SCRIPT_EXT = /\.(?:ps1|psm1|mjs|cjs|js|ts|sh|bash|py|rb|cmd|bat|exe|dll|json|ya?ml|toml|lock)$/i
/** 下载器用来指定输出文件的开关。 */
const OUTPUT_FLAG_PATTERN = /(?:^|\s)(?:-o|--output|-O|--out|--out-file|--output-file|-OutFile|-Out|-DestinationPath|-Path)\s+(?:"([^"]+)"|'([^']+)'|([^\s"'`]+))/gi

/**
 * 去掉 ANSI 转义序列。
 * @param {string} text - 原始文本。
 * @returns {string} 可读文本。
 */
function stripAnsi(text) {
  return String(text).replace(ANSI_PATTERN, '')
}

/**
 * `1,234.5` → 1234.5。
 * @param {string} text - 含千分位的数字串。
 * @returns {number} 数字。
 */
function toNumber(text) {
  return Number.parseFloat(String(text).replace(/,/g, ''))
}

/**
 * 取一个正则的**全部**匹配（`matchAll` 内部克隆，不污染 lastIndex）。
 * @param {RegExp} pattern - 带 g 标志的正则。
 * @param {string} text - 被搜索文本。
 * @returns {RegExpMatchArray[]} 匹配列表。
 */
function allMatches(pattern, text) {
  return Array.from(text.matchAll(pattern))
}

/**
 * 从一行里找时长。
 * @param {string} line - 单行文本。
 * @returns {number|undefined} 毫秒数。
 */
function parseDurationFromLine(line) {
  const clock = allMatches(CLOCK_PATTERN, line)
  if (clock.length > 0) {
    const match = clock[clock.length - 1]
    const first = Number(match[1])
    const second = Number(match[2])
    const third = match[3] === undefined ? undefined : Number(match[3])
    const seconds = third === undefined ? (first * 60) + second : (first * 3600) + (second * 60) + third
    return seconds * 1000
  }
  const unit = line.match(UNIT_TIME_PATTERN)
  if (unit !== null) {
    const hours = unit[1] === undefined ? 0 : Number(unit[1])
    const minutes = unit[2] === undefined ? 0 : Number(unit[2])
    const seconds = unit[3] === undefined ? 0 : Number(unit[3])
    return Math.round(((hours * 3600) + (minutes * 60) + seconds) * 1000)
  }
  return undefined
}

/**
 * 这一行是否含有进度信号。
 * @param {string} line - 单行文本。
 * @returns {boolean} 是否含有进度信号。
 */
function hasProgressToken(line) {
  if (BRACKET_BAR_PATTERN.test(line) || BARE_BAR_PATTERN.test(line)) return true
  if (TEST_PERCENT.test(line) || TEST_BYTES.test(line) || TEST_BARE_BYTES.test(line)) return true
  if (TEST_CLOCK.test(line) || TEST_RATIO.test(line)) return true
  return BLOCK_KEYWORDS.test(line)
}

/**
 * 把一行里的字节数按关键词归类。带"总量"字样的算总量，带"已传/已完成"
 * 字样的算已完成量；两者都没有时交给调用方按出现顺序决定。
 * @param {string} line - 单行文本。
 * @param {number[]} unlabeled - 无标签字节数的收集数组。
 * @param {boolean} isProgressLine - 该行是否带百分比或速率。
 * @returns {{ bytes?: number, bytesTotal?: number }} 本行给出的量。
 */
function bytesFromLine(line, unlabeled, isProgressLine) {
  let values = allMatches(BYTES_PATTERN, line).map(match => toNumber(match[1]) * (BYTE_UNITS[match[2].toLowerCase()] ?? 1))
  // 整行没有带 B 的写法时，退回 wget / 各类下载器的 `7.98M`、`512K`。
  if (values.length === 0) {
    values = allMatches(BARE_BYTES_PATTERN, line).map(match => toNumber(match[1]) * (BARE_BYTE_UNITS[match[2].toLowerCase()] ?? 1))
  }
  if (values.length === 0) return {}
  // 一行里有两个量就是通用的 `已完成 / 总量` 写法，词义让位给位置。
  if (values.length >= 2) return { bytes: values[0], bytesTotal: values[values.length - 1] }
  const isTotal = TOTAL_KEYWORD.test(line)
  const isDone = DONE_KEYWORD.test(line)
  if (isTotal && !isDone) return { bytesTotal: values[values.length - 1] }
  if (isDone && !isTotal) return { bytes: values[values.length - 1] }
  // 进度行（带 `%` 或速率）上的单个量就是"已传输多少"——wget 的
  // `45%[===>  ] 7.98M 1.21MB/s eta 8s` 正是这个形状。没有这个判断时，
  // 这个值会掉进 unlabeled 池，跟别处的总量混淆。
  if (isProgressLine) return { bytes: values[values.length - 1] }
  unlabeled.push(values[0])
  return {}
}

/**
 * 从一个 Markdown 进度块里抽出全部指标。逐行处理，后出现的字段覆盖先出现的；
 * 速率 / 百分比 / 比例 / 进度条取整块里最后一次出现。
 * @param {string[]} lines - 进度块的行。
 * @returns {Record<string, unknown>} 指标。
 */
function extractFromLines(lines) {
  const out = {}
  const unlabeled = []

  for (const line of lines) {
    if (line.trim() === '') continue
    for (const match of allMatches(SPEED_PATTERN, line)) {
      out.speed = toNumber(match[1]) * (BYTE_UNITS[match[2].toLowerCase()] ?? 1)
    }
    const speedSpans = allMatches(SPEED_PATTERN, line).map(match => match[0])
    const percents = allMatches(PERCENT_PATTERN, line)
    // 带百分比或速率的行 = 进度行：它上面的字节数是"已传输"，不是"总量"。
    const isProgressLine = percents.length > 0 || speedSpans.length > 0
    let bytesLine = line
    for (const span of speedSpans) bytesLine = bytesLine.split(span).join(' ')
    const bytes = bytesFromLine(bytesLine, unlabeled, isProgressLine)
    if (bytes.bytes !== undefined) out.bytes = bytes.bytes
    if (bytes.bytesTotal !== undefined) out.bytesTotal = bytes.bytesTotal

    if (percents.length > 0) out.percent = toNumber(percents[percents.length - 1][1])

    for (const match of allMatches(RATIO_PATTERN, bytesLine)) {
      const done = toNumber(match[1])
      const total = toNumber(match[2])
      if (!Number.isFinite(done) || !Number.isFinite(total)) continue
      if (total <= 0 || done > total) continue
      out.done = done
      out.total = total
    }

    const eta = parseDurationFromLine(speedSpans.length > 0 ? line.split(speedSpans[speedSpans.length - 1]).join(' ') : line)
    if (eta !== undefined) {
      if (/剩余|预计|eta|remain|left/i.test(line)) out.etaMs = eta
      else if (out.etaMs === undefined) out.etaHintMs = eta
    }
  }

  // 无标签的字节数：**跨行不拼比例**。一屏 `✓ a.ttf 3.49 MB` / `✓ b.ttf 8.17 MB`
  // 是"已完成文件清单"，不是"已传/总量"；只有恰好一个无标签值时才拿它补缺的那一侧。
  // 典型场景：下载脚本开头打一行「目标：x.ttf  16.95 MB」（总量），后面的进度行给出的是
  // 已传输量——那个 16.95 MB 就该落到总量格。
  if (unlabeled.length === 1) {
    const candidate = unlabeled[0]
    if (out.bytesTotal === undefined && out.bytes === undefined) out.bytes = candidate
    else if (out.bytesTotal === undefined && candidate > out.bytes) out.bytesTotal = candidate
    else if (out.bytes === undefined && candidate <= out.bytesTotal) out.bytes = candidate
  }

  // 进度条只在没有显式百分比时兜底。
  if (out.percent === undefined) {
    const bar = barFraction(lines.join('\n'))
    if (bar !== undefined) out.percent = bar * 100
  }

  if (out.etaMs === undefined && out.etaHintMs !== undefined) out.etaMs = out.etaHintMs
  delete out.etaHintMs

  const label = labelFromLines(lines)
  if (label !== undefined) out.label = label
  return out
}

/**
 * 从一段文本里读进度条的填充比例。
 * @param {string} text - 含进度条的文本。
 * @returns {number|undefined} 0–1 的比例。
 */
function barFraction(text) {
  const bracket = text.match(BRACKET_BAR_PATTERN)
  const bare = text.match(BARE_BAR_PATTERN)
  const bar = bracket !== null ? bracket[1] : (bare !== null ? bare[1] : undefined)
  if (bar === undefined) return undefined
  let filled = 0
  let empty = 0
  for (const char of bar) {
    if (BAR_FILLED.includes(char)) filled += 1
    else if (BAR_EMPTY.includes(char)) empty += 1
  }
  if (filled === 0 || filled + empty < 4) return undefined
  return filled / (filled + empty)
}

/**
 * 猜一个任务名：标题 > 加粗 > 不含指标的第一行。
 * @param {string[]} lines - 进度块的行。
 * @returns {string|undefined} 标签。
 */
function labelFromLines(lines) {
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/)
    if (heading !== null) {
      const text = stripAnsi(heading[1]).replace(/[*_`]/g, '').trim()
      if (text !== '') return text
    }
  }
  for (const line of lines) {
    const bold = line.match(/\*\*(.+?)\*\*/)
    if (bold !== null && bold[1].trim() !== '') return bold[1].trim()
  }
  for (const line of lines) {
    const text = stripAnsi(line).replace(/^[\s>*\-+]+/, '').trim()
    if (text === '' || text.length > 80) continue
    if (hasProgressToken(text)) continue
    return text
  }
  return undefined
}

/**
 * 从一段文本里切出"最后一块进度"。下载器会不停追加新行，所以只看尾部；
 * 往上最多再吃 2 行非进度行，超过就认为跨到了别的内容。
 * @param {string} text - 原始文本（通常是某个任务的输出尾部）。
 * @param {number} [maxLines] - 进度块最多几行。
 * @returns {string[]} 进度块的行（可能为空数组）。
 */
function collectProgressBlock(text, maxLines = 12) {
  const clean = stripAnsi(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = clean.split('\n')
  let anchor = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() !== '' && hasProgressToken(lines[index])) { anchor = index; break }
  }
  if (anchor === -1) return []
  const block = []
  let gap = 0
  for (let index = anchor; index >= 0 && block.length < maxLines; index -= 1) {
    const line = lines[index]
    if (line.trim() === '' || (!hasProgressToken(line) && !/^\s{0,3}#{1,6}\s/.test(line))) {
      gap += 1
      if (gap > 2) break
      block.unshift(line)
      continue
    }
    gap = 0
    block.unshift(line)
  }
  const trimmed = block.map(line => line.replace(/\s+$/, ''))
  while (trimmed.length > 0 && trimmed[0] === '') trimmed.shift()
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop()
  return trimmed
}

/**
 * 收窄一个 JSON 数值字段。
 * @param {unknown} value - 原始值。
 * @returns {number|undefined} 数字。
 */
function jsonNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[,_\s]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * 收窄一个 JSON 时长字段：数字按毫秒，字符串走时长解析。
 * @param {unknown} value - 原始值。
 * @returns {number|undefined} 毫秒。
 */
function jsonDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    // 先按时长写法学（`1m30s` / `00:02:31`），再退回"纯数字字符串 = 毫秒"。
    // 顺序不能反：`parseFloat('1m30s')` 会给出 1，把 90 秒读成 1 毫秒。
    const duration = parseDurationFromLine(value)
    if (duration !== undefined) return duration
    return jsonNumber(value)
  }
  return undefined
}

/**
 * 解析「通用 JSON」进度对象：`{ total, done, bytes, bytesTotal, speed, eta, label }`。
 * @param {Record<string, unknown>} record - 进度对象。
 * @returns {Record<string, unknown>} 指标。
 */
function metricsFromJsonRecord(record) {
  const out = {}
  const label = nonEmptyString(record.label) ?? nonEmptyString(record.name) ?? nonEmptyString(record.title)
  if (label !== undefined) out.label = label
  const done = jsonNumber(record.done)
  const total = jsonNumber(record.total)
  if (done !== undefined) out.done = done
  if (total !== undefined) out.total = total
  const bytes = jsonNumber(record.bytes)
  const bytesTotal = jsonNumber(record.bytesTotal)
  if (bytes !== undefined) out.bytes = bytes
  if (bytesTotal !== undefined) out.bytesTotal = bytesTotal
  const speed = jsonNumber(record.speed)
  if (speed !== undefined) out.speed = speed
  const percent = jsonNumber(record.percent)
  if (percent !== undefined) out.percent = percent
  const etaMs = jsonDuration(record.eta)
  if (etaMs !== undefined) out.etaMs = etaMs
  const status = nonEmptyString(record.status)
  if (status !== undefined) out.status = status
  const detail = nonEmptyString(record.detail)
  if (detail !== undefined) out.detail = detail
  return out
}

/**
 * 解析一份进度源文本：JSON 优先，否则按 Markdown 进度块处理。
 * @param {string} text - 文件 / 输出内容。
 * @returns {{ tasks: Record<string, unknown>[], raw: string, format: 'json'|'markdown'|'empty' }} 解析结果。
 */
function parseProgressDocument(text) {
  const source = typeof text === 'string' ? text : ''
  const trimmed = source.trim()
  if (trimmed === '') return { tasks: [], raw: '', format: 'empty' }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      parsed = undefined
    }
    if (parsed !== undefined) {
      const records = Array.isArray(parsed)
        ? parsed
        : (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.tasks) ? parsed.tasks : [parsed])
      const tasks = records
        .filter(item => item !== null && typeof item === 'object' && !Array.isArray(item))
        .map(item => metricsFromJsonRecord(item))
      return { tasks, raw: trimmed.slice(0, 400), format: 'json' }
    }
  }

  const block = collectProgressBlock(source)
  if (block.length === 0) return { tasks: [], raw: '', format: 'empty' }
  return { tasks: [extractFromLines(block)], raw: block.join('\n'), format: 'markdown' }
}

/**
 * 只取指标（不关心格式），给任务输出回读用。
 * @param {string} text - 输出尾部文本。
 * @returns {{ metrics: Record<string, unknown>, raw: string }} 指标与原始进度块。
 */
function parseProgressText(text) {
  const block = collectProgressBlock(text)
  return { metrics: extractFromLines(block), raw: block.join('\n') }
}

/**
 * 把原始指标补齐成对外的形状：算出百分比，缺百分比就按完成量 / 总量推；
 * 缺剩余时间就用「剩余字节 ÷ 速率」推。
 * @param {Record<string, unknown>} metrics - 原始指标。
 * @returns {Record<string, unknown>} 补齐后的指标（缺什么就没什么）。
 */
function finalizeMetrics(metrics) {
  const out = { ...metrics }
  const percent = finiteNumber(out.percent)
  const done = finiteNumber(out.done)
  const total = finiteNumber(out.total)
  const bytes = finiteNumber(out.bytes)
  const bytesTotal = finiteNumber(out.bytesTotal)

  let resolved = percent
  if (resolved === undefined && done !== undefined && total !== undefined && total > 0) resolved = (done / total) * 100
  if (resolved === undefined && bytes !== undefined && bytesTotal !== undefined && bytesTotal > 0) resolved = (bytes / bytesTotal) * 100
  if (resolved !== undefined) out.percent = Math.max(0, Math.min(100, resolved))

  if (out.etaMs === undefined) {
    const speed = finiteNumber(out.speed)
    if (speed !== undefined && speed > 0 && bytesTotal !== undefined && bytes !== undefined && bytesTotal > bytes) {
      out.etaMs = ((bytesTotal - bytes) / speed) * 1000
    }
  }
  return out
}

// ── 文件名与文件路径 ───────────────────────────────────────────────────────
//
// 面板**只显示文件名 + 后缀**，不显示下载位置；但"点开文件 / 打开所在文件夹"需要
// 绝对路径。两者分开：`fileName` 是给人的，`filePath` 只在内部流转（并发给客户端，
// 但客户端不渲染它）。

/** 去掉路径末尾的标点（命令行里 `'E:\a.gz'` 之类）。 */
const TRAILING_PUNCTUATION = /[.,;:)\]}'"`]+$/

/**
 * 取路径的最后一段。
 * @param {unknown} target - 路径。
 * @returns {string|undefined} 文件名。
 */
function fileNameOf(target) {
  const value = nonEmptyString(target)
  if (value === undefined) return undefined
  const parts = value.replace(/[\\/]+$/, '').split(/[\\/]/)
  const last = parts[parts.length - 1]
  return last === undefined || last === '' ? undefined : last
}

/**
 * 抽出一段文本里的**绝对文件路径**（必须以扩展名结尾）。
 * @param {unknown} text - 被搜索的文本。
 * @returns {string[]} 去重后的路径。
 */
function absoluteFilePathsIn(text) {
  const source = typeof text === 'string' ? text : ''
  const raw = []
  for (const match of allMatches(WINDOWS_PATH_PATTERN, source)) raw.push(match[0])
  for (const match of allMatches(POSIX_PATH_PATTERN, source)) {
    if (match[0].includes('://')) continue
    raw.push(match[0])
  }
  const out = []
  for (const item of raw) {
    const cleaned = item.replace(TRAILING_PUNCTUATION, '')
    if (!/\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(cleaned)) continue
    if (cleaned.includes('://')) continue
    if (!out.includes(cleaned)) out.push(cleaned)
  }
  return out
}

/**
 * 从一行命令里找"产物路径"。
 *
 * 先认下载器开关（`-o` / `--output` / `-OutFile` …）——这是最可信的信号；认不到就退回
 * 「最后一个不以脚本后缀结尾的绝对路径」（命令里通常先出现脚本自己、再出现产物）。
 * @param {unknown} text - 命令行 / 标签。
 * @returns {string|undefined} 绝对路径。
 */
function outputPathFromCommand(text) {
  const source = typeof text === 'string' ? text : ''
  let flagged
  for (const match of allMatches(OUTPUT_FLAG_PATTERN, source)) {
    const value = match[1] ?? match[2] ?? match[3]
    const cleaned = nonEmptyString(value)
    if (cleaned === undefined || cleaned.includes('://')) continue
    const path = cleaned.replace(TRAILING_PUNCTUATION, '')
    if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/')) flagged = path
  }
  if (flagged !== undefined && /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(flagged)) return flagged
  const candidates = absoluteFilePathsIn(source).filter(path => !SCRIPT_EXT.test(path))
  return candidates.length > 0 ? candidates[candidates.length - 1] : undefined
}

/**
 * 从进度块里猜文件名（**只有名字，没有目录**）。
 * @param {string[]} lines - 进度块的行。
 * @returns {string|undefined} 文件名。
 */
function fileNameFromLines(lines) {
  // wget 式：行首就是文件名，紧跟数字百分比。
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^\s*([^\s/\\]+\.\w{1,8})\s+\d{1,3}(?:\.\d+)?\s*%/)
    if (match !== null) return match[1]
  }
  // 退一步：块里第一个"像文件名"的裸 token（不含路径分隔符、不是脚本、不以数字开头）。
  for (const line of lines) {
    for (const match of allMatches(FILE_TOKEN_PATTERN, line)) {
      const token = match[1]
      if (token === '' || token.includes('/') || token.includes('\\')) continue
      if (SCRIPT_EXT.test(token) || /^\d/.test(token)) continue
      return token
    }
  }
  return undefined
}

/** 宽口径的绝对路径（不要求扩展名），只用于**显示前擦除**。 */
const ANY_WINDOWS_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'`|<>*?]*/g
/** 宽口径的 POSIX 目录路径，只用于显示前擦除。 */
const ANY_POSIX_PATH = /(?<![\w:/])\/(?:[^\s"'`|<>*?:/]+\/)+[^\s"'`|<>*?:/]*/g

/**
 * 把一段文本里的所有路径擦掉——**显示层绝不泄漏下载位置**。
 * @param {unknown} text - 原始文本。
 * @returns {string} 擦除后的文本（可能为空串）。
 */
function stripPaths(text) {
  let out = typeof text === 'string' ? text : ''
  out = out.replace(ANY_WINDOWS_PATH, ' ').replace(ANY_POSIX_PATH, ' ')
  return out.replace(/\s+/g, ' ').replace(/^[\s&"'`]+/, '').trim()
}

// ── src/host/30-sources.js ─────────────────────────────────────────────────
/**
 * 回退进度源（③）：扫描配置里的文件 / 目录，把它们当成进度看板读。
 *
 * 只读：只做 `stat` / `readdir` / 定长 `read`，不写、不建、不删。目录**浅扫描**
 * 一层（不递归），只取已知的进度文件扩展名，并且有明确的条数上限——一个配错的
 * 目录（比如用户把 `C:\` 填进来）不该让一次 HTTP 请求去遍历整块盘。
 */

/** 目录扫描认的扩展名。 */
const PROGRESS_EXTENSIONS = ['.md', '.markdown', '.txt', '.json', '.jsonl', '.progress']

/**
 * 展开 `~` 与 `~/x`（Windows 上映射到用户主目录）。
 * @param {string} target - 原始路径。
 * @returns {string} 展开后的路径。
 */
function expandHome(target) {
  if (target !== '~' && !target.startsWith('~/') && !target.startsWith('~\\')) return target
  const os = builtinModule('node:os')
  const path = builtinModule('node:path')
  const home = os !== undefined && typeof os.homedir === 'function' ? os.homedir() : undefined
  if (home === undefined || path === undefined) return target
  const rest = target.slice(1).replace(/^[\\/]/, '')
  return rest === '' ? home : path.join(home, rest)
}

/**
 * 一个配置项解析成一个候选文件列表。
 * @param {string} source - 配置里的路径。
 * @returns {{ files: string[], note?: string }} 文件列表与说明。
 */
function expandProgressSource(source) {
  const fs = builtinModule('node:fs')
  const path = builtinModule('node:path')
  if (fs === undefined || path === undefined) return { files: [], note: '宿主进程不支持 getBuiltinModule，进度源回退分支不可用' }
  const target = expandHome(source)
  let info
  try {
    info = fs.statSync(target)
  } catch (error) {
    return { files: [], note: `读不到：${error instanceof Error ? error.message : String(error)}` }
  }
  if (info.isFile()) return { files: [target] }
  if (!info.isDirectory()) return { files: [], note: '既不是文件也不是目录' }
  let entries
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
  } catch (error) {
    return { files: [], note: `目录不可读：${error instanceof Error ? error.message : String(error)}` }
  }
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!PROGRESS_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue
    files.push(path.join(target, entry.name))
    if (files.length >= MAX_PROGRESS_FILES) break
  }
  files.sort()
  return files.length > 0 ? { files } : { files: [], note: `目录里没有 ${PROGRESS_EXTENSIONS.join(' / ')} 文件` }
}

/**
 * 读一个文件的**尾部**（超过上限时只取最后一段——进度行总在末尾）。
 * @param {string} file - 文件路径。
 * @param {number} maxBytes - 最多读入的字节数。
 * @returns {{ text: string, truncated: boolean }|undefined} 文本；读不到时 undefined。
 */
function readTextTail(file, maxBytes) {
  const fs = builtinModule('node:fs')
  if (fs === undefined) return undefined
  let handle
  try {
    const info = fs.statSync(file)
    handle = fs.openSync(file, 'r')
    const size = info.size
    const length = Math.min(size, maxBytes)
    const start = size - length
    const buffer = Buffer.allocUnsafe(length)
    fs.readSync(handle, buffer, 0, length, start)
    let text = buffer.toString('utf8')
    // 从中间截断时，首行大概率是半行，丢掉它。
    if (start > 0) {
      const newline = text.indexOf('\n')
      text = newline === -1 ? '' : text.slice(newline + 1)
    }
    return { text, truncated: start > 0 }
  } catch {
    return undefined
  } finally {
    if (handle !== undefined) {
      try { fs.closeSync(handle) } catch { /* 关不上也不该影响响应 */ }
    }
  }
}

/**
 * 收集「进度源文件」这一路的数据。
 * @param {string[]} sources - 配置里的路径数组。
 * @returns {{ records: { source: string, file: string, metrics: Record<string, unknown>, raw: string, format: string }[], notes: string[] }} 记录与诊断信息。
 */
function collectProgressFiles(sources) {
  const records = []
  const notes = []
  for (const source of sources) {
    const expanded = expandProgressSource(source)
    if (expanded.note !== undefined) notes.push(`${source}：${expanded.note}`)
    for (const file of expanded.files) {
      const read = readTextTail(file, MAX_PROGRESS_FILE_BYTES)
      if (read === undefined) {
        notes.push(`${file}：读取失败`)
        continue
      }
      const document = parseProgressDocument(read.text)
      if (document.tasks.length === 0) {
        notes.push(`${file}：没找到可识别的进度块`)
        continue
      }
      document.tasks.forEach((metrics, index) => {
        records.push({ source, file, metrics, raw: document.raw, format: document.format, index })
      })
    }
  }
  return { records, notes }
}

// ── src/host/40-tasks.js ───────────────────────────────────────────────────
/**
 * 任务汇总：把三路数据源合成同一份任务列表。
 *
 * 优先级按需求写死，且**逐项标注来源**，面板上能看出每一条是从哪来的：
 *   ① `dsh-ops/background` 的后台任务（存在对应服务时）
 *   ② DSH 自身的会话内 managed background job（宿主 `ctx.jobs` 注册表）
 *   ③ 配置里的「进度源文件 / 目录」
 *
 * 全部读取都是只读的：`ctx.jobs.list` / `ctx.jobs.readAt` 是非消耗读，不会移动
 * 模型自己的 `job_output` 游标，也不会触发任何"已完成"通知。
 */

/** 后台任务服务候选名（按可能性排序，逐个结构探测）。 */
const OPS_SERVICE_NAMES = ['opsBackground', 'backgroundTasks', 'opsJobs', 'background']

/** 任务状态到中文标签。 */
const STATUS_LABELS = {
  running: '运行中',
  stopping: '正在停止',
  completed: '已完成',
  killed: '已取消',
  failed: '已失败',
  pending: '等待中',
  unknown: '未知',
}

/**
 * 收集当前进程里所有可能的会话 id：查询参数里的那个 + 活体 agent + 会话服务。
 * 注册表按"所有者"过滤，只有拿得到会话 id 才看得见属于该会话的任务。
 * @param {any} ctx - host 上下文。
 * @param {string|undefined} sessionId - 请求带来的会话 id。
 * @returns {string[]} 去重后的会话 id。
 */
function collectSessionIds(ctx, sessionId) {
  const ids = new Set()
  if (nonEmptyString(sessionId) !== undefined) ids.add(sessionId)
  try {
    const agents = ctx.get('agents')
    const list = agents !== undefined && typeof agents.list === 'function' ? agents.list() : undefined
    for (const agent of Array.isArray(list) ? list : []) {
      const id = nonEmptyString(agent?.id) ?? nonEmptyString(agent?.sessionId) ?? nonEmptyString(agent?.session?.id)
      if (id !== undefined) ids.add(id)
    }
  } catch { /* 服务形状不认识就当没有 */ }
  try {
    const sessions = ctx.get('sessions')
    const list = sessions !== undefined && typeof sessions.list === 'function' ? sessions.list() : undefined
    for (const session of Array.isArray(list) ? list : []) {
      const id = nonEmptyString(session?.id) ?? nonEmptyString(session?.sessionId)
      if (id !== undefined) ids.add(id)
    }
  } catch { /* 同上 */ }
  return [...ids]
}

/**
 * 从任务输出尾部回读进度。
 * @param {any} jobs - `ctx.jobs` 注册表。
 * @param {{ id: string, output?: { total?: number } }} view - 任务投影。
 * @param {string} owner - 该任务所属会话（用作访问围栏的调用方）。
 * @returns {{ metrics: Record<string, unknown>, raw: string, text: string }} 解析结果与原始尾部文本。
 */
function readJobProgress(jobs, view, owner) {
  try {
    const total = finiteNumber(view.output?.total) ?? 0
    const from = Math.max(0, total - OUTPUT_TAIL_BYTES)
    const read = jobs.readAt(view.id, from, owner)
    const chunks = Array.isArray(read?.chunks) ? read.chunks : []
    const text = chunks.map(chunk => (typeof chunk?.text === 'string' ? chunk.text : '')).join('')
    return { ...parseProgressText(text), text }
  } catch {
    return { metrics: {}, raw: '', text: '' }
  }
}

/**
 * 定出任务的**展示文件名**与**产物绝对路径**。
 *
 * 展示层只要文件名 + 后缀（不显示下载位置），但打开 / 定位需要绝对路径，所以两条线
 * 分开算：路径优先从命令行开关拿，文件名优先从进度块的行首拿（wget 式），最后才退回
 * 被擦掉路径的标签文本。
 *
 * @param {string} label - 任务标签（对 DSH 后台任务而言通常是整行命令行）。
 * @param {string} blockRaw - 进度块原文（`raw`）。
 * @param {string} tailText - 输出尾部全文。
 * @param {unknown} metricsLabel - 进度源自己写的名字。
 * @param {string} fallback - 兜底显示名（任务 id 之类）。
 * @returns {{ fileName: string, filePath: string|null, nameFromPath: boolean }} 文件信息。
 */
function resolveFileIdentity(label, blockRaw, tailText, metricsLabel, fallback) {
  const filePath = outputPathFromCommand(label) ?? outputPathFromCommand(tailText)
  const metricsName = nonEmptyString(metricsLabel)
  const blockLines = typeof blockRaw === 'string' && blockRaw !== '' ? blockRaw.split('\n') : []
  const candidates = [
    fileNameOf(filePath),
    fileNameFromLines(blockLines),
    metricsName !== undefined && /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(metricsName) ? metricsName : undefined,
    metricsName,
    // 兜底显示名：只取命令行第一行，并**擦掉所有本地路径**——显示层绝不泄漏下载位置。
    stripPaths(firstLineOf(label)) === '' ? undefined : stripPaths(firstLineOf(label)),
  ]
  let fileName
  for (const candidate of candidates) {
    const value = nonEmptyString(candidate)
    if (value !== undefined) { fileName = value; break }
  }
  return {
    fileName: fileName ?? fallback,
    filePath: filePath ?? null,
    nameFromPath: fileNameOf(filePath) !== undefined && fileName === fileNameOf(filePath),
  }
}

/**
 * 把一条 `ctx.jobs` 投影变成任务。
 * @param {any} jobs - 注册表。
 * @param {Record<string, any>} view - 任务投影（`JobView`）。
 * @param {string} owner - 用来读取的调用方会话（可能为空串）。
 * @returns {Record<string, unknown>} 任务记录。
 */
function taskFromJob(jobs, view, owner) {
  const id = String(view.id)
  const progress = readJobProgress(jobs, view, owner)
  const metrics = finalizeMetrics({ ...progress.metrics, ...(nonEmptyString(view.progress) !== undefined ? parseProgressText(view.progress).metrics : {}) })
  const status = nonEmptyString(view.status) ?? 'unknown'
  const label = nonEmptyString(view.label) ?? id
  const identity = resolveFileIdentity(label, progress.raw, progress.text, metrics.label, `${nonEmptyString(view.kind) ?? 'job'} ${id}`)
  const file = identity.filePath === null ? { exists: false, isFile: false } : statOf(identity.filePath)
  if (identity.filePath !== null) rememberOpenablePath(identity.filePath)
  return {
    id: `job:${id}`,
    sourceId: 'dsh-jobs',
    sourceLabel: 'DSH 后台任务',
    jobId: id,
    kind: nonEmptyString(view.kind) ?? 'job',
    name: identity.fileName,
    fileName: identity.fileName,
    filePath: identity.filePath,
    fileExists: file.exists === true && file.isFile === true,
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    owner: nonEmptyString(view.owner) ?? null,
    readAs: owner === '' ? null : owner,
    startedAt: finiteNumber(view.startedAt) ?? null,
    finishedAt: finiteNumber(view.finishedAt) ?? null,
    detail: nonEmptyString(view.detail) ?? null,
    outputBytes: finiteNumber(view.output?.total) ?? null,
    progressLine: nonEmptyString(view.progress) ?? null,
    metrics,
    raw: progress.raw,
  }
}

/**
 * 数据源 ②：DSH 自身的会话内 managed background job。
 * @param {any} ctx - host 上下文。
 * @param {string|undefined} sessionId - 请求带来的会话 id。
 * @returns {{ tasks: Record<string, unknown>[], source: Record<string, unknown> }} 任务与数据源状态。
 */
function collectJobTasks(ctx, sessionId) {
  const source = { id: 'dsh-jobs', label: 'DSH 后台任务', available: false, count: 0, reason: null }
  const jobs = ctx.get('jobs')
  if (jobs === undefined || typeof jobs.list !== 'function' || typeof jobs.readAt !== 'function') {
    source.reason = '宿主没有提供 ctx.jobs 注册表（需要 @deepseek-ai/dsh-jobs-local 之类的实现）'
    return { tasks: [], source }
  }
  source.available = true
  const seen = new Set()
  const tasks = []
  const now = Date.now()
  for (const owner of collectSessionIds(ctx, sessionId)) {
    let views
    try {
      views = jobs.list(owner)
    } catch {
      continue
    }
    for (const view of Array.isArray(views) ? views : []) {
      const id = nonEmptyString(view?.id)
      if (id === undefined || seen.has(id)) continue
      seen.add(id)
      const status = nonEmptyString(view.status) ?? 'unknown'
      const finishedAt = finiteNumber(view.finishedAt)
      const terminal = status === 'completed' || status === 'killed' || status === 'failed'
      if (terminal && (finishedAt === undefined || now - finishedAt > RECENT_SETTLED_MS)) continue
      tasks.push(taskFromJob(jobs, view, owner))
    }
  }
  tasks.sort((left, right) => (finiteNumber(right.startedAt) ?? 0) - (finiteNumber(left.startedAt) ?? 0))
  source.count = tasks.length
  return { tasks, source }
}

/**
 * 数据源 ①：`dsh-ops/background` 的后台任务。它当前只注册工具、不发布服务，
 * 所以这里是**结构探测**：拿到就映射，拿不到就如实报"不可用"。
 * @param {any} ctx - host 上下文。
 * @param {string|undefined} sessionId - 请求带来的会话 id。
 * @returns {{ tasks: Record<string, unknown>[], source: Record<string, unknown> }} 任务与数据源状态。
 */
function collectOpsTasks(ctx, sessionId) {
  const source = { id: 'ops-background', label: 'dsh-ops/background', available: false, count: 0, reason: null }
  let found
  for (const name of OPS_SERVICE_NAMES) {
    try {
      const candidate = ctx.get(name)
      if (candidate !== undefined && typeof candidate.list === 'function') { found = candidate; break }
    } catch { /* 继续探测下一个 */ }
  }
  if (found === undefined) {
    source.reason = 'dsh-ops/background 未发布服务扩展点（它只注册 run_background / job_list 等工具），已跳过'
    return { tasks: [], source }
  }
  source.available = true
  const tasks = []
  let rows
  try {
    rows = found.list(sessionId)
  } catch {
    try { rows = found.list() } catch { rows = undefined }
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = nonEmptyString(row?.id) ?? nonEmptyString(row?.jobId)
    if (id === undefined) continue
    const status = nonEmptyString(row?.status) ?? 'unknown'
    const metrics = finalizeMetrics({
      done: jsonNumber(row?.done), total: jsonNumber(row?.total),
      bytes: jsonNumber(row?.bytes), bytesTotal: jsonNumber(row?.bytesTotal),
      speed: jsonNumber(row?.speed), etaMs: jsonDuration(row?.eta),
      percent: jsonNumber(row?.percent),
    })
    tasks.push({
      id: `ops:${id}`,
      sourceId: 'ops-background',
      sourceLabel: 'dsh-ops/background',
      jobId: id,
      kind: nonEmptyString(row?.kind) ?? 'ops',
      name: nonEmptyString(row?.label) ?? nonEmptyString(row?.name) ?? id,
      status,
      statusLabel: STATUS_LABELS[status] ?? status,
      owner: nonEmptyString(row?.owner) ?? null,
      readAs: null,
      startedAt: finiteNumber(row?.startedAt) ?? null,
      finishedAt: finiteNumber(row?.finishedAt) ?? null,
      detail: nonEmptyString(row?.detail) ?? null,
      outputBytes: null,
      progressLine: null,
      metrics,
      raw: '',
    })
  }
  if (tasks.length === 0 && source.reason === null) source.reason = '服务存在但列表为空'
  source.count = tasks.length
  return { tasks, source }
}

/**
 * 数据源 ③：配置里的进度源文件 / 目录。
 * @param {string[]} sources - 配置里的路径。
 * @returns {{ tasks: Record<string, unknown>[], source: Record<string, unknown> }} 任务与数据源状态。
 */
function collectFileTasks(sources) {
  const source = { id: 'progress-files', label: '进度源文件', available: sources.length > 0, count: 0, reason: null }
  if (sources.length === 0) {
    source.reason = '未配置 progressSources'
    return { tasks: [], source }
  }
  const collected = collectProgressFiles(sources)
  const tasks = collected.records.map((record, position) => {
    const metrics = finalizeMetrics(record.metrics)
    const status = nonEmptyString(metrics.status) ?? (finiteNumber(metrics.percent) === 100 ? 'completed' : 'running')
    // 进度源里的 JSON 可以直接给 `path` / `file` / `output` —— 那才是下载产物本身；
    // 源文件自己（`record.file`）是"看板"，不是被下载的东西，所以只当兜底。
    const declaredPath = nonEmptyString(record.metrics.path)
      ?? nonEmptyString(record.metrics.file)
      ?? nonEmptyString(record.metrics.output)
    const identity = resolveFileIdentity(
      typeof declaredPath === 'string' ? declaredPath : '',
      record.raw,
      record.raw,
      metrics.label,
      `${basenameOf(record.file)}${collected.records.length > 1 ? ` #${record.index + 1}` : ''}`,
    )
    const file = identity.filePath === null ? { exists: false, isFile: false } : statOf(identity.filePath)
    if (identity.filePath !== null) rememberOpenablePath(identity.filePath)
    return {
      id: `file:${record.file}#${record.index}#${position}`,
      sourceId: 'progress-files',
      sourceLabel: '进度源文件',
      jobId: null,
      kind: 'file',
      name: identity.fileName,
      fileName: identity.fileName,
      filePath: identity.filePath,
      fileExists: file.exists === true && file.isFile === true,
      status,
      statusLabel: STATUS_LABELS[status] ?? status,
      owner: null,
      readAs: null,
      startedAt: null,
      finishedAt: null,
      detail: nonEmptyString(metrics.detail) ?? null,
      outputBytes: null,
      progressLine: null,
      path: record.file,
      metrics,
      raw: record.raw,
    }
  })
  if (tasks.length === 0) source.reason = collected.notes.length > 0 ? collected.notes.join('；') : '没有可识别的进度块'
  source.count = tasks.length
  return { tasks, source }
}

/**
 * 取路径最后一段（不依赖 node:path，避免为了一个字符串去碰内建模块）。
 * @param {string} target - 路径。
 * @returns {string} 文件名。
 */
function basenameOf(target) {
  const parts = String(target).split(/[\\/]/)
  return parts[parts.length - 1] || String(target)
}

/**
 * 取多行文本的第一行非空内容并压到一行。
 * @param {string} text - 原始标签。
 * @returns {string} 单行标签。
 */
function firstLineOf(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed
  }
  return String(text)
}

/**
 * 汇总一次请求的全部任务。
 * @param {any} ctx - host 上下文。
 * @param {{ progressSources: string[], pollIntervalMs: number }} config - 收窄后的配置。
 * @param {string|undefined} sessionId - 请求带来的会话 id。
 * @returns {{ tasks: Record<string, unknown>[], sources: Record<string, unknown>[], canOpenWithDesktop: boolean, pollIntervalMs: number, generatedAt: number }} 响应载荷。
 */
function collectTasks(ctx, config, sessionId) {
  const ops = collectOpsTasks(ctx, sessionId)
  const jobs = collectJobTasks(ctx, sessionId)
  const files = collectFileTasks(config.progressSources)
  const tasks = [...ops.tasks, ...jobs.tasks, ...files.tasks].slice(0, MAX_TASKS)
  // 客户端据此决定"打开 / 打开所在文件夹"两个按钮要不要出现：宿主没有原生打开能力
  // （非桌面部署）时它们不该出现，而不是点了报错。
  const canOpen = canOpenWithDesktop(ctx)
  return {
    generatedAt: Date.now(),
    pollIntervalMs: config.pollIntervalMs,
    canOpenWithDesktop: canOpen,
    sources: [ops.source, jobs.source, files.source],
    tasks,
  }
}

// ── src/host/50-route.js ───────────────────────────────────────────────────
/**
 * 只读状态路由 `GET /download-progress`。
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
 * 会写的那条（打开文件 / 定位文件夹）在 `60-open.js` 的 `POST /download-progress/open`，
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
    path: '/download-progress',
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
        const url = new URL(req.url ?? '/download-progress', 'http://dsh.internal')
        const value = collectTasks(ctx, config, url.searchParams.get('sessionId') ?? undefined)
        sendJson(res, 200, { ok: true, value })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { ok: false, error: { code: 'internal-error', message } })
      }
    },
  }
}

// ── src/host/60-open.js ────────────────────────────────────────────────────
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
    path: '/download-progress/open',
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

// ── src/host/90-entry.js ───────────────────────────────────────────────────
/**
 * dsh-download-progress —— host 半边入口。
 *
 * 挂两条路由到宿主 webServer：
 * - `GET  /download-progress`       只读状态（数据来自三路：dsh-ops/background 服务 →
 *                               宿主 `ctx.jobs` 注册表 → 配置的进度源文件）
 * - `POST /download-progress/open`  用系统默认应用打开产物 / 在文件管理器里定位它。
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
    'dsh-download-progress: GET /download-progress',
  )
  ctx.effect(
    () => ctx.webServer.register(createTaskProgressOpenRoute(ctx)),
    'dsh-download-progress: POST /download-progress/open',
  )
  const logger = ctx.logger
  if (logger !== undefined && typeof logger.info === 'function') {
    const sources = resolved.progressSources.length
    const desktop = canOpenWithDesktop(ctx) ? '可用' : '不可用'
    logger.info(`dsh-download-progress: /download-progress 就绪（轮询 ${resolved.pollIntervalMs}ms，进度源 ${sources} 个，原生打开${desktop}）`)
  }
}

export { Config, apply, inject };
