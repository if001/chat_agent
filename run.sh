#!/bin/bash

REQUIRED_NODE_MAJOR=23
CURRENT_NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')

if (( CURRENT_NODE_MAJOR < REQUIRED_NODE_MAJOR )); then
    USER_HOME_DIR=$(getent passwd "$(id -u)" | cut -d: -f6)
    NVM_SCRIPT_PATH="${USER_HOME_DIR}/.nvm/nvm.sh"
    if [[ -s "$NVM_SCRIPT_PATH" ]]; then
        # shellcheck source=/dev/null
        source "$NVM_SCRIPT_PATH"
        nvm use --silent "$REQUIRED_NODE_MAJOR" >/dev/null
        CURRENT_NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
    fi
fi

if (( CURRENT_NODE_MAJOR < REQUIRED_NODE_MAJOR )); then
    echo "Node.js ${REQUIRED_NODE_MAJOR}以上が必要です（現在: $(node --version 2>/dev/null || printf '未検出')）" >&2
    exit 1
fi

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

# The root processes import local packages through their compiled `lib` entrypoints.
# Rebuild them after pulls/merges so runtime exports cannot lag behind `src`.
if ! npm run build:packages; then
    echo -e "${RED}[SYSTEM] ローカルパッケージのビルドに失敗しました。起動を中止します。${NC}"
    exit 1
fi

colorize() {
    local color="$1"
    local label="$2"
    # sedではなく、より確実な awk を使用して行ごとに色付け
    awk -v col="$color" -v lbl="$label" -v rst="$NC" '{print col "[" lbl "] " $0 rst}'
}

FORCE_COLOR=1 npm run start:ao 2>&1 | colorize "$BLUE" "AO" &
FORCE_COLOR=1 npm run start:aka 2>&1 | colorize "$RED" "AKA" &
FORCE_COLOR=1 npm run start:ingest 2>&1 | colorize "$YELLOW" "ingest" &
FORCE_COLOR=1 npm run start:memory 2>&1 | colorize "$CYAN" "memory" &
FORCE_COLOR=1 npm run start:simple-pomdp 2>&1 | colorize "$GREEN" "pomdp" &

# FORCE_COLOR=1 cd packages/memory-system && npm run start:background 2>&1 | colorize "$CYAN" "memory" &
# FORCE_COLOR=1 cd packages/simple-pomdp-system && npm run start:background 2>&1 | colorize "$GREEN" "pomdp" &

wait
echo "done"
