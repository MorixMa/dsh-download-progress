/**
 * client 半边冒烟：在 Node 里用一个最小 React 替身 + `__ModuleLoader__` 替身把
 * `lib/client.js` **真跑一遍**，验证
 *
 *   1. 产物按 `window.__ModuleLoader__.load({ id, factory })` 的契约自注册，且
 *      `require` 面只有 `react`（**不依赖任何其它插件**）；
 *   2. `apply()` 真的把指示器注册进 **DSH 自己的** slot
 *      `conversation.session.header.utilities`；
 *   3. 组件能**首渲染不抛异常**，渲染出图标按钮、环形进度与正确 aria 属性；
 *   4. 任务行把指标摊成结构化数字，**不出现源里的 markdown 原文**。
 *
 * 用法：node tests/test-client.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
/**
 * 断言帮助函数。
 * @param {string} label - 断言名。
 * @param {boolean} ok - 是否通过。
 * @param {string} [detail] - 失败细节。
 */
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}

// ── 最小 React 替身：只提供组件用到的那几个 API ────────────────────────────
/**
 * createElement 替身：产出可遍历的普通对象。
 * @param {any} type - 元素类型。
 * @param {any} props - 属性。
 * @param {...any} children - 子节点。
 * @returns {Record<string, any>} 元素。
 */
function createElement(type, props, ...children) {
  return {
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false),
  }
}
const REACT_STUB = {
  createElement,
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: initial => ({ current: initial ?? null }),
}

// ── DOM 替身：installStyles 只用到这几个 API ───────────────────────────────
const STYLE_TAGS = []
globalThis.document = {
  baseURI: 'http://127.0.0.1:19387/',
  querySelector: () => null,
  createElement: () => {
    const tag = { dataset: {}, textContent: '' }
    STYLE_TAGS.push(tag)
    return tag
  },
  head: { appendChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
}

// ── ModuleLoader 替身：捕获 id / factory，并按契约提供 require ─────────────
let loaded = null
globalThis.window = {
  __ModuleLoader__: { load: registration => { loaded = registration } },
}

const source = readFileSync(resolve(PLUGIN_ROOT, 'lib', 'client.js'), 'utf8')
new Function('window', source)(globalThis.window)

check('client 产物向 window.__ModuleLoader__.load 自注册', loaded !== null)
check('模块 id 与包名一致', loaded?.id === 'dsh-task-progress', String(loaded?.id))

const REQUIRED = []
const module = loaded.factory(name => {
  REQUIRED.push(name)
  if (name === 'react') return REACT_STUB
  throw new Error(`产物 require 了未声明的宿主模块：${name}`)
})
check('factory 只 require react（零第三方插件依赖）', REQUIRED.length === 1 && REQUIRED[0] === 'react', JSON.stringify(REQUIRED))
check('导出 inject 只声明 slots', JSON.stringify(module.inject) === '["slots"]', JSON.stringify(module.inject))
check('导出 apply 是函数', typeof module.apply === 'function')

// ── 假的 Slot 服务 + client 上下文 ────────────────────────────────────────
const registered = []
const disposers = []
const fakeCtx = {
  effect: (fn, label) => {
    const disposer = fn()
    disposers.push({ label, disposer })
    return disposer
  },
  slots: {
    inject: (slotName, callback) => {
      const disposer = callback()
      disposers.push({ label: `slots.inject(${slotName})`, disposer })
      return disposer
    },
    register: (options, component) => {
      registered.push({ options, component })
      return () => { registered.pop() }
    },
  },
}

module.apply(fakeCtx)
check('apply 后恰好注册了 1 个 slot 条目', registered.length === 1, String(registered.length))
const entry = registered[0] ?? {}
check('挂载点是 DSH 自己的会话头工具区',
  entry.options?.name === 'conversation.session.header.utilities', String(entry.options?.name))
check('条目 id 为 dsh-task-progress:indicator',
  entry.options?.id === 'dsh-task-progress:indicator', String(entry.options?.id))
check('order = 5（排在系统项之后、第三方项之前）', entry.options?.order === 5, String(entry.options?.order))
check('声明了中文标签', entry.options?.label?.() === '任务进度', String(entry.options?.label?.()))
check('注册与样式都挂了 disposer', disposers.length === 2, disposers.map(item => item.label).join(' | '))
check('样式标签已注入且含动画关键帧',
  STYLE_TAGS.length === 1
  && ['@keyframes dtp-rotate', '@keyframes dtp-dash', '@keyframes dtp-shimmer', '@keyframes dtp-stripes',
    '@keyframes dtp-pop', '@keyframes dtp-rise'].every(key => STYLE_TAGS[0].textContent.includes(key)),
  String(STYLE_TAGS.length))
check('样式带 prefers-reduced-motion 关断', STYLE_TAGS[0].textContent.includes('prefers-reduced-motion:reduce'))
check('样式表里没有 markdown 原文块的类', !STYLE_TAGS[0].textContent.includes('.dtp-raw'))

// ── 首渲染 ────────────────────────────────────────────────────────────────
/**
 * 把元素树里的文本节点收成一个数组（函数组件直接调一次，不重复遍历 children）。
 * @param {any} node - 元素或文本。
 * @param {string[]} out - 收集数组。
 * @returns {string[]} 文本数组。
 */
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const item of node) collectText(item, out); return out }
  if (node.type === undefined) return out
  if (typeof node.type === 'string') return collectText(node.children, out)
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (node.children.length === 1) props.children = node.children[0]
    else if (node.children.length > 1) props.children = node.children
    return collectText(node.type(props), out)
  }
  return out
}

