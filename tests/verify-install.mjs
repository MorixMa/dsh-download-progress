/**
 * 安装自检：确认插件已被 profile 正确安装、产物符合 DSH 的加载契约、构建产物与源码
 * 同步，并在同一个进程里冒烟跑一遍进度解析器。
 *
 * 覆盖七类检查：
 *   1. profile 登记（node_modules 链接、dependencies、dsh.profile.bundles）；
 *   2. 产物存在（lib/index.js、lib/client.js、cordis.patch.yml、README.md、INSTALL.md）；
 *   3. package.json 的 `dsh` 字段与 peerDependencies 锚定；
 *   4. host 产物可被 Node 解析、导出面正确、且**零 import / 零 require**；
 *   5. client 产物的动态 bundle 契约（ModuleLoader 包装 / id / react 外部引用）；
 *   6. 包目录里没有 node_modules（会破坏 pnpm 的 link: 安装）；
 *   7. 产物不比源码旧，且解析器冒烟通过。
 *
 * 用法：node tests/verify-install.mjs
 * 环境变量：DSH_PROFILE_DIR 覆盖 profile 路径（默认 desktop）。
 */
import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CLIENT_FRAGMENTS, HOST_FRAGMENTS, concatFragments } from '../tools/build.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'dsh-download-progress'
const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? 'C:\\Users\\Morix\\.dsh\\profiles\\desktop'
/** 产物允许比源码旧的时间容差（checkout / merge 会把 mtime 刷成同一时刻）。 */
const MTIME_TOLERANCE_MS = 2000

const failures = []
const skipped = []
/**
 * 打印一条检查结果并记录失败。
 * @param {string} label - 检查名。
 * @param {boolean} ok - 是否通过。
 * @param {string} [detail] - 细节。
 */
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}

/**
 * 明确跳过一条**本机**检查（不计入失败）。CI 上没有 DSH profile，
 * 那几项本来就无从检查——跳过必须是响亮的，不能装成通过。
 * @param {string} label - 检查名。
 * @param {string} why - 为什么跳过。
 */
function skip(label, why) {
  console.log(`SKIP  ${label} — ${why}`)
  skipped.push(label)
}

const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))

// ── 1) profile 登记 ────────────────────────────────────────────────────────
const installed = resolve(PROFILE_DIR, 'node_modules', PLUGIN_ID)
const profileManifestPath = resolve(PROFILE_DIR, 'package.json')
const profileManifest = existsSync(profileManifestPath)
  ? JSON.parse(readFileSync(profileManifestPath, 'utf8'))
  : {}
const spec = String(profileManifest.dependencies?.[PLUGIN_ID] ?? '')

// CI（GitHub Actions）上没有 DSH profile —— 那几项是**本机**检查，缺失时明确跳过
// 而不是误报失败。本地跑同一个脚本时会真的检查。
if (!existsSync(PROFILE_DIR)) {
  skip('profile 登记（node_modules / dependencies / dsh.profile.bundles）',
    `本机没有 ${PROFILE_DIR}，跳过 —— 这是 CI 或未安装环境下的预期行为`)
} else {
  check('profile 的 node_modules 里有本插件目录', existsSync(installed), installed)
  if (existsSync(installed)) {
    let linkedHere = false
    try {
      linkedHere = realpathSync(installed) === realpathSync(PLUGIN_ROOT)
    } catch {
      linkedHere = false
    }
    check('依赖指向本目录（link: / file: 软链）', linkedHere || spec.startsWith('link:') || spec.startsWith('file:'),
      linkedHere ? `${spec} → 解析到本目录` : spec || '(未声明)')
  }
  check('profile dependencies 声明了本插件', PLUGIN_ID in (profileManifest.dependencies ?? {}), spec || '(缺失)')
  check('profile dsh.profile.bundles 注册了本插件',
    (profileManifest.dsh?.profile?.bundles ?? []).includes(PLUGIN_ID),
    JSON.stringify(profileManifest.dsh?.profile?.bundles ?? []))
}

