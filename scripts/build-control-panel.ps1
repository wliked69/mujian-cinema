$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
if (!(Test-Path -LiteralPath $compiler)) {
    throw 'Run this script using Windows PowerShell 5.1 (.NET Framework).'
}
& $compiler /nologo /target:winexe /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll "/out:$root\ScreenRoom.exe" (Join-Path $PSScriptRoot 'ScreenRoomPanel.cs') (Join-Path $PSScriptRoot 'ScreenRoomBackup.cs') (Join-Path $PSScriptRoot 'ScreenRoomBrowser.cs')
exit $LASTEXITCODE
