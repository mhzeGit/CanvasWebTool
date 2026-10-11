@echo off
setlocal
cd /d "%~dp0"

echo === Checking Python ===
where python >nul 2>nul
if errorlevel 1 (
	echo Python was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
	pause
	exit /b 1
)

echo === Installing dependencies ===
if exist "node_modules\@tiptap\core\package.json" (
	echo Dependencies already installed, skipping npm install.
) else (
	where npm >nul 2>nul
	if errorlevel 1 (
		echo npm was not found. Install Node.js LTS from https://nodejs.org/
		pause
		exit /b 1
	)
	call npm install
	if errorlevel 1 (
		echo npm install failed.
		pause
		exit /b 1
	)
)

echo === Starting server on http://localhost:5173 ===
echo Press Ctrl+C to stop the server.
start "" cmd /c "timeout /t 2 >nul && start http://localhost:5173"
python serve.py --port 5173
if errorlevel 1 (
	echo Server failed to start. Is port 5173 already in use?
)
pause
