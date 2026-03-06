from langgraph.graph import StateGraph, START, END
from langgraph.constants import Send
from typing import List, cast

from core.state import AgentState, Task
from agents.intention import intention_node
from agents.implement import implement_node
from agents.reviewer import reviewer_node
from agents.attacker import attacker_node

# --- Node Definitions --- #

def node_intention(state: AgentState) -> dict:
    return intention_node(state)

# For Map-Reduce nodes, LangGraph Send API passes arguments directly if defined correctly.
# We will use simple wrapper functions to extract the task ID from the mapped payload.

def node_implement(task_payload: dict) -> dict:
    # We pass the full state and specific task_id in the Send payload
    return implement_node(task_payload["state"], task_payload["task_id"])

def node_review(task_payload: dict) -> dict:
    return reviewer_node(task_payload["state"], task_payload["task_id"])

def node_attack(task_payload: dict) -> dict:
    return attacker_node(task_payload["state"], task_payload["task_id"])

# --- Routing Logic (Edges) --- #

def route_from_intention(state: AgentState) -> List[Send]:
    """
    After Intention Analyzer has broken down the tasks,
    we spawn a parallel `node_implement` job for each task.
    This is the MAP step.
    """
    if not state.tasks:
        return [Send(END, state)]
        
    sends = []
    for task in state.tasks:
        sends.append(Send("implement", {"state": state, "task_id": task.id}))
    return sends

def route_from_implement(state: AgentState) -> List[Send]:
    """
    Implementation returns its result into the shared state.
    We route ALL tasks that are 'IMPLEMENTED' to review & attack.
    """
    sends = []
    for task in state.tasks:
        status = state.task_statuses.get(task.id, "")
        if status == "IMPLEMENTED":
            # Fire both Red and Blue team nodes
            sends.append(Send("review", {"state": state, "task_id": task.id}))
            sends.append(Send("attack", {"state": state, "task_id": task.id}))
    
    if not sends:
        # If no tasks are ready, we end (or we could route back, but for MVP we end)
        return [Send(END, state)]
    return sends

def route_to_end(state: AgentState) -> str:
    """
    Checks if all tasks reached 'REVIEWED' AND 'ATTACKED' or fallback states.
    If yes, we can end the graph. For simplicity, we just end after Red/Blue phase.
    """
    return END

# --- Graph Compilation --- #
def build_graph():
    builder = StateGraph(AgentState)
    
    # Add nodes
    builder.add_node("intention", node_intention)
    builder.add_node("implement", node_implement)
    builder.add_node("review", node_review)
    builder.add_node("attack", node_attack)
    
    # Add edges
    builder.add_edge(START, "intention")
    builder.add_conditional_edges("intention", route_from_intention, ["implement", END])
    
    builder.add_conditional_edges("implement", route_from_implement, ["review", "attack", END])
    
    builder.add_conditional_edges("review", route_to_end)
    builder.add_conditional_edges("attack", route_to_end)
    
    return builder.compile()
