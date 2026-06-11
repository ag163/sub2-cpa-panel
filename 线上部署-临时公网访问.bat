@echo off
setlocal

cd /d "%~dp0"
set "PORT=8765"

echo [1/2] 启动本地面板...
start "Sub2CPAPanel-%PORT%" /min cmd /c "cd /d ""%~dp0"" && where py >nul 2>nul && (py -3 ""%~dp0sub2_cpa_panel.py"" --host 127.0.0.1 --port %PORT% --no-open) || python ""%~dp0sub2_cpa_panel.py"" --host 127.0.0.1 --port %PORT% --no-open"

echo 等待服务启动...
timeout /t 3 /nobreak >nul

echo [2/2] 创建免费公网地址（临时）...
echo 说明：
echo   - 当前方案是免费临时公网隧道
echo   - 保持此窗口开启，公网地址才会持续可用
echo   - 关闭此窗口后，公网地址会失效
echo.

npx -y localtunnel --port %PORT%

endlocal
