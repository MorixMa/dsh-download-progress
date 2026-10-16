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
