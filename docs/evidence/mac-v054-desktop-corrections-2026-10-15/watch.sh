#!/bin/zsh
# When the restore is staged (pending dir appears), make Claude frontmost before the restart.
end=$(( $(date +%s) + 900 ))
while [ $(date +%s) -lt $end ]; do
  if [ -e "/Users/rickymac/Library/Application Support/com.herflightdeck.app/.restore-pending" ] || [ -e "/Users/rickymac/Library/Application Support/com.herflightdeck.app/.restore-staging" ]; then
    osascript -e 'tell application "Claude" to activate'
    echo "staged-seen $(date -u +%H:%M:%S) oldpid=$(pgrep -x her-flight-deck | tr '\n' ' ') front=$(/private/tmp/claude-501/-Users-rickymac-code/87cc7222-5af2-43b4-bca3-7d3b41c974e3/scratchpad/desk2/front)" >> /private/tmp/claude-501/-Users-rickymac-code/87cc7222-5af2-43b4-bca3-7d3b41c974e3/scratchpad/desk2/run2-watch.log
    sleep 3
    echo "after $(date -u +%H:%M:%S) pids=$(pgrep -x her-flight-deck | tr '\n' ' ') front=$(/private/tmp/claude-501/-Users-rickymac-code/87cc7222-5af2-43b4-bca3-7d3b41c974e3/scratchpad/desk2/front)" >> /private/tmp/claude-501/-Users-rickymac-code/87cc7222-5af2-43b4-bca3-7d3b41c974e3/scratchpad/desk2/run2-watch.log
    exit 0
  fi
  sleep 0.05
done
echo timeout >> /private/tmp/claude-501/-Users-rickymac-code/87cc7222-5af2-43b4-bca3-7d3b41c974e3/scratchpad/desk2/run2-watch.log
