import json, traceback, ast
from jinja2 import Template, Environment, StrictUndefined
from jinja2.meta import find_undeclared_variables
from datetime import datetime

def render_and_diagnose(template_str, variables_str, env_options_json='{}'):
    env_options = json.loads(env_options_json)
    env_kwargs = {
        'trim_blocks': env_options.get('trim_blocks', False),
        'lstrip_blocks': env_options.get('lstrip_blocks', False),
        'keep_trailing_newline': env_options.get('keep_trailing_newline', False),
    }

    result = {
        "templateError": None,
        "variablesError": None,
        "extraVars": [],
        "undefinedVars": [],
        "renderError": None,
        "output": None,
    }

    # 1. Parse template
    parsed_content = None
    try:
        parsed_content = Environment(**env_kwargs).parse(template_str)
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)[-1]
        result["templateError"] = {
            "cls": e.__class__.__name__,
            "msg": str(e),
            "line": tb.lineno,
            "col": tb.colno or 0,
        }
        return result

    template_vars = set(find_undeclared_variables(parsed_content))

    # 2. Parse variables
    user_dict = None
    try:
        ast.parse(variables_str)
        user_dict = eval(variables_str)
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)[-1]
        result["variablesError"] = {
            "cls": e.__class__.__name__,
            "msg": str(e),
            "line": tb.lineno,
            "col": tb.colno or 0,
        }
        return result

    if not isinstance(user_dict, dict):
        result["variablesError"] = {
            "cls": "TypeError",
            "msg": "Variables should be defined as a dictionary",
            "line": 1,
            "col": 0,
        }
        return result

    # 3. Compare variables
    user_var_names = set(user_dict.keys())
    result["extraVars"] = list(user_var_names - template_vars)
    result["undefinedVars"] = list(template_vars - user_var_names)

    # 4. Detect undefined attributes via StrictUndefined render
    try:
        Environment(undefined=StrictUndefined, **env_kwargs).from_string(template_str).render(user_dict)
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)[-1]
        if e.__class__.__name__ == "UndefinedError":
            import re
            m = re.search(r"'([^']*)' is undefined", str(e)) or re.search(r"has no attribute '([^']*)'", str(e))
            if m:
                var = m.group(1).strip()
                if var not in result["undefinedVars"]:
                    result["undefinedVars"].insert(0, var)
            result["undefinedAttrError"] = {
                "cls": e.__class__.__name__,
                "msg": str(e),
                "line": tb.lineno,
                "col": tb.colno or 0,
            }

    # 5. Final render (permissive)
    try:
        result["output"] = Environment(**env_kwargs).from_string(template_str).render(user_dict)
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)[-1]
        result["renderError"] = {
            "cls": e.__class__.__name__,
            "msg": str(e),
            "line": tb.lineno,
            "col": tb.colno or 0,
        }

    return result
