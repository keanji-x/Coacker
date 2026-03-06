from typing import Dict
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from core.state import AgentState
from core.config import get_llm_kwargs, get_temperature

def reviewer_node(state: AgentState, task_id: str) -> Dict:
    """
    Ground Reviewer: Checks the discovered implementation for code quality, style, and obvious bugs.
    """
    llm_kwargs = get_llm_kwargs()
    llm = ChatOpenAI(**llm_kwargs, temperature=get_temperature("reviewer"))

    task = next((t for t in state.tasks if t.id == task_id), None)
    if not task or not task.implementation_path.strip():
        return {}

    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are the Ground Reviewer.
Your job is to read the discovered implementation path for a task and perform a standard code quality review.
Look for: resource leaks, bad naming, unhandled exceptions, concurrency dataraces, or bloated functions.
Do NOT question the business logic. Focus purely on code hygiene and engineering safety.
Output a Markdown summary of your review findings."""),
        ("user", "Task Intention: {intention}\n\nDiscovered Implementation:\n{implementation}\n\nProvide your engineering review.")
    ])

    chain = prompt | llm
    try:
        response = chain.invoke({
            "intention": task.intention,
            "implementation": task.implementation_path
        })
        task.code_review = response.content
    except Exception as e:
        task.code_review = f"[Reviewer Error] Failed to generate review: {str(e)}"

    return {"tasks": [task], "task_statuses": {task.id: "REVIEWED"}}
