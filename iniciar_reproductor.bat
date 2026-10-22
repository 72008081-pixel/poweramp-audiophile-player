@echo off
title Poweramp Audiophile Player - Hi-Res Audio
chcp 65001 >nul
cls

echo ======================================================================
echo       🎵 POWERAMP AUDIOPHILE WEB PLAYER (FLAC Hi-Res 24-bit/96kHz)
echo ======================================================================
echo.
echo [1/2] Verificando entorno de ejecucion...

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Node.js detectado. Iniciando servidor de streaming ultra-rapido...
    start http://localhost:3000
    node server.js
    goto :end
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Python detectado. Iniciando servidor de streaming...
    start http://localhost:3000
    python server.py
    goto :end
)

echo [AVISO] Ni Node ni Python fueron encontrados en PATH.
echo Abriendo reproductor estatico directamente en el navegador...
start index.html

:end
pause
