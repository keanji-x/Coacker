import asyncio
import threading
import json
import os
import sys
from typing import Dict, Any, List

class MCPManager:
    """Manages MCP client sessions in a background thread."""
    def __init__(self):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        self.sessions = {}
        self.tools_registry = {}  # { tool_name: { "desc": ..., "server": ... } }

    def _run_loop(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def run_coro(self, coro):
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        return future.result()

    async def _start_client(self, server_name: str, command: str, args: List[str], cwd: str = None):
        # We only import mcp here so it doesn't crash if mcp isn't installed during simple bash runs
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        import mcp.types as types
        
        env = os.environ.copy()
        if cwd:
            # Although stdio doesn't directly take cwd in early versions, we can set PWD or similar if supported
            pass
            
        server_params = StdioServerParameters(command=command, args=args, env=env)
        transport_cm = stdio_client(server_params)
        read, write = await transport_cm.__aenter__()
        
        session_cm = ClientSession(read, write)
        session = await session_cm.__aenter__()
        await session.initialize()
        
        self.sessions[server_name] = {
            "session": session,
            "transport_cm": transport_cm,
            "session_cm": session_cm
        }
        
        res = await session.list_tools()
        tools = res.tools
        
        # Register them
        for t in tools:
            # Create a description including schema
            desc = f"{t.description}\nSchema: {json.dumps(t.inputSchema)}"
            self.tools_registry[t.name] = {
                "desc": desc,
                "server": server_name,
                "schema": t.inputSchema
            }
        return tools

    def start_client(self, server_name: str, command: str, args: List[str], cwd: str = None):
        return self.run_coro(self._start_client(server_name, command, args, cwd))

    async def _call_tool(self, server_name: str, tool_name: str, arguments: dict):
        session = self.sessions[server_name]["session"]
        res = await session.call_tool(tool_name, arguments)
        return res

    def call_tool(self, server_name: str, tool_name: str, arguments: dict):
        return self.run_coro(self._call_tool(server_name, tool_name, arguments))

_manager = None

def get_mcp_manager():
    global _manager
    if _manager is None:
        _manager = MCPManager()
    return _manager

def init_rust_analyzer(cwd: str):
    return {}

def init_semgrep(cwd: str):
    return {}

def init_all_mcp(cwd: str):
    init_rust_analyzer(cwd)
    init_semgrep(cwd)
    return get_mcp_manager().tools_registry

def call_mcp_tool(tool_name: str, args_str: str) -> str:
    manager = get_mcp_manager()
    info = manager.tools_registry.get(tool_name)
    if not info:
        return f"[Error] Unknown MCP tool: {tool_name}"
    
    server_name = info["server"]
    try:
        args_dict = json.loads(args_str) if args_str.strip() else {}
    except json.JSONDecodeError:
        # Fallback for LLMs that just pass a raw string despite the schema
        args_dict = {"query": args_str}

    try:
        res = manager.call_tool(server_name, tool_name, args_dict)
        output = ""
        for content in res.content:
            text = getattr(content, "text", str(content))
            output += text + "\n"
        if res.isError:
            return f"[MCP Error] {output}"
        return output
    except Exception as e:
        return f"[MCP Exception] {str(e)}"
