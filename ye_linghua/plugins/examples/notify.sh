#!/bin/bash
# PLUGIN_ID: sh_notify
# PLUGIN_NAME: Shell Notification Plugin
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: Send notifications via notify-send

# Read JSON input from stdin
INPUT_JSON=$(cat)

# Parse JSON using python
ACTION=$(echo "$INPUT_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['action'])")

case "$ACTION" in
    "get_prompt")
        # Return prompt extension
        echo '{
            "success": true,
            "prompt": "## Linux通知功能\n\n你可以请求发送Linux桌面通知，我会使用notify-send来处理。"
        }'
        ;;

    "get_context")
        # Return context extension
        echo '{
            "success": true,
            "context": {
                "platform": "linux",
                "notification_available": true
            }
        }'
        ;;

    "send_notification")
        # Parse title and message
        TITLE=$(echo "$INPUT_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['title'])")
        MESSAGE=$(echo "$INPUT_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['message'])")

        # Send notification
        if command -v notify-send &> /dev/null; then
            notify-send "$TITLE" "$MESSAGE" -u normal -i dialog-information
            echo '{"success": true}'
        else
            echo '{"success": false, "error": "notify-send not found"}'
        fi
        ;;

    *)
        echo "{\"success\": false, \"error\": \"Unknown action: $ACTION\"}"
        ;;
esac