// ── 2) 产物存在 ────────────────────────────────────────────────────────────
const hostEntry = resolve(PLUGIN_ROOT, 'lib', 'index.js')
const clientEntry = resolve(PLUGIN_ROOT, 'lib', 'client.js')
for (const [label, target] of [
  ['host 产物 lib/index.js', hostEntry],
  ['client 产物 lib/client.js', clientEntry],
  ['bundle patch cordis.patch.yml', resolve(PLUGIN_ROOT, 'cordis.patch.yml')],
  ['DSH 插件清单 dsh-plugin.json', resolve(PLUGIN_ROOT, 'dsh-plugin.json')],
  ['README.md', resolve(PLUGIN_ROOT, 'README.md')],
  ['README.en.md', resolve(PLUGIN_ROOT, 'README.en.md')],
  ['INSTALL.md', resolve(PLUGIN_ROOT, 'INSTALL.md')],
  ['CHANGELOG.md', resolve(PLUGIN_ROOT, 'CHANGELOG.md')],
  ['LICENSE', resolve(PLUGIN_ROOT, 'LICENSE')],
  ['CONTRIBUTING.md', resolve(PLUGIN_ROOT, 'CONTRIBUTING.md')],
  ['CODE_OF_CONDUCT.md', resolve(PLUGIN_ROOT, 'CODE_OF_CONDUCT.md')],
  ['SECURITY.md', resolve(PLUGIN_ROOT, 'SECURITY.md')],
]) check(`${label} 存在`, existsSync(target), target)

// ── 2b) DSH 插件市场 / 分享规则 ────────────────────────────────────────────
// 这三条来自 DSH 的插件装载契约与市场清单约束，不是风格偏好。
const dependencyFields = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']
const cordisHits = dependencyFields.filter(field => 'cordis' in (manifest[field] ?? {}))
check('市场约束：任何依赖字段里都没有 cordis', cordisHits.length === 0, cordisHits.join(',') || '无')
const installHooks = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']
const hookHits = installHooks.filter(hook => hook in (manifest.scripts ?? {}))
check('市场约束：scripts 里没有 install 类钩子', hookHits.length === 0,
  hookHits.join(',') || Object.keys(manifest.scripts ?? {}).join(','))
check('分享规则：包内不带 node_modules', !existsSync(join(PLUGIN_ROOT, 'node_modules')))
check('分享规则：产物随仓库提交（lib/ 不是忽略项）',
  !readFileSync(join(PLUGIN_ROOT, '.gitignore'), 'utf8')
    .split('\n').some(line => /^lib\/?\s*$/.test(line.trim())),
  'lib/ 被 gitignore 了 —— 安装端不会构建，产物必须提交')

