param([string]$KnownNode)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch {}
. (Join-Path $PSScriptRoot '..\scripts\bootstrap-node.ps1') -LibraryOnly
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$tempParent = [IO.Path]::GetTempPath()
$testRoot = Join-Path $tempParent ('screenroom-bootstrap-tests-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$script:passed = 0
function Assert-True($Value, [string]$Message = 'assertion failed') { if (!$Value) { throw $Message } }
function Assert-Throws([scriptblock]$Action) {
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    Assert-True $failed 'expected an exception'
}
function Case([string]$Name, [scriptblock]$Action) {
    & $Action | Out-Null
    $script:passed++
    Write-Output ('PASS ' + $Name)
}
try {
    Case 'supported and unsupported versions' {
        Assert-True ((ConvertTo-NodeVersion 'v22.20.0').Major -eq 22)
        Assert-True ($null -eq (ConvertTo-NodeVersion 'v22.0.0-rc.1'))
        Assert-True ($null -eq (ConvertTo-NodeVersion 'echo v26.0.0'))
        Assert-True ($null -eq (ConvertTo-NodeVersion ''))
    }
    Case 'minimum major follows package.json' {
        [IO.File]::WriteAllText((Join-Path $testRoot 'package.json'), '{"engines":{"node":">=24"}}')
        Assert-True ((Get-MinimumNodeMajor $testRoot) -eq 24)
        [IO.File]::WriteAllText((Join-Path $testRoot 'package.json'), '{"engines":{"node":">=22 <27"}}')
        Assert-Throws { Get-MinimumNodeMajor $testRoot }
    }
    Case 'native CPU architectures' {
        Assert-True ((Get-NodeArchitecture 'AMD64') -eq 'x64')
        Assert-True ((Get-NodeArchitecture 'ARM64') -eq 'arm64')
        Assert-True ((Get-NodeArchitecture 'x86') -eq 'x86')
        Assert-Throws { Get-NodeArchitecture 'unknown' }
    }
    Case 'existing compatible system node prevents installation' {
        $result = Resolve-ExistingNode -RuntimeRoot (Join-Path $testRoot 'missing') -MinimumMajor 22 -Architecture x64 -SystemCandidates @('old.exe', 'good.exe') -Probe { param($p) if ($p -eq 'old.exe') { 'v20.1.0' } else { 'v22.20.0' } }
        Assert-True ($result.Path -eq 'good.exe' -and $result.Source -eq 'system')
        $none = Resolve-ExistingNode -RuntimeRoot (Join-Path $testRoot 'missing') -MinimumMajor 24 -Architecture x64 -SystemCandidates @('old.exe') -Probe { 'v22.20.0' }
        Assert-True ($null -eq $none)
    }
    Case 'actual installed executable version check' {
        Assert-True ($null -ne (ConvertTo-NodeVersion (Get-NodeVersionText $KnownNode)))
        Assert-True ($null -eq (Get-NodeVersionText (Join-Path $testRoot 'missing-node.exe')))
    }
    $entryRoot = Join-Path $testRoot 'project with spaces 中文 !'
    $entryScripts = Join-Path $entryRoot 'scripts'
    [void][IO.Directory]::CreateDirectory($entryScripts)
    $entryScript = Join-Path $entryScripts 'bootstrap-node.ps1'
    [IO.File]::Copy((Join-Path $PSScriptRoot '..\scripts\bootstrap-node.ps1'), $entryScript)
    [IO.File]::WriteAllText((Join-Path $entryRoot 'package.json'), '{"engines":{"node":">=22"},"type":"module"}')
    Case 'check-only missing node never downloads or creates runtime' {
        $output = & (Join-Path $PSHOME 'powershell.exe') -NoLogo -NoProfile -ExecutionPolicy Bypass -File $entryScript -CheckOnly -SkipSystemNode
        Assert-True ($LASTEXITCODE -eq 1)
        $result = ($output -join "`n") | ConvertFrom-Json
        Assert-True (!$result.Available -and $result.MinimumMajor -eq 22)
        Assert-True (!(Test-Path -LiteralPath (Join-Path $entryRoot '.runtime')))
    }
    Case 'launch handles spaces, Chinese, exclamation and server exit status' {
        [IO.File]::WriteAllText((Join-Path $entryRoot 'server.mjs'), 'if (!process.argv.includes("--open")) process.exit(90); console.log("TEST SERVER ONLY"); process.exit(7);')
        $savedPath = $env:PATH
        try {
            $env:PATH = [IO.Path]::GetDirectoryName($KnownNode) + ';' + $env:PATH
            $output = & (Join-Path $PSHOME 'powershell.exe') -NoLogo -NoProfile -ExecutionPolicy Bypass -File $entryScript
            Assert-True ($LASTEXITCODE -eq 7)
            Assert-True (($output -join "`n").Contains('TEST SERVER ONLY'))
            Assert-True (!(Test-Path -LiteralPath (Join-Path $entryRoot '.runtime')))
        } finally { $env:PATH = $savedPath }
    }
    Case 'select newest LTS with architecture, never prerelease/current' {
        $releases = @(
            @{version='v30.0.0';lts=$false;files=@('win-x64-zip')},
            @{version='v28.0.0-rc.1';lts='test';files=@('win-x64-zip')},
            @{version='v26.0.0';lts='test';files=@('win-x64-zip','win-arm64-zip')},
            @{version='v24.1.0';lts='test';files=@('win-x64-zip','win-x86-zip')})
        Assert-True ((Select-NodeRelease $releases 22 'x64').Version -eq 'v26.0.0')
        Assert-True ((Select-NodeRelease $releases 22 'x86').Version -eq 'v24.1.0')
        Assert-Throws { Select-NodeRelease $releases 26 'x86' }
    }
    Case 'HTTPS official host only, no credentials or arbitrary ports' {
        Assert-True (Test-OfficialNodeUri ([uri]'https://nodejs.org/dist/index.json'))
        Assert-True (Test-OfficialNodeUri ([uri]'https://nodejs.org/download/release/v24.0.0/SHASUMS256.txt'))
        foreach ($uri in @('http://nodejs.org/dist/a','https://nodejs.org.evil.test/dist/a','https://nodejs.org:444/dist/a','https://user:pass@nodejs.org/dist/a','https://nodejs.org/dist/a?token=example','file:///C:/node.exe')) {
            Assert-True (!(Test-OfficialNodeUri ([uri]$uri)))
        }
    }
    Case 'checksum file exact filename, no absent or duplicate match' {
        $hash = 'a' * 64
        Assert-True ((Get-ArchiveChecksum "$hash  node-v24.0.0-win-x64.zip`n" 'node-v24.0.0-win-x64.zip') -eq $hash)
        Assert-Throws { Get-ArchiveChecksum "$hash  other.zip" 'node-v24.0.0-win-x64.zip' }
        Assert-Throws { Get-ArchiveChecksum "$hash  a.zip`n$hash  a.zip" 'a.zip' }
    }
    $fixture = Join-Path $testRoot 'fixture'
    $fixtureNode = Join-Path $fixture 'node-v24.0.0-win-x64'
    [void][IO.Directory]::CreateDirectory($fixtureNode)
    [IO.File]::WriteAllText((Join-Path $fixtureNode 'node.exe'), 'TEST FIXTURE - NEVER EXECUTED')
    $bundle = Join-Path $testRoot 'fixture.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($fixture, $bundle)
    $bundleHash = Get-NodeFileSha256 $bundle
    $download = {
        param($uri, $destination, $limit)
        if ($uri.EndsWith('/index.json')) { [IO.File]::WriteAllText($destination, '[{"version":"v24.0.0","lts":"fixture","files":["win-x64-zip"]}]') }
        elseif ($uri.EndsWith('/SHASUMS256.txt')) { [IO.File]::WriteAllText($destination, "$bundleHash  node-v24.0.0-win-x64.zip`n") }
        elseif ($uri.EndsWith('/node-v24.0.0-win-x64.zip')) { [IO.File]::Copy($bundle, $destination) }
        else { throw 'unexpected fixture URL' }
    }.GetNewClosure()
    $probe = { 'v24.0.0' }
    $fakeSignature = { param($p) } # Fixture only; the real downloader requires Windows publisher validation.
    $runtime = Join-Path $testRoot 'runtime'
    Case 'missing node install pipeline with verified fixture, no network/execution' {
        $installed = Install-ProjectNode -RuntimeRoot $runtime -MinimumMajor 22 -Architecture x64 -Downloader $download -Probe $probe -VerifyPublisher $fakeSignature
        Assert-True ($installed.Source -eq 'project' -and (Test-Path -LiteralPath $installed.Path))
        Assert-True ([IO.Path]::GetFullPath($installed.Path).StartsWith([IO.Path]::GetFullPath($runtime) + '\'))
    }
    Case 'verified project cache is reusable offline' {
        $cached = Install-ProjectNode -RuntimeRoot $runtime -MinimumMajor 22 -Architecture x64 -Downloader { throw 'must not download' } -Probe $probe -VerifyPublisher $fakeSignature
        Assert-True ($cached.Source -eq 'project')
    }
    Case 'modified cached executable is rejected before use' {
        $cached = Resolve-ExistingNode -RuntimeRoot $runtime -MinimumMajor 22 -Architecture x64 -Probe $probe
        [IO.File]::AppendAllText($cached.Path, 'modified')
        Assert-True ($null -eq (Resolve-ExistingNode -RuntimeRoot $runtime -MinimumMajor 22 -Architecture x64 -Probe $probe))
    }
    Case 'checksum failure stops execution and clears partial staging' {
        $badDownload = {
            param($uri,$destination,$limit)
            & $download $uri $destination $limit
            if ($uri.EndsWith('/SHASUMS256.txt')) { [IO.File]::WriteAllText($destination, ('0' * 64) + '  node-v24.0.0-win-x64.zip') }
        }.GetNewClosure()
        $badRoot = Join-Path $testRoot 'bad-checksum'
        Assert-Throws { Install-ProjectNode -RuntimeRoot $badRoot -MinimumMajor 22 -Architecture x64 -Downloader $badDownload -Probe { throw 'must not execute' } -VerifyPublisher { throw 'must not verify invalid archive' } }
        Assert-True (@(Get-ChildItem -LiteralPath $badRoot -Directory).Count -eq 0)
        $handle = [IO.File]::Open((Join-Path $badRoot '.install.lock'), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $handle.Dispose()
    }
    Case 'publisher verification failure never creates usable runtime' {
        $badRoot = Join-Path $testRoot 'bad-publisher'
        Assert-Throws { Install-ProjectNode -RuntimeRoot $badRoot -MinimumMajor 22 -Architecture x64 -Downloader $download -Probe { throw 'must not execute' } -VerifyPublisher { throw 'bad publisher' } }
        Assert-True (@(Get-ChildItem -LiteralPath $badRoot -Directory).Count -eq 0)
    }
    Case 'unsafe zip path cannot escape extraction root' {
        $evil = Join-Path $testRoot 'evil.zip'
        $zip = [IO.Compression.ZipFile]::Open($evil, [IO.Compression.ZipArchiveMode]::Create)
        $entry = $zip.CreateEntry('../escape.txt'); $writer = New-Object IO.StreamWriter($entry.Open()); $writer.Write('bad'); $writer.Dispose(); $zip.Dispose()
        Assert-Throws { Expand-ValidatedNodeArchive -Archive $evil -Destination (Join-Path $testRoot 'extract') }
        Assert-True (!(Test-Path -LiteralPath (Join-Path $testRoot 'escape.txt')))
    }
    Case 'uncompressed size bounded' {
        Assert-Throws { Expand-ValidatedNodeArchive -Archive $bundle -Destination (Join-Path $testRoot 'too-small') -MaximumBytes 1 }
    }
    Case 'cleanup is fenced to named child directories' {
        Assert-Throws { Remove-SafeRuntimeDirectory -Path $testRoot -RuntimeRoot $testRoot }
        Assert-Throws { Remove-SafeRuntimeDirectory -Path ($testRoot + '-outside') -RuntimeRoot $testRoot }
        Assert-True (Test-Path -LiteralPath $testRoot)
    }
    Write-Output ("BOOTSTRAP TESTS: {0} passed" -f $script:passed)
} finally { Remove-SafeRuntimeDirectory -Path $testRoot -RuntimeRoot $tempParent }
