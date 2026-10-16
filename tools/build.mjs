/**
 * 构建：把 `src/` 里的模块碎片拼成两个**自包含**产物。
 *
 * 为什么不用打包器：本插件只有两个产物、零第三方依赖、源码里连一条 `import`
 * 语句都没有（碎片共享同一个模块作用域，靠文件名的编号保证装载顺序）。一个
 * 六十行的拼接脚本比引入 esbuild/tsup 更可控，也让"产物必须随包发布"这件事
 * 变得可以当场复现：`node tools/build.mjs` 就是全部构建步骤。
 *
 * 产物契约（tests/verify-install.mjs 逐条守护）：
 * - `lib/index.js` —— ESM，**零 import / 零 require**，导出 `Config` / `apply` / `inject`；
 * - `lib/client.js` —— `window.__ModuleLoader__.load({ id, factory })` 包装，
 *   id 与包名一致，`react` 走 `require("react")` 外部引用，不内联。
 *
 * 用法：node tools/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 包根目录。 */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** host 半边碎片的装载顺序（顺序即依赖顺序：后一个可以用前一个的声明）。 */
export const HOST_FRAGMENTS = [
  '00-runtime.js',
  '10-config.js',
  '20-parse.js',
  '30-sources.js',
  '40-tasks.js',
  '50-route.js',
  '60-open.js',
  '90-entry.js',
]

/** client 半边碎片的装载顺序。 */
export const CLIENT_FRAGMENTS = [
  '00-format.js',
  '05-route.js',
  '10-sampler.js',
  '20-styles.js',
  '30-view.js',
  '90-entry.js',
]

/** host 产物的导出面：刻意只有三个命名导出，没有 default。 */
export const HOST_EXPORTS = ['Config', 'apply', 'inject']

/**
 * 读一组碎片并拼成一段源码。
 * @param {'host'|'client'} half - 半边名。
 * @param {string[]} files - 文件名列表。
 * @returns {string} 拼接后的源码（不含产物包装）。
 */
export function concatFragments(half, files) {
  return files
    .map(name => {
      const file = join(ROOT, 'src', half, name)
      if (!existsSync(file)) throw new Error(`缺少源文件：${file}`)
      return `// ── src/${half}/${name} ${'─'.repeat(Math.max(2, 62 - name.length))}\n${readFileSync(file, 'utf8').trimEnd()}`
    })
    .join('\n\n')
}

/**
 * host 产物全文（不落盘）。
 * @returns {string} `lib/index.js` 的内容。
 */
export function buildHostSource() {
  return [
    '/* eslint-disable */',
    '// dsh-download-progress —— host 半边（由 tools/build.mjs 生成，请勿手改）。',
    '// 自包含：零 import / 零 require。Node 内建模块经 process.getBuiltinModule() 取。',
    '',
    concatFragments('host', HOST_FRAGMENTS),
    '',
    `export { ${HOST_EXPORTS.join(', ')} };`,
    '',
  ].join('\n')
}

/**
 * client 产物全文（不落盘）。
 * @param {string} packageName - 包名，用作模块 id。
 * @returns {string} `lib/client.js` 的内容。
 */
export function buildClientSource(packageName) {
  return [
    '// dsh-download-progress —— client 半边（由 tools/build.mjs 生成，请勿手改）。',
    '// 宿主模块（react）走 require 外部引用，不打包进产物。',
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(packageName)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    '\t\tconst React = require("react");',
    '\t\tconst h = React.createElement;',
    '',
    concatFragments('client', CLIENT_FRAGMENTS),
    '',
    '\t\texports.apply = apply;',
    '\t\texports.inject = inject;',
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n')
}

/**
 * 跑一次构建。
 * @returns {{ files: { path: string, bytes: number }[] }} 产物清单。
 */
export function build() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const lib = join(ROOT, 'lib')
  mkdirSync(lib, { recursive: true })
  const outputs = [
    { path: join(lib, 'index.js'), text: buildHostSource() },
    { path: join(lib, 'client.js'), text: buildClientSource(manifest.name) },
  ]
  return {
    files: outputs.map(output => {
      writeFileSync(output.path, output.text, 'utf8')
      return { path: output.path, bytes: Buffer.byteLength(output.text, 'utf8') }
    }),
  }
}

// 直接被 `node tools/build.mjs` 运行时才写盘；被测试 import 时只借用函数。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = build()
  for (const file of result.files) console.log(`OK   ${file.path}  ${file.bytes} 字节`)
  console.log('构建完成。')
}
