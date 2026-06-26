#!/bin/bash

RED=$(printf '\033[0;31m')
GREEN=$(printf '\033[0;32m')
YELLOW=$(printf '\033[0;33m')
BLUE=$(printf '\033[0;34m')
MAGENTA=$(printf '\033[0;35m')
CYAN=$(printf '\033[0;36m')
NC=$(printf '\033[0m')

# 2. Ctrl + C (SIGINT) を検知したときの処理を定義
cleanup() {
    echo -e "\n${RED}[SYSTEM] Ctrl+C が押されました。すべてのプロセスを終了します...${NC}"
    # jobs -p でこのスクリプトから起動したバックグラウンドのPID（プロセスID）をすべて取得し、キルする
    kill $(jobs -p) 2>/dev/null
    exit 1
}

# trap を設定：INT（Ctrl+C）信号を受け取ったら cleanup 関数を実行する
trap cleanup INT

colorize() {
    local color="$1"
    local label="$2"
    # sedではなく、より確実な awk を使用して行ごとに色付け
    awk -v col="$color" -v lbl="$label" -v rst="$NC" '{print col "[" lbl "] " $0 rst}'
}

FORCE_COLOR=1 npm run start:ao 2>&1 | colorize "$BLUE" "AO" &
FORCE_COLOR=1 npm run start:aka 2>&1 | colorize "$RED" "AKA" &
FORCE_COLOR=1 npm run start:ingest 2>&1 | colorize "$YELLOW" "ingest" &
FORCE_COLOR=1 cd packages/memory-system && npm run start:background 2>&1 | colorize "$CYAN" "ingest" &
FORCE_COLOR=1 cd packages/simple-pomdp-system && npm run start:background 2>&1 | colorize "$GREEN" "pomdp" &

wait
echo "done"
