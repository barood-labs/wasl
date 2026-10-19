#!/bin/bash
# Full sandbox demo re-record: TTS -> server -> record main + dashboard -> edit. Run under the heavy-job lock.
set -x
cd /workspace/bounty/paypal
echo "START $(date)"
(cd demo && mkdir -p build/vo && /workspace/bounty/tools/sdenv/bin/python tts.py) || { echo "FAIL tts"; exit 1; }
pkill -f "PORT=8795" ; fuser -k 8795/tcp 2>/dev/null
PORT=8795 DATA_DIR=demo/data PUBLIC_URL=http://localhost:8795 AI_TIMEOUT_MS=7200000 nohup node server/index.js > /tmp/wasl_server.log 2>&1 &
SRV=$!
sleep 6
curl -s -o /dev/null -w "server %{http_code}\n" http://localhost:8795/ || { echo "FAIL server"; exit 1; }
rm -rf demo/build/frames demo/build/framesB
node demo/record.mjs http://localhost:8795 demo/build/frames > /tmp/rec.log 2>&1
grep -q '"end"' demo/build/timeline_frames.json && ! grep -q '"error"' demo/build/timeline_frames.json || { echo "FAIL main recording"; tail -20 /tmp/rec.log; kill $SRV; exit 1; }
PART=dashboard node demo/record.mjs http://localhost:8795 demo/build/framesB > /tmp/recB.log 2>&1
kill $SRV
(cd demo && /workspace/bounty/tools/sdenv/bin/python edit.py) > /tmp/edit.log 2>&1 || { echo "FAIL edit"; tail -20 /tmp/edit.log; exit 1; }
ffprobe -v error -show_entries format=duration -of csv=p=0 demo/wasl_demo.mp4
echo "DONE $(date)"
