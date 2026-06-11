@echo off
setlocal

cd /d "%~dp0"

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%~dp0convert_sub2api_to_cpa.py" %*
) else (
  python "%~dp0convert_sub2api_to_cpa.py" %*
)

set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo Script failed. Please check the error above.
)
pause
exit /b %EXIT_CODE%
