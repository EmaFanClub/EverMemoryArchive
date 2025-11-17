# 叶灵华插件系统文档

## 概述

叶灵华的插件系统提供了强大的扩展能力，支持：

- ✅ **Python插件** - 基于Python的原生插件
- ✅ **Shell脚本插件** - PowerShell/Bash脚本插件
- ✅ **热重载** - 运行时动态重载插件
- ✅ **自动发现** - 自动扫描plugins目录
- ✅ **Reply Handler链** - 处理LLM回复的插件链
- ✅ **上下文注入** - 向LLM注入插件功能
- ✅ **Agent集成** - 完全集成到Agent运行时

## Agent集成

插件系统已完全集成到Ye Linghua的Agent类中，无需额外配置即可工作：

### 自动集成特性

1. **系统提示词注入**
   - 插件的 `get_prompt_extension()` 会在Agent初始化时自动注入到系统提示词
   - LLM可以看到所有可用的插件功能和使用方法

2. **响应处理链**
   - LLM的每个响应都会通过 ReplyHandler 链处理
   - 插件可以提取标记（如 `<set-timer>`、`<notify>`）并执行相应操作
   - 按优先级顺序执行Handler

3. **上下文共享**
   - 插件接收完整的对话历史和平台信息
   - 可以访问session_id、user_id、platform等元数据

### 在CLI中使用

启动Ye Linghua CLI时，插件会自动加载：

```bash
ye-linghua
```

启动信息会显示加载的插件：

```
Initializing plugin system...
✅ Loaded Timer plugin
✅ Loaded Notification plugin
✅ Auto-discovered 2 plugins from ./plugins

╔══════════════════════════════════════════════════════════╗
║            🌸 叶灵华 (Ye Linghua) - 热爱编程的AI少女           ║
╚══════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────┐
│                     Session Info                          │
├──────────────────────────────────────────────────────────┤
│ Model: MiniMax-M2                                         │
│ Workspace: /path/to/workspace                            │
│ Message History: 1 messages                              │
│ Available Tools: 10 tools                                │
│ Active Plugins: 2 plugins                                │
└──────────────────────────────────────────────────────────┘
```

### 编程方式使用

如果要在代码中使用Agent：

```python
from ye_linghua import LLMClient, Agent
from ye_linghua.plugins import PluginRegistry
from ye_linghua.plugins.timer import TimerPlugin
from ye_linghua.plugins.notification import NotificationPlugin

# 创建插件注册表
plugin_registry = PluginRegistry()

# 加载插件
timer_plugin = TimerPlugin()
await timer_plugin.initialize()
plugin_registry.register_plugin(timer_plugin)

notification_plugin = NotificationPlugin()
await notification_plugin.initialize()
plugin_registry.register_plugin(notification_plugin)

# 创建Agent，传入插件注册表
agent = Agent(
    llm_client=llm_client,
    system_prompt=system_prompt,
    tools=tools,
    plugin_registry=plugin_registry,
    platform="custom",
    session_id="my-session-id"
)

# 运行Agent - 插件会自动工作
agent.add_user_message("提醒我5分钟后查看邮件")
response = await agent.run()
# LLM会生成 <set-timer> 标记，Timer插件自动处理
```

## 内置插件

### 1. 定时器插件（Timer Plugin）

提供定时提醒和任务调度功能。

**使用方法**：

```xml
<!-- 设置定时器 -->
<set-timer time="in 5 minutes" reason="查看邮件" repeat="once" />
<set-timer time="2024-12-25 10:00" reason="圣诞节提醒" repeat="daily" />

<!-- 列出所有定时器 -->
<list-timers />

<!-- 删除定时器 -->
<remove-timer id="timer-id" />
```

**时间格式**：
- 相对时间：`in X minutes/hours/days/weeks`
- 绝对时间：`2024-12-25 10:00:00` 或 `12/25/2024 10:00`

**重复策略**：
- `once` - 一次性
- `daily` - 每天
- `weekly` - 每周
- `monthly` - 每月

### 2. 通知插件（Notification Plugin）

发送桌面通知。

**使用方法**：

