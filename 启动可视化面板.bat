@echo off
setlocal

cd /d "%~dp0"

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%~dp0sub2_cpa_panel.py" %*
) else (
  python "%~dp0sub2_cpa_panel.py" %*
)

set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Panel failed. Please check the error above.
)
pause
exit /b %EXIT_CODE%
