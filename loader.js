(function () {
    "use strict";

    let templateEditor, varsEditor, resultEditor;
    let renderVersion = 0;

    const PYTHON_SETUP = `
import json, traceback, ast
from jinja2 import Template, Environment, StrictUndefined
from jinja2.meta import find_undeclared_variables
from datetime import datetime

def render_and_diagnose(template_str, variables_str):
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
        parsed_content = Environment().parse(template_str)
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
        Template(template_str, undefined=StrictUndefined).render(user_dict)
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
        result["output"] = Template(template_str).render(user_dict)
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)[-1]
        result["renderError"] = {
            "cls": e.__class__.__name__,
            "msg": str(e),
            "line": tb.lineno,
            "col": tb.colno or 0,
        }

    return result
`;

    function debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    async function renderTemplate() {
        const thisVersion = ++renderVersion;

        const templateString = templateEditor.getSession().getValue();
        const variablesString = varsEditor.getSession().getValue();

        localStorage.setItem('templateString', templateString);
        localStorage.setItem('variablesString', variablesString);

        for (const editor of [varsEditor, templateEditor, resultEditor])
            editor.getSession().clearAnnotations();

        let diagnostics;
        try {
            window.pyodide.globals.set("_template_str", templateString);
            window.pyodide.globals.set("_variables_str", variablesString);
            diagnostics = JSON.parse(window.pyodide.runPython(
                `json.dumps(render_and_diagnose(_template_str, _variables_str))`
            ));
        } catch (error) {
            console.error("Pyodide execution error:", error);
            resultEditor.getSession().setValue("Internal error: " + error.message);
            return;
        }

        if (thisVersion !== renderVersion) return;

        if (diagnostics.templateError) {
            const e = diagnostics.templateError;
            templateEditor.getSession().setAnnotations([{
                row: e.line - 1,
                col: e.col,
                text: `${e.cls}: ${e.msg}`,
                type: 'error'
            }]);
            resultEditor.getSession().setValue(`Error in the template text:\n${e.cls}: ${e.msg}`);
            setSharingLink({ templateString, variablesString });
            return;
        }

        if (diagnostics.variablesError) {
            const e = diagnostics.variablesError;
            let errorText = e.msg;
            let line = e.line;
            const match = errorText.match(/^(.*)\(<unknown>, line (\d+)\)$/);
            if (match) {
                errorText = match[1].trim();
                line = parseInt(match[2]);
            }
            varsEditor.getSession().setAnnotations([{
                row: line - 1,
                col: e.col,
                text: `${e.cls}: ${errorText}`,
                type: 'error'
            }]);
            resultEditor.getSession().setValue(`Error in the variable definitions:\n${e.cls}: ${errorText}`);
            setSharingLink({ templateString, variablesString });
            return;
        }

        if (diagnostics.extraVars.length > 0) {
            varsEditor.getSession().setAnnotations([{
                row: 0,
                text: `The following user variable${diagnostics.extraVars.length > 1 ? 's are' : ' is'} not mentioned in the template: ${diagnostics.extraVars.join(', ')}`,
                type: 'warning'
            }]);
        }

        const undefinedVars = diagnostics.undefinedVars;
        if (undefinedVars.length > 0) {
            const attrErr = diagnostics.undefinedAttrError;
            templateEditor.getSession().setAnnotations([{
                row: attrErr ? attrErr.line - 1 : 0,
                col: attrErr ? attrErr.col : 0,
                text: `The following template variable${undefinedVars.length > 1 ? 's are' : ' is'} not defined: ${undefinedVars.join(', ')}`,
                type: 'warning'
            }]);
        }

        if (diagnostics.renderError) {
            const e = diagnostics.renderError;
            templateEditor.getSession().setAnnotations([{
                row: e.line - 1,
                col: e.col,
                text: `${e.cls}: ${e.msg}`,
                type: 'error'
            }]);
            resultEditor.getSession().setValue(e.msg);
        } else if (diagnostics.output !== null) {
            resultEditor.getSession().setValue(diagnostics.output);
        }

        setSharingLink({ templateString, variablesString });
    }

    const debouncedRender = debounce(renderTemplate, 250);

    function setSharingLink(obj) {
        let hash = window.btoa(
            Array.from(pako.gzip(JSON.stringify(obj), { level: 9 }))
                .map((byte) => String.fromCharCode(byte))
                .join('')
        );
        hash = hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const baseURL = window.location.href.split('#')[0];
        document.getElementById("sharinglink").href = `${baseURL}#${hash}`;
    }

    function copyLinkToClipboard() {
        navigator.clipboard.writeText(document.getElementById("sharinglink").href).then(() => {
            const copyButton = document.getElementById('copybutton');
            const copyIcon = document.getElementById("copyicon");
            const copiedIcon = document.getElementById("copiedicon");
            copyIcon.style.display = 'none';
            copiedIcon.style.display = 'inline';
            copyButton.disabled = true;

            setTimeout(() => {
                copyIcon.style.display = 'inline';
                copiedIcon.style.display = 'none';
                copyButton.disabled = false;
            }, 2000);
        }).catch(err => {
            console.error('Error copying text to clipboard:', err);
        });
    }

    function getDataFromLocationHash() {
        let loadedFromHash = false;
        try {
            let hash = window.location.hash.substring(1);
            hash = hash.replace(/-/g, '+').replace(/_/g, '/');
            const charCodeArray = Array.from(window.atob(hash)).map((char) => char.charCodeAt(0));
            const obj = JSON.parse(pako.inflate(new Uint8Array(charCodeArray), { to: 'string' }));
            templateEditor.getSession().setValue(obj.templateString);
            varsEditor.getSession().setValue(obj.variablesString);
            window.location.hash = '';
            loadedFromHash = true;
        } catch (error) {
            if (window.location.hash.length > 1) {
                console.error('Failed to load data from URL hash:', error);
            }
        }

        if (!loadedFromHash) {
            if (localStorage.getItem('templateString') && localStorage.getItem('variablesString')) {
                templateEditor.getSession().setValue(localStorage.getItem('templateString'));
                varsEditor.getSession().setValue(localStorage.getItem('variablesString'));
            } else {
                templateEditor.getSession().setValue('Hello, {{ name }}!');
                varsEditor.getSession().setValue('{"name": "World"}');
            }
        }
    }

    function applyTheme(isDark) {
        document.body.setAttribute("data-bs-theme", isDark ? "dark" : "light");
        const themeName = "ace/theme/" + (isDark ? "twilight" : "chrome");
        for (const editor of [templateEditor, varsEditor, resultEditor]) {
            if (editor) editor.setOption("theme", themeName);
        }
    }

    async function main() {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        applyTheme(darkModeQuery.matches);
        darkModeQuery.addEventListener('change', (e) => applyTheme(e.matches));

        document.getElementById('copybutton').addEventListener('click', copyLinkToClipboard);

        window.pyodide = await loadPyodide();
        await window.pyodide.loadPackage('jinja2');
        window.pyodide.runPython(PYTHON_SETUP);

        templateEditor = window.ace.edit('template');
        templateEditor.setOptions({ mode: 'ace/mode/django' });
        varsEditor = window.ace.edit('variables');
        varsEditor.setOptions({ mode: 'ace/mode/python' });
        resultEditor = window.ace.edit('output');
        resultEditor.setOptions({ mode: 'ace/mode/text' });

        getDataFromLocationHash();

        const editorOptions = {
            theme: "ace/theme/" + (darkModeQuery.matches ? "twilight" : "chrome"),
            wrap: true,
            showGutter: true,
            fadeFoldWidgets: false,
            showFoldWidgets: false,
            showPrintMargin: false,
            highlightActiveLine: true
        };

        for (const editor of [templateEditor, varsEditor, resultEditor]) {
            editor.setOptions(editorOptions);
            editor.commands.removeCommand('gotoline');
        }

        document.body.classList.add('loaded');

        for (const editor of [templateEditor, varsEditor])
            editor.getSession().on('change', debouncedRender);

        await renderTemplate();
    }

    main();
})();
