import PYTHON_SETUP from "./render_and_diagnose.py?raw";

let templateEditor, varsEditor, resultEditor;
let renderVersion = 0;

function debounce(fn, delay) {
	let timer;
	return function (...args) {
		clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), delay);
	};
}

function getEnvOptions() {
	return {
		trim_blocks: document.getElementById("opt-trim-blocks").checked,
		lstrip_blocks: document.getElementById("opt-lstrip-blocks").checked,
		keep_trailing_newline: document.getElementById("opt-keep-trailing-newline")
			.checked,
	};
}

function setEnvOptions(opts) {
	document.getElementById("opt-trim-blocks").checked = !!opts.trim_blocks;
	document.getElementById("opt-lstrip-blocks").checked = !!opts.lstrip_blocks;
	document.getElementById("opt-keep-trailing-newline").checked =
		!!opts.keep_trailing_newline;
}

async function renderTemplate() {
	const thisVersion = ++renderVersion;

	const templateString = templateEditor.getSession().getValue();
	const variablesString = varsEditor.getSession().getValue();
	const envOptions = getEnvOptions();

	localStorage.setItem("templateString", templateString);
	localStorage.setItem("variablesString", variablesString);
	localStorage.setItem("envOptions", JSON.stringify(envOptions));

	for (const editor of [varsEditor, templateEditor, resultEditor])
		editor.getSession().clearAnnotations();

	let diagnostics;
	try {
		window.pyodide.globals.set("_template_str", templateString);
		window.pyodide.globals.set("_variables_str", variablesString);
		window.pyodide.globals.set("_env_options", JSON.stringify(envOptions));
		diagnostics = JSON.parse(
			window.pyodide.runPython(
				"json.dumps(render_and_diagnose(_template_str, _variables_str, _env_options))",
			),
		);
	} catch (error) {
		console.error("Pyodide execution error:", error);
		resultEditor.getSession().setValue(`Internal error: ${error.message}`);
		return;
	}

	if (thisVersion !== renderVersion) return;

	if (diagnostics.templateError) {
		const e = diagnostics.templateError;
		templateEditor.getSession().setAnnotations([
			{
				row: e.line - 1,
				col: e.col,
				text: `${e.cls}: ${e.msg}`,
				type: "error",
			},
		]);
		resultEditor
			.getSession()
			.setValue(`Error in the template text:\n${e.cls}: ${e.msg}`);
		setSharingLink({ templateString, variablesString, envOptions });
		return;
	}

	if (diagnostics.variablesError) {
		const e = diagnostics.variablesError;
		let errorText = e.msg;
		let line = e.line;
		const match = errorText.match(/^(.*)\(<unknown>, line (\d+)\)$/);
		if (match) {
			errorText = match[1].trim();
			line = parseInt(match[2], 10);
		}
		varsEditor.getSession().setAnnotations([
			{
				row: line - 1,
				col: e.col,
				text: `${e.cls}: ${errorText}`,
				type: "error",
			},
		]);
		resultEditor
			.getSession()
			.setValue(`Error in the variable definitions:\n${e.cls}: ${errorText}`);
		setSharingLink({ templateString, variablesString, envOptions });
		return;
	}

	if (diagnostics.extraVars.length > 0) {
		varsEditor.getSession().setAnnotations([
			{
				row: 0,
				text: `The following user variable${diagnostics.extraVars.length > 1 ? "s are" : " is"} not mentioned in the template: ${diagnostics.extraVars.join(", ")}`,
				type: "warning",
			},
		]);
	}

	const undefinedVars = diagnostics.undefinedVars;
	if (undefinedVars.length > 0) {
		const attrErr = diagnostics.undefinedAttrError;
		templateEditor.getSession().setAnnotations([
			{
				row: attrErr ? attrErr.line - 1 : 0,
				col: attrErr ? attrErr.col : 0,
				text: `The following template variable${undefinedVars.length > 1 ? "s are" : " is"} not defined: ${undefinedVars.join(", ")}`,
				type: "warning",
			},
		]);
	}

	if (diagnostics.renderError) {
		const e = diagnostics.renderError;
		templateEditor.getSession().setAnnotations([
			{
				row: e.line - 1,
				col: e.col,
				text: `${e.cls}: ${e.msg}`,
				type: "error",
			},
		]);
		resultEditor.getSession().setValue(e.msg);
	} else if (diagnostics.output !== null) {
		resultEditor.getSession().setValue(diagnostics.output);
	}

	setSharingLink({ templateString, variablesString, envOptions });
}

