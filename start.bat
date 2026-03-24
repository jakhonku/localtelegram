@echo off
setlocal enabledelayedexpansion
echo ==============================================
echo LAN Messenger (Local Telegram) Ishga Tushmoqda
echo ==============================================
echo.

:: Avval standard python komandasini tekshiramiz (boshqa kompyuterlarda shunday bo'ladi)
python --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_EXE=python"
) else (
    :: Agar standard topilmasa, joriy foydalanuvchi kompyuteridagi manzil
    set "PY_EXE=C:\Users\User\AppData\Local\Python\pythoncore-3.12-64\python.exe"
)

:: Python yaroqliligini tekshirish
"%PY_EXE%" --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [XATOLIK] Python topilmadi! Iltimos ushbu kompyuterga Python o'rnating.
    pause
    exit /b 1
)

echo 1. Kutubxonalar ornatilmoqda...
"%PY_EXE%" -m pip install -r backend\requirements.txt

echo.
echo 2. Server ishga tushirilmoqda...
start /b cmd /c "cd backend && "%PY_EXE%" main.py"

echo.
echo 3. Dastur interfeysi ochilmoqda...
timeout /t 3 >nul
"%PY_EXE%" desktop_client.py

pause
