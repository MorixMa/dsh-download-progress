/**
 * 解析器单测：直接拿**源码碎片**拼出同一个模块作用域来跑，测的就是随包发布的那份
 * 代码（不复制粘贴一份"测试专用实现"）。
 *
 * 手法：`tools/build.mjs` 导出了碎片清单与拼接函数，这里把它们包进 `new Function`
 * 并 return 出内部符号。碎片本身没有一条 import，所以在函数体里跑得起来。
 *
 * 用法：node tests/test-parsers.mjs
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { concatFragments, CLIENT_FRAGMENTS, HOST_FRAGMENTS } from '../tools/build.mjs'

/** 包根目录（测试里用一个真实存在的文件当"下载产物"）。 */
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 把 host 碎片拼成一个函数体，导出内部符号供断言使用。 */
function loadInternals() {
  const body = `${concatFragments('host', HOST_FRAGMENTS)}
return { apply, parseProgressText, parseProgressDocument, finalizeMetrics, collectProgressBlock, narrowConfig, configProblems, Config, isTrustedRequest, createTaskProgressRoute, createTaskProgressOpenRoute, collectTasks, collectProgressFiles, collectFileTasks, rememberOpenablePath, isKnownOpenablePath, fileNameOf, stripPaths, outputPathFromCommand, fileNameFromLines, absoluteFilePathsIn, canOpenWithDesktop }`
  const build = new Function(body)
  return build()
}

/** 把 client 碎片拼成一个函数体（client 依赖 React，这里只取纯函数）。 */
function loadClientInternals() {
  const body = `const React = { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) }
const h = React.createElement
${concatFragments('client', CLIENT_FRAGMENTS)}
return { formatBytes, formatSpeed, formatDuration, formatRatio, formatPercent, createSampler, aggregateTasks }`
  const build = new Function(body)
  return build()
}

const failures = []
/**
 * 断言帮助函数。
 * @param {string} label - 断言名。
 * @param {boolean} ok - 是否通过。
 * @param {string} [detail] - 失败时的细节。
 */
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}

const host = loadInternals()
const client = loadClientInternals()

// ── Markdown 进度块 ────────────────────────────────────────────────────────
const markdown = [
  '正在下载 思源黑体.zip',
  '',
  '# 字体包下载',
  '进度 ██████░░░░ 11/47 (23%)',
  '体积 90.0 MB / 100.0 MB',
  '速度 0.42 MB/s',
  '剩余 00:02:31',
].join('\n')
const markdownParsed = host.parseProgressText(markdown)
check('Markdown：标签取标题', markdownParsed.metrics.label === '字体包下载', String(markdownParsed.metrics.label))
check('Markdown：百分比 23', markdownParsed.metrics.percent === 23, String(markdownParsed.metrics.percent))
check('Markdown：完成量 11/47', markdownParsed.metrics.done === 11 && markdownParsed.metrics.total === 47,
  `${markdownParsed.metrics.done}/${markdownParsed.metrics.total}`)
check('Markdown：体积 90MB/100MB',
  Math.round(host.finalizeMetrics(markdownParsed.metrics).bytes / 1048576) === 90
  && Math.round(host.finalizeMetrics(markdownParsed.metrics).bytesTotal / 1048576) === 100,
  `${markdownParsed.metrics.bytes} / ${markdownParsed.metrics.bytesTotal}`)
check('Markdown：速率 0.42 MB/s ≈ 440401 B/s',
  Math.abs(markdownParsed.metrics.speed - 0.42 * 1024 * 1024) < 1, String(markdownParsed.metrics.speed))
check('Markdown：剩余 2 分 31 秒 = 151000ms', markdownParsed.metrics.etaMs === 151000, String(markdownParsed.metrics.etaMs))

// ── 只有进度条时按填充比例推百分比 ─────────────────────────────────────────
const barOnly = host.parseProgressText('打包中\n[########------------]')
check('进度条兜底：8/20 = 40%', Math.round(host.finalizeMetrics(barOnly.metrics).percent) === 40,
  String(host.finalizeMetrics(barOnly.metrics).percent))
