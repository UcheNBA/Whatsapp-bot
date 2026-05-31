@echo off
:start
echo [SYSTEM] Starting Carson Bot...
node index.js

echo [SYSTEM] Bot stopped or crashed. Restarting in 5 seconds...
timeout /t 5
goto start