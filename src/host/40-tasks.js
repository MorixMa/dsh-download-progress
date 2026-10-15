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