check('markdown 标题不会被误读成进度条', host.parseProgressText('## 标题\n自动构建').metrics.percent === undefined)

// ── 完成清单不能被误读成「已传 / 总量」 ─────────────────────────────────────
const fileList = host.parseProgressText([
  '  ✓ SawarabiMincho/SawarabiMincho-Regular.ttf  3.49 MB',
  '  ✓ ShipporiMincho/ShipporiMincho-Bold.ttf  8.17 MB',
  '  ✗ ShipporiMinchoB1  （所有候选名都未命中）',
].join('\n'))
check('跨行的文件大小清单不会被拼成 已传/总量', fileList.metrics.bytesTotal === undefined,
  `bytes=${fileList.metrics.bytes} bytesTotal=${fileList.metrics.bytesTotal}`)
check('跨行的文件大小清单不会推出百分比',
  host.finalizeMetrics(fileList.metrics).percent === undefined,
  String(host.finalizeMetrics(fileList.metrics).percent))

// ── 无速率 / 无剩余时按要求只留空缺 ────────────────────────────────────────
const minimal = host.parseProgressText('进度 3/10')
const minimalFinal = host.finalizeMetrics(minimal.metrics)
check('只有 3/10 时百分比 = 30', minimalFinal.percent === 30, String(minimalFinal.percent))
check('没有速率时绝不编造速度', minimalFinal.speed === undefined, String(minimalFinal.speed))
check('没有速率时绝不编造剩余时间', minimalFinal.etaMs === undefined, String(minimalFinal.etaMs))

// ── 有速率有总量时由「剩余字节 ÷ 速率」推 ETA ──────────────────────────────
const derived = host.finalizeMetrics(host.parseProgressText('体积 100 MB\n已传输 40 MB\n速度 1 MB/s').metrics)
check('由字节 + 速率推 ETA = 60 秒', derived.etaMs !== undefined && Math.abs(derived.etaMs - 60000) < 50, String(derived.etaMs))

// ── 通用 JSON ─────────────────────────────────────────────────────────────
const json = JSON.stringify({ label: '模型权重', total: 47, done: 11, bytes: 94371840, bytesTotal: 104857600, speed: 440401, eta: 24000 })
const jsonParsed = host.parseProgressDocument(json)
check('JSON：单对象解析成 1 个任务', jsonParsed.tasks.length === 1 && jsonParsed.format === 'json', jsonParsed.format)
check('JSON：字段原样带上', jsonParsed.tasks[0].label === '模型权重' && jsonParsed.tasks[0].done === 11 && jsonParsed.tasks[0].etaMs === 24000,
  JSON.stringify(jsonParsed.tasks[0]))
const jsonList = host.parseProgressDocument(JSON.stringify({ tasks: [{ label: 'A', percent: 10 }, { label: 'B', percent: 90 }] }))
check('JSON：tasks 数组形态', jsonList.tasks.length === 2 && jsonList.tasks[1].label === 'B', String(jsonList.tasks.length))
check('JSON：eta 支持字符串时长', host.parseProgressDocument(JSON.stringify({ label: 'X', eta: '1m30s' })).tasks[0].etaMs === 90000)
check('空文本走空态', host.parseProgressDocument('   ').format === 'empty')

// ── 真实下载器的输出格式（用 curl / wget 的实际字节） ──────────────────────
// curl --progress-bar 用 \r 刷新、整段没有换行：必须按 \r 分帧，否则整段输出会被当成
// 一行，进度块退化成一大坨文本，跨行启发式（已传/总量）也失去意义。
const curlBar = ['\r', `${'#'.repeat(9)}${' '.repeat(60)}  13.1%`,
  `\r${'#'.repeat(28)}${' '.repeat(41)}  45.2%`,
  `\r${'#'.repeat(62)}${' '.repeat(7)}  98.6%`, '\r\n'].join('')
const curlParsed = host.parseProgressText(curlBar)
check('curl --progress-bar：\\r 分帧后取最后一次百分比', curlParsed.metrics.percent === 98.6, String(curlParsed.metrics.percent))
check('curl --progress-bar：进度块是尾部几帧，不是整段输出',
  curlParsed.raw.split('\n').length <= 4, `${curlParsed.raw.split('\n').length} 行`)

