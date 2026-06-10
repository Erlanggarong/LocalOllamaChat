@echo off
echo ==========================================
echo  My Kizo - Clean Rebuild Script
echo ==========================================
echo.

echo [1/3] Cleaning old build folders...
rmdir /s /q dist 2>nul
rmdir /s /q .next 2>nul
rmdir /s /q src-tauri\target 2>nul
echo Cleaned.
echo.

echo [2/3] Building frontend (Next.js)...
call npm run build
if errorlevel 1 (
    echo.
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)
echo Frontend built successfully.
echo.

echo [3/3] Building Tauri desktop app...
cd src-tauri
call cargo tauri build
if errorlevel 1 (
    echo.
    echo ERROR: Tauri build failed!
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
