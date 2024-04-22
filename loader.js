async function renderTemplate() {
    const templateString = window.templateEditor.getSession().getValue();
    const variablesString = window.varsEditor.getSession().getValue();
    const stopOnUndefined = false;

    localStorage.setItem('templateString', templateString);
    localStorage.setItem('variablesString', variablesString);

    let templateVariables;
    try {
        templateVariables = JSON.parse(pyodide.runPython(
`from jinja2 import Template, Environment
from jinja2.meta import find_undeclared_variables
import json
parsed_content = Environment().parse(${JSON.stringify(templateString)})
json.dumps(list(set(find_undeclared_variables(parsed_content))))
`));
    }
    catch (error){}

    try {
        for(const editor of [window.varsEditor, window.templateEditor, window.resultEditor])
            editor.getSession().clearAnnotations();

        const rendered = pyodide.runPython(
`from jinja2 import Template, StrictUndefined, DebugUndefined
template = Template(${JSON.stringify(templateString)}${stopOnUndefined ? ", undefined=StrictUndefined": ""})
variables = (
${variablesString}
)
rendered = template.render(variables)
rendered
`);
        window.resultEditor.getSession().setValue(rendered);
        try {
            const variables = JSON.parse(variablesString);
            let undefinedVars = templateVariables.filter(
                v => !variables.hasOwnProperty(v)
            );
            undefinedVars = [...new Set(undefinedVars)];

            if (undefinedVars && undefinedVars.length >= 1)
                window.resultEditor.getSession().setAnnotations([{
                    row: 0,
                    text: `The following template variable${undefinedVars.length > 1 ? 's are' : ' is'} not defined: ${undefinedVars.join(', ')}`,
                    type: 'warning'
                }]);
        }
        catch (error) {}

    } catch (error) {
        let errorText = `Error: ${error.toString()}`;
        let match = error.toString().match(/.*File ".*", (line \d+, in.{0,10} template.*)/s);

        if(match) {
            const line = parseInt(match[1].match(/line (\d+)/)[1]) - 1;
            errorText = `Error on ${match[1].trim().replace('jinja2.exceptions.', '')}`;
            let charMatch = errorText.match(/.* at (\d+)$/);
            let char = 0;
            if (charMatch) {
                const stringsBeforeChar = templateString.substring(0, parseInt(charMatch[1])).split('\n');
                char = stringsBeforeChar ? stringsBeforeChar[stringsBeforeChar.length - 1].length : 0;
            }
            errorText = match[1].trim().replace('jinja2.exceptions.', '');

            match = errorText.match(/.*(UndefinedError: .*)/);
            if(match) {
                errorText = match[1];
            }

            window.templateEditor.getSession().setAnnotations([{
                row: line,
                column: char,
                text: errorText,
                type: 'error'
            }]);
        }
        else {
            match = error.toString().match(/.*File "<exec>+", line (\d+)(.*)/s);
            if(match) {
                const line = parseInt(match[1]);
                const lineInVars = line - 3;
                const subError = match[2].trim().replace(RegExp(`line ${line}`), `line ${lineInVars}`);
                errorText = `Error on line ${lineInVars} in variable definitions: ${subError}`;
                window.varsEditor.getSession().setAnnotations([{
                    row: lineInVars - 1,
                    text: subError,
                    type: 'error'
                }]);
            }
        }
        window.resultEditor.getSession().setValue(errorText);
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
    try {
        let hash = window.location.hash.substring(1);
        hash = hash.replace(/-/g, '+').replace(/_/g, '/');
        const charCodeArray = Array.from(window.atob(hash)).map((char) => char.charCodeAt(0));
        const obj = JSON.parse(pako.inflate(new Uint8Array(charCodeArray), { to: 'string' }));
        window.templateEditor.getSession().setValue(obj.templateString);
        window.varsEditor.getSession().setValue(obj.variablesString);
    }
    catch {
        window.templateEditor.getSession().setValue(localStorage.getItem('templateString') || 'Hello, {{ name }}!');
        window.varsEditor.getSession().setValue(localStorage.getItem('variablesString') || '{"name": "World"}');
    }
}

async function main() {
    document.getElementById('copybutton').addEventListener('click', copyLinkToClipboard);

    window.pyodide = await loadPyodide();
    await pyodide.loadPackage('jinja2')

    window.templateEditor = window.ace.edit('template');
    window.templateEditor.setOptions({mode: 'ace/mode/django'});
    window.varsEditor = window.ace.edit('variables');
    window.varsEditor.setOptions({mode: 'ace/mode/python'});
    window.resultEditor = window.ace.edit('output');
    window.resultEditor.setOptions({mode: 'ace/mode/text'});

    getDataFromLocationHash();

    for(const editor of [window.templateEditor, window.varsEditor])
        editor.getSession().on('change', renderTemplate);

    for(const editor of [window.templateEditor, window.varsEditor, window.resultEditor])
        editor.setOptions({
            theme: 'ace/theme/twilight',
            wrap: true,
            showGutter: true,
            fadeFoldWidgets: false,
            showFoldWidgets: false,
            showPrintMargin: false,
            highlightActiveLine: true
        });

    document.body.classList.add('loaded');

    await renderTemplate();
}

main();