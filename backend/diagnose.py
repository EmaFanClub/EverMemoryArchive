#!/usr/bin/env python3
"""后端配置诊断脚本

检查 Mini-Agent 后端的配置是否正确，帮助快速定位问题。
"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent))

print("🔍 Mini-Agent 后端配置诊断\n")
print("=" * 60)

# 1. 检查 Python 版本
print("\n1️⃣  检查 Python 版本")
print(f"   Python 版本: {sys.version}")
if sys.version_info < (3, 10):
    print("   ❌ Python 版本过低，需要 3.10 或更高版本")
    sys.exit(1)
else:
    print("   ✅ Python 版本符合要求")

# 2. 检查必要的包是否安装
print("\n2️⃣  检查依赖包")
required_packages = [
    "fastapi",
    "uvicorn",
    "sqlalchemy",
    "pydantic",
    "pydantic_settings",
    "httpx",
    "anthropic",
    "openai",
    "tiktoken",
    "yaml",
    "mcp",
]

missing_packages = []
for package in required_packages:
    try:
        if package == "yaml":
            __import__("yaml")
        else:
            __import__(package)
        print(f"   ✅ {package}")
    except ImportError:
        print(f"   ❌ {package} 未安装")
        missing_packages.append(package)

if missing_packages:
    print(f"\n   ⚠️  缺少依赖包: {', '.join(missing_packages)}")
    print(f"   💡 运行: pip install -r requirements.txt")
    sys.exit(1)

# 3. 检查 .env 文件
print("\n3️⃣  检查 .env 配置文件")
env_file = Path(__file__).parent / ".env"
if not env_file.exists():
    print(f"   ❌ .env 文件不存在")
    print(f"   💡 请复制 .env.example 为 .env 并修改配置")
    print(f"   命令: cp .env.example .env")
    sys.exit(1)
else:
    print(f"   ✅ .env 文件存在")

# 4. 加载配置
print("\n4️⃣  加载配置")
try:
    from app.config import get_settings

    settings = get_settings()
    print(f"   ✅ 配置加载成功")
except Exception as e:
    print(f"   ❌ 配置加载失败: {e}")
    sys.exit(1)

# 5. 检查关键配置项
print("\n5️⃣  检查关键配置项")

# LLM API Key
if not settings.llm_api_key or settings.llm_api_key == "your-api-key-here":
    print(f"   ❌ LLM_API_KEY 未配置或使用默认值")
    print(f"   💡 请在 .env 文件中设置正确的 API 密钥")
    has_error = True
else:
    masked_key = settings.llm_api_key[:8] + "..." + settings.llm_api_key[-4:]
    print(f"   ✅ LLM_API_KEY: {masked_key}")
    has_error = False

# LLM API Base
print(f"   ✅ LLM_API_BASE: {settings.llm_api_base}")

# LLM Model
print(f"   ✅ LLM_MODEL: {settings.llm_model}")

# LLM Provider
print(f"   ✅ LLM_PROVIDER: {settings.llm_provider}")
if settings.llm_provider not in ["anthropic", "openai"]:
    print(f"   ⚠️  警告：provider 应该是 'anthropic' 或 'openai'")

# 数据库
print(f"   ✅ DATABASE_URL: {settings.database_url}")

# 工作空间
print(f"   ✅ WORKSPACE_BASE: {settings.workspace_base}")

# 6. 检查 mini_agent 源码路径
print("\n6️⃣  检查 mini_agent 源码")
mini_agent_path = Path(__file__).parent.parent / "mini_agent"
if not mini_agent_path.exists():
    print(f"   ❌ mini_agent 目录不存在: {mini_agent_path}")
    print(f"   💡 请确保在 Mini-Agent 项目根目录运行")
    sys.exit(1)
else:
    print(f"   ✅ mini_agent 路径: {mini_agent_path}")

# 检查是否可以导入 mini_agent
try:
    sys.path.insert(0, str(mini_agent_path.parent))
    from mini_agent.agent import Agent
    from mini_agent.llm import LLMClient
    from mini_agent.schema import LLMProvider

    print(f"   ✅ mini_agent 模块可以正常导入")
except ImportError as e:
    print(f"   ❌ 无法导入 mini_agent: {e}")
    sys.exit(1)

# 7. 测试 LLM 客户端初始化
print("\n7️⃣  测试 LLM 客户端初始化")
try:
    provider = (
        LLMProvider.OPENAI
        if settings.llm_provider.lower() == "openai"
        else LLMProvider.ANTHROPIC
    )
    llm_client = LLMClient(
        api_key=settings.llm_api_key,
        api_base=settings.llm_api_base,
        provider=provider,
        model=settings.llm_model,
    )
    print(f"   ✅ LLM 客户端初始化成功")
    print(f"   📝 提供商: {provider.value}")
    print(f"   📝 模型: {settings.llm_model}")
except Exception as e:
    print(f"   ❌ LLM 客户端初始化失败: {e}")
    import traceback

    print(f"\n详细错误:\n{traceback.format_exc()}")
    has_error = True

# 8. 检查数据库
print("\n8️⃣  检查数据库")
try:
    from app.models.database import init_db, engine
    from sqlalchemy import text

    init_db()
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    print(f"   ✅ 数据库连接正常")
except Exception as e:
    print(f"   ❌ 数据库初始化失败: {e}")
    has_error = True

# 总结
print("\n" + "=" * 60)
if has_error:
    print("❌ 发现配置问题，请根据上述提示修复")
    print("\n常见问题:")
    print("1. 确保 .env 文件中的 LLM_API_KEY 已正确配置")
    print("2. 确保所有依赖包已安装: pip install -r requirements.txt")
    print("3. 确保在正确的目录运行（Mini-Agent/backend/）")
    sys.exit(1)
else:
    print("✅ 所有检查通过，后端配置正常！")
    print("\n可以运行后端服务:")
    print("   uvicorn app.main:app --reload")
