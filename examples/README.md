# 示例脚本

两个 PowerShell 脚本，用来**真跑一个下载**，好让面板有东西可看。它们不是插件的组成部分，
只是让验证过程可复现。

## `demo-download.ps1`

不需要网络。每步打印一块标准进度（百分比 / 体积 / 速率 / 剩余时间），用来快速确认
面板的解析与动画是否正常。

```powershell
# 默认：300 步 × 1 秒 ≈ 5 分钟
pwsh -File .\demo-download.ps1

# 跑 2 分钟
pwsh -File .\demo-download.ps1 -Steps 120 -DelayMs 1000
```

参数：`-Steps`（步数）、`-DelayMs`（每步毫秒）、`-TotalMB`（假想总量，影响体积与速率）。

## `real-download.ps1`

**真的从网络下载**。用 `curl.exe` 传字节，同时盯着输出文件的大小打印**真实数字**的进度行
（瞬时速率，不是累计平均——任务卡住时它会掉到 0，而不是慢慢衰减）。

```powershell
pwsh -File .\real-download.ps1 `
  -Url 'https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ls-lR.gz' `
  -OutFile "$env:TEMP\ls-lR.gz"
```

想慢到能盯着面板看（镜像动辄几十 MB/s），加 `-LimitRate`：

```powershell
pwsh -File .\real-download.ps1 -Url <URL> -OutFile <路径> -LimitRate 200k
```

有些 CDN 对裸 `curl` 直接回 403，要求浏览器 UA 与 Referer：

```powershell
pwsh -File .\real-download.ps1 -Url <URL> -OutFile <路径> -Referer 'https://example.com/'
```

> 脚本默认就带浏览器 UA。**HEAD 探测与真正下载共用同一套请求头**——这不是风格问题：
> 探测拿不到 `Content-Length` 时就没有总量，面板上那条任务就不会有百分比。

## 为什么脚本要自己打印进度行

面板读的是**任务输出**。所以任何会在输出里打印进度的下载器（curl `--progress-bar`、
wget、aria2、你自己的脚本……）都能被它认出来——这几个脚本的作用之一，就是证明
"别人的输出格式"也能被正确解析。

支持的写法见 [README 的「支持的进度格式」](../README.md#支持的进度写法) /
[README.en.md](../README.en.md#supported-progress-formats)。
