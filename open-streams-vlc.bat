@echo off
REM ============================================================
REM  SonicBeat — Open all 4 Icecast streams in VLC
REM  Run this on Windows to hear audio from the Docker server
REM ============================================================

REM Try to find VLC in common install locations
set VLC=""
if exist "C:\Program Files\VideoLAN\VLC\vlc.exe" set VLC="C:\Program Files\VideoLAN\VLC\vlc.exe"
if exist "C:\Program Files (x86)\VideoLAN\VLC\vlc.exe" set VLC="C:\Program Files (x86)\VideoLAN\VLC\vlc.exe"

if %VLC%=="" (
    echo VLC not found. Please install VLC from https://www.videolan.org/
    echo Or open VLC manually and go to: Media ^> Open Network Stream
    echo Then paste: http://localhost:8000/deck-a
    pause
    exit /b 1
)

REM Change localhost to your server IP if running remotely
set SERVER=localhost
set PORT=8000

echo Starting SonicBeat streams in VLC...
echo Server: %SERVER%:%PORT%
echo.
echo Deck A: http://%SERVER%:%PORT%/deck-a
echo Deck B: http://%SERVER%:%PORT%/deck-b
echo Deck C: http://%SERVER%:%PORT%/deck-c
echo Deck D: http://%SERVER%:%PORT%/deck-d
echo.

REM Open all 4 streams in VLC playlist
start "" %VLC% ^
    http://%SERVER%:%PORT%/deck-a ^
    http://%SERVER%:%PORT%/deck-b ^
    http://%SERVER%:%PORT%/deck-c ^
    http://%SERVER%:%PORT%/deck-d ^
    --playlist-autostart

echo VLC launched. Use the dashboard at http://%SERVER%:8083 to control playback.
