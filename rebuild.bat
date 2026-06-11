@echo off
echo ==========================================
echo  My-Kizo - Clean Rebuild Script
echo ==========================================
echo.

echo [1/2] Cleaning old build folders...
rmdir /s /q dist 2>nul
rmdir /s /q .next 2>nul
rmdir /s /q src-tauri\target 2>nul
echo Cleaned.
echo.

echo [2/2] Building App (Frontend + Tauri)...
call npm run tauri build
if errorlevel 1 (
    echo.
    echo ERROR: App build failed!
    pause
    exit /b 1
)
echo.

echo ==========================================
echo  Build Complete!
echo ==========================================
echo.
echo Installer location:
echo   src-tauri\target\release\bundle\msi\
echo   src-tauri\target\release\bundle\nsis\
echo.
pause
