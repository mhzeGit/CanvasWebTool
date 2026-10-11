@echo off
rem Canvas CLI launcher for the installed desktop app.
rem
rem ELECTRON_RUN_AS_NODE makes Canvas.exe behave as a plain Node runtime, so the
rem CLI works without Node being installed separately and without ever opening a
rem window. Run `canvas path --install` once to put this folder on your PATH.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\Canvas.exe" "%~dp0..\app.asar\bin\canvas.mjs" %*
exit /b %ERRORLEVEL%
