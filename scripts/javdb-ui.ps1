param([switch]$Smoke)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'data'
$configFile = Join-Path $dataDir 'javdb-ui.json'
$tokenFile = Join-Path $dataDir 'javdb-ui-token.dpapi'
$planFile = Join-Path $dataDir 'javdb-plan.json'
$failedFile = Join-Path $dataDir 'javdb-failed.json'
$coversDir = Join-Path $dataDir 'covers'
$logFile = Join-Path $dataDir 'javdb-ui-run.log'
$errFile = Join-Path $dataDir 'javdb-ui-run.err.log'

$node = 'node'
$runtime = Join-Path $root '.runtime\node.exe'
if (Test-Path $runtime) { $node = $runtime }
elseif (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  [void][System.Windows.Forms.MessageBox]::Show('未找到 Node.js 22+。先运行 start.cmd 准备 .runtime，或安装 Node.js。', 'JavDB 补全')
  exit 1
}

# —— 配置 ——
$config = [ordered]@{ url = 'http://127.0.0.1:3210'; skipCovered = $true; onlyMissing = $true; retryFailed = $false; refresh = $false; apply = $true }
if (Test-Path $configFile) {
  try {
    $loaded = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($key in @($config.Keys)) { if ($null -ne $loaded.$key) { $config[$key] = $loaded.$key } }
  } catch { }
}

function Save-Config {
  $config.url = $txtUrl.Text.Trim()
  $config.skipCovered = $chkSkipCovered.Checked
  $config.onlyMissing = $chkOnlyMissing.Checked
  $config.retryFailed = $chkRetryFailed.Checked
  $config.refresh = $chkRefresh.Checked
  $config.apply = $chkApply.Checked
  ($config | ConvertTo-Json) | Set-Content -LiteralPath $configFile -Encoding UTF8
}

function Read-Token {
  foreach ($file in @($tokenFile, (Join-Path $dataDir 'mcp-facts-token.dpapi'))) {
    if (-not (Test-Path $file)) { continue }
    try {
      $secure = Get-Content -LiteralPath $file -Raw | ConvertTo-SecureString
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
      if ($token -match '^sr_[A-Za-z0-9_-]{43}$') { return $token }
    } catch { }
  }
  return ''
}

function Save-Token([string]$token) {
  $secure = ConvertTo-SecureString -String $token -AsPlainText -Force
  (ConvertFrom-SecureString -SecureString $secure) | Set-Content -LiteralPath $tokenFile -Encoding ASCII -NoNewline
}

function Get-Count([string]$file, [string]$pattern) {
  if (-not (Test-Path $file)) { return 0 }
  return ([regex]::Matches([IO.File]::ReadAllText($file), $pattern)).Count
}

# —— 窗体 ——
$form = New-Object System.Windows.Forms.Form
$form.Text = 'JavDB 补全控制台'
$form.ClientSize = New-Object System.Drawing.Size(900, 640)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

$groupConn = New-Object System.Windows.Forms.GroupBox
$groupConn.Text = '连接'
$groupConn.Location = New-Object System.Drawing.Point(14, 10)
$groupConn.Size = New-Object System.Drawing.Size(872, 96)

$lblUrl = New-Object System.Windows.Forms.Label
$lblUrl.Text = '影院地址（IP:端口）'
$lblUrl.Location = New-Object System.Drawing.Point(14, 26)
$lblUrl.Size = New-Object System.Drawing.Size(132, 20)

$txtUrl = New-Object System.Windows.Forms.TextBox
$txtUrl.Location = New-Object System.Drawing.Point(150, 23)
$txtUrl.Size = New-Object System.Drawing.Size(300, 24)
$txtUrl.Text = $config.url

$lblToken = New-Object System.Windows.Forms.Label
$lblToken.Text = '调试令牌（sr_ 开头）'
$lblToken.Location = New-Object System.Drawing.Point(14, 60)
$lblToken.Size = New-Object System.Drawing.Size(132, 20)

$txtToken = New-Object System.Windows.Forms.TextBox
$txtToken.Location = New-Object System.Drawing.Point(150, 57)
$txtToken.Size = New-Object System.Drawing.Size(300, 24)
$txtToken.UseSystemPasswordChar = $true
$savedToken = Read-Token
if ($savedToken) { $txtToken.Text = $savedToken; $txtToken.ForeColor = [System.Drawing.Color]::Gray }
else { $txtToken.Text = '' }

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = '保存'
$btnSave.Location = New-Object System.Drawing.Point(462, 22)
$btnSave.Size = New-Object System.Drawing.Size(80, 26)

$lblTokenHint = New-Object System.Windows.Forms.Label
$lblTokenHint.Text = '令牌用 Windows DPAPI 加密保存在 data\javdb-ui-token.dpapi，不写日志、不外传。'
$lblTokenHint.Location = New-Object System.Drawing.Point(462, 60)
$lblTokenHint.Size = New-Object System.Drawing.Size(396, 20)
$lblTokenHint.ForeColor = [System.Drawing.Color]::DimGray

