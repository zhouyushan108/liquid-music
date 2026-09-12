@echo off
chcp 65001 >nul
set WORK=%LOCALAPPDATA%\LiquidMusic
if not exist "%WORK%" mkdir "%WORK%"
echo Extracting files...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%~dp0app.zip' -DestinationPath '%WORK%' -Force"
copy /y "%~dp0node.exe" "%WORK%\node.exe" >nul
echo Adding firewall rule for port 3000...
netsh advfirewall firewall delete rule name="LiquidMusic LAN" >nul 2>&1
netsh advfirewall firewall add rule name="LiquidMusic LAN" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo Starting Liquid Music (LAN mode)...
start "" "http://localhost:3000"
cd /d "%WORK%"
echo ============================================
echo  Liquid Music is running (LAN mode)
echo  Local:   http://localhost:3000
echo  LAN:     see address below
echo  Close this window to stop the server.
echo ============================================
node server.js
pause