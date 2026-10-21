#!/usr/bin/env bash
# Start N render-queue servers (default 2) with a restart loop. Each server is ONE Blender (about 0.5-1 GB).
#   scripts/places/render-queue/run.sh [N]        start N servers in the background and return
#   scripts/places/render-queue/run.sh stop       ask all servers to exit after their current job (and kill the loops)
#   scripts/places/render-queue/run.sh status     show heartbeats
# Logs: scripts/places/render-queue/logs/server-<id>.log.  Exit code 75 from a server means "300 jobs done, start a fresh Blender".
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
Q="$HERE/q"
LOGS="$HERE/logs"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
mkdir -p "$Q/in" "$Q/work" "$Q/done" "$Q/workers" "$LOGS"

case "${1:-}" in
  stop)
    touch "$Q/stop"
    for f in "$Q"/loops/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done
    echo "stop requested (servers exit after the current job)"; exit 0 ;;
  status)
    for f in "$Q"/workers/*.json; do [ -f "$f" ] && cat "$f" && echo; done; exit 0 ;;
esac

N="${1:-2}"
rm -f "$Q/stop"
mkdir -p "$Q/loops"
for ((i = 0; i < N; i++)); do
  ID="$(printf "\\x$(printf %x $((65 + i)))")"
  if [ -f "$Q/loops/$ID.pid" ] && kill -0 "$(cat "$Q/loops/$ID.pid")" 2>/dev/null; then echo "server $ID already running"; continue; fi
  (
    while [ ! -f "$Q/stop" ]; do
      "$BLENDER" -b --factory-startup --python "$HERE/server.py" -- --root "$Q" --workers-id "$ID" >> "$LOGS/server-$ID.log" 2>&1
      code=$?
      echo "[run.sh] server $ID exited with $code" >> "$LOGS/server-$ID.log"
      [ "$code" -eq 0 ] && break
      [ "$code" -eq 75 ] && sleep 1 || sleep 5   # 75 = planned restart; anything else is a crash, back off
    done
  ) &
  echo $! > "$Q/loops/$ID.pid"
  disown
done
echo "started $N render-queue server(s); logs in $LOGS"