$groupConn.Controls.AddRange(@($lblUrl, $txtUrl, $lblToken, $txtToken, $btnSave, $lblTokenHint))

$groupRules = New-Object System.Windows.Forms.GroupBox
$groupRules.Text = '规则'
$groupRules.Location = New-Object System.Drawing.Point(14, 114)
$groupRules.Size = New-Object System.Drawing.Size(872, 62)

$chkSkipCovered = New-Object System.Windows.Forms.CheckBox
$chkSkipCovered.Text = '有封面就跳过'
$chkSkipCovered.Location = New-Object System.Drawing.Point(14, 26)
$chkSkipCovered.Size = New-Object System.Drawing.Size(130, 22)
$chkSkipCovered.Checked = [bool]$config.skipCovered

$chkOnlyMissing = New-Object System.Windows.Forms.CheckBox
$chkOnlyMissing.Text = '只补缺失'
$chkOnlyMissing.Location = New-Object System.Drawing.Point(150, 26)
$chkOnlyMissing.Size = New-Object System.Drawing.Size(110, 22)
$chkOnlyMissing.Checked = [bool]$config.onlyMissing

$chkRetryFailed = New-Object System.Windows.Forms.CheckBox
$chkRetryFailed.Text = '重试历史失败'
$chkRetryFailed.Location = New-Object System.Drawing.Point(266, 26)
$chkRetryFailed.Size = New-Object System.Drawing.Size(130, 22)
$chkRetryFailed.Checked = [bool]$config.retryFailed

$chkRefresh = New-Object System.Windows.Forms.CheckBox
$chkRefresh.Text = '忽略缓存重抓'
$chkRefresh.Location = New-Object System.Drawing.Point(402, 26)
$chkRefresh.Size = New-Object System.Drawing.Size(130, 22)
$chkRefresh.Checked = [bool]$config.refresh

$chkApply = New-Object System.Windows.Forms.CheckBox
$chkApply.Text = '抓完写入片库'
$chkApply.Location = New-Object System.Drawing.Point(538, 26)
$chkApply.Size = New-Object System.Drawing.Size(130, 22)
$chkApply.Checked = [bool]$config.apply

$groupRules.Controls.AddRange(@($chkSkipCovered, $chkOnlyMissing, $chkRetryFailed, $chkRefresh, $chkApply))

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = '开始'
$btnStart.Location = New-Object System.Drawing.Point(14, 184)
$btnStart.Size = New-Object System.Drawing.Size(100, 32)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(224, 247, 236)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = '停止'
$btnStop.Location = New-Object System.Drawing.Point(124, 184)
$btnStop.Size = New-Object System.Drawing.Size(100, 32)
$btnStop.Enabled = $false

$btnOpenData = New-Object System.Windows.Forms.Button
$btnOpenData.Text = '数据目录'
$btnOpenData.Location = New-Object System.Drawing.Point(234, 184)
$btnOpenData.Size = New-Object System.Drawing.Size(100, 32)

$lblStats = New-Object System.Windows.Forms.Label
$lblStats.Location = New-Object System.Drawing.Point(346, 190)
$lblStats.Size = New-Object System.Drawing.Size(540, 22)
$lblStats.Text = '片库 -　计划 -　封面 -　失败 -'
$lblStats.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Regular)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Location = New-Object System.Drawing.Point(14, 224)
$lblStatus.Size = New-Object System.Drawing.Size(872, 20)
$lblStatus.Text = '空闲'
$lblStatus.ForeColor = [System.Drawing.Color]::DimGray

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Location = New-Object System.Drawing.Point(14, 250)
$logBox.Size = New-Object System.Drawing.Size(872, 376)
$logBox.ReadOnly = $true
$logBox.BackColor = [System.Drawing.Color]::FromArgb(18, 22, 28)
$logBox.ForeColor = [System.Drawing.Color]::FromArgb(226, 233, 240)
$logBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$logBox.WordWrap = $false
$logBox.ScrollBars = 'Both'
$logBox.Text = '等待开始…'

$form.Controls.AddRange(@($groupConn, $groupRules, $btnStart, $btnStop, $btnOpenData, $lblStats, $lblStatus, $logBox))

$script:proc = $null
$script:logPos = 0

function Update-Stats {
  $planned = Get-Count $planFile '"id":'
  $failed = Get-Count $failedFile '"id":'
  $covers = 0
  if (Test-Path $coversDir) { $covers = @(Get-ChildItem $coversDir -File -ErrorAction SilentlyContinue).Count }
  $lblStats.Text = "计划 $planned　封面 $covers　失败 $failed"
}

