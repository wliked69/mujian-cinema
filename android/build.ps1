param([switch]$Offline, [switch]$UseGoogleMirror)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $sdk 'platforms\android-36\android.jar'))) {
    throw '需要 Android SDK 36。请先在 Android Studio 的 SDK Manager 安装，不会自动接受许可。'
}
if (Test-Path -LiteralPath 'C:\Program Files\Java\jdk-17\bin\java.exe') {
    $env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
}
if (-not $env:JAVA_HOME) { throw '请安装 Java 17，并设置 JAVA_HOME。' }
$env:ANDROID_HOME = $sdk
# local.properties is machine-specific and excluded from source control.
$escapedSdk = $sdk.Replace('\', '/').Replace(':', '\:')
[IO.File]::WriteAllText((Join-Path $project 'local.properties'), "sdk.dir=$escapedSdk`n", [Text.UTF8Encoding]::new($false))
$gradle = Join-Path $project 'gradlew.bat'
if (-not (Test-Path -LiteralPath $gradle)) {
    $candidates = @(Get-ChildItem -Path (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.13-bin\*\gradle-8.13\bin\gradle.bat') -ErrorAction SilentlyContinue)
    if (-not $candidates) { throw '需要 Gradle 8.13。可用 Android Studio 打开本项目后同步。' }
    $gradle = $candidates[0].FullName
}
Push-Location -LiteralPath $project
try {
    $tasks = @('--no-daemon', '--console=plain', 'testDebugUnitTest', 'lintDebug', 'assembleDebug')
    if ($Offline) { $tasks = @('--offline') + $tasks }
    if ($UseGoogleMirror) { $tasks = @('-PuseGoogleMirror=true') + $tasks }
    & $gradle @tasks
    if ($LASTEXITCODE -ne 0) { throw "构建失败（$LASTEXITCODE）。" }
    Write-Host "测试版安装包：$(Join-Path $project 'app\build\outputs\apk\debug\app-debug.apk')"
} finally { Pop-Location }
