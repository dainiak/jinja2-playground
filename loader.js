async function renderTemplate() {
    const templateString = window.templateEditor.getSession().getValue();
    const variablesString = window.varsEditor.getSession().getValue();

    localStorage.setItem('templateString', templateString);
    localStorage.setItem('variablesString', variablesString);

    try {
        const rendered = pyodide.runPython(
            `
from jinja2 import Template
template = Template(${JSON.stringify(templateString)})
variables = ${variablesString}
rendered = template.render(variables)
rendered
`);

        window.resultEditor.getSession().setValue(rendered);
    } catch (error) {
        window.resultEditor.getSession().setValue('Error: ' + error.toString());
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

    window.templateEditor.getSession().setValue(
        localStorage.getItem('templateString') || 'Hello, {{ name }}!'
    );
    window.varsEditor.getSession().setValue(
        localStorage.getItem('variablesString') || '{"name": "World"}'
    );

    for(const editor of [window.templateEditor, window.varsEditor]) {
        editor.getSession().on('change', renderTemplate);
    }

    for(const editor of [window.templateEditor, window.varsEditor, window.resultEditor]) {
        editor.setOptions({
            theme: 'ace/theme/twilight',
            wrap: true,
            showGutter: true,
            fadeFoldWidgets: false,
            showFoldWidgets: false,
            showPrintMargin: false,
            highlightActiveLine: true
        });
    }

    document.body.classList.add('loaded');

    await renderTemplate();
}

main();