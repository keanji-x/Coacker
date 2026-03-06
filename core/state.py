from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
import operator
from typing import Annotated

class Task(BaseModel):
    id: str = Field(description="Unique identifier for the task, usually task_1, task_2 etc.")
    intention: str = Field(description="The business intention or goal of this task.")
    implementation_path: str = Field(default="", description="The discovered code execution path and actual implementation.")
    code_review: str = Field(default="", description="Basic code quality, style, and safety review findings.")
    attacker_review: str = Field(default="", description="Deep logical vulnerabilities and edge case flaws found.")
    
class AgentState(BaseModel):
    entry_file: str
    user_intent: str
    tasks: List[Task] = Field(default_factory=list)
    # Using Annotated and operator.add allows LangGraph to intelligently merge/update dictionary states from parallel branches
    task_statuses: Annotated[Dict[str, str], operator.ior] = Field(default_factory=dict)
    
    # Optional global error or message passing
    errors: List[str] = Field(default_factory=list)
