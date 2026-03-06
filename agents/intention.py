from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from core.state import AgentState, Task
from core.config import get_llm_kwargs, get_temperature
import json
import uuid

def intention_node(state: AgentState):
    """
    Intention Analyzer: Generates a list of hypothesized tasks based on user intent and entry file.
    No file reading tools are provided here.
    """
    llm_kwargs = get_llm_kwargs()
    llm = ChatOpenAI(**llm_kwargs, temperature=get_temperature("intention"))

    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are the Intention Analyzer in an AI multi-agent code review system.
Your job is to read the user's review intent and the entry file path, and break them down into specific isolated architectural or business tasks.
Do NOT write code. Output a JSON array of objects, where each object has:
- "id": A unique snake_case string (e.g., "auth_refactor")
- "intention": A detailed string explaining the hypothesis/goal of this task.

Output purely standard JSON. No markdown backticks."""),
        ("user", "Entry File: {entry_file}\n\nUser Intent: {user_intent}")
    ])

    chain = prompt | llm
    response = chain.invoke({"entry_file": state.entry_file, "user_intent": state.user_intent})

    tasks = []
    try:
        text = response.content.replace("```json", "").replace("```", "").strip()
        parsed_tasks = json.loads(text)
        for pt in parsed_tasks:
            tasks.append(
                Task(
                    id=pt.get("id", f"task_{uuid.uuid4().hex[:8]}"),
                    intention=pt.get("intention", "")
                )
            )
    except Exception as e:
        print(f"[Intention Analyzer] Warning: Failed to parse JSON tasks: {e}")
        tasks = [Task(id="fallback_task", intention=state.user_intent)]

    return {"tasks": tasks}
