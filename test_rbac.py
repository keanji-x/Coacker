import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.agent import Agent
from tools.bash_tools import BashResult

class DummyBackend:
    def name(self): return "dummy"
    def query(self, prompt, system, temperature, cwd):
        from core.backend import BackendResponse
        # Simulate LLM trying to call a restricted tool
        if "test_read_only" in prompt:
            return BackendResponse("TOOL_CALL: sandbox_execute echo 1", 0)
        # Simulate LLM finishing
        return BackendResponse("FINAL_ANSWER: Done", 0)

def main():
    print("--- Testing Agent RBAC ---")
    
    # 1. Test Read-Only Agent (Attacker)
    print("\n[1] Testing Read-Only Agent (Attacker)")
    read_agent = Agent(
        role="attacker",
        system_prompt="You are an attacker.",
        backend=DummyBackend(),
        tools=["cat", "sandbox_execute"],
        read_only=True
    )
    res = read_agent.invoke_with_tools("test_read_only", cwd=".")
    
    print("Steps executed:")
    for step in res.steps:
        print(f" - {step.action}: {step.output_summary.strip()}")
        if "Security Denied" in step.output_summary:
            print("   -> (SUCCESS) Blocked by RBAC!")

    # 2. Test Write Agent (PoC Engineer)
    print("\n[2] Testing Write-Enabled Agent (PoC Engineer)")
    write_agent = Agent(
        role="poc_engineer",
        system_prompt="You are an engineer.",
        backend=DummyBackend(),
        tools=["cat", "sandbox_execute"],
        read_only=False
    )
    res2 = write_agent.invoke_with_tools("test_read_only", cwd=".")
    
    print("Steps executed:")
    for step in res2.steps:
        print(f" - {step.action}: {step.output_summary.strip()}")
        if "sandbox" in step.input_summary.lower() and "Security Denied" not in step.output_summary:
            print("   -> (SUCCESS) Execution allowed!")

if __name__ == "__main__":
    main()
