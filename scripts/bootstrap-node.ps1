param(
    [switch]$CheckOnly,
    [switch]$InstallOnly,
    [switch]$SkipSystemNode,
    [switch]$LibraryOnly
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-NodeFileSha256([string]$Path) {
    $file = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($file)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $file.Dispose() }
}
function Get-MinimumNodeMajor([string]$ProjectRoot) {
    $package = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'package.json')) | ConvertFrom-Json
    if ([string]$package.engines.node -notmatch '^>=([1-9][0-9]{0,2})(?:\.0(?:\.0)?)?$') {
        throw 'package.json 中的 Node 要求无法自动识别，请联系维护者检查启动脚本。'
    }
    return [int]$Matches[1]
}
function ConvertTo-NodeVersion([string]$Text) {
    if ($Text -cmatch '^v([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,4})$') {
        return [version]$Text.Substring(1)
    }
    return $null
}
function Get-NodeArchitecture([string]$NativeArchitecture = '') {
    if (!$NativeArchitecture) {
        $NativeArchitecture = $env:PROCESSOR_ARCHITEW6432
        if (!$NativeArchitecture) { $NativeArchitecture = $env:PROCESSOR_ARCHITECTURE }
    }
    switch ($NativeArchitecture.ToUpperInvariant()) {
        'AMD64' { return 'x64' }
        'X64' { return 'x64' }
        'ARM64' { return 'arm64' }
        'X86' { return 'x86' }
        'I386' { return 'x86' }
        default { throw '当前 Windows 处理器架构不支持自动准备，请从 Node.js 官网手动安装。' }
    }
}
function Get-NodeVersionText([string]$Executable) {
    $process = New-Object Diagnostics.Process
    try {
        if (!(Test-Path -LiteralPath $Executable -PathType Leaf)) { return $null }
        $process.StartInfo.FileName = $Executable
        $process.StartInfo.Arguments = '--version'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        [void]$process.Start()
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit(5000)) { $process.Kill(); $process.WaitForExit(); return $null }
        $text = $output.GetAwaiter().GetResult().Trim()
        [void]$errors.GetAwaiter().GetResult()
        if ($process.ExitCode -eq 0 -and (ConvertTo-NodeVersion $text)) { return $text }
    } catch { return $null }
    finally { $process.Dispose() }
    return $null
}
function Get-SystemNodePaths {
    $seen = @{}
    foreach ($command in @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
        if (!$seen.ContainsKey($command.Source)) { $seen[$command.Source] = $true; $command.Source }
    }
}
function Resolve-ExistingNode {
    param([string]$RuntimeRoot, [int]$MinimumMajor, [string]$Architecture,
        [string[]]$SystemCandidates = @(), [scriptblock]$Probe = { param($p) Get-NodeVersionText $p })
    foreach ($candidate in $SystemCandidates) {
        $text = & $Probe $candidate
        $version = ConvertTo-NodeVersion $text
        if ($null -ne $version -and $version.Major -ge $MinimumMajor) {
            return [pscustomobject]@{ Path = $candidate; Version = $text; Source = 'system' }
        }
    }
    if (!(Test-Path -LiteralPath $RuntimeRoot -PathType Container)) { return $null }
    if ((Get-Item -LiteralPath $RuntimeRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw '项目 .runtime 是链接目录，已停止自动使用，请检查目录位置。'
    }
    $pattern = '^node-v[0-9]+\.[0-9]+\.[0-9]+-win-' + [regex]::Escape($Architecture) + '-[a-f0-9]{8}$'
    foreach ($directory in @(Get-ChildItem -LiteralPath $RuntimeRoot -Directory | Sort-Object LastWriteTimeUtc -Descending)) {
        if ($directory.Name -notmatch $pattern -or $directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $exe = Join-Path $directory.FullName 'node.exe'
        $marker = Join-Path $directory.FullName 'screenroom-runtime.json'
        try {
            if (!(Test-Path -LiteralPath $exe -PathType Leaf) -or !(Test-Path -LiteralPath $marker -PathType Leaf)) { continue }
            if ((Get-Item -LiteralPath $exe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            if ((Get-Item -LiteralPath $marker -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            if ((Get-Item -LiteralPath $marker).Length -gt 8192) { continue }
            $meta = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
            $version = ConvertTo-NodeVersion ([string]$meta.version)
            if ($meta.architecture -ne $Architecture -or $null -eq $version -or $version.Major -lt $MinimumMajor) { continue }
            if ($meta.nodeSha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-NodeFileSha256 $exe) -ne $meta.nodeSha256) { continue }
            $actual = & $Probe $exe
            if ($actual -ceq $meta.version) { return [pscustomobject]@{ Path = $exe; Version = $actual; Source = 'project' } }
        } catch { continue }
    }
    return $null
}
function Select-NodeRelease {
    param([object[]]$Releases, [int]$MinimumMajor, [string]$Architecture)
    if ($Architecture -notin @('x64', 'arm64', 'x86')) { throw '不支持的处理器架构。' }
    $choices = foreach ($release in $Releases) {
        try {
            $version = ConvertTo-NodeVersion ([string]$release.version)
            if ($null -eq $version -or $version.Major -lt $MinimumMajor) { continue }
            if ($release.lts -isnot [string] -or [string]::IsNullOrWhiteSpace($release.lts)) { continue }
            if (@($release.files) -notcontains "win-$Architecture-zip") { continue }
            [pscustomobject]@{ Version = [string]$release.version; Number = $version; Architecture = $Architecture;
                Archive = "node-$($release.version)-win-$Architecture.zip" }
        } catch { continue }
    }
    $selected = @($choices | Sort-Object Number -Descending | Select-Object -First 1)
    if (!$selected.Count) { throw '官方目录中没有符合版本与架构要求的 LTS 安装包。' }
    return $selected[0]
}
function Test-OfficialNodeUri([uri]$Uri) {
    return $Uri.IsAbsoluteUri -and $Uri.Scheme -eq 'https' -and $Uri.Host -ceq 'nodejs.org' -and $Uri.Port -eq 443 `
        -and !$Uri.UserInfo -and !$Uri.Query -and !$Uri.Fragment `
        -and ($Uri.AbsolutePath.StartsWith('/dist/') -or $Uri.AbsolutePath.StartsWith('/download/release/'))
}
function Save-OfficialNodeFile {
    param([uri]$Uri, [string]$Destination, [long]$MaximumBytes = 268435456)
    if (!(Test-OfficialNodeUri $Uri)) { throw '拒绝非 Node.js 官方 HTTPS 下载地址。' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(120)
    $cancel = New-Object Threading.CancellationTokenSource
    $cancel.CancelAfter(120000)
    $response = $null; $inputStream = $null; $output = $null
    try {
        for ($hop = 0; $hop -le 5; $hop++) {
            if (!(Test-OfficialNodeUri $Uri)) { throw '拒绝转向非官方 HTTPS 地址。' }
            $response = $client.GetAsync($Uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancel.Token).GetAwaiter().GetResult()
            if ([int]$response.StatusCode -in @(301, 302, 303, 307, 308)) {
                if (!$response.Headers.Location -or $hop -eq 5) { throw '官方下载重定向异常。' }
                $Uri = New-Object Uri($Uri, $response.Headers.Location)
                $response.Dispose(); $response = $null
                continue
            }
            [void]$response.EnsureSuccessStatusCode()
            if ($response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $MaximumBytes) { throw '官方下载文件超过大小限制。' }
            $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $output = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $buffer = New-Object byte[] 65536
            [long]$received = 0
            while ($true) {
                $count = $inputStream.ReadAsync($buffer, 0, $buffer.Length, $cancel.Token).GetAwaiter().GetResult()
                if ($count -eq 0) { break }
                $received += $count
                if ($received -gt $MaximumBytes) { throw '官方下载文件超过大小限制。' }
                $output.Write($buffer, 0, $count)
            }
            return
        }
    } finally {
        if ($output) { $output.Dispose() }; if ($inputStream) { $inputStream.Dispose() }
        if ($response) { $response.Dispose() }; $cancel.Dispose(); $client.Dispose(); $handler.Dispose()
    }
}
function Get-ArchiveChecksum([string]$Text, [string]$Archive) {
    $pattern = '^(?<hash>[a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($Archive) + '$'
    $hashes = @($Text -split '\r?\n' | ForEach-Object { if ($_.Trim() -match $pattern) { $Matches.hash.ToLowerInvariant() } })
    if ($hashes.Count -ne 1) { throw '官方校验清单缺少安装包或存在重复记录。' }
    return $hashes[0]
}
function Expand-ValidatedNodeArchive {
    param([string]$Archive, [string]$Destination, [long]$MaximumBytes = 536870912)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $root = [IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
    [void][IO.Directory]::CreateDirectory($root)
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -gt 30000) { throw '安装包文件数量异常。' }
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if ([IO.Path]::IsPathRooted($name) -or $name.Contains(':') -or $name -match '(^|/)\.\.(/|$)' -or (($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000) { throw '安装包包含不安全路径或链接。' }
            $target = [IO.Path]::GetFullPath((Join-Path $root $name))
            if (!$target.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '安装包文件超出目标目录。' }
            if ($entry.Length -gt $MaximumBytes -or $total + $entry.Length -gt $MaximumBytes) { throw '安装包解压大小异常。' }
            if ($name.EndsWith('/')) { [void][IO.Directory]::CreateDirectory($target); continue }
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
            $source = $entry.Open(); $file = $null
            try {
                $file = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                $buffer = New-Object byte[] 65536
                while (($count = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $total += $count; if ($total -gt $MaximumBytes) { throw '安装包解压大小异常。' }
                    $file.Write($buffer, 0, $count)
                }
            } finally { if ($file) { $file.Dispose() }; $source.Dispose() }
        }
    } finally { $zip.Dispose() }
}
function Remove-SafeRuntimeDirectory([string]$Path, [string]$RuntimeRoot) {
    $root = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\', '/')
    $target = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    if (!$target.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '拒绝清理运行环境目录之外的位置。' }
    if (!(Test-Path -LiteralPath $target)) { return }
    $ancestor = $target
    while ($ancestor.Length -ge $root.Length) {
        if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '运行环境包含链接目录，拒绝自动清理。' }
        if ($ancestor -eq $root) { break }; $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
    if (@(Get-ChildItem -LiteralPath $target -Force -Recurse -Attributes ReparsePoint).Count) { throw '运行环境包含链接，拒绝自动清理。' }
    Remove-Item -LiteralPath $target -Force -Recurse
}
function Install-ProjectNode {
    param([string]$RuntimeRoot, [int]$MinimumMajor, [string]$Architecture,
        [scriptblock]$Downloader = { param($uri, $path, $limit) Save-OfficialNodeFile -Uri $uri -Destination $path -MaximumBytes $limit },
        [scriptblock]$Probe = { param($p) Get-NodeVersionText $p },
        [scriptblock]$VerifyPublisher = {
            param($p)
            $signature = Get-AuthenticodeSignature -LiteralPath $p
            if ($signature.Status -ne 'Valid' -or !$signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O="?(?:OpenJS Foundation|Node\.js Foundation)"?(?:,|$)') {
                throw 'Node.exe 的官方发布者签名无法通过验证，已停止。请检查网络 / 系统证书，或手动从官网安装。'
            }
        })
    $root = [IO.Path]::GetFullPath($RuntimeRoot)
    [void][IO.Directory]::CreateDirectory($root)
    if ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '.runtime 不能是链接目录。' }
    $lock = $null; $stage = $null
    try {
        try { $lock = [IO.File]::Open((Join-Path $root '.install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw '另一个启动窗口正在准备 Node.js，请等待完成后重试。' }
        # Another completed install may have become available before acquiring the lock.
        $ready = Resolve-ExistingNode -RuntimeRoot $root -MinimumMajor $MinimumMajor -Architecture $Architecture -Probe $Probe
        if ($ready) { return $ready }
        $stage = Join-Path $root ('install-' + [guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($stage)
        Write-Host '未找到符合要求的 Node.js，正在查询官方 LTS 运行环境。'
        $index = Join-Path $stage 'index.json'
        & $Downloader 'https://nodejs.org/dist/index.json' $index 8388608
        $releases = [IO.File]::ReadAllText($index) | ConvertFrom-Json
        $selected = Select-NodeRelease -Releases $releases -MinimumMajor $MinimumMajor -Architecture $Architecture
        $base = 'https://nodejs.org/dist/' + $selected.Version + '/'
        $checksums = Join-Path $stage 'SHASUMS256.txt'; $archive = Join-Path $stage $selected.Archive
        Write-Host ("正在下载官方 Node.js {0}（{1}），只安装到项目 .runtime，不修改系统 PATH。" -f $selected.Version, $Architecture)
        & $Downloader ($base + 'SHASUMS256.txt') $checksums 8388608
        & $Downloader ($base + $selected.Archive) $archive 268435456
        $expected = Get-ArchiveChecksum -Text ([IO.File]::ReadAllText($checksums)) -Archive $selected.Archive
        if ((Get-NodeFileSha256 $archive) -ne $expected) { throw 'Node.js 安装包 SHA-256 校验失败，未执行任何下载程序。' }
        $unpack = Join-Path $stage 'unpacked'
        Expand-ValidatedNodeArchive -Archive $archive -Destination $unpack
        $folder = Join-Path $unpack $selected.Archive.Substring(0, $selected.Archive.Length - 4)
        $exe = Join-Path $folder 'node.exe'
        if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw '官方安装包中没有找到 node.exe。' }
        & $VerifyPublisher $exe
        $actual = & $Probe $exe
        if ($actual -cne $selected.Version) { throw '下载的 Node.js 不能正常运行或版本不匹配，未启动网站。' }
        $marker = @{ version = $actual; architecture = $Architecture; nodeSha256 = (Get-NodeFileSha256 $exe) }
        [IO.File]::WriteAllText((Join-Path $folder 'screenroom-runtime.json'), ($marker | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        $destination = Join-Path $root ($selected.Archive.Substring(0, $selected.Archive.Length - 4) + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        # Both absolute paths were constructed inside this runtime root; never move/delete a user directory.
        if (![IO.Path]::GetFullPath($folder).StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or ![IO.Path]::GetFullPath($destination).StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '运行环境目标目录异常。' }
        [IO.Directory]::Move($folder, $destination)
        return [pscustomobject]@{ Path = (Join-Path $destination 'node.exe'); Version = $actual; Source = 'project' }
    } finally {
        try { if ($stage) { Remove-SafeRuntimeDirectory -Path $stage -RuntimeRoot $root } }
        finally { if ($lock) { $lock.Dispose() } }
    }
}

if (!$LibraryOnly) {
    try {
        try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch {}
        if ($CheckOnly -and $InstallOnly) { throw '检查与准备模式不能同时使用。' }
        $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
        $minimum = Get-MinimumNodeMajor $project
        $architecture = Get-NodeArchitecture
        $runtime = Join-Path $project '.runtime'
        $paths = @(); if (!$SkipSystemNode) { $paths = @(Get-SystemNodePaths) }
        $node = Resolve-ExistingNode -RuntimeRoot $runtime -MinimumMajor $minimum -Architecture $architecture -SystemCandidates $paths
        if ($CheckOnly) {
            if ($node) { $node | ConvertTo-Json -Compress; exit 0 }
            [pscustomobject]@{ Available = $false; MinimumMajor = $minimum } | ConvertTo-Json -Compress; exit 1
        }
        if (!$node) { $node = Install-ProjectNode -RuntimeRoot $runtime -MinimumMajor $minimum -Architecture $architecture }
        Write-Host ("使用 Node.js {0}：{1}" -f $node.Version, $node.Path)
        if ($InstallOnly) { $node | ConvertTo-Json -Compress; exit 0 }
        $env:PATH = [IO.Path]::GetDirectoryName($node.Path) + ';' + $env:PATH
        Push-Location -LiteralPath $project
        try { & $node.Path (Join-Path $project 'server.mjs') '--open'; $serverExit = $LASTEXITCODE }
        finally { Pop-Location }
        exit $serverExit
    } catch {
        [Console]::Error.WriteLine('启动准备失败：' + $_.Exception.Message)
        [Console]::Error.WriteLine('请检查网络或从 https://nodejs.org/ 安装符合要求的 Node.js，然后重试。自动准备过程不改动系统 Node.js、账号或片库数据。')
        exit 1
    }
}