// ── 2c) dsh-plugin.json 的结构校验（0.15 社区规范） ────────────────────────
// 不引 ajv：这个清单的约束很少，逐条断言比拉一个校验器依赖更合适
//（本仓库的依赖数永远是 0）。
const pluginManifestPath = resolve(PLUGIN_ROOT, 'dsh-plugin.json')
if (existsSync(pluginManifestPath)) {
  let pluginManifest = {}
  let manifestParsed = true
  try {
    pluginManifest = JSON.parse(readFileSync(pluginManifestPath, 'utf8'))
  } catch (error) {
    manifestParsed = false
    check('dsh-plugin.json 是合法 JSON', false, String(error))
  }
  if (manifestParsed) {
    check('dsh-plugin.json 是合法 JSON', true)
    check('清单：manifestVersion 为 0.15', pluginManifest.manifestVersion === '0.15', String(pluginManifest.manifestVersion))
    check('清单：id 符合 namespacedId 规则',
      /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/.test(String(pluginManifest.id)), String(pluginManifest.id))
    check('清单：name 与 package.json 一致', pluginManifest.name === manifest.name,
      `${pluginManifest.name} vs ${manifest.name}`)
    check('清单：version 与 package.json 一致', pluginManifest.version === manifest.version,
      `${pluginManifest.version} vs ${manifest.version}`)
    check('清单：license 与 package.json 一致', pluginManifest.license === manifest.license,
      `${pluginManifest.license} vs ${manifest.license}`)
    check('清单：facets.host.entry 指向真实存在的产物',
      typeof pluginManifest.facets?.host?.entry === 'string'
      && existsSync(resolve(PLUGIN_ROOT, pluginManifest.facets.host.entry)),
      String(pluginManifest.facets?.host?.entry))
    check('清单：facets.host.apiVersion 符合 vN[alpha|beta M] 规则',
      /^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/.test(String(pluginManifest.facets?.host?.apiVersion)),
      String(pluginManifest.facets?.host?.apiVersion))
    check('清单：facets 只声明 host（0.15 的 additionalProperties 限制）',
      Object.keys(pluginManifest.facets ?? {}).every(key => key === 'host'),
      Object.keys(pluginManifest.facets ?? {}).join(','))
    check('清单：permissions 每项都有 name/scope，name 合法',
      Array.isArray(pluginManifest.permissions) && pluginManifest.permissions.length > 0
      && pluginManifest.permissions.every(item =>
        typeof item?.name === 'string' && typeof item?.scope === 'string' && item.scope.length > 0
        && /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/.test(item.name)),
      JSON.stringify((pluginManifest.permissions ?? []).map(item => item.name)))
    check('清单：source.repository 指向本仓库',
      pluginManifest.source?.repository === 'https://github.com/MorixMa/dsh-download-progress',
      String(pluginManifest.source?.repository))
    check('清单：contributes 的扩展键都带 x- 前缀（0.15 只允许 commands/panels）',
      Object.keys(pluginManifest.contributes ?? {}).every(key => key === 'commands' || key === 'panels' || key.startsWith('x-')),
      Object.keys(pluginManifest.contributes ?? {}).join(','))
  }
}

// ── 3) dsh 字段与 peer 锚定 ────────────────────────────────────────────────
check('manifest 的 dsh.bundle.patch 指向 ./cordis.patch.yml',
  manifest.dsh?.bundle?.patch === './cordis.patch.yml', String(manifest.dsh?.bundle?.patch))
check('manifest 的 dsh.client.platform 为 web',
  manifest.dsh?.client?.platform === 'web', String(manifest.dsh?.client?.platform))
check('manifest 的 dsh.client.inject 是非空字符串数组',
  Array.isArray(manifest.dsh?.client?.inject) && manifest.dsh.client.inject.length > 0
  && manifest.dsh.client.inject.every(item => typeof item === 'string'),
  JSON.stringify(manifest.dsh?.client?.inject))
check('peerDependencies 精确锚定 >=0.2.0-rc.1 <0.2.1',
  manifest.peerDependencies?.['@deepseek-ai/dsh'] === '>=0.2.0-rc.1 <0.2.1',
  String(manifest.peerDependencies?.['@deepseek-ai/dsh']))
check('peerDependenciesMeta 把宿主提供的包标为 optional',
  manifest.peerDependenciesMeta?.['@deepseek-ai/dsh']?.optional === true,
  JSON.stringify(manifest.peerDependenciesMeta))
check('peerDependencies 里没有任何第三方插件（只锚定宿主）',
  Object.keys(manifest.peerDependencies ?? {}).every(name => name === '@deepseek-ai/dsh'),
  Object.keys(manifest.peerDependencies ?? {}).join(','))
const patchText = existsSync(resolve(PLUGIN_ROOT, 'cordis.patch.yml'))
  ? readFileSync(resolve(PLUGIN_ROOT, 'cordis.patch.yml'), 'utf8')
  : ''
check('patch 声明了本插件的装载行 id', patchText.includes('id: download-progress'), 'id: download-progress')
check('patch 声明了本插件的包名', patchText.includes(`name: ${PLUGIN_ID}`), `name: ${PLUGIN_ID}`)

