@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
set "FANGYU_INSTALL_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %FANGYU_INSTALL_EXIT%