// wget 的进度行：无 B 后缀的 `7.98M`、方括号进度条、`eta 8s`。
const wgetLine = 'NotoSansSC.ttf  45%[===================>      ]   7.98M  1.21MB/s    eta 8s'
const wgetParsed = host.finalizeMetrics(host.parseProgressText(wgetLine).metrics)
check('wget：百分比 45', wgetParsed.percent === 45, String(wgetParsed.percent))
check('wget：无 B 后缀的 7.98M 读成字节数', Math.round(wgetParsed.bytes / 1048576 * 100) / 100 === 7.98, String(wgetParsed.bytes))
check('wget：速率 1.21MB/s ≈ 1268777 B/s', Math.abs(wgetParsed.speed - 1.21 * 1048576) < 1, String(wgetParsed.speed))
check('wget：eta 8s → 8000ms', wgetParsed.etaMs === 8000, String(wgetParsed.etaMs))

// 真实场景：脚本先打一行总量，再持续打 wget 式进度行。
const realBlock = [
  '目标：NotoSansSC-VF.ttf  16.95 MB',
  'NotoSansSC-VF.ttf  24%[======                      ]  4.07M  465KB/s  eta 26s',
  'NotoSansSC-VF.ttf  36%[==========                  ]  6.10M  512KB/s  eta 24s',
].join('\n')
const realParsed = host.finalizeMetrics(host.parseProgressText(realBlock).metrics)
check('真实下载：进度行的 6.10M 读成已传输量', Math.round(realParsed.bytes / 1048576 * 100) / 100 === 6.10,
  String(realParsed.bytes))
check('真实下载：头部那行的 16.95 MB 落到总量格',
  Math.round(realParsed.bytesTotal / 1048576 * 100) / 100 === 16.95, String(realParsed.bytesTotal))
check('真实下载：百分比 / 速率 / 剩余时间都对',
  realParsed.percent === 36 && Math.abs(realParsed.speed - 512 * 1024) < 1 && realParsed.etaMs === 24000,
  JSON.stringify({ percent: realParsed.percent, speed: realParsed.speed, etaMs: realParsed.etaMs }))

// 反向：不能被误读的两种写法。
check('时长 1m30s 不会被读成字节数',
  host.parseProgressText('剩余 1m30s').metrics.bytes === undefined,
  String(host.parseProgressText('剩余 1m30s').metrics.bytes))
const onlySpeed = host.parseProgressText('下载中  1.21MB/s').metrics
check('速率不会被同时读成字节数', onlySpeed.bytes === undefined && onlySpeed.speed > 0, JSON.stringify(onlySpeed))

// ── 配置收窄 ──────────────────────────────────────────────────────────────
check('配置：默认轮询 1500ms', host.narrowConfig(undefined).pollIntervalMs === 1500)
check('配置：轮询越界被钳制', host.narrowConfig({ pollIntervalMs: 999999 }).pollIntervalMs === 60000)
check('配置：progressSources 去空项', host.narrowConfig({ progressSources: ['D:\\a.md', '  '] }).progressSources.length === 1)
check('配置：未知字段被拒', host.configProblems({ nope: 1 }).length === 1, JSON.stringify(host.configProblems({ nope: 1 })))
check('配置：Standard Schema 形状',
  host.Config['~standard'].version === 1
  && host.Config['~standard'].vendor === 'dsh-task-progress'
  && Array.isArray(host.Config['~standard'].validate({}).value.progressSources)
  && host.Config['~standard'].validate({}).value.pollIntervalMs === 1500
  && Array.isArray(host.Config['~standard'].validate({ nope: 1 }).issues))
check('配置：合法输入经 Config 规范化', host.Config['~standard'].validate({ pollIntervalMs: 2000 }).value.pollIntervalMs === 2000)

