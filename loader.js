async function renderTemplate() {
    const templateString = window.templateEditor.getSession().getValue();
    const variablesString = window.varsEditor.getSession().getValue();

    localStorage.setItem('templateString', templateString);
    localStorage.setItem('variablesString', variablesString);

    try {
        const rendered = pyodide.runPython(
`from jinja2 import Template
template = Template(${JSON.stringify(templateString)})
variables = (
${variablesString}
)
rendered = template.render(variables)
rendered
`);
        window.resultEditor.getSession().setValue(rendered);
        try {
            const variables = JSON.parse(variablesString);
            let undefinedVars = templateString.match(
                /\{\{-?\s*(\w+)\s*-?}}/g
            ).map(
                s => s.match(/\w+/)[0]
            ).filter(
                v => !variables.hasOwnProperty(v)
            );
            undefinedVars = [...new Set(undefinedVars)];

            if (undefinedVars && undefinedVars.length >= 1) {
                window.resultEditor.getSession().setAnnotations([{
                    row: 0,
                    text: `The following template variable${undefinedVars.length > 1 ? 's are' : ' is'} not defined: ${undefinedVars.join(', ')}`,
                    type: 'warning'
                }]);
            }
            else{
                window.resultEditor.getSession().setAnnotations([]);
            }
        }
        catch (error) {
        }
        window.templateEditor.getSession().setAnnotations([]);
    } catch (error) {
        let errorText = `Error: ${error.toString()}`;
        let m = error.toString().match(/.*File ".*", (line \d+, in.{0,10} template.*)/s);

        if(m) {
            const line = parseInt(m[1].match(/line (\d+)/)[1]) - 1;
            errorText = `Error on ${m[1].trim().replace('jinja2.exceptions.', '')}`;
            let charMatch = errorText.match(/.* at (\d+)$/);
            let char = 0;
            if (charMatch) {
                const stringsBeforeChar = templateString.substring(0, parseInt(charMatch[1])).split('\n');
                char = stringsBeforeChar ? stringsBeforeChar[stringsBeforeChar.length - 1].length : 0;
            }

            window.templateEditor.getSession().setAnnotations([{
                row: line,
                column: char,
                text: m[1].trim().replace('jinja2.exceptions.', ''),
                type: 'error'
            }]);
        }
        else {
            m = error.toString().match(/.*File "<exec>+", line (\d+)(.*)/s);
            if(m) {
                const line = parseInt(m[1]);
                const lineInVars = line - 3;
                const subError = m[2].trim().replace(RegExp(`line ${line}`), `line ${lineInVars}`);
                errorText = `Error on line ${lineInVars} in variable definitions: ${subError}`;
                window.varsEditor.getSession().setAnnotations([{
                    row: lineInVars,
                    text: m[1],
                    type: 'error'
                }]);
            }
        }
        window.resultEditor.getSession().setValue(errorText);
    }
}

async function main() {
    window.pyodide = await loadPyodide();
    await pyodide.loadPackage('jinja2')

    window.templateEditor = window.ace.edit('template');
    window.templateEditor.setOptions({mode: 'ace/mode/django'});
    window.varsEditor = window.ace.edit('variables');
    window.varsEditor.setOptions({mode: 'ace/mode/json'});
    window.resultEditor = window.ace.edit('output');
    window.resultEditor.setOptions({mode: 'ace/mode/text'});

    window.templateEditor.getSession().setValue(localStorage.getItem('templateString') || 'Hello, {{ name }}!');
    window.varsEditor.getSession().setValue(localStorage.getItem('variablesString') || '{"name": "World"}');

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