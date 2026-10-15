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
    vendor: 'dsh-task-progress',
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
