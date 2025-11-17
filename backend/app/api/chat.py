"""对话 API"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DBSession
from app.models.database import get_db
from app.models.session import Session
from app.schemas.chat import SendMessageRequest, SendMessageResponse
from app.services.agent_service import AgentService
from app.services.history_service import HistoryService
from app.services.workspace_service import WorkspaceService
from datetime import datetime

router = APIRouter()

# 内存中的 Agent 实例缓存
_agent_cache: dict[str, AgentService] = {}


@router.post("/{chat_session_id}/message", response_model=SendMessageResponse)
async def send_message(
    chat_session_id: str,
    request: SendMessageRequest,
    session_id: str = Query(..., description="Session ID (user_id)"),
    db: DBSession = Depends(get_db),
):
    """发送消息并获取响应"""
    # 验证会话
    session = (
        db.query(Session)
        .filter(Session.id == chat_session_id, Session.user_id == session_id)
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    if session.status == "completed":
        raise HTTPException(status_code=410, detail="会话已完成")

    # 获取或创建 Agent Service
    if chat_session_id not in _agent_cache:
        try:
            workspace_service = WorkspaceService()
            workspace_dir = workspace_service._get_session_dir(session_id, chat_session_id)

            history_service = HistoryService(db)
            agent_service = AgentService(workspace_dir, history_service, chat_session_id)

            # 初始化 Agent
            print(f"🔧 正在初始化 Agent...")
            agent_service.initialize_agent()
            print(f"✅ Agent 初始化成功")

            _agent_cache[chat_session_id] = agent_service
        except Exception as e:
            import traceback
            error_detail = traceback.format_exc()
            print(f"\n{'='*60}")
            print(f"❌ Agent 初始化失败")
            print(f"{'='*60}")
            print(f"错误类型: {type(e).__name__}")
            print(f"错误信息: {str(e)}")
            print(f"\n详细堆栈:\n{error_detail}")
            print(f"{'='*60}\n")

            # 返回更详细的错误信息给前端
            error_msg = f"Agent 初始化失败: {type(e).__name__}: {str(e)}"
            if "api_key" in str(e).lower() or "apikey" in str(e).lower():
                error_msg += "\n\n💡 提示：请检查 .env 文件中的 LLM_API_KEY 配置是否正确"
            raise HTTPException(status_code=500, detail=error_msg)
    else:
        agent_service = _agent_cache[chat_session_id]

    # 执行对话
    try:
        print(f"🤖 开始执行对话...")
        result = await agent_service.chat(request.message)
        print(f"✅ 对话执行完成")
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"\n{'='*60}")
        print(f"❌ 对话执行失败")
        print(f"{'='*60}")
        print(f"错误类型: {type(e).__name__}")
        print(f"错误信息: {str(e)}")
        print(f"\n详细堆栈:\n{error_detail}")
        print(f"{'='*60}\n")

        # 返回更详细的错误信息给前端
        error_msg = f"对话执行失败: {type(e).__name__}: {str(e)}"
        raise HTTPException(status_code=500, detail=error_msg)

    # 更新会话活跃时间
    session.updated_at = datetime.utcnow()
    db.commit()

    return SendMessageResponse(
        message=request.message,
        response=result["response"],
    )