```xml
<notify title="提醒" message="记得查看邮件" />
<notify title="任务完成" message="代码审查已完成" />
```

**平台支持**：
- ✅ Windows - PowerShell Toast通知
- ✅ Linux - notify-send (需要libnotify-bin)
- ✅ macOS - osascript (AppleScript)

## 插件架构

### 基础类

```python
from ye_linghua.plugins import Plugin, PluginContext, PluginMetadata, ReplyHandler

class MyPlugin(Plugin):
    def __init__(self):
        metadata = PluginMetadata(
            id="my_plugin",
            name="My Plugin",
            version="1.0.0",
            description="Does something cool"
        )
        super().__init__(metadata)

    async def initialize(self) -> None:
        """插件初始化"""
        self._initialized = True

    async def shutdown(self) -> None:
        """插件清理"""
        self._initialized = False

    def get_prompt_extension(self, context: PluginContext) -> str:
        """返回要注入到系统提示词的文本"""
        return """
## My Plugin功能

你可以使用我的插件做xxx...
"""

    def get_context_extension(self, context: PluginContext) -> dict:
        """返回要注入到上下文的额外数据"""
        return {
            "my_plugin_data": "some value"
        }

    def get_reply_handlers(self) -> list[ReplyHandler]:
        """返回回复处理器列表"""
        return [MyReplyHandler(self)]
```

### ReplyHandler

```python
class MyReplyHandler(ReplyHandler):
    async def handle_reply(
        self,
        response: str,
        context: PluginContext
    ) -> tuple[str, bool]:
        """
        处理LLM回复

        返回：
            (modified_response, should_continue)
            - modified_response: 修改后的回复
            - should_continue: 是否继续执行后续处理器
        """
        # 在这里处理回复，比如提取特殊标记
        modified = response.replace("<my-tag>", "✅ 已处理")
        return modified, True

    @property
    def priority(self) -> int:
        """优先级（数字越小优先级越高）"""
        return 100
```

## 创建Python插件

### 1. 创建插件目录

```
plugins/
└── my_plugin/
    ├── __init__.py
    └── metadata.yaml (可选)
```

### 2. 实现插件

在 `__init__.py` 中：

```python
from ye_linghua.plugins import Plugin, PluginMetadata, PluginContext

class MyAwesomePlugin(Plugin):
    def __init__(self):
        metadata = PluginMetadata(
            id="my_awesome_plugin",
            name="My Awesome Plugin",
            version="1.0.0",
            description="An awesome plugin",
        )
        super().__init__(metadata)

    async def initialize(self) -> None:
        print("Plugin initialized!")
        self._initialized = True

    async def shutdown(self) -> None:
        print("Plugin shutdown!")
        self._initialized = False

    def get_prompt_extension(self, context: PluginContext) -> str:
        return "## My Awesome Plugin\n\nI can do awesome things!"
```

### 3. 插件自动加载

将插件目录放入 `plugins/` 目录，系统会自动发现和加载。

## 创建Shell脚本插件

### PowerShell插件示例

```powershell
# PLUGIN_ID: my_ps_plugin
# PLUGIN_NAME: My PowerShell Plugin
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: A PowerShell plugin

# Read JSON input
$InputJson = [Console]::In.ReadToEnd()
$Input = ConvertFrom-Json $InputJson

$Action = $Input.action

switch ($Action) {
    "get_prompt" {
        $Result = @{
            success = $true
            prompt = "## PowerShell Plugin\n\nDoes cool stuff on Windows!"
        }
        ConvertTo-Json $Result -Compress
    }

    "get_context" {
        $Result = @{
            success = $true
            context = @{
                platform = "windows"
            }
        }
        ConvertTo-Json $Result -Compress
    }

    default {
        $Result = @{
            success = $false
            error = "Unknown action"
        }
        ConvertTo-Json $Result -Compress
    }
}
```

### Bash插件示例