const debouncedRender = debounce(renderTemplate, 250);

function setSharingLink(obj) {
	let hash = window.btoa(
		Array.from(pako.gzip(JSON.stringify(obj), { level: 9 }))
			.map((byte) => String.fromCharCode(byte))
			.join(""),
	);
	hash = hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	const baseURL = window.location.href.split("#")[0];
	document.getElementById("sharinglink").href = `${baseURL}#${hash}`;
}

function copyLinkToClipboard() {
	navigator.clipboard
		.writeText(document.getElementById("sharinglink").href)
		.then(() => {
			const copyButton = document.getElementById("copybutton");
			const copyIcon = document.getElementById("copyicon");
			const copiedIcon = document.getElementById("copiedicon");
			copyIcon.style.display = "none";
			copiedIcon.style.display = "inline";
			copyButton.disabled = true;

			setTimeout(() => {
				copyIcon.style.display = "inline";
				copiedIcon.style.display = "none";
				copyButton.disabled = false;
			}, 2000);
		})
		.catch((err) => {
			console.error("Error copying text to clipboard:", err);
		});
}

function getDataFromLocationHash() {
	let loadedFromHash = false;
	try {
		let hash = window.location.hash.substring(1);
		hash = hash.replace(/-/g, "+").replace(/_/g, "/");
		const charCodeArray = Array.from(window.atob(hash)).map((char) =>
			char.charCodeAt(0),
		);
		const obj = JSON.parse(
			pako.inflate(new Uint8Array(charCodeArray), { to: "string" }),
		);
		templateEditor.getSession().setValue(obj.templateString);
		varsEditor.getSession().setValue(obj.variablesString);
		if (obj.envOptions) setEnvOptions(obj.envOptions);
		window.location.hash = "";
		loadedFromHash = true;
	} catch (error) {
		if (window.location.hash.length > 1) {
			console.error("Failed to load data from URL hash:", error);
		}
	}

	if (!loadedFromHash) {
		if (
			localStorage.getItem("templateString") &&
			localStorage.getItem("variablesString")
		) {
			templateEditor
				.getSession()
				.setValue(localStorage.getItem("templateString"));
			varsEditor.getSession().setValue(localStorage.getItem("variablesString"));
		} else {
			templateEditor.getSession().setValue("Hello, {{ name }}!");
			varsEditor.getSession().setValue('{"name": "World"}');
		}
		try {
			const stored = JSON.parse(localStorage.getItem("envOptions"));
			if (stored) setEnvOptions(stored);
		} catch (_) {}
	}
}

function applyTheme(isDark) {
	document.body.setAttribute("data-bs-theme", isDark ? "dark" : "light");
	const themeName = `ace/theme/${isDark ? "twilight" : "chrome"}`;
	for (const editor of [templateEditor, varsEditor, resultEditor]) {
		if (editor) editor.setOption("theme", themeName);
	}
}

async function main() {
	const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
	applyTheme(darkModeQuery.matches);
	darkModeQuery.addEventListener("change", (e) => applyTheme(e.matches));

	document
		.getElementById("copybutton")
		.addEventListener("click", copyLinkToClipboard);

	window.pyodide = await loadPyodide();
	await window.pyodide.loadPackage("jinja2");
	window.pyodide.runPython(PYTHON_SETUP);

	templateEditor = window.ace.edit("template");
	templateEditor.setOptions({ mode: "ace/mode/django" });
	varsEditor = window.ace.edit("variables");
	varsEditor.setOptions({ mode: "ace/mode/python" });
	resultEditor = window.ace.edit("output");
	resultEditor.setOptions({ mode: "ace/mode/text" });

	getDataFromLocationHash();

	const editorOptions = {
		theme: `ace/theme/${darkModeQuery.matches ? "twilight" : "chrome"}`,
		wrap: true,
		showGutter: true,
		fadeFoldWidgets: false,
		showFoldWidgets: false,
		showPrintMargin: false,
		highlightActiveLine: true,
	};

	for (const editor of [templateEditor, varsEditor, resultEditor]) {
		editor.setOptions(editorOptions);
		editor.commands.removeCommand("gotoline");
	}

	document.body.classList.add("loaded");

	for (const editor of [templateEditor, varsEditor])
		editor.getSession().on("change", debouncedRender);

	for (const id of [
		"opt-trim-blocks",
		"opt-lstrip-blocks",
		"opt-keep-trailing-newline",
	])
		document.getElementById(id).addEventListener("change", debouncedRender);

	await renderTemplate();
}

main();