// ── 4) host 产物可被 Node 解析、自包含 ─────────────────────────────────────
if (existsSync(hostEntry)) {
  const hostText = readFileSync(hostEntry, 'utf8')
  try {
    const module = await import(pathToFileURL(hostEntry).href)
    check('host 半边导出 apply()', typeof module.apply === 'function')
    check('host 半边导出 inject（含 webServer）',
      Array.isArray(module.inject) && module.inject.includes('webServer'), JSON.stringify(module.inject))
    check('host 半边导出 Config（Standard Schema 形状）',
      module.Config?.['~standard']?.version === 1 && typeof module.Config['~standard'].validate === 'function')
    const narrowed = module.Config['~standard'].validate({ progressSources: ['D:\\x.md'], pollIntervalMs: 2000 })
    check('Config 能规范化一份合法配置',
      narrowed?.value?.progressSources?.length === 1 && narrowed.value.pollIntervalMs === 2000,
      JSON.stringify(narrowed?.value ?? narrowed?.issues))
    check('Config 拒绝未知字段', Array.isArray(module.Config['~standard'].validate({ nope: 1 }).issues))
    check('host 半边没有 default 导出（避免 Loader 丢掉命名空间）', module.default === undefined)
  } catch (error) {
    check('host 半边可被 Node 导入', false, String(error))
  }
  check('host 产物自包含（无 import / require）',
    !/^\s*import[\s{'"]/m.test(hostText) && !/\bimport\s*\(/.test(hostText) && !/\brequire\s*\(/.test(hostText))
}

// ── 5) client 产物契约 ─────────────────────────────────────────────────────
if (existsSync(clientEntry)) {
  const source = readFileSync(clientEntry, 'utf8')
  check('client 产物使用 window.__ModuleLoader__.load 包装', source.includes('window.__ModuleLoader__.load'))
  check('client 产物 id 与本包名一致', source.includes(JSON.stringify(PLUGIN_ID)))
  check('client 产物导出 apply', /exports\.apply\s*=/.test(source))
  check('client 产物导出 inject', /exports\.inject\s*=/.test(source))
  check('client 产物把 react 走 require 外部引用（不内联）', source.includes('require("react")'))
  check('client 产物零第三方插件引用（不依赖 better-sidebar 等）',
    !source.includes('betterSidebar') && !source.includes('dsh-better-sidebar')
    && (source.match(/\brequire\("/g) ?? []).length === 1,
    `require 次数 ${(source.match(/\brequire\("/g) ?? []).length}`)
  check('client 产物只声明 slots 服务依赖', /inject\s*=\s*\[\s*['"]slots['"]\s*\]/.test(source))
  check('client 产物注册进 DSH 自己的会话头工具区',
    source.includes('conversation.session.header.utilities'))
  check('client 产物不含 markdown 原文渲染块', !source.includes('ddp-raw'))
  check('client 产物带进度动画关键帧',
    ['ddp-rotate', 'ddp-dash', 'ddp-shimmer', 'ddp-stripes', 'ddp-pop', 'ddp-rise']
      .every(key => source.includes(key)))
  check('client 产物尊重 prefers-reduced-motion', source.includes('prefers-reduced-motion:reduce'))
}

// ── 6) 包内不得有 node_modules ─────────────────────────────────────────────
check('包目录里没有 node_modules（否则会破坏 pnpm 的 link: 安装）',
  !existsSync(join(PLUGIN_ROOT, 'node_modules')))

// ── 7) 产物不旧于源码 ──────────────────────────────────────────────────────
/**
 * 收集一组源文件。
 * @param {string} half - 半边名。
 * @param {string[]} files - 文件名。
 * @returns {string[]} 绝对路径。
 */
const sourcesOf = (half, files) => files.map(name => join(PLUGIN_ROOT, 'src', half, name))
/**
 * 一组文件里最新的 mtime。
 * @param {string[]} files - 文件列表。
 * @returns {number} 毫秒时间戳。
 */
const newestOf = files => Math.max(...files.map(file => statSync(file).mtimeMs))
const hostNewest = newestOf(sourcesOf('host', HOST_FRAGMENTS))
const clientNewest = newestOf(sourcesOf('client', CLIENT_FRAGMENTS))
check('lib/index.js 不早于它对应的源码（已重新构建）',
  existsSync(hostEntry) && statSync(hostEntry).mtimeMs >= hostNewest - MTIME_TOLERANCE_MS,
  `bundle=${existsSync(hostEntry) ? new Date(statSync(hostEntry).mtimeMs).toISOString() : '缺失'}`
  + ` src=${new Date(hostNewest).toISOString()}`)
check('lib/client.js 不早于它对应的源码（已重新构建）',
  existsSync(clientEntry) && statSync(clientEntry).mtimeMs >= clientNewest - MTIME_TOLERANCE_MS,
  `bundle=${existsSync(clientEntry) ? new Date(statSync(clientEntry).mtimeMs).toISOString() : '缺失'}`
  + ` src=${new Date(clientNewest).toISOString()}`)

// ── 7b) 解析器冒烟（跑的就是产物里的那份代码） ─────────────────────────────
try {
  const build = new Function(`${concatFragments('host', HOST_FRAGMENTS)}
return { parseProgressText, finalizeMetrics }`)
  const internals = build()
  const sample = [
    '进度 ██████░░░░ 11/47 (23%)',
    '体积 90.0 MB / 100.0 MB',
    '速度 0.42 MB/s',
    '剩余 00:02:31',
  ].join('\n')
  const metrics = internals.finalizeMetrics(internals.parseProgressText(sample).metrics)
  check('解析器冒烟：百分比 / 完成量 / 体积 / 速率 / 剩余时间',
    metrics.percent === 23 && metrics.done === 11 && metrics.total === 47
    && Math.round(metrics.bytes / 1048576) === 90 && Math.round(metrics.bytesTotal / 1048576) === 100
    && Math.abs(metrics.speed - 440401.92) < 1 && metrics.etaMs === 151000,
    JSON.stringify(metrics))
} catch (error) {
  check('解析器冒烟', false, String(error))
}

// ── 7c) 两个子测试套件（同一个门禁） ───────────────────────────────────────
// 解析器单测与 client 冒烟各自是独立脚本（也方便单独跑），这里作为子进程串起来，
// 让 `node tests/verify-install.mjs` 成为唯一入口、唯一退出码。
for (const [label, script] of [
  ['解析器 / host 内部逻辑单测', 'test-parsers.mjs'],
  ['client 半边冒烟（ModuleLoader + React 替身）', 'test-client.mjs'],
]) {
  const result = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'tests', script)], { stdio: 'inherit' })
  check(label, result.status === 0, `退出码 ${result.status ?? `signal ${result.signal}`}`)
}

// ── 附带信息 ───────────────────────────────────────────────────────────────
console.log('')
console.log(`插件目录   ${PLUGIN_ROOT}`)
console.log(`profile    ${PROFILE_DIR}`)
console.log(`产物大小   lib/index.js ${existsSync(hostEntry) ? statSync(hostEntry).size : 0} 字节，`
  + `lib/client.js ${existsSync(clientEntry) ? statSync(clientEntry).size : 0} 字节`)
console.log(`源码碎片   host ${HOST_FRAGMENTS.length} 个 / client ${CLIENT_FRAGMENTS.length} 个`)
try {
  console.log(`包内清单   ${readdirSync(PLUGIN_ROOT).sort().join(', ')}`)
} catch { /* 列不出来不影响结论 */ }

if (failures.length > 0) {
  console.error(`\n${failures.length} 项检查未通过：${failures.join('; ')}`)
  process.exit(1)
}
if (skipped.length > 0) {
  console.log(`\n全部检查通过（其中 ${skipped.length} 项本机检查被明确跳过：${skipped.join('; ')}）。`)
} else {
  console.log('\n全部安装自检通过。')
}