/**
 * 把元素树里所有 className 收成一个数组。
 * @param {any} node - 元素。
 * @param {string[]} out - 收集数组。
 * @returns {string[]} className 数组。
 */
function collectClasses(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const item of node) collectClasses(item, out); return out }
  if (node.type === undefined) return out
  if (typeof node.props?.className === 'string') out.push(node.props.className)
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (node.children.length === 1) props.children = node.children[0]
    else if (node.children.length > 1) props.children = node.children
    collectClasses(node.type(props), out)
    return out
  }
  for (const child of node.children) collectClasses(child, out)
  return out
}

let tree
try {
  tree = entry.component({ sessionId: 'session-abcdef' })
} catch (error) {
  check('组件首渲染不抛异常', false, String(error))
}
if (tree !== undefined) {
  const classes = collectClasses(tree)
  check('组件首渲染不抛异常', true)
  check('渲染出图标按钮（dtp-trigger）', classes.includes('dtp-trigger'), classes.join(','))
  check('按钮带 aria-haspopup / aria-expanded', tree.children[0].props['aria-haspopup'] === 'dialog'
    && tree.children[0].props['aria-expanded'] === 'false')
  check('渲染出环形进度（dtp-ring）', classes.some(name => name.startsWith('dtp-ring')), classes.join(','))
  check('渲染出下载图标（dtp-glyph）', classes.includes('dtp-glyph'))
  check('没有任务时不渲染数量角标', !classes.some(name => name.startsWith('dtp-count')), classes.join(','))
  check('没有任务时不渲染弹层', !classes.includes('dtp-pop'))
}

// ── 结构化的任务行（不出现 markdown 原文） ────────────────────────────────
const { aggregateTasks, createSampler, TaskRow, ProgressRing, TaskBar } = (() => {
  const read = name => readFileSync(resolve(PLUGIN_ROOT, 'src', 'client', name), 'utf8')
  const build = new Function(`const React = arguments[0]; const h = React.createElement;
${read('00-format.js')}
${read('05-route.js')}
${read('10-sampler.js')}
${read('20-styles.js')}
${read('30-view.js')}
return { aggregateTasks, createSampler, TaskRow, ProgressRing, TaskBar }`)
  return build(REACT_STUB)
})()

const sampleTask = {
  id: 'job:pwsh-2',
  // 旧字段：整行命令行。面板**不该**再显示它。
  name: "& 'D:\\demo-download.ps1'",
  // 新字段：只有文件名 + 后缀；绝对路径只用于打开，不进 UI。
  fileName: 'NotoSansSC-VF.ttf',
  filePath: 'D:\\downloads\\NotoSansSC-VF.ttf',
  fileExists: true,
  status: 'completed',
  statusLabel: '已完成',
  finishedAt: Date.now() - 60000,
  metrics: {
    percent: 100, done: 200, total: 200, bytes: 104857600, bytesTotal: 104857600,
    speed: 1310720, etaMs: 0,
  },
  // 源里的原文：只作为数据存在，**不允许出现在渲染结果里**
  raw: '进度 [----------] 12/200 (6%)\n体积 6.0 MB / 100.0 MB',
}
const opened = []
const onAction = (action, task) => { opened.push(`${action}:${task.fileName}`) }
const rowProps = { task: sampleTask, now: Date.now(), canOpenWithDesktop: true, busy: false, onAction }
const rowText = collectText(TaskRow(rowProps)).join(' ')
const rowClasses = collectClasses(TaskRow(rowProps))

