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
