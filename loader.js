async function renderTemplate() {
    const templateString = window.templateEditor.getSession().getValue();
    const variablesString = window.varsEditor.getSession().getValue();

    localStorage.setItem('templateString', templateString);
    localStorage.setItem('variablesString', variablesString);

    for(const editor of [window.varsEditor, window.templateEditor, window.resultEditor])
        editor.getSession().clearAnnotations();

    let fatalError = "";

    let templateDiagnostics = [];
    try {
        templateDiagnostics = JSON.parse(pyodide.runPython(
`from jinja2 import Template, Environment
from jinja2.meta import find_undeclared_variables
import json, traceback

parsed_content = None
try:
    parsed_content = Environment().parse(${JSON.stringify(templateString)})
except Exception as e:
    traceback_ = traceback.extract_tb(e.__traceback__)[3]
    diagnostics = [e.__class__.__name__, str(e), traceback_.lineno, traceback_.colno]

json.dumps(diagnostics if parsed_content is None else [list(set(find_undeclared_variables(parsed_content)))])
`));
    }
    catch (error){}

    if (templateDiagnostics.length > 1) {
        const [errorClass, errorText, line, col] = templateDiagnostics;
        window.templateEditor.getSession().setAnnotations([{
            row: line-1,
            col: col,
            text: `${errorClass}: ${errorText}`,
            type: 'error'
        }]);
        fatalError = `Error in the template text:\n${errorClass}: ${errorText}`;
    }

    let userVariablesDiagnostics = [];

    try {
        let jsonVars = JSON.stringify(variablesString);
        jsonVars = jsonVars.slice(1, jsonVars.length-1);
        userVariablesDiagnostics = JSON.parse(pyodide.runPython(
`import json, traceback, ast
from datetime import datetime

error_report = None
try:
    ast.parse("${jsonVars}")
    result = eval("${jsonVars}")
except Exception as e:
    traceback_ = traceback.extract_tb(e.__traceback__)[1]
    error_report = [e.__class__.__name__, str(e), traceback_.lineno, traceback_.colno]

json.dumps(error_report if error_report else ([] if isinstance(result, dict) else ["TypeError", "Variables should be defined as a dictionary", 1, 1]))
`));
    }
    catch (error) {}

    if (userVariablesDiagnostics.length > 0) {
        let [errorClass, errorText, line, col] = userVariablesDiagnostics;
        const match = errorText.match(/^(.*)\(<unknown>, line (\d+)\)$/);
        if(match){
            errorText = match[1].trim();
            line = parseInt(match[2]);
        }
        window.varsEditor.getSession().setAnnotations([{
            row: line-1,
            col: col,
            text: `${errorClass}: ${errorText}`,
            type: 'error'
        }]);
        fatalError = `${fatalError ? fatalError + "\n\n": ""}Error in the variable definitions:\n${errorClass}: ${errorText}`;
    }

    if (fatalError) {
        window.resultEditor.getSession().setValue(fatalError);
        return;
    }

    const templateVariables = templateDiagnostics[0];
    let [extraVars, undefinedVars] = JSON.parse(pyodide.runPython(
`import json
from datetime import datetime

user_vars = set(
${variablesString}
)
template_vars = set(${JSON.stringify(templateVariables)})
json.dumps([list(user_vars - template_vars), list(template_vars - user_vars)])
`));

    if (extraVars.length >= 1)
        window.varsEditor.getSession().setAnnotations([{
            row: 0,
            text: `The following user variable${extraVars.length > 1 ? 's are' : ' is'} not mentioned in the template: ${extraVars.join(', ')}`,
            type: 'warning'
        }]);

    const undefinedVariablesDiagnostics = JSON.parse(pyodide.runPython(
`from jinja2 import Template, StrictUndefined
import json
from datetime import datetime
template = Template(
${JSON.stringify(templateString)}, undefined=StrictUndefined
)
variables = (
${variablesString}
)
result = []
try:
    template.render(variables)
except Exception as e:
    traceback_ = traceback.extract_tb(e.__traceback__)[3]
    result = [e.__class__.__name__, str(e), traceback_.lineno, traceback_.colno]

json.dumps(result)
`));
    if(undefinedVariablesDiagnostics.length > 0) {
        const [errorClass, errorText, line, col] = undefinedVariablesDiagnostics;
        if(errorClass === 'UndefinedError') {
            let undefinedVarMatch = errorText.match(/.*'([^']*)' is undefined.*/);
            if (!undefinedVarMatch)
                undefinedVarMatch = errorText.match(/.* has no attribute '([^']*)'.*/);
            let undefinedVar = null;
            if(undefinedVarMatch)
                undefinedVar = undefinedVarMatch[1].trim();
            if(!undefinedVars.includes(undefinedVar))
                undefinedVars = [undefinedVar, ...undefinedVars.filter(v => v !== undefinedVar)];
        }
        window.templateEditor.getSession().setAnnotations([{
            row: line - 1,
            col: col,
            text: `The following template variable${undefinedVars.length > 1 ? 's are' : ' is'} not defined: ${undefinedVars.join(', ')}`,
            type: 'warning'
        }]);
    }

    const result = JSON.parse(pyodide.runPython(
`from jinja2 import Template
import json
from datetime import datetime
result = []
try:
    result = [Template(${JSON.stringify(templateString)}).render(${variablesString})]
except Exception as e:
    traceback_ = traceback.extract_tb(e.__traceback__)[3]
    result = [e.__class__.__name__, str(e), traceback_.lineno, traceback_.colno]

json.dumps(result)
`));

    if(result.length > 1) {
        const [errorClass, errorText, line, col] = result;
        window.templateEditor.getSession().setAnnotations([{
            row: line - 1,
            col: col,
            text: `${errorClass}: ${errorText}`,
            type: 'error'
        }]);
        window.resultEditor.getSession().setValue(errorText);
    }
    else{
        window.resultEditor.getSession().setValue(result[0]);
    }

    setSharingLink({templateString, variablesString});
}