check('任务行只显示文件名 + 后缀', rowText.includes('NotoSansSC-VF.ttf'), rowText.slice(0, 140))
check('任务行**不显示下载位置**（目录、盘符都不出现）',
  !rowText.includes('downloads') && !rowText.includes('D:\\') && !rowText.includes('demo-download.ps1'), rowText)
check('任务行不再显示整行命令行', !rowText.includes('demo-download.ps1'), rowText)
check('任务行把指标摊成结构化数字',
  rowText.includes('100%') && rowText.includes('200 / 200')
  && rowText.includes('100 MB / 100 MB'), rowText)
check('任务行**不渲染**源里的 markdown 原文',
  !rowText.includes('进度 [----------]') && !rowText.includes('体积 6.0 MB / 100.0 MB'), rowText)

// 单击打开 / 打开所在文件夹
const nameElement = TaskRow(rowProps).children[0].children[0]
check('已完成且文件在盘上时，文件名是可点击的按钮',
  nameElement.type === 'button' && nameElement.props.className.includes('dtp-name--link'), String(nameElement.type))
nameElement.props.onClick()
check('点文件名发出的是 open 动作', opened.join(',') === 'open:NotoSansSC-VF.ttf', opened.join(','))
const headChildren = TaskRow(rowProps).children[0].children
const folderButton = headChildren[headChildren.length - 1]
check('标题行有「打开所在文件夹」按钮', folderButton.type === 'button'
  && folderButton.props.title === '打开所在文件夹', String(folderButton.props.title))
folderButton.props.onClick()
check('点文件夹按钮发出的是 reveal 动作', opened.join(',') === 'open:NotoSansSC-VF.ttf,reveal:NotoSansSC-VF.ttf', opened.join(','))

const runningText = collectText(TaskRow({ ...rowProps, task: { ...sampleTask, status: 'running' } })).join(' ')
check('运行中的任务名不可点（避免打开半截文件）',
  TaskRow({ ...rowProps, task: { ...sampleTask, status: 'running' } }).children[0].children[0].type === 'span', runningText.slice(0, 80))

const noDesktop = TaskRow({ ...rowProps, canOpenWithDesktop: false })
check('宿主没有原生打开能力时两个入口都不出现',
  collectClasses(noDesktop).every(name => !name.includes('dtp-name--link') && !name.includes('dtp-icon-btn')),
  collectClasses(noDesktop).join(','))
const missingFile = TaskRow({ ...rowProps, task: { ...sampleTask, fileExists: false } })
check('文件不在盘上时不出现任何打开入口',
  collectClasses(missingFile).every(name => !name.includes('dtp-name--link') && !name.includes('dtp-icon-btn')),
  collectClasses(missingFile).join(','))

check('运行中的行带扫光动画类（dtp-fill--live）',
  collectClasses(TaskRow({ ...rowProps, task: { ...sampleTask, status: 'running' } }))
    .some(name => name.includes('dtp-fill--live')))
check('已完成的行换用成功色', collectClasses(TaskBar({ task: { status: 'completed', metrics: { percent: 100 } } }))
  .some(name => name.includes('dtp-fill--done')))
check('未知进度走马灯（dtp-track--unknown）', collectClasses(TaskBar({ task: { status: 'running', metrics: {} } }))
  .some(name => name.includes('dtp-track--unknown')))
check('环形进度在未知百分比时走旋转态',
  collectClasses(ProgressRing({ percent: null, spin: true })).some(name => name.includes('dtp-ring--spin')))
check('环形进度在已知百分比时不旋转',
  !collectClasses(ProgressRing({ percent: 42, spin: false })).some(name => name.includes('dtp-ring--spin')))

// ── 聚合 ──────────────────────────────────────────────────────────────────
const sampled = createSampler()([{
  id: 'job:a', status: 'running', metrics: { bytes: 50000000, bytesTotal: 100000000, percent: 50 },
}], 1000)
const agg = aggregateTasks(sampled)
check('聚合按字节口径给总进度 50%', agg.running === 1 && Math.round(agg.percent) === 50 && agg.basis === 'bytes',
  JSON.stringify({ running: agg.running, percent: agg.percent, basis: agg.basis }))
const aggByPercent = aggregateTasks([
  { id: 'x', status: 'running', metrics: { percent: 40 } },
  { id: 'y', status: 'running', metrics: { percent: 60 } },
])
check('没有字节口径时退回百分比平均，并如实标注口径',
  aggByPercent.basis === 'percent' && aggByPercent.percent === 50, JSON.stringify(aggByPercent))

// ── 路由 URL：HTTP 必须走**页面基底**，不能走壳注入的传输基底 ──────────────
// 这是实测踩过的坑：桌面壳页面是 dsh-app://app，__DSH_TRANSPORT__.streamBaseUrl 是
// 宿主的真实 origin（http://127.0.0.1:<port>）。用后者 = 跨源 fetch，而插件路由不回
// CORS 头 → 浏览器直接拒 → "TypeError: Failed to fetch"。
const { taskProgressRouteUrl } = (() => {
  const read = name => readFileSync(resolve(PLUGIN_ROOT, 'src', 'client', name), 'utf8')
  const build = new Function(`${read('05-route.js')}
return { taskProgressRouteUrl, taskProgressBase }`)
  return build()
})()
const ORIGINAL_BASE = globalThis.document.baseURI

globalThis.document.baseURI = 'dsh-app://app/'
globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:19387' }
const shellUrl = taskProgressRouteUrl('session-1')
check('路由：桌面壳里走页面基底 dsh-app://app（同源转发给宿主），不用传输基底',
  shellUrl === 'dsh-app://app/task-progress?sessionId=session-1', shellUrl)
check('路由：回归守卫——绝不把请求打到跨源的传输 origin 上',
  !shellUrl.startsWith('http://127.0.0.1:19387'), shellUrl)

globalThis.document.baseURI = 'https://host/dataops/proxy/3080/'
check('路由：反代子路径前缀被保留（相对路径，无前导斜杠）',
  taskProgressRouteUrl() === 'https://host/dataops/proxy/3080/task-progress', taskProgressRouteUrl())

globalThis.document.baseURI = 'https://host/dataops/proxy/3080'
check('路由：基底没有结尾斜杠时不会吃掉前缀最后一段',
  taskProgressRouteUrl() === 'https://host/dataops/proxy/3080/task-progress', taskProgressRouteUrl())

globalThis.document.baseURI = 'dsh-app://app/index.html'
check('路由：基底指向文件时替换掉文件名，而不是拼在它后面',
  taskProgressRouteUrl() === 'dsh-app://app/task-progress', taskProgressRouteUrl())

globalThis.document.baseURI = 'http://127.0.0.1:19387/?token=abc#x'
check('路由：基底的 query / hash 被丢掉（启动令牌不进 URL）',
  taskProgressRouteUrl() === 'http://127.0.0.1:19387/task-progress', taskProgressRouteUrl())

globalThis.document.baseURI = 'http://127.0.0.1:19387/'
check('路由：普通浏览器页面基底就是宿主 origin',
  taskProgressRouteUrl() === 'http://127.0.0.1:19387/task-progress', taskProgressRouteUrl())

// 非 DOM（SSR / 单测）才退回传输基底；这一支在真实浏览器里走不到。
delete globalThis.document
globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:19387/' }
check('路由：没有 document 时退回传输基底',
  taskProgressRouteUrl() === 'http://127.0.0.1:19387/task-progress', taskProgressRouteUrl())
delete globalThis.__DSH_TRANSPORT__
const bareUrl = taskProgressRouteUrl()
check('路由：两者都没有时给出一个合法的占位绝对 URL（这个环境不会真的发请求）',
  bareUrl.endsWith('/task-progress'), bareUrl)
globalThis.document = { ...globalThis.document, baseURI: ORIGINAL_BASE }

if (failures.length > 0) {
  console.error(`\n${failures.length} 项 client 冒烟未通过：${failures.join('; ')}`)
  process.exit(1)
}
console.log('\nclient 半边冒烟全部通过。')
