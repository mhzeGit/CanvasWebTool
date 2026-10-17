param([string]$Destination = (Join-Path $env:LOCALAPPDATA 'Programs\CanvasNative'), [switch]$NoDefaultAppPrompt)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectFile = Join-Path $projectRoot 'native\Canvas\Canvas.csproj'
$installPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $installPath -Force | Out-Null
& dotnet publish $projectFile -c Release -r win-x64 --self-contained true -o $installPath --nologo
if ($LASTEXITCODE -ne 0) { throw 'The native Canvas publish failed.' }
$executable = Join-Path $installPath 'Canvas.Native.exe'
& $executable --register-file-associations
if ($LASTEXITCODE -ne 0) { throw 'The .cvdoc registration failed.' }
Write-Output "Installed Canvas Native at $executable"
$choice = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.cvdoc\UserChoice' -ErrorAction SilentlyContinue
if (-not $NoDefaultAppPrompt -and $choice.ProgId -notin @('Canvas.Native.Document', 'Applications\Canvas.Native.exe')) {
    Write-Output 'Registration is complete. Finish the Windows default-app selection: choose Canvas Native for .cvdoc and select Set default (or Always in Open with).'
    & $executable --choose-default-app
    if ($LASTEXITCODE -ne 0) { throw 'Could not open Windows Default Apps.' }
}
