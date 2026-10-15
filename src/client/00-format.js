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