function Update-Log {
  if (-not (Test-Path $logFile)) { return }
  $length = (Get-Item $logFile).Length
  if ($length -le $script:logPos) { return }
  try {
    $stream = [IO.File]::Open($logFile, 'Open', 'Read', 'ReadWrite')
    try {
      $stream.Position = $script:logPos
      $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
      $chunk = $reader.ReadToEnd()
      $script:logPos = $stream.Position
    } finally { $stream.Close() }
  } catch { return }
  if ($chunk) {
    $logBox.AppendText($chunk)
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
  Update-Log
  Update-Stats
  if ($script:proc) {
    if ($script:proc.HasExited) {
      Update-Log
      $code = $script:proc.ExitCode
      $script:proc = $null
      $btnStart.Enabled = $true
      $btnStop.Enabled = $false
      $lblStatus.Text = "任务结束（退出码 $code）"
      $lblStatus.ForeColor = [System.Drawing.Color]::DimGray
    }
  }
})

$btnSave.Add_Click({
  Save-Config
  $token = $txtToken.Text.Trim()
  if ($token) {
    if ($token -notmatch '^sr_[A-Za-z0-9_-]{43}$') {
      [void][System.Windows.Forms.MessageBox]::Show('令牌格式不对，应为 sr_ 加 43 位字符。', 'JavDB 补全')
      return
    }
    Save-Token $token
    $txtToken.Text = $token
    $lblStatus.Text = '已保存地址、规则与令牌'
    $lblStatus.ForeColor = [System.Drawing.Color]::SeaGreen
    return
  }
  $lblStatus.Text = '已保存地址与规则（令牌沿用之前保存的）'
  $lblStatus.ForeColor = [System.Drawing.Color]::SeaGreen
})

$btnStart.Add_Click({
  if ($script:proc -and -not $script:proc.HasExited) { return }
  $url = $txtUrl.Text.Trim()
  if ($url -notmatch '^http://') {
    [void][System.Windows.Forms.MessageBox]::Show('影院地址请填 http://IP:端口，例如 http://192.168.1.20:3210', 'JavDB 补全')
    return
  }
  Save-Config
  $typed = $txtToken.Text.Trim()
  if ($typed) {
    if ($typed -notmatch '^sr_[A-Za-z0-9_-]{43}$') {
      [void][System.Windows.Forms.MessageBox]::Show('令牌格式不对，应为 sr_ 加 43 位字符。', 'JavDB 补全')
      return
    }
    Save-Token $typed
  }
  $token = Read-Token
  if (-not $token) {
    [void][System.Windows.Forms.MessageBox]::Show('还没有可用令牌，请在“调试令牌”里填写后保存。', 'JavDB 补全')
    return
  }
  $arguments = @((Join-Path $root 'scripts\javdb-sync.mjs'))
  if ($chkOnlyMissing.Checked) { $arguments += '--only-missing' }
  if (-not $chkSkipCovered.Checked) { $arguments += '--strict' }
  if ($chkRetryFailed.Checked) { $arguments += '--retry-failed' }
  if ($chkRefresh.Checked) { $arguments += '--refresh' }
  if ($chkApply.Checked) { $arguments += '--apply' }
  Remove-Item $logFile, $errFile -ErrorAction SilentlyContinue
  $env:SCREENROOM_URL = $url
  $env:SCREENROOM_TOKEN = $token
  try {
    $script:proc = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru -WindowStyle Hidden
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show("启动失败：$($_.Exception.Message)", 'JavDB 补全')
    $script:proc = $null
    return
  } finally {
    Remove-Item Env:\SCREENROOM_TOKEN -ErrorAction SilentlyContinue
  }
  $script:logPos = 0
  $logBox.Text = ''
  $logBox.AppendText("=== 已启动：$url ===`r`n")
  $btnStart.Enabled = $false
  $btnStop.Enabled = $true
  $lblStatus.Text = '运行中…'
  $lblStatus.ForeColor = [System.Drawing.Color]::SeaGreen
  $timer.Start()
})

$btnStop.Add_Click({
  if ($script:proc -and -not $script:proc.HasExited) {
    try { $script:proc.Kill() } catch { }
    $lblStatus.Text = '已停止'
    $lblStatus.ForeColor = [System.Drawing.Color]::DimGray
  }
  $script:proc = $null
  $btnStart.Enabled = $true
  $btnStop.Enabled = $false
})

$btnOpenData.Add_Click({ Start-Process explorer.exe $dataDir })

$form.Add_Shown({
  Update-Stats
  Update-Log
})

if ($Smoke) {
  Update-Stats
  Write-Output ("OK controls={0} node={1} tokenSet={2} url={3}" -f $form.Controls.Count, $node, [bool](Read-Token), $txtUrl.Text)
  $form.Dispose()
  exit 0
}

[void]$form.ShowDialog()
$form.Dispose()
