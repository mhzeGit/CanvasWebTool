@echo off
setlocal
cd /d "%~dp0"

echo === Cleaning previous build ===
if exist release rmdir /s /q release

echo === Vendoring browser modules ===
call npm run vendor
if errorlevel 1 goto :fail

echo === Building Windows artifacts ===
call npm run dist
if errorlevel 1 goto :fail

set "EXE="
for %%F in ("release\Canvas-*-portable.exe") do set "EXE=%%~fF"
if not defined EXE if exist "release\win-unpacked\Canvas.exe" set "EXE=%CD%\release\win-unpacked\Canvas.exe"

if not defined EXE (
  echo Could not find a built executable in release\
  goto :fail
)

echo === Running "%EXE%" ===
start "" "%EXE%"
exit /b 0

:fail
echo.
echo Build failed.
pause
exit /b 1
