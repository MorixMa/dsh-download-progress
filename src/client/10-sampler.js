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
