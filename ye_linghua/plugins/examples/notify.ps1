# PLUGIN_ID: ps_notify
# PLUGIN_NAME: PowerShell Notification Plugin
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: Send Windows notifications via PowerShell

# Read JSON input from stdin
$InputJson = [Console]::In.ReadToEnd()
$Input = ConvertFrom-Json $InputJson

# Get action and data
$Action = $Input.action
$Data = $Input.data

# Process action
switch ($Action) {
    "get_prompt" {
        # Return prompt extension
        $Prompt = @"
## Windows通知功能

你可以请求发送Windows通知，我会使用PowerShell插件来处理。
"@
        $Result = @{
            success = $true
            prompt = $Prompt
        }
        ConvertTo-Json $Result -Compress
        return
    }

    "get_context" {
        # Return context extension
        $Result = @{
            success = $true
            context = @{
                platform = "windows"
                notification_available = $true
            }
        }
        ConvertTo-Json $Result -Compress
        return
    }

    "send_notification" {
        # Send Windows notification
        $Title = $Data.title
        $Message = $Data.message

        # Create toast notification
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

        $Template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">$Title</text>
            <text id="2">$Message</text>
        </binding>
    </visual>
</toast>
"@

        try {
            $Xml = New-Object Windows.Data.Xml.Dom.XmlDocument
            $Xml.LoadXml($Template)
            $Toast = [Windows.UI.Notifications.ToastNotification]::new($Xml)
            $Notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Ye Linghua")
            $Notifier.Show($Toast)

            $Result = @{
                success = $true
            }
        }
        catch {
            $Result = @{
                success = $false
                error = $_.Exception.Message
            }
        }

        ConvertTo-Json $Result -Compress
        return
    }

    default {
        # Unknown action
        $Result = @{
            success = $false
            error = "Unknown action: $Action"
        }
        ConvertTo-Json $Result -Compress
        return
    }
}
