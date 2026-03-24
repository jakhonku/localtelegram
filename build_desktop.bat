@echo off
setlocal enabledelayedexpansion
echo ==============================================
echo Institut Messenger Desktop Ilovaga Aylantirish
echo ==============================================
echo.

:: Python bor-yo'qligini tekshirish
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [XATOLIK] Python topilmadi! Iltimos Python o'rnating va uni PATH ga qo'shing.
    pause
    exit /b 1
)

echo 1. Kutubxonalar o'rnatilmoqda...
python -m pip install -r backend\requirements.txt

echo.
echo 2. EXE fayli yaratilmoqda...
:: PyInstaller bor-yo'qligini tekshirib o'rnatamiz
python -m PyInstaller --version >nul 2>&1
if %errorlevel% neq 0 (
    echo PyInstaller o'rnatilmoqda...
    python -m pip install pyinstaller
)

python -m PyInstaller --noconsole --onefile --add-data "frontend;frontend" --name "Institut Messenger" desktop_client.py

if %errorlevel% neq 0 (
    echo.
    echo [XATOLIK] EXE yaratishda muammo bo'ldi.
    pause
    exit /b 1
)

echo.
echo ==============================================
echo MUVOFAQQIYATLI TUGADI!
echo Tayyor o'rnatish EXE fayli "dist\Institut Messenger.exe" papkasida joylashgan.
echo Shuni barcha kompyuterlarga nusxalab o'rnatishingiz mumkin.
echo ==============================================
pause
