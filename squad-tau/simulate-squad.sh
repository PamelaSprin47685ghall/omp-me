#!/usr/bin/env bash
# Simulation: Real OMP /squad command end-to-end test
# Usage: ./simulate-squad.sh

set -e

PLUGIN_PATH="$(pwd)/index.js"
TEST_DIR="/tmp/squad-sim-calc-$(date +%s)"
TMUX_SESSION="squad-sim-$$"

echo "=== Squad Simulation ==="
echo "Plugin: $PLUGIN_PATH"
echo "Test dir: $TEST_DIR"
echo "Tmux session: $TMUX_SESSION"
echo ""

# Check dependencies
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed"
    echo "Install with: sudo pacman -S tmux  (or your package manager)"
    exit 1
fi

if ! command -v omp &> /dev/null; then
    echo "Error: omp is not installed"
    echo "Install oh-my-pi first"
    exit 1
fi

# Create test directory
mkdir -p "$TEST_DIR"
echo "Created test directory: $TEST_DIR"

# Start OMP in tmux with /squad command
echo "Starting OMP with /squad command..."
echo "Command: cd $TEST_DIR && omp -e $PLUGIN_PATH"
echo "Then sending: /squad 在当前目录写一个简单的计算器程序，支持加减乘除，用 JavaScript 实现"
echo ""

tmux new-session -d -s "$TMUX_SESSION" "cd $TEST_DIR && omp -e $PLUGIN_PATH"

# Wait for OMP to start
sleep 3

# Send the /squad command
tmux send-keys -t "$TMUX_SESSION" "/squad 在当前目录写一个简单的计算器程序，支持加减乘除，用 JavaScript 实现" C-m

echo "Squad command sent to tmux session: $TMUX_SESSION"
echo ""
echo "To monitor progress in real-time:"
echo "  tmux attach -t $TMUX_SESSION"
echo ""
echo "To view tmux output:"
echo "  tmux capture-pane -t $TMUX_SESSION -p"
echo ""
echo "Waiting for squad to complete (polling every 5s)..."
echo ""

# Poll for completion
START_TIME=$(date +%s)
TIMEOUT=300  # 5 minutes
LAST_OUTPUT=""
LAST_CHANGE_TIME=$START_TIME
HANG_TIMEOUT=60  # Consider hung if no output change for 60s

while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    
    if [ $ELAPSED -gt $TIMEOUT ]; then
        echo ""
        echo "Timeout after ${TIMEOUT}s"
        echo "Session is still running. Attach with: tmux attach -t $TMUX_SESSION"
        tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
        exit 1
    fi
    
    # Capture current output
    CURRENT_OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null | tail -10)
    
    # Check if output has changed
    if [ "$CURRENT_OUTPUT" != "$LAST_OUTPUT" ]; then
        LAST_OUTPUT="$CURRENT_OUTPUT"
        LAST_CHANGE_TIME=$(date +%s)
    fi
    
    # Check for hang (no output change for HANG_TIMEOUT seconds)
    TIME_SINCE_CHANGE=$(($(date +%s) - LAST_CHANGE_TIME))
    if [ $TIME_SINCE_CHANGE -gt $HANG_TIMEOUT ]; then
        echo ""
        echo "ERROR: Squad appears to be hung (no output change for ${HANG_TIMEOUT}s)"
        echo ""
        echo "Last output:"
        echo "$CURRENT_OUTPUT"
        echo ""
        echo "Killing tmux session..."
        tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
        exit 1
    fi
    
    # Show elapsed time and current tmux output
    echo "[${ELAPSED}s] Checking progress... (last change: ${TIME_SINCE_CHANGE}s ago)"
    
    # Capture last 5 lines from tmux
    echo "  Last output:"
    echo "$CURRENT_OUTPUT" | tail -5 | sed 's/^/    /'
    
    # Check if any .js files were created
    JS_FILES=$(find "$TEST_DIR" -name "*.js" 2>/dev/null | wc -l)
    echo "  Files in $TEST_DIR: $(ls -1 "$TEST_DIR" 2>/dev/null | wc -l) total, $JS_FILES .js files"
    
    if [ "$JS_FILES" -gt 0 ]; then
        echo ""
        echo "✓ Squad completed! Found $JS_FILES JavaScript file(s)"
        echo ""
        echo "Files created:"
        ls -lh "$TEST_DIR"
        echo ""
        echo "File contents:"
        for f in "$TEST_DIR"/*.js; do
            echo "--- $f ---"
            head -20 "$f"
            echo ""
        done
        echo "Killing tmux session..."
        tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
        echo ""
        echo "Simulation successful!"
        exit 0
    fi
    
    echo ""
    sleep 5
done
