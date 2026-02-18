start-smart-invoice.bat
@echo off
title SMART INVOICE - AUTO RUN
echo ----------------------------------------
echo   ✅ STARTING SMART INVOICE PROJECT...
echo ----------------------------------------
echo.

cd %~dp0
npm install
npm start

pause