```bash
#!/bin/bash
# PLUGIN_ID: my_sh_plugin
# PLUGIN_NAME: My Shell Plugin
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: A shell plugin

INPUT_JSON=$(cat)
ACTION=$(echo "$INPUT_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['action'])")

case "$ACTION" in
    "get_prompt")
        echo '{"success": true, "prompt": "## Shell Plugin\n\nDoes cool stuff on Linux!"}'
        ;;

    "get_context")
        echo '{"success": true, "context": {"platform": "linux"}}'
        ;;

    *)
        echo '{"success": false, "error": "Unknown action"}'
        ;;
esac
```

## 配置

在 `config.yaml` 中配置插件系统：

```yaml
plugins:
  enabled: true              # 启用插件系统
  plugins_dir: "./plugins"   # 插件目录
  auto_discover: true        # 自动发现插件
  hot_reload: false          # 热重载（实验性）

  # 内置插件
  timer_enabled: true
  notification_enabled: true

  # 插件设置
  timer_check_interval: 30
  notification_sound: true
```

## PluginContext

插件上下文包含：

```python
@dataclass
class PluginContext:
    messages: list[dict]      # 对话历史
    platform: str             # 平台（cli/web等）
    user_id: str | None       # 用户ID
    session_id: str | None    # 会话ID
    config: dict              # 配置
    extra: dict               # 额外数据

    def get_recent_messages(self, count: int = 5) -> list[dict]:
        """获取最近的N条消息"""

    def get_message_summary(self) -> str:
        """生成消息摘要"""
```

## 插件生命周期

1. **发现** - 扫描plugins目录
2. **加载** - 导入模块/执行脚本
3. **初始化** - 调用`initialize()`
4. **运行** - 处理请求和回复
5. **重载** - 可选的热重载
6. **关闭** - 调用`shutdown()`

## ReplyHandler链

所有插件的ReplyHandler按优先级排序后顺序执行：

```
LLM回复
  ↓
Timer Handler (priority: 50)
  ↓
Notification Handler (priority: 60)
  ↓
Custom Handler (priority: 100)
  ↓
最终回复
```

每个Handler可以：
- 修改回复内容
- 提取特殊标记并执行操作
- 决定是否继续执行后续Handler

## 最佳实践

1. **错误处理** - 插件应该优雅地处理错误，不影响主系统
2. **异步操作** - 使用 `async/await` 进行I/O操作
3. **日志记录** - 使用Python logging记录重要事件
4. **资源清理** - 在`shutdown()`中清理资源
5. **优先级设置** - 合理设置ReplyHandler优先级
6. **文档完善** - 提供清晰的使用说明

## 示例：完整的插件

查看内置插件的完整实现：

- `ye_linghua/plugins/timer/` - 定时器插件
- `ye_linghua/plugins/notification/` - 通知插件
- `ye_linghua/plugins/examples/` - 示例脚本插件

## 故障排除

### 插件未加载

1. 检查`config.yaml`中`plugins.enabled`是否为`true`
2. 确认插件目录路径正确
3. 查看日志输出

### Shell插件执行失败

1. 确认脚本有执行权限（Linux/macOS）
2. 检查interpreter是否安装（powershell/bash）
3. 验证脚本的JSON输入/输出格式

### 热重载不工作

热重载功能是实验性的，建议重启应用以加载插件更改。

## 进阶话题

### 跨平台插件

```python
import platform

class CrossPlatformPlugin(Plugin):
    def get_prompt_extension(self, context: PluginContext) -> str:
        system = platform.system()
        if system == "Windows":
            return "Windows-specific功能..."
        elif system == "Linux":
            return "Linux-specific功能..."
        else:
            return "通用功能..."
```

### 插件间通信

通过`PluginContext.extra`字典在插件间共享数据：

```python
# Plugin A
def get_context_extension(self, context: PluginContext) -> dict:
    return {"shared_data": "value from Plugin A"}

# Plugin B
def handle_reply(self, response: str, context: PluginContext) -> tuple[str, bool]:
    shared_data = context.extra.get("shared_data")
    # 使用共享数据...
```

## 贡献插件

欢迎贡献新插件！请遵循：

1. 使用清晰的插件ID和名称
2. 提供完整的文档
3. 包含使用示例
4. 添加适当的错误处理
5. 编写单元测试

---

**Made with 💖 by the Ye Linghua Team**
