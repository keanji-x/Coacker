from typing import Dict
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from core.state import AgentState
from core.config import get_llm_kwargs, get_temperature

def attacker_node(state: AgentState, task_id: str) -> Dict:
    """
    Intention Attacker: Compares ideal intention with discovered implementation to find logic flaws.
    """
    llm_kwargs = get_llm_kwargs()
    llm = ChatOpenAI(**llm_kwargs, temperature=get_temperature("attacker"))

    task = next((t for t in state.tasks if t.id == task_id), None)
    if not task or not task.implementation_path.strip():
        return {}

    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are the Intention Attacker (Red Team).
Your job is to read the original User Intention and compare it with the Discovered Implementation path.
Look for high-dimensional business logic flaws:
- Did they forget to deduct balance after a transfer?
- Is there a state that cannot be rolled back in case of an error?
- Does the implementation achieve the opposite of the intention?
- Are they logging sensitive information?
Do NOT report basic code style issues or typos. Focus solely on FATAL LOGICAL VULNERABILITIES.
Output a Markdown summary of your attack findings."""),
        ("user", "User Intent: {user_intent}\nTask Specific Intention: {task_intention}\n\nDiscovered Implementation:\n{implementation}\n\nCommence your logical attack.")
    ])

    chain = prompt | llm
    try:
        response = chain.invoke({
            "user_intent": state.user_intent,
            "task_intention": task.intention,
            "implementation": task.implementation_path
        })
        task.attacker_review = response.content
    except Exception as e:
        task.attacker_review = f"[Attacker Error] Failed to generate attack: {str(e)}"

    return {"tasks": [task], "task_statuses": {task.id: "ATTACKED"}}
