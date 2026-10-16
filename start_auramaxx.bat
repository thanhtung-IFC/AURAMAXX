@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_CMD="
if exist ".venv\Scripts\python.exe" (
  set "PYTHON_CMD=.venv\Scripts\python.exe"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON_CMD=py -3.12"
  ) else (
    where python >nul 2>nul
    if not errorlevel 1 (
      set "PYTHON_CMD=python"
    )
  )
)

if "%PYTHON_CMD%"=="" (
  echo Cannot find the project's Python environment: .venv
  echo Open PowerShell in this folder and run:
  echo   python -m venv .venv
  echo   .venv\Scripts\python.exe -m pip install -r requirements-postgres.txt
  pause
  exit /b 1
)

powershell.exe -NoProfile -Command "try { $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2; if ($status.service -eq 'AURAMAXX API' -and $status.status -eq 'ok') { exit 0 }; exit 1 } catch { exit 1 }"
if not errorlevel 1 (
  echo AURAMAXX is already running. Opening the website.
  start "" "http://127.0.0.1:8000"
  exit /b 0
)

echo Starting AURAMAXX + VisionFace at http://127.0.0.1:8000
echo Database: PostgreSQL on Supabase. Internet connection is required.
echo Keep this window open while using the website. Press Ctrl+C to stop.
echo.
%PYTHON_CMD% -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause
