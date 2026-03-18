import os
import json
from tools.bash_tools import BashResult

_parser_initialized = False
_parser = None
_language = None

def init_tree_sitter():
    global _parser_initialized, _parser, _language
    if _parser_initialized:
        return True
    try:
        import tree_sitter_rust
        from tree_sitter import Language, Parser
        
        _language = Language(tree_sitter_rust.language())
        _parser = Parser(_language)
        _parser_initialized = True
        return True
    except ImportError:
        return False

def ast_validate_call(args: str, cwd: str) -> BashResult:
    """
    Validates if a specific function calls another function within a file.
    Expected args format (JSON): {"file_path": "path/to/file.rs", "caller": "func_name", "callee": "target_name"}
    """
    if not init_tree_sitter():
        return BashResult("ast_validate_call", "", "[AST Error] tree-sitter not installed", 1, 0)

    try:
        data = json.loads(args.strip())
        file_path = os.path.join(cwd, data["file_path"])
        caller = data["caller"]
        callee = data["callee"]
    except Exception as e:
        return BashResult("ast_validate_call", "", f"[AST Error] Invalid arguments: {e}", 1, 0)
        
    if not os.path.exists(file_path):
        return BashResult("ast_validate_call", "", f"[AST Error] File not found: {file_path}", 1, 0)
        
    try:
        with open(file_path, "rb") as f:
            source_code = f.read()
    except Exception as e:
        return BashResult("ast_validate_call", "", f"[AST Error] Could not read file: {e}", 1, 0)

    tree = _parser.parse(source_code)
    
    # We use tree-sitter query to find the caller function
    # A simple query to find function items and their names
    query_str = """
    (function_item
      name: (identifier) @func_name
      body: (block) @func_body
    )
    """
    try:
        from tree_sitter import Query
        query = Query(_language, query_str)
    except Exception as e:
        return BashResult("ast_validate_call", "", f"[AST Error] Query error: {e}", 1, 0)
        
    captures = query.captures(tree.root_node)
    
    caller_body_node = None
    for node, capture_name in captures.items() if isinstance(captures, dict) else captures:
        # tree-sitter < 0.22 returns list of tuples, >= 0.22 returns dict
        name = capture_name
        n = node
        if isinstance(capture_name, tuple) or isinstance(node, tuple):
             # old api: [(node, "capture_name")]
             if isinstance(node, tuple) and len(node) == 2:
                 n, name = node
        
        if name == "func_name" and n.text.decode("utf8") == caller:
            # Found the caller. We need its body
            pass
            
    # Simpler approach: AST traversal since node querying can be tricky across versions
    def find_function_body(node, target_name):
        if node.type == 'function_item' or node.type == 'impl_item': # impl items have functions inside
            pass
        if node.type == 'function_item':
            name_node = node.child_by_field_name('name')
            if name_node and name_node.text.decode('utf8') == target_name:
                return node.child_by_field_name('body')
        for child in node.children:
            res = find_function_body(child, target_name)
            if res: return res
        return None

    caller_body = find_function_body(tree.root_node, caller)
    if not caller_body:
         return BashResult("ast_validate_call", "", f"Result: FALSE. Caller function '{caller}' not found in {data['file_path']}.", 0, 0)

    # Now verify if callee is called inside caller_body
    def find_call(node, target_callee):
        if node.type == 'call_expression':
            func_node = node.child_by_field_name('function')
            if func_node:
                # Handle simple identifiers or field expressions (obj.callee())
                text = func_node.text.decode('utf8')
                if text == target_callee or text.endswith(f".{target_callee}") or text.endswith(f"::{target_callee}"):
                    return True
        for child in node.children:
            if find_call(child, target_callee):
                return True
        return False

    found = find_call(caller_body, callee)
    if found:
        return BashResult("ast_validate_call", f"Result: TRUE. Function '{caller}' DOES call '{callee}'.", "", 0, 0)
    else:
        return BashResult("ast_validate_call", "", f"Result: FALSE. '{caller}' does NOT call '{callee}' in its AST.", 0, 0)

