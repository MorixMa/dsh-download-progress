# dsh-download-progress

**A download-progress indicator built for DSH's download tasks** — a persistent download-style
icon in the session header that finds your running downloads on its own, and renders them as a
progress ring, animated bars, transfer speed and ETA.

> **中文**：专为 DSH 的下载任务做的进度指示器 —— 会话头里一个常驻的下载图标，自动发现正在跑的
> 下载任务与后台任务，用环形进度、动画进度条、速率和预计剩余时间实时呈现。
> 完整中文文档：[README.md](./README.md)。

[![License: MIT](https://img.shields.io/badge/License-MIT-334EAC.svg)](./LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1%20%3C0.2.1-081F5C.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.3-7096D1.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-2ea043.svg)](#development)
[![CI](https://github.com/MorixMa/dsh-download-progress/actions/workflows/ci.yml/badge.svg)](https://github.com/MorixMa/dsh-download-progress/actions/workflows/ci.yml)

---

## What this plugin is for

**It watches one thing: downloads.**

In DSH, downloads almost always happen as **background jobs**: `curl` / `wget` / `aria2c`
pulling model weights, installers, datasets, font packs, or a package manager fetching
dependencies. Their progress only ever appears in the **job's output**, so your options are
staring at a terminal, repeatedly asking the model "is it done yet?", or simply forgetting that
it is still running.

This plugin turns that into **one glance**: an icon in the top-right of the session header lights
up with a progress ring and a count badge while downloads are running; clicking it opens a list
with one animated progress bar per task, carrying percentage, transferred / total, speed and ETA.
When a download finishes, one click on its filename opens the file.

It **does not start jobs, kill jobs, or write files** — it is a pure observer. The single
exception is *open file* / *reveal in folder*, which requires an explicit click and only works
on the files the panel is currently showing.

> **Why does it list other background jobs too?** Because in DSH, downloads and ordinary
> background jobs share **one roster** (`ctx.jobs`) — the plugin cannot, and should not, guess
> which entry is a download. So it reads the whole roster: anything with parseable progress
> becomes a progress bar, anything without becomes an unknown-progress barber-pole. For downloads
> that is exactly what you want; for other jobs it doubles as a general progress board.

## Features

- **Written for downloader output.** The parser understands what real downloaders actually
  print: curl `--progress-bar`'s `\r`-refreshed meter, wget's
  `45%[===>  ] 7.98M 1.21MB/s eta 8s`, aria2's summary lines, the common
  `transferred x / y` shapes, and generic JSON progress files.
- **No third-party plugin required.** The client-side Slot registry and the host `webServer`
  are both DSH core capabilities. Whether plugins like `dsh-better-sidebar` are installed makes
  no difference.
- **Zero runtime dependencies.** `dependencies` is empty and the package ships no `node_modules`.
- **Zero build dependencies.** `node tools/build.mjs` is the entire build step; artifacts are
  committed, so installing never builds anything.
- **Filenames only.** No directories, no drive letters, no raw command lines anywhere in the UI.
- **Never invents numbers.** If the source does not report a speed, no speed is shown. Speed and
  ETA are derived from a two-frame byte delta, and extrapolation stops when a job stalls instead
  of showing a stale value forever.
- **Reads what real downloaders actually print.** curl `--progress-bar` (a `\r`-refreshed meter),
  wget (`45%[===>  ] 7.98M 1.21MB/s eta 8s`), aria2, and the common `transferred x / y` shapes.

---

## Installation

### From GitHub

```powershell
dsh plugin --profile <profile-name> add github:MorixMa/dsh-download-progress
```

The artifacts (`lib/`) are committed to the repository, so the installing side **never** runs a
build or downloads a dependency.

### From a local checkout (development)

```powershell
dsh plugin --profile <profile-name> add link:<absolute path to this repository>
```

> The `desktop` profile is managed exclusively by the Electron application and the CLI refuses
> it on purpose (`error: profile "desktop" is managed exclusively by the Electron application`).
> Use the in-app plugin manager for that profile, with the same `github:` / `link:` spec.

**Restart DSH afterwards** — the host half is mounted at load time. Then hard-refresh the page
(Ctrl+Shift+R). The download icon appears in the top-right of the session header.

Uninstalling and step-by-step verification: [INSTALL.md](./INSTALL.md).

---

## The UI

### The icon (always present)

| State | Appearance |
|---|---|
| Idle | Greyed-out download glyph, no badge |
| Work running | A **progress ring** around the icon, smoothly advancing (`stroke-dashoffset`, 0.55s transition); a blue count badge with a slow breathing animation |
| Progress unknown (source reports no percentage) | The ring becomes a **spinning, stretching arc** |
| Only failures left | The badge turns red and shows the failure count |

### The panel (one click)

- Header: the title, `N running`, an aggregate progress bar and aggregate figures.
- One row per task:
  - **Filename + extension only** (`live-ls-lR.gz`). Directories, drive letters and command
    lines never reach the UI — not even in the hover tooltip.
  - Animated bar: a **light sweep** crosses the filled part while running; unknown progress is a
    **scrolling barber-pole**; completed turns green, failed turns red.
  - Figures: `100% · 36.71 MB / 36.71 MB · 48.1 MB/s`.
  - A freshly completed task **flashes green** once, then settles.
- **File actions** (only when the host can open paths natively):
  - **Click the filename → open it with the OS default application.** Clickable only when the
    task is finished *and* the file actually exists on disk — so you can never open a half-written file.
  - **The folder icon at the end of the row → reveal it in the file manager.** Available even
    while the download is still running.
  - The outcome is reported on a status line at the bottom of the panel.
- Footer: last refresh time, how many data sources are available, and a manual refresh button.

All animations are disabled under `prefers-reduced-motion: reduce`.

### No raw markdown, ever

The UI **never renders the source text**. A progress block (the markdown-looking kind) is only
parsed *as data* into bars and numbers. The original text stays in the `raw` field of the host
response so you can debug with `curl`, but not one line of it reaches the screen.

### Filenames and paths are two separate tracks

| | Used for | Comes from |
|---|---|---|
| `fileName` | **Shown to you** — that one row title | basename of the artifact path → the wget-style filename at the start of a progress line → the label the progress source wrote → the command line with **every local path stripped out** |
| `filePath` | **Never displayed**, only for *open* / *reveal* | the `-o` / `--output` / `-OutFile` switch in the command line; failing that, the last non-script absolute path |

Path extraction carries two false-positive guards: `(?<![A-Za-z0-9])` keeps the `s://` inside
`https://…` from being read as an `s:` drive path, and the POSIX branch's `(?<![\w:/])` keeps a
`/host/a/b.gz` from being sliced out of a URL.

---

## Where the data comes from

Three sources, in a fixed priority order. The empty state reports each source's availability
honestly.

| Order | Source | Notes |
|---|---|---|
| ① | `dsh-ops/background` | **Structural probe**: if a service exposing `list()` exists, it is used; otherwise the panel says "no service extension point published". See *Known limitations* |
| ② | DSH background jobs | The host `ctx.jobs` registry (`@deepseek-ai/dsh-jobs-local`). Read per session through the **non-consuming** `list()` + `readAt()` — the model's own `job_output` cursor is never moved and no completion notice fires |
| ③ | Progress source files | Absolute paths from the `progressSources` config. Files are parsed by extension; directories are **scanned one level deep** for `*.md / *.markdown / *.txt / *.json / *.jsonl / *.progress` |

Every row carries its origin, so you can always tell which track a value came from.

### Supported progress formats

**Progress blocks** (multi-line text, extracted line by line; later fields win):

```
# 字体包下载
进度 ██████░░░░ 11/47 (23%)
体积 90.0 MB / 100.0 MB
速度 0.42 MB/s
剩余 00:02:31
```

Recognised: percentages (`23%` / `(23%)`), ratios (`11/47`), bars (`██████░░░░`, `[####------]`),
byte counts (`90.0 MB` / `1.2GiB` / `94371840 B` / wget's bare `7.98M`), speeds
(`0.42 MB/s` / `512 KBps` / `3 MiB per second`), and remaining time
(`00:02:31` / `1m30s` / `2 分 31 秒`). The label comes from a heading, `**bold**`, or the first
metric-free line.

**Generic JSON**:

```json
{ "label": "模型权重", "total": 47, "done": 11, "bytes": 94371840, "bytesTotal": 104857600, "speed": 440401, "eta": 24000 }
```

`{ "tasks": [ … ] }` and top-level arrays are accepted too (one file, several tasks).
`eta` is either milliseconds or a duration string.

### It never guesses

If the source does not print a speed, no speed is shown — not `0`. Speed and ETA fall back to a
**two-frame delta**: the client remembers the previous byte count and computes
`Δbytes / Δtime` (exponential moving average, α = 0.4, to damp jitter), then derives ETA from
`remaining bytes ÷ speed`. After three consecutive ticks with no progress, extrapolation stops —
a stalled job stops showing a stale rate instead of pretending to move.

---

## Configuration

Configuration lives in the plugin's loader row `config:`. Defaults ship in the plugin's own
[cordis.patch.yml](./cordis.patch.yml); you can also set them in the profile's patch layer.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `progressSources` | `string[]` | `[]` | Absolute paths to progress files or directories. Directories are scanned one level deep |
| `pollIntervalMs` | `number` | `1500` | Client poll interval, clamped to 500–60000 |

```yaml
- id: download-progress
  name: dsh-download-progress
  config:
    progressSources:
      - 'D:\下载\字体_进度.md'
      - 'D:\downloads\progress'
    pollIntervalMs: 1500
```

> **Changing this requires a DSH restart.** The config is read once at mount and narrowed; a
> change makes the loader remount the row, and a running host half is not hot-updated.

### About the settings form

`ctx.settings.register(ns, schema)` was **removed in DSH 0.1.7**. Its replacement is the host's
`SettingsForms`, whose rule is: *the namespace is the plugin loader row's entry id (here
`download-progress`), and the form schema is the `Config` the plugin module exports*. This plugin
follows that rule.

The honest caveat: `Config` uses the **Standard Schema** shape, not the host's built-in
schemastery shape. The former validates correctly at load time (the plugin mounts and `config`
takes effect), but the host settings page **will not** auto-generate a form for it — the Inspect
Config channel reports this entry as `unsupported`.

The reason is a hard constraint: the host artifact has **zero imports / zero requires**, and
`@deepseek-ai/schemastery` cannot be resolved from the plugin directory under a `link:` install
(Node walks the symlink's realpath, where no `node_modules/@deepseek-ai` exists). The two cannot
both be satisfied, so this plugin chose "the plugin always installs".

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No download icon in the session header | The client half did not load. Check that `dsh.profile.bundles` contains `dsh-download-progress`, then **hard-refresh** (Ctrl+Shift+R); if it persists, restart DSH |
| The icon is there but the panel says "Failed to fetch" | The host route is not mounted — **restart DSH**. Host-half changes always need a restart |
| "HTTP 403" from the route | The trust fence refused it. This never happens on desktop (the shell origin `dsh-app://app` is allowed); it means the request came from another origin, or the GUI is behind a non-loopback reverse proxy — add that authority to the deployment's `trustedHosts` |
| Always "no running tasks" | The empty state lists why each source is empty |
| The bar is always the barber-pole (unknown progress) | That job's output contains no recognisable progress. Run `curl "http://127.0.0.1:19387/download-progress"` and look at that task's `raw` field |
| Speed is always empty | The source prints no speed and the byte count did not change between polls (no baseline for the delta). Two samples are needed |
| The bar is stuck at some number | Normal — progress comes from the source; if the source does not update, neither does the bar. Check the "refreshed at" timestamp in the footer to confirm polling is alive |
| Parsed numbers look wrong | Compare against *Supported progress formats* above, or open an issue with those raw lines |

---

## Known limitations

- **`dsh-ops/background` publishes no service extension point.** Its `dsh` component only
  registers the tools `run_background` / `job_output` / `job_list` / `job_kill` and `provide`s no
  cordis service, so source ① is unavailable on this machine (the empty state says so). The
  structural probe stays: the moment it — or any other plugin — publishes a service with
  `list()`, the panel picks it up with no code change. Real data comes from source ②.
- **The indicator lives in the session header.** It is visible while a conversation is open; on
  a bare settings page there is no session header and therefore no icon. For a frame-wide
  floating version, change `SLOT_NAME` in `src/client/90-entry.js` to `shell.overlay` — the
  cost is that `shell.overlay` carries no `sessionId`, so it degrades to a global view without
  the per-session fence.
- **The icon is always present**, not "only when there is work". When idle it just sits there, greyed out.
- **DSH's own internal jobs show up too.** The panel lists everything in the `ctx.jobs` roster,
  including its resident PowerShell/POSIX session (named after the first line of its command,
  e.g. `$ErrorActionPreference='SilentlyContinue'`). It has no recognisable progress, so it
  renders as an unknown-progress barber-pole. DSH's own jobs drawer lists them as well.
  If that bothers you, filter by `kind` in `collectJobTasks` (`src/host/40-tasks.js`) — but that
  is a matter of taste, and the default does not decide it for you.
- **Progress source directories are scanned one level deep**, not recursively.
- **A progress source file reads at most its last 256 KB**; a possibly truncated first line is dropped.
- **A job's output is read back at most 8 KB from the tail** (progress lines are essentially always there).
- At most 64 tasks per response; tasks settled more than 2 minutes ago are dropped.
- **No i18n**: the UI copy is Chinese only.

---

## Security

### Two routes, two permission levels

| Route | Side effects | Authorisation |
|---|---|---|
| `GET /download-progress` | **None** (no file writes, no job kills, no cursor movement) | Browser trust fence |
| `POST /download-progress/open` | Makes the host open a file with the OS default application, or reveal it in the file manager | Trust fence **+ allowlist** |

Fence rules (the same as DSH's `/api` gateway): the `Host` must be loopback or a deployment
`trustedHosts` entry; `Sec-Fetch-Site: cross-site` is always refused; when an `Origin` is present
it must be the desktop shell's `dsh-app://app` or share the Host's hostname. A non-trusted Host
gets **403**.

### The open route's allowlist

**Only files this plugin itself just reported can be opened.** While collecting tasks the plugin
writes every known artifact's absolute path into a **10-minute TTL, 128-entry** allowlist. A
`path` that is not on it gets **403** before any `stat` happens.

Why it matters: even someone able to issue a same-origin request cannot turn this route into a
"launch any path" backdoor — they can only open the handful of files the panel is displaying
at that moment.

### No process spawning

Opening and revealing go through DSH's own native capability: the host service
`ctx.sessionController`'s `openPath(path, signal)` / `revealPath(path, signal)` /
`canOpenPath()` (implemented in `@deepseek-ai/dsh-native-command`'s `path-opener`). This plugin
**does not exec, spawn, or build a command line**. On a deployment without that service the two
buttons simply do not appear, rather than failing when clicked.

### The fence is the only gate on these routes

**Verified:** DSH's web token only covers its own `/api*` — `GET /api/modules` without a token
returns 401, while a plugin-registered `GET /download-progress` returns 200. So any **local** process
can read the task list. That is the platform convention; don't install it if you don't want it.

---

## Development

```powershell
node tools/build.mjs            # build lib/ (the only build step, zero dependencies)
node tests/test-parsers.mjs     # host logic unit tests
node tests/test-client.mjs      # client smoke test (runs the real artifact)
node tests/verify-install.mjs   # the gate: both suites plus install/artifact/manifest checks
```

No `npm install` / `pnpm install` — **this repository has no dependencies.**

### Source layout

```
src/host/    00-runtime.js  →  builtin-module shim, JSON responses, trust fence
             10-config.js   →  Config (Standard Schema) + narrowing
             20-parse.js    →  progress parsing, filename/path extraction, display stripping
             30-sources.js  →  progress source file scanning
             40-tasks.js    →  three-source task assembly
             50-route.js    →  GET /download-progress
             60-open.js     →  POST /download-progress/open (allowlist + native opener)
             90-entry.js    →  apply / inject
src/client/  00-format.js   →  number formatting (Chinese)
             05-route.js    →  host route URL resolution
             10-sampler.js  →  two-frame delta + aggregation
             20-styles.js   →  CSS + all @keyframes
             30-view.js     →  icon / panel / task rows (React.createElement)
             90-entry.js    →  ctx.slots registration
tools/build.mjs              →  fragment concatenation (the zero-dependency build)
```

Fragments are concatenated in filename order and share a single module scope — which is why
**not one `import` statement exists in the source**.

### Why the host half has zero imports

Under a `link:` install, any import of a host package from the host artifact fails at **link
time**, and DSH does not report it: the plugin simply stays inactive forever, which is
extremely hard to diagnose. So the host artifact has **zero imports / zero requires**, and Node
builtins are obtained through the global `process.getBuiltinModule()`. Where that is
unavailable (Node < 22.3) only the *progress source files* track degrades; the plugin still boots.

### Why no bundler

Two artifacts, zero dependencies, no JSX (it uses `React.createElement`). `tools/build.mjs` is
"concatenate in a fixed order and wrap in a ModuleLoader envelope" — readable, reproducible, and
it removes an entire `devDependencies` tree. The "no `node_modules` in the package" constraint
makes a bundler's remaining benefit vanish.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The short version: hard constraints come from DSH's
loading contract (zero-import host artifact, `react`-only client artifact, committed artifacts,
no `node_modules`), not from style preferences. Please read them before changing anything.

Security issues: [SECURITY.md](./SECURITY.md) — please do not open a public issue.

## License

[MIT](./LICENSE) © 2026 MorixMa

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md) code of conduct.