// ── 客户端格式化 ──────────────────────────────────────────────────────────
check('格式化：格式化字节', client.formatBytes(94371840) === '90.0 MB', client.formatBytes(94371840))
check('格式化：格式化速率', client.formatSpeed(440401) === '430 KB/s', client.formatSpeed(440401))
check('格式化：格式化速率（小数位）', client.formatSpeed(1024 * 1024 * 1.5) === '1.5 MB/s', client.formatSpeed(1024 * 1024 * 1.5))
check('格式化：格式化时长', client.formatDuration(151000) === '2 分 31 秒', client.formatDuration(151000))
check('格式化：格式化比例', client.formatRatio(11, 47) === '11 / 47', client.formatRatio(11, 47))
check('格式化：百分比', client.formatPercent(23.4) === '23%', client.formatPercent(23.4))

// ── 两帧差分 ──────────────────────────────────────────────────────────────
const sampler = client.createSampler()
const first = sampler([{ id: 'job:a', status: 'running', metrics: { bytes: 1000000, bytesTotal: 5000000 } }], 1000)
check('差分：第一帧不给速率（没有基线）', first[0].metrics.speed === undefined, String(first[0].metrics.speed))
const second = sampler([{ id: 'job:a', status: 'running', metrics: { bytes: 2000000, bytesTotal: 5000000 } }], 3000)
check('差分：第二帧算出 ≈500000 B/s', Math.abs(second[0].metrics.speed - 500000) < 1, String(second[0].metrics.speed))
check('差分：第二帧算出剩余时间 ≈6 秒', Math.abs(second[0].metrics.etaMs - 6000) < 50, String(second[0].metrics.etaMs))

// ── 聚合 ──────────────────────────────────────────────────────────────────
const agg = client.aggregateTasks([
  { id: 'a', status: 'running', metrics: { bytes: 50, bytesTotal: 100, percent: 50, etaMs: 1000 } },
  { id: 'b', status: 'running', metrics: { bytes: 100, bytesTotal: 100, percent: 100, etaMs: 0 } },
  { id: 'c', status: 'completed', metrics: { percent: 100 } },
])
check('聚合：只统计运行中（2 个）', agg.running === 2 && agg.total === 3, `${agg.running}/${agg.total}`)
check('聚合：字节口径总进度 = 75%', Math.round(agg.percent) === 75, String(agg.percent))
check('聚合：口径标记为 bytes', agg.basis === 'bytes', agg.basis)

// ── 信任围栏（Host / Origin / Sec-Fetch-Site） ─────────────────────────────
/**
 * 造一个最小请求。
 * @param {Record<string, string>} headers - 请求头。
 * @param {string} [method] - 方法。
 * @returns {{ method: string, url: string, headers: Record<string, string> }} 请求。
 */
const req = (headers, method = 'GET') => ({ method, url: '/task-progress', headers })
check('围栏：回环 Host 放行', host.isTrustedRequest(req({ host: '127.0.0.1:19387' }), []))
check('围栏：localhost 放行', host.isTrustedRequest(req({ host: 'localhost:19387' }), []))
check('围栏：局域网 Host 拒绝', host.isTrustedRequest(req({ host: '192.168.1.20:19387' }), []) === false)
check('围栏：trustedHosts 声明的权威放行',
  host.isTrustedRequest(req({ host: 'box.lan:19387' }), ['box.lan:19387']))
check('围栏：跨站抓取拒绝',
  host.isTrustedRequest(req({ host: '127.0.0.1:19387', 'sec-fetch-site': 'cross-site' }), []) === false)
