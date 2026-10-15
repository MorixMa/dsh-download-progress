# 演示用「下载任务」：每 $DelayMs 毫秒打印一块 Markdown 进度，共 $Steps 步。
#
# 用来给 dsh-task-progress 面板喂真实数据——它是一份**普通的 DSH 后台任务**，输出里带
# 标准进度块；面板会自己发现它、解析它，并用两帧差分算出速率与剩余时间。
#
# 重新跑一次：
#   pwsh -File <仓库绝对路径>\examples\demo-download.ps1
# 换时长（例：20 分钟 → 1200 步 × 1 秒）：
#   pwsh -File <仓库绝对路径>\examples\demo-download.ps1 -Steps 1200 -DelayMs 1000
param(
    [int]$Steps = 300,          # 默认 300 步
    [int]$DelayMs = 1000,       # 每步 1 秒 → 约 5 分钟
    [double]$TotalMB = 100
)
$total = $Steps
$totalBytes = $TotalMB * 1MB
$started = Get-Date
for ($i = 0; $i -le $total; $i++) {
    $pct = [math]::Round($i * 100.0 / $total, 1)
    $filled = [int][math]::Floor($i * 10 / $total)
    $bar = ('#' * $filled).PadRight(10, '-')
    $bytes = $totalBytes * $i / $total
    $speedMB = $TotalMB / ($total * $DelayMs / 1000.0)
    $remainSec = [int][math]::Round(($total - $i) * $DelayMs / 1000.0)
    $mm = [int][math]::Floor($remainSec / 60)
    $ss = $remainSec % 60
    '# 演示：字体包下载'
    "进度 [$bar] $i/$total ($pct%)"
    ('体积 {0:N1} MB / {1:N1} MB' -f ($bytes / 1MB), $TotalMB)
    ('速度 {0:N2} MB/s' -f $speedMB)
    ('剩余 {0:d2}:{1:d2}' -f $mm, $ss)
    Start-Sleep -Milliseconds $DelayMs
}
('演示任务：下载完成，用时 {0:N0} 秒' -f ((Get-Date) - $started).TotalSeconds)