function setSharingLink(obj) {
    let hash = window.btoa(Array.from(pako.gzip(JSON.stringify(obj), {level: 9})).map((byte) => String.fromCharCode(byte)).join(''));
    hash = hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const baseURL= window.location.href.split('#')[0];
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
        console.error('Error copying text to clipboard', err);
    });
}

function getDataFromLocationHash() {
    let loadedFromHash = false;
    try {
        let hash = window.location.hash.substring(1);
        hash = hash.replace(/-/g, '+').replace(/_/g, '/');
        const charCodeArray = Array.from(window.atob(hash)).map((char) => char.charCodeAt(0));
        const obj = JSON.parse(pako.inflate(new Uint8Array(charCodeArray), { to: 'string' }));
        window.templateEditor.getSession().setValue(obj.templateString);
        window.varsEditor.getSession().setValue(obj.variablesString);
        window.location.hash = '';
        loadedFromHash = true;
    }
    catch {}

    if(!loadedFromHash) {
        if (localStorage.getItem('templateString') && localStorage.getItem('variablesString')) {
            window.templateEditor.getSession().setValue(localStorage.getItem('templateString'));
            window.varsEditor.getSession().setValue(localStorage.getItem('variablesString'));
        }
        else {
            window.templateEditor.getSession().setValue('Hello, {{ name }}!');
            window.varsEditor.getSession().setValue('{"name": "World"}');
        }
    }
}

async function main() {
    const isInDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body && document.body.setAttribute("data-bs-theme", isInDarkMode ? "dark" : "light");

    document.getElementById('copybutton').addEventListener('click', copyLinkToClipboard);

    window.pyodide = await loadPyodide();
    await pyodide.loadPackage('jinja2');

    window.templateEditor = window.ace.edit('template');
    window.templateEditor.setOptions({mode: 'ace/mode/django'});
    window.varsEditor = window.ace.edit('variables');
    window.varsEditor.setOptions({mode: 'ace/mode/python'});
    window.resultEditor = window.ace.edit('output');
    window.resultEditor.setOptions({mode: 'ace/mode/text'});

    getDataFromLocationHash();

    for(const editor of [window.templateEditor, window.varsEditor, window.resultEditor]) {
        editor.setOptions({
            theme: "ace/theme/" + (isInDarkMode ? "twilight" : "chrome"),
            wrap: true,
            showGutter: true,
            fadeFoldWidgets: false,
            showFoldWidgets: false,
            showPrintMargin: false,
            highlightActiveLine: true
        });
        editor.commands.removeCommand('gotoline');
    }

    document.body.classList.add('loaded');

    for(const editor of [window.templateEditor, window.varsEditor])
        editor.getSession().on('change', renderTemplate);

    await renderTemplate();
}

main();