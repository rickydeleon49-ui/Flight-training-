#!/bin/zsh
# Records her-flight-deck processes, their window-server windows and LaunchServices state, twice a second.
OUT=$1; DUR=${2:-90}; S=${0:A:h}
end=$(( $(date +%s) + DUR ))
: > $OUT
while [ $(date +%s) -lt $end ]; do
  ts=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
  for p in $(pgrep -x her-flight-deck); do
    w=$($S/windows $p | /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin);print(json.dumps([{k:x[k] for k in ("number","onscreen","layer","alpha","bounds")} for x in d["windows"]]))')
    ls=$(lsappinfo info -only type "$(lsappinfo find pid=$p)" 2>/dev/null | tr -d '\n' | tr -s ' ')
    fr=$(lsappinfo front 2>/dev/null)
    echo "{\"t\":\"$ts\",\"pid\":$p,\"lsapp\":\"${ls//\"/}\",\"front\":\"$fr\",\"windows\":$w}" >> $OUT
  done
  [ -z "$(pgrep -x her-flight-deck)" ] && echo "{\"t\":\"$ts\",\"pid\":null}" >> $OUT
  sleep 0.5
done
