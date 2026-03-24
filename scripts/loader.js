import { firstCanvasScript } from './first.js';
import { secondCanvasScript } from './second.js';
import { thirdCanvasScript } from './third.js';

const scriptRegistry = [firstCanvasScript, secondCanvasScript, thirdCanvasScript];

const inactiveLabelLines = ['click a canvas to activate it', 'message pyotr to change things'];

function createAppState() {
	return {
		activeCanvasId: null,
		controlsExpanded: false,
		scriptsById: new Map(),
	};
}

function setInactiveLabel(label) {
	label.textContent = inactiveLabelLines.join('\n');
}

function createControlsShell(root) {
	root.innerHTML = `
		<div class="controls-shell">
			<div class="controls-header">
				<h2 class="controls-title">controls</h2>
				<button type="button" class="controls-toggle" data-action="toggle-controls" aria-expanded="false" aria-label="expand controls">
					+
				</button>
			</div>
			<div class="controls-active-label" data-role="active-label">click a canvas to activate it</div>
			<div class="controls-content" data-role="controls-content"></div>
		</div>
	`;

	root.classList.add('is-collapsed');

	const activeLabel = root.querySelector('[data-role="active-label"]');
	if (activeLabel instanceof HTMLElement) {
		setInactiveLabel(activeLabel);
	}
}

function renderActiveControls(appState) {
	const controlsRoot = document.getElementById('controls');
	const content = controlsRoot?.querySelector('[data-role="controls-content"]');
	const label = controlsRoot?.querySelector('[data-role="active-label"]');

	if (!content || !label) {
		return;
	}

	content.innerHTML = '';

	const script = appState.scriptsById.get(appState.activeCanvasId);
	if (!script) {
		setInactiveLabel(label);
		return;
	}

	label.textContent = `active: ${script.label}`;

	const controlsElement = script.createControls({
		currentState: script.getState(),
		onStateChange(nextState) {
			script.setState(nextState);
		},
	});

	if (controlsElement instanceof HTMLElement) {
		content.appendChild(controlsElement);
	}
}

function updateWrapperState(canvasId, isActive, isFrozen) {
	const canvas = document.getElementById(canvasId);
	if (!canvas) {
		return;
	}

	const wrapper = canvas.closest('.canvas-wrapper');
	if (!wrapper) {
		return;
	}

	wrapper.classList.toggle('is-active', isActive);
	wrapper.classList.toggle('is-frozen', isFrozen);
}

function setCanvasFrozen(script, canvasId, isFrozen) {
	if (typeof script.setFrozen === 'function') {
		script.setFrozen(isFrozen);
	}

	updateWrapperState(canvasId, !isFrozen, isFrozen);
}

function setActiveCanvas(appState, canvasId) {
	if (!appState.scriptsById.has(canvasId)) {
		return;
	}

	appState.activeCanvasId = canvasId;

	appState.scriptsById.forEach((script, id) => {
		const isActive = id === canvasId;
		setCanvasFrozen(script, id, !isActive);

		if (typeof script.setActive === 'function') {
			script.setActive(isActive);
		}
	});

	renderActiveControls(appState);
}

function freezeAllCanvases(appState) {
	appState.activeCanvasId = null;

	appState.scriptsById.forEach((script, id) => {
		setCanvasFrozen(script, id, true);
		if (typeof script.setActive === 'function') {
			script.setActive(false);
		}
	});

	renderActiveControls(appState);
}

function toggleControlsPanel(appState) {
	const controlsRoot = document.getElementById('controls');
	if (!controlsRoot) {
		return;
	}

	appState.controlsExpanded = !appState.controlsExpanded;
	controlsRoot.classList.toggle('is-collapsed', !appState.controlsExpanded);

	const toggleButton = controlsRoot.querySelector('[data-action="toggle-controls"]');
	if (!(toggleButton instanceof HTMLButtonElement)) {
		return;
	}

	toggleButton.textContent = appState.controlsExpanded ? '−' : '+';
	toggleButton.setAttribute('aria-label', appState.controlsExpanded ? 'minimize controls' : 'expand controls');
	toggleButton.setAttribute('aria-expanded', String(appState.controlsExpanded));
}

function registerScripts(appState) {
	scriptRegistry.forEach((script) => {
		if (!script?.id) {
			return;
		}

		const canvas = document.getElementById(script.id);
		if (!canvas) {
			return;
		}

		appState.scriptsById.set(script.id, script);
		script.init({ canvas });

		const wrapper = canvas.closest('.canvas-wrapper');
		if (!wrapper) {
			return;
		}

		wrapper.dataset.canvasId = script.id;
		wrapper.addEventListener('click', () => {
			setActiveCanvas(appState, script.id);
		});
	});
}

function bindControlsEvents(appState) {
	const controlsRoot = document.getElementById('controls');
	if (!controlsRoot) {
		return;
	}

	controlsRoot.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		const toggleControl = target.closest('[data-action="toggle-controls"]');
		if (toggleControl) {
			toggleControlsPanel(appState);
		}
	});
}

function bootstrap({ initialCanvasId = null } = {}) {
	const controlsRoot = document.getElementById('controls');
	if (!controlsRoot) {
		return;
	}

	const appState = createAppState();
	createControlsShell(controlsRoot);
	registerScripts(appState);
	bindControlsEvents(appState);

	if (initialCanvasId && appState.scriptsById.has(initialCanvasId)) {
		setActiveCanvas(appState, initialCanvasId);
		return;
	}

	freezeAllCanvases(appState);
}

export function bootstrapGalleryPage() {
	bootstrap();
}

export function bootstrapSingleCanvasPage(canvasId) {
	bootstrap({ initialCanvasId: canvasId });
}
