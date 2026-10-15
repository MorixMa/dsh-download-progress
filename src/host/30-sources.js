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
