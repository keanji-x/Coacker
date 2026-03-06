from typing import Dict
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.prebuilt import create_react_agent
from core.state import AgentState
from core.config import get_llm_kwargs, get_temperature, get_sandbox_config
from tools.sandbox import read_file_with_cache
import os

PROJECT_ROOT = os.getcwd()

@tool
def read_file(file_path: str) -> str:
    """Reads the contents of a local file safely. Pass the relative or absolute path of the file."""
    return read_file_with_cache(file_path, PROJECT_ROOT)

SYSTEM_PROMPT = """You are the Implementation Analyzer.
Your job is to read the codebase using the `read_file` tool to verify the business intention.
Follow the execution path starting from the entry file.
Find out HOW this intention is actually implemented.

Once you have enough information, output a detailed Markdown summary of the discovered execution path, files involved, and any unintended side-effects.
Respond with ONLY the markdown summary."""

def implement_node(state: AgentState, task_id: str) -> Dict:
    """
    Implementation Analyzer: Takes a specific task, uses tools to find the real execution path.
    """
    llm_kwargs = get_llm_kwargs()
    llm = ChatOpenAI(**llm_kwargs, temperature=get_temperature("implementation"))
    tools = [read_file]

    task = next((t for t in state.tasks if t.id == task_id), None)
    if not task:
        return {}

    sandbox_cfg = get_sandbox_config()
    max_calls = sandbox_cfg.get("max_tool_calls", 15)

    agent = create_react_agent(llm, tools)

    user_msg = f"Entry File: {state.entry_file}\n\nTask Intention: {task.intention}\n\nBegin your exploration."

    try:
        result = agent.invoke(
            {"messages": [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_msg)]},
            {"recursion_limit": max_calls}
        )
        # The last AI message contains the final answer
        final_message = result["messages"][-1].content
        task.implementation_path = final_message
    except Exception as e:
        task.implementation_path = f"Error during exploration: {str(e)}"

    return {"tasks": [task], "task_statuses": {task.id: "IMPLEMENTED"}}
