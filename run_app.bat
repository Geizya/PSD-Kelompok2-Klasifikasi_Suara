@echo off
title AudioNoise Detector AI - Sistem Klasifikasi Suara
echo ========================================================
echo   AudioNoise Detector AI (PSD)
echo   Klasifikasi Suara Berisik vs Non-Berisik
echo   Feedback Audio: notif.mp3
echo ========================================================
echo.
echo Membuka server aplikasi di http://localhost:8000 ...
echo Tekan Ctrl+C untuk menghentikan server.
echo.

py -3.11 app.py
pause
