# 真实下载任务：真的从网络把文件拉下来，同时打印**真实数字**的进度行。
#
# 进度行刻意用 wget 的格式（`45%[====>     ]  7.98M  1.21MB/s  eta 8s`），
# 而不是本项目自造的格式——这样测的是"插件能不能解析别人的输出"。
#
# 重新跑一次：
#   pwsh -File <仓库绝对路径>\examples\real-download.ps1 -Url <URL> -OutFile <路径>
# 想让它慢到能盯着面板看（镜像动辄几十 MB/s），加 -LimitRate：
#   pwsh -File <仓库绝对路径>\examples\real-download.ps1 -Url <URL> -OutFile <路径> -LimitRate 250k
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$LimitRate = '',
    [string]$Referer = ''
)
$ErrorActionPreference = 'Continue'
$name = [System.IO.Path]::GetFileName($OutFile)

# 很多 CDN（网易云、各类网盘）对裸 curl 直接 403，要求浏览器 UA；有些还看 Referer。
# 没有这些头时连 Content-Length 都拿不到，面板就会没有百分比——所以 HEAD 探测和真正
# 下载必须带同一套头。
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
$common = @('-A', $ua)
if ($Referer -ne '') { $common += @('-e', $Referer) }

# 先问一次 Content-Length，用来算百分比与剩余时间（顺便验证代理通不通）。
$total = 0L
try {
    $head = & curl.exe -sIL --max-time 40 @common $Url 2>$null
    foreach ($line in $head) {
        if ($line -match '^(?i)content-length:\s*(\d+)') { $total = [int64]$Matches[1] }
    }
} catch { }
if ($total -gt 0) { "目标：$name  $([math]::Round($total / 1MB, 2)) MB" } else { "目标：$name  （服务端未给 Content-Length）" }

$target = Split-Path -Parent $OutFile
if (-not (Test-Path $target)) { New-Item -ItemType Directory -Force -Path $target | Out-Null }
if (Test-Path $OutFile) { Remove-Item $OutFile -Force }

$curlArgs = @('-L', '-sS') + $common
if ($LimitRate -ne '') { $curlArgs += @('--limit-rate', $LimitRate) }
$curlArgs += @('-o', $OutFile, $Url)

# 用 ProcessStartInfo.ArgumentList 逐条传参：PowerShell 的 Start-Process -ArgumentList
# 会把数组用空格拼成一个字符串，带空格的 User-Agent 会被拆成好几个 argv
# （实测报 "Could not resolve host: NT" / "AppleWebKit"）。ArgumentList 不做任何拼串。
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = 'curl.exe'
$psi.UseShellExecute = $false
foreach ($arg in $curlArgs) { $psi.ArgumentList.Add($arg) }
$proc = [System.Diagnostics.Process]::Start($psi)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$lastAt = 0.0
$lastSize = 0L

while (-not $proc.HasExited) {
    Start-Sleep -Milliseconds 350
    $elapsed = $sw.Elapsed.TotalSeconds
    if ($elapsed - $lastAt -lt 0.9) { continue }
    $size = if (Test-Path $OutFile) { (Get-Item $OutFile).Length } else { 0 }
    # 瞬时速率（这一段的增量），不是累计平均——卡住时它会掉到 0 而不是慢慢衰减。
    $speed = ($size - $lastSize) / [math]::Max($elapsed - $lastAt, 0.001)
    $lastAt = $elapsed
    $lastSize = $size
    $pct = if ($total -gt 0) { [int][math]::Floor($size * 100 / $total) } else { 0 }
    if ($speed -ge 1MB) { $speedText = '{0:N2} MB/s' -f ($speed / 1MB) }
    elseif ($speed -ge 1KB) { $speedText = '{0:N0} KB/s' -f ($speed / 1KB) }
    else { $speedText = '{0:N0} B/s' -f $speed }
    $barLen = 28
    $filled = [int][math]::Floor($pct * $barLen / 100)
    $bar = ('=' * $filled) + (' ' * ($barLen - $filled))
    if ($total -gt 0) {
        '{0}  {1}%[{2}]  已传输 {3:N2} MB / {4:N2} MB  速度 {5}' -f $name, $pct, $bar, ($size / 1MB), ($total / 1MB), $speedText
    } else {
        '{0}  {1}%[{2}]  已传输 {3:N2} MB  速度 {4}' -f $name, $pct, $bar, ($size / 1MB), $speedText
    }
}
$proc.WaitForExit()

if ($proc.ExitCode -ne 0) { "下载失败：curl 退出码 $($proc.ExitCode)" ; exit $proc.ExitCode }
$final = (Get-Item $OutFile).Length
$seconds = $sw.Elapsed.TotalSeconds
'{0}  100%[{1}]  已传输 {2:N2} MB / {2:N2} MB  速度 {3:N2} MB/s' -f $name, ('=' * 28), ($final / 1MB), ($final / 1MB / [math]::Max($seconds, 0.001))
'下载完成：{0}  {1:N2} MB  用时 {2:N1} 秒' -f $name, ($final / 1MB), $seconds