check('围栏：同源 Origin 放行',
  host.isTrustedRequest(req({ host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' }), []))
check('围栏：异源 Origin 拒绝',
  host.isTrustedRequest(req({ host: '127.0.0.1:19387', origin: 'http://evil.example' }), []) === false)
check('围栏：桌面壳的 dsh-app://app origin 放行',
  host.isTrustedRequest(req({ host: '127.0.0.1:19387', origin: 'dsh-app://app' }), []))
check('围栏：不透明 origin "null" 拒绝',
  host.isTrustedRequest(req({ host: '127.0.0.1:19387', origin: 'null' }), []) === false)
check('围栏：缺 Host 拒绝', host.isTrustedRequest(req({}), []) === false)
check('围栏：端口不同但 hostname 相同仍放行（Chromium 会省略非默认端口）',
  host.isTrustedRequest(req({ host: '127.0.0.1:19387', origin: 'http://127.0.0.1' }), []))

// ── 路由：方法限制与 403 分支 ──────────────────────────────────────────────
/**
 * 造一个假的响应对象。
 * @returns {{ statusCode: number, headers: Record<string, string>, body: string, setHeader: Function, end: Function }} 响应。
 */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value },
    end(text) { this.body = text },
  }
}
const fakeRouteCtx = { get: () => undefined }
const route = host.createTaskProgressRoute(fakeRouteCtx, host.narrowConfig(undefined))
check('路由种类是 exact、路径是 /task-progress',
  route.kind === 'exact' && route.path === '/task-progress', `${route.kind} ${route.path}`)
const forbidden = fakeResponse()
await route.handler(req({ host: '10.0.0.5:19387' }), forbidden)
check('路由：非可信 Host 返回 403', forbidden.statusCode === 403, String(forbidden.statusCode))
const wrongMethod = fakeResponse()
await route.handler({ method: 'POST', url: '/task-progress', headers: { host: '127.0.0.1:19387' } }, wrongMethod)
check('路由：非 GET 返回 405', wrongMethod.statusCode === 405, String(wrongMethod.statusCode))
const okResponse = fakeResponse()
await route.handler(req({ host: '127.0.0.1:19387' }), okResponse)
const okBody = JSON.parse(okResponse.body)
check('路由：无注册表时也返回 200 + 三路数据源诊断',
  okResponse.statusCode === 200 && okBody.ok === true
  && Array.isArray(okBody.value.sources) && okBody.value.sources.length === 3,
  JSON.stringify(okBody.value.sources?.map(source => `${source.id}:${source.available}`)))
check('路由：响应里没有写路径（只有 tasks/sources/generatedAt/pollIntervalMs/canOpenWithDesktop）',
  JSON.stringify(Object.keys(okBody.value).sort()) === '["canOpenWithDesktop","generatedAt","pollIntervalMs","sources","tasks"]',
  JSON.stringify(Object.keys(okBody.value).sort()))

// ── 三路数据源合成 ────────────────────────────────────────────────────────
const fakeJobs = {
  list: () => [
    { id: 'bash-1', kind: 'bash', label: '下载\n(第二行)', status: 'running', startedAt: 1, output: { total: 30 } },
    { id: 'bash-2', kind: 'bash', label: '早已结束', status: 'completed', startedAt: 1, finishedAt: 1, output: { total: 0 } },
  ],
  readAt: () => ({ chunks: [{ at: 0, text: '进度 3/10 (30%)\n速度 1 MB/s' }], next: 30, lossy: false }),
}
const combined = host.collectTasks({ get: name => (name === 'jobs' ? fakeJobs : undefined) }, host.narrowConfig(undefined), 'session-x')
check('合成：运行中的任务在列，超期结算的不在列',
  combined.tasks.length === 1 && combined.tasks[0].jobId === 'bash-1',
  combined.tasks.map(task => task.id).join(','))
check('合成：多行 label 只取第一行', combined.tasks[0].name === '下载', combined.tasks[0].name)
check('合成：从任务输出尾部解析出进度',
  combined.tasks[0].metrics.percent === 30 && combined.tasks[0].metrics.speed === 1048576,
  JSON.stringify(combined.tasks[0].metrics))
check('合成：三路来源都被登记', combined.sources.map(source => source.id).join(',') === 'ops-background,dsh-jobs,progress-files',
  combined.sources.map(source => source.id).join(','))

// ── 进度源文件（③）：真的读一次磁盘（走 process.getBuiltinModule） ─────────
const demoDir = mkdtempSync(join(tmpdir(), 'dtp-'))
try {
  const demoMarkdown = join(demoDir, 'progress.md')
  const demoJson = join(demoDir, 'task.json')
  writeFileSync(demoMarkdown, [
    '# 字体包下载',
    '进度 ██████░░░░ 11/47 (23%)',
    '体积 90.0 MB / 100.0 MB',
    '速度 0.42 MB/s',
    '剩余 00:02:31',
  ].join('\n'), 'utf8')
  writeFileSync(demoJson, JSON.stringify({ label: '模型权重', total: 47, done: 11, bytesTotal: 104857600 }), 'utf8')
  writeFileSync(join(demoDir, 'ignore.bin'), '这不是进度文件', 'utf8')

  const fromFile = host.collectProgressFiles([demoMarkdown])
  check('进度源：单文件解析出 1 条', fromFile.records.length === 1 && fromFile.notes.length === 0,
    JSON.stringify(fromFile.notes))
  check('进度源：文件里的指标正确',
    fromFile.records[0].metrics.label === '字体包下载' && fromFile.records[0].metrics.done === 11,
    JSON.stringify(fromFile.records[0].metrics))

  const fromDir = host.collectProgressFiles([demoDir])
  check('进度源：目录浅扫描只认已知扩展名（.bin 被跳过）', fromDir.records.length === 2,
    fromDir.records.map(record => record.file.split(/[\\/]/).pop()).join(','))

  const fileTasks = host.collectFileTasks([demoMarkdown, demoJson])
  check('进度源：合成出 2 条任务且都带 id / name',
    fileTasks.tasks.length === 2 && fileTasks.tasks.every(task => typeof task.id === 'string' && task.name !== ''),
    fileTasks.tasks.map(task => `${task.name}=${Math.round(task.metrics.percent ?? -1)}%`).join(', '))

  const missing = host.collectProgressFiles([join(demoDir, '不存在.md')])
  check('进度源：路径不存在时给出诊断而不是抛错',
    missing.records.length === 0 && missing.notes.length === 1, JSON.stringify(missing.notes))
} finally {
  rmSync(demoDir, { recursive: true, force: true })
}
check('进度源：未配置时如实报「未配置 progressSources」',
  host.collectFileTasks([]).source.reason === '未配置 progressSources')

// ── 文件名 / 路径提取：显示层只给名字，内部才拿路径 ────────────────────────
check('文件名：取最后一段', host.fileNameOf('E:\\a\\b\\live-ls-lR.gz') === 'live-ls-lR.gz', String(host.fileNameOf('E:\\a\\b\\live-ls-lR.gz')))

const cmdLabel = "& 'D:\\real-download.ps1' -Url 'https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ls-lR.gz' -OutFile 'D:\\downloads\\live-ls-lR.gz' -LimitRate 150k"
check('产物路径：认 -OutFile 开关', host.outputPathFromCommand(cmdLabel) === 'D:\\downloads\\live-ls-lR.gz',
  String(host.outputPathFromCommand(cmdLabel)))
check('产物路径：不会把 URL 当成盘符路径',
  !host.absoluteFilePathsIn(cmdLabel).some(path => path.includes('tuna.tsinghua')),
  JSON.stringify(host.absoluteFilePathsIn(cmdLabel)))
check('产物路径：认 curl 的 -o', host.outputPathFromCommand("& curl.exe -L -# -o 'E:\\d\\x.tgz' 'https://e.com/x.tgz'") === 'E:\\d\\x.tgz',
  String(host.outputPathFromCommand("& curl.exe -L -# -o 'E:\\d\\x.tgz' 'https://e.com/x.tgz'")))
check('产物路径：退回到最后一个非脚本绝对路径',
  host.outputPathFromCommand("pwsh 'C:\\s\\fetch.ps1' 'D:\\out\\font.ttf'") === 'D:\\out\\font.ttf',
  String(host.outputPathFromCommand("pwsh 'C:\\s\\fetch.ps1' 'D:\\out\\font.ttf'")))

check('文件名：优先取 wget 式行首',
  host.fileNameFromLines(['live-ls-lR.gz  17%[====      ]  6.60 MB / 36.71 MB']) === 'live-ls-lR.gz',
  String(host.fileNameFromLines(['live-ls-lR.gz  17%[====      ]  6.60 MB / 36.71 MB'])))
check('文件名：不会把 90.0 当成文件名',
  host.fileNameFromLines(['体积 90.0 MB / 100.0 MB']) === undefined,
  String(host.fileNameFromLines(['体积 90.0 MB / 100.0 MB'])))

check('显示擦除：命令里的路径被抹掉（盘符与目录都不剩）',
  !host.stripPaths(cmdLabel).includes('D:\\') && !host.stripPaths(cmdLabel).includes('downloads'),
  JSON.stringify(host.stripPaths(cmdLabel)))
check('显示擦除：URL 不会被当成路径删掉（只删本地路径）',
  host.stripPaths("下载 https://example.com/a/b 完成").includes('example.com'),
  JSON.stringify(host.stripPaths('下载 https://example.com/a/b 完成')))

// ── 任务装配：DSH 后台任务给出文件名 + 隐藏路径 ────────────────────────────
const openCalls = []
const fakeSessionController = {
  canOpenPath: () => true,
  openPath: async (path) => { openCalls.push(`open:${path}`) },
  revealPath: async (path) => { openCalls.push(`reveal:${path}`) },
}
const outputFilePath = join(PLUGIN_ROOT, 'package.json')
const ctxWithJobs = {
  get: name => {
    if (name === 'jobs') return {
      list: () => [{
        id: 'pwsh-9', kind: 'pwsh', status: 'completed', startedAt: 1, finishedAt: Date.now(),
        label: `& 'D:\\real-download.ps1' -OutFile '${outputFilePath}'`,
        output: { total: 40 },
      }],
      readAt: () => ({ chunks: [{ at: 0, text: `${host.fileNameOf(outputFilePath)}  100%[${'='.repeat(28)}]  已传输 4.17 MB / 4.17 MB  速度 1.20 MB/s` }], next: 40, lossy: false }),
    }
    if (name === 'sessionController') return fakeSessionController
    return undefined
  },
}
const assembled = host.collectTasks(ctxWithJobs, host.narrowConfig(undefined), 'session-x')
const assembledTask = assembled.tasks[0] ?? {}
check('装配：展示名只有文件名 + 后缀', assembledTask.fileName === 'package.json', String(assembledTask.fileName))
check('装配：路径仍然带着（打开要用），但不在展示名里',
  assembledTask.filePath === outputFilePath && !String(assembledTask.name).includes('\\'),
  `${assembledTask.filePath}`)
check('装配：文件存在被如实标出', assembledTask.fileExists === true, String(assembledTask.fileExists))
check('装配：能力探测说桌面打开可用', assembled.canOpenWithDesktop === true)
check('装配：没有 sessionController 时如实报不可用',
  host.canOpenWithDesktop({ get: () => undefined }) === false)

// ── 打开路由：白名单 / 方法 / 围栏 ─────────────────────────────────────────
const openRoute = host.createTaskProgressOpenRoute(ctxWithJobs)
check('打开路由：路径是 /task-progress/open', openRoute.path === '/task-progress/open' && openRoute.kind === 'exact',
  `${openRoute.kind} ${openRoute.path}`)

/**
 * 造一个带 JSON body 的假请求。真实 Node 请求在 handler 挂完监听器之后才推数据，
 * 所以这里也等一个 tick 再 `data` + `end`。
 * @param {Record<string, string>} headers - 请求头。
 * @param {string} [method] - 方法。
 * @param {unknown} [body] - 请求体。
 * @returns {any} 假请求。
 */
function postRequest(headers, method = 'POST', body = undefined) {
  const listeners = { data: [], end: [], error: [] }
  const request = {
    method,
    url: '/task-progress/open',
    headers,
    on(event, handler) {
      if (listeners[event] === undefined) listeners[event] = []
      listeners[event].push(handler)
      if (event === 'end') {
        setTimeout(() => {
          if (body !== undefined) {
            const chunk = Buffer.from(JSON.stringify(body), 'utf8')
            for (const notify of listeners.data) notify(chunk)
          }
          for (const notify of listeners.end) notify()
        }, 0)
      }
      return request
    },
    destroy() {},
  }
  return request
}

const unknownResponse = fakeResponse()
const unknownReq = postRequest({ host: '127.0.0.1:19387' }, 'POST', { action: 'open', path: 'E:\\secret\\a.txt' })
await openRoute.handler(unknownReq, unknownResponse)
check('打开路由：白名单外的路径一律 403（不能当启动任意路径的后门）',
  unknownResponse.statusCode === 403, String(unknownResponse.statusCode))
check('打开路由：白名单外的路径不会触发任何原生调用', openCalls.length === 0, openCalls.join(','))

host.rememberOpenablePath(outputFilePath)
check('白名单：刚报告过的路径可查', host.isKnownOpenablePath(outputFilePath) === true)

const openResponse = fakeResponse()
const openReq = postRequest({ host: '127.0.0.1:19387' }, 'POST', { action: 'open', path: outputFilePath })
await openRoute.handler(openReq, openResponse)
check('打开路由：白名单内的文件用默认应用打开',
  openResponse.statusCode === 200 && openCalls.join(',') === `open:${outputFilePath}`,
  `${openResponse.statusCode} ${openCalls.join(',')}`)

const revealResponse = fakeResponse()
const revealReq = postRequest({ host: '127.0.0.1:19387' }, 'POST', { action: 'reveal', path: outputFilePath })
await openRoute.handler(revealReq, revealResponse)
check('打开路由：reveal 走定位而不是打开',
  revealResponse.statusCode === 200 && openCalls.join(',') === `open:${outputFilePath},reveal:${outputFilePath}`,
  openCalls.join(','))

const getResponse = fakeResponse()
await openRoute.handler(postRequest({ host: '127.0.0.1:19387' }, 'GET'), getResponse)
check('打开路由：GET 返回 405', getResponse.statusCode === 405, String(getResponse.statusCode))
const badHostResponse = fakeResponse()
const badHostReq = postRequest({ host: '10.0.0.5:19387' }, 'POST', { action: 'open', path: outputFilePath })
await openRoute.handler(badHostReq, badHostResponse)
check('打开路由：非可信 Host 返回 403', badHostResponse.statusCode === 403, String(badHostResponse.statusCode))
const badActionResponse = fakeResponse()
const badActionReq = postRequest({ host: '127.0.0.1:19387' }, 'POST', { action: 'launch', path: outputFilePath })
await openRoute.handler(badActionReq, badActionResponse)
check('打开路由：未知 action 被拒', badActionResponse.statusCode === 500, String(badActionResponse.statusCode))

// ── apply() 冒烟：装上之前先跑一遍，别等重启才发现挂不上 ────────────────────
const appliedRoutes = []
const effectLabels = []
const applyCtx = {
  effect: (fn, label) => { effectLabels.push(label); const disposer = fn(); return disposer },
  get: name => (name === 'jobs' ? undefined : (name === 'sessionController' ? undefined : undefined)),
  logger: { info: () => {} },
  webServer: {
    register: route => { appliedRoutes.push(route); return () => {} },
  },
}
let applyThrew = null
try {
  host.apply(applyCtx, { progressSources: [], pollIntervalMs: 1500 })
} catch (error) {
  applyThrew = error
}
check('apply() 不抛异常', applyThrew === null, String(applyThrew))
check('apply() 挂了恰好两条路由：状态 + 打开',
  appliedRoutes.length === 2 && appliedRoutes.map(route => route.path).join(',') === '/task-progress,/task-progress/open',
  appliedRoutes.map(route => `${route.kind} ${route.path}`).join(' | '))
check('apply() 两条 effect 都带说明标签', effectLabels.length === 2 && effectLabels.every(label => typeof label === 'string'),
  effectLabels.join(' | '))
check('apply() 支持坏配置（null）而不抛', (() => {
  try { host.apply(applyCtx, null); return true } catch { return false }
})())

// 路由 URL 解析已随「不再依赖 better-sidebar」重写，由 tests/test-client.mjs 覆盖
// （壳注入的 streamBaseUrl / 反代子路径前缀 / document.baseURI 三条路径）。

if (failures.length > 0) {
  console.error(`\n${failures.length} 项解析器断言未通过：${failures.join('; ')}`)
  process.exit(1)
}
console.log('\n解析器单测全部通过。')
