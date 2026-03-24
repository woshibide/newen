const MAX_TEXT_LENGTH = 25;
const FONT_URL = '/assets/fonts/SourceSans3-wght.ttf';
const P5_CDN_URL = 'https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js';

const state = {
	targetText: 'newen',
	particleText: 'newen',
	particles: 2000,
	homePull: .002,
	mouseForce: 100,
	mouseRadius: 300,
	showMouse: true,
	trails: true,
	frozen: true,
	enabled: true,
};

const runtime = {
	sketch: null,
	hostCanvas: null,
	font: null,
	attractors: [],
	particles: [],
	needsShapeRefresh: true,
	keyboardBound: false,
};

let p5LoaderPromise = null;

function clampText(value, fallback) {
	const normalized = String(value ?? '').slice(0, MAX_TEXT_LENGTH);
	return normalized.trim().length > 0 ? normalized : fallback;
}

function clampParticleCount(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.particles;
	}

	return Math.max(60, Math.min(1400, Math.round(parsed)));
}

function applyVisualState(canvasElement) {
	canvasElement.style.borderRadius = state.trails ? '0.25rem' : '0';
	canvasElement.style.opacity = state.enabled ? '1' : '0.35';
	canvasElement.dataset.frozen = String(state.frozen);
}

function ensureP5Loaded() {
	if (window.p5) {
		return Promise.resolve(window.p5);
	}

	if (p5LoaderPromise) {
		return p5LoaderPromise;
	}

	p5LoaderPromise = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = P5_CDN_URL;
		script.async = true;
		script.onload = () => {
			if (window.p5) {
				resolve(window.p5);
				return;
			}

			reject(new Error('p5 was loaded but not available on window'));
		};
		script.onerror = () => reject(new Error('failed to load p5 library'));
		document.head.appendChild(script);
	});

	return p5LoaderPromise;
}

function getFallbackGlyphForIndex(text, index) {
	if (typeof text !== 'string' || text.length === 0) {
		return 'n';
	}

	const char = text[index] ?? '';
	if (char.trim().length > 0) {
		return char;
	}

	for (let offset = 1; offset < text.length; offset += 1) {
		const left = text[index - offset];
		if (left && left.trim().length > 0) {
			return left;
		}

		const right = text[index + offset];
		if (right && right.trim().length > 0) {
			return right;
		}
	}

	return 'n';
}

function buildAttractorsForText(p, text, drawX, drawY, fontSize, sampleFactor) {
	let cursorX = drawX;
	const points = [];

	p.push();
	p.textFont(runtime.font);
	p.textSize(fontSize);

	for (let index = 0; index < text.length; index += 1) {
		const glyph = text[index];
		const fallbackGlyph = getFallbackGlyphForIndex(text, index);
		const glyphPoints = runtime.font.textToPoints(glyph, cursorX, drawY, fontSize, {
			sampleFactor,
			simplifyThreshold: 0,
		});

		for (let pointIndex = 0; pointIndex < glyphPoints.length; pointIndex += 1) {
			const point = glyphPoints[pointIndex];
			points.push({ x: point.x, y: point.y, glyph: fallbackGlyph });
		}

		cursorX += p.textWidth(glyph);
	}

	p.pop();
	return points;
}

function rebuildShape(p) {
	if (!runtime.font) {
		return;
	}

	const text = clampText(state.targetText, 'newen');
	state.targetText = text;

	const estimatedSize = Math.min(p.width / (text.length * 0.58), p.height * 0.52);
	const fontSize = Math.max(62, Math.min(estimatedSize, 280));
	const bounds = runtime.font.textBounds(text, 0, 0, fontSize);
	const x = (p.width - bounds.w) / 2 - bounds.x;
	const y = (p.height - bounds.h) / 2 - bounds.y;

	runtime.attractors = buildAttractorsForText(p, text, x, y, fontSize, 0.16);

	if (runtime.attractors.length > 0) {
		let sumX = 0;
		let sumY = 0;

		for (const point of runtime.attractors) {
			sumX += point.x;
			sumY += point.y;
		}

		const centerX = sumX / runtime.attractors.length;
		const centerY = sumY / runtime.attractors.length;
		const offsetX = p.width * 0.5 - centerX;
		const offsetY = p.height * 0.5 - centerY;

		for (const point of runtime.attractors) {
			point.x += offsetX;
			point.y += offsetY;
		}
	}

	if (runtime.attractors.length === 0) {
		runtime.attractors = [{ x: p.width / 2, y: p.height / 2, glyph: getFallbackGlyphForIndex(text, 0) }];
	}

	const particles = [];
	const attractorCount = runtime.attractors.length;

	for (let index = 0; index < state.particles; index += 1) {
		const home = runtime.attractors[index % attractorCount];
		const startX = home.x + p.random(-8, 8);
		const startY = home.y + p.random(-8, 8);

		particles.push({
			homeX: home.x,
			homeY: home.y,
			fallbackGlyph: home.glyph ?? getFallbackGlyphForIndex(state.targetText, 0),
			position: p.createVector(startX, startY),
			velocity: p.createVector(p.random(-0.25, 0.25), p.random(-0.25, 0.25)),
			acceleration: p.createVector(0, 0),
		});
	}

	runtime.particles = particles;
	runtime.needsShapeRefresh = false;
}

function updateParticles(p) {
	const springStrength = 0.012 + state.homePull * 0.035;
	const disturbanceStrength = 0.08 + state.mouseForce * 0.26;
	const radius = Math.max(12, state.mouseRadius);
	const maxSpeed = 0.8 + state.mouseForce * 0.9;

	const mouseInside = p.mouseX >= 0 && p.mouseX <= p.width && p.mouseY >= 0 && p.mouseY <= p.height;

	for (let index = 0; index < runtime.particles.length; index += 1) {
		const particle = runtime.particles[index];

		particle.acceleration.set(0, 0);

		const homeVector = p.createVector(
			particle.homeX - particle.position.x,
			particle.homeY - particle.position.y,
		).mult(springStrength);
		particle.acceleration.add(homeVector);

		if (mouseInside) {
			const away = p.createVector(particle.position.x - p.mouseX, particle.position.y - p.mouseY);
			const distance = away.mag();

			if (distance > 0 && distance < radius) {
				const normalizedDistance = 1 - distance / radius;
				away
					.normalize()
					.mult(normalizedDistance * normalizedDistance * disturbanceStrength);
				particle.acceleration.add(away);
			}
		}

		particle.velocity.add(particle.acceleration).limit(maxSpeed);
		particle.position.add(particle.velocity);
		particle.velocity.mult(0.92);
	}
}

function drawParticles(p) {
	const customGlyph = String(state.particleText ?? '').slice(0, MAX_TEXT_LENGTH);
	const useOutlineGlyph = customGlyph.trim().length === 0;

	p.fill(245, 248, 255, state.enabled ? 224 : 140);
	p.textAlign(p.CENTER, p.CENTER);
	p.textSize(10 + state.homePull * 0.8);

	for (const particle of runtime.particles) {
		const glyph = useOutlineGlyph ? (particle.fallbackGlyph ?? getFallbackGlyphForIndex(state.targetText, 0)) : customGlyph;
		p.text(glyph, particle.position.x, particle.position.y);
	}
}

function drawMouseArea(p) {
	if (!state.showMouse) {
		return;
	}

	const mouseInside = p.mouseX >= 0 && p.mouseX <= p.width && p.mouseY >= 0 && p.mouseY <= p.height;
	if (!mouseInside) {
		return;
	}

	p.noFill();
	p.stroke(160, 190, 255, 120);
	p.strokeWeight(1.2);
	p.circle(p.mouseX, p.mouseY, Math.max(12, state.mouseRadius) * 2);
	p.noStroke();
}

function minimizeControlsPanel() {
	const controlsRoot = document.getElementById('controls');
	if (!controlsRoot || controlsRoot.classList.contains('is-collapsed')) {
		return;
	}

	const toggleButton = controlsRoot.querySelector('[data-action="toggle-controls"]');
	if (!(toggleButton instanceof HTMLButtonElement)) {
		return;
	}

	toggleButton.click();
}

function isThirdCanvasActive() {
	const canvas = runtime.hostCanvas ?? document.getElementById('third');
	if (!canvas) {
		return false;
	}

	const wrapper = canvas.closest('.canvas-wrapper');
	if (!wrapper) {
		return true;
	}

	return wrapper.classList.contains('is-active');
}

function setMouseVisibility(isVisible, { minimizeControls = false } = {}) {
	state.showMouse = Boolean(isVisible);

	if (runtime.sketch && state.frozen) {
		runtime.sketch.redraw();
	}

	if (minimizeControls) {
		minimizeControlsPanel();
	}
}

function bindKeyboardToggle() {
	if (runtime.keyboardBound) {
		return;
	}

	window.addEventListener('keydown', (event) => {
		if (event.key.toLowerCase() !== 's') {
			return;
		}

		const target = event.target;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			return;
		}

		if (!isThirdCanvasActive()) {
			return;
		}

		setMouseVisibility(!state.showMouse);
	});

	runtime.keyboardBound = true;
}

function buildSketch(canvasHost) {
	const hostParent = canvasHost.parentElement;
	if (!hostParent) {
		return;
	}

	runtime.hostCanvas = canvasHost;

	const sketch = (p) => {
		p.preload = () => {
			runtime.font = p.loadFont(FONT_URL);
		};

		p.setup = () => {
			const width = Math.max(120, hostParent.clientWidth);
			const height = Math.max(120, hostParent.clientHeight);
			runtime.hostCanvas.removeAttribute('id');

			const nextCanvas = p.createCanvas(width, height);
			nextCanvas.parent(hostParent);
			nextCanvas.id('third');
			nextCanvas.attribute('data-engine', 'p5');

			runtime.hostCanvas.remove();
			runtime.hostCanvas = nextCanvas.elt;

			applyVisualState(runtime.hostCanvas);
			runtime.needsShapeRefresh = true;
			p.background(6, 8, 11);

			if (state.frozen) {
				p.noLoop();
				p.redraw();
			}
		};

		p.windowResized = () => {
			if (!runtime.hostCanvas?.parentElement) {
				return;
			}

			const width = Math.max(120, runtime.hostCanvas.parentElement.clientWidth);
			const height = Math.max(120, runtime.hostCanvas.parentElement.clientHeight);
			p.resizeCanvas(width, height);
			runtime.needsShapeRefresh = true;

			if (state.frozen) {
				p.redraw();
			}
		};

		p.draw = () => {
			if (runtime.needsShapeRefresh) {
				rebuildShape(p);
			}

			if (state.trails) {
				p.background(6, 8, 11, state.frozen ? 240 : 78);
			} else {
				p.background(6, 8, 11, 245);
			}

			if (!state.frozen && state.enabled) {
				updateParticles(p);
			}

			drawParticles(p);
			drawMouseArea(p);
		};
	};

	runtime.sketch = new window.p5(sketch);
}

export const thirdCanvasScript = {
	id: 'third',
	label: 'dyi swarm; use mouse to make it look like a swarm | press S to toggle mouse',
	async init({ canvas }) {
		canvas.dataset.engine = 'p5';
		applyVisualState(canvas);
		bindKeyboardToggle();

		try {
			await ensureP5Loaded();
			buildSketch(canvas);
		} catch (error) {
			console.error(error);
		}
	},
	createControls({ currentState, onStateChange }) {
		const root = document.createElement('div');
		root.className = 'controls-group';
		root.innerHTML = `
			<label class="control-row">
				<span>shape text (max 5)</span>
				<input type="text" maxlength="${MAX_TEXT_LENGTH}" value="${currentState.targetText}" data-key="targetText" />
			</label>
			<label class="control-row">
				<span>particle text (max 5)</span>
				<input type="text" maxlength="${MAX_TEXT_LENGTH}" value="${currentState.particleText}" data-key="particleText" />
			</label>
			<label class="control-row">
				<span>start particles</span>
				<input type="range" min="60" max="1400" step="20" value="${currentState.particles}" data-key="particles" />
			</label>
			<label class="control-row">
				<span>home pull</span>
				<input type="range" min="0.2" max="4" step="0.1" value="${currentState.homePull}" data-key="homePull" />
			</label>
			<label class="control-row">
				<span>mouse force</span>
				<input type="range" min="0.2" max="6" step="0.1" value="${currentState.mouseForce}" data-key="mouseForce" />
			</label>
			<label class="control-row">
				<span>mouse radius</span>
				<input type="range" min="20" max="260" step="2" value="${currentState.mouseRadius}" data-key="mouseRadius" />
			</label>
			<label class="control-row">
				<span>show mouse</span>
				<input type="checkbox" ${currentState.showMouse ? 'checked' : ''} data-key="showMouse" />
			</label>
			<label class="control-row">
				<span>trails</span>
				<input type="checkbox" ${currentState.trails ? 'checked' : ''} data-key="trails" />
			</label>
		`;

		root.addEventListener('input', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement)) {
				return;
			}

			if (target.dataset.key === 'targetText') {
				onStateChange({ targetText: target.value.slice(0, MAX_TEXT_LENGTH) });
				return;
			}

			if (target.dataset.key === 'particleText') {
				onStateChange({ particleText: target.value.slice(0, MAX_TEXT_LENGTH) });
				return;
			}

			if (target.dataset.key === 'particles') {
				onStateChange({ particles: clampParticleCount(target.value) });
				return;
			}

			if (target.dataset.key === 'homePull') {
				onStateChange({ homePull: Math.max(0.2, Math.min(4, Number(target.value))) });
				return;
			}

			if (target.dataset.key === 'mouseForce') {
				onStateChange({ mouseForce: Math.max(0.2, Math.min(6, Number(target.value))) });
				return;
			}

			if (target.dataset.key === 'mouseRadius') {
				onStateChange({ mouseRadius: Math.max(20, Math.min(260, Number(target.value))) });
			}
		});

		root.addEventListener('change', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement)) {
				return;
			}

			if (target.dataset.key === 'trails') {
				onStateChange({ trails: target.checked });
				return;
			}

			if (target.dataset.key === 'showMouse') {
				onStateChange({
					showMouse: target.checked,
					minimizeControlsAfterMouseToggle: target.checked === false,
				});
				return;
			}

			if (target.dataset.key === 'enabled') {
				onStateChange({ enabled: target.checked });
			}
		});

		return root;
	},
	getState() {
		return { ...state };
	},
	setState(nextState) {
		const previousText = state.targetText;
		const previousParticleText = state.particleText;
		const previousCount = state.particles;
		const shouldMinimizeControls = nextState.minimizeControlsAfterMouseToggle === true;
		delete nextState.minimizeControlsAfterMouseToggle;

		if (typeof nextState.targetText === 'string') {
			nextState.targetText = clampText(nextState.targetText, 'newen');
		}

		if (typeof nextState.particleText === 'string') {
			nextState.particleText = String(nextState.particleText).slice(0, MAX_TEXT_LENGTH);
		}

		if (nextState.particles !== undefined) {
			nextState.particles = clampParticleCount(nextState.particles);
		}

		if (nextState.showMouse !== undefined) {
			setMouseVisibility(nextState.showMouse, { minimizeControls: shouldMinimizeControls });
			delete nextState.showMouse;
		}

		Object.assign(state, nextState);

		if (
			state.targetText !== previousText
			|| state.particleText !== previousParticleText
			|| state.particles !== previousCount
		) {
			runtime.needsShapeRefresh = true;
		}

		const canvas = document.getElementById('third');
		if (canvas) {
			applyVisualState(canvas);
		}

		if (runtime.sketch && state.frozen) {
			runtime.sketch.redraw();
		}
	},
	setFrozen(isFrozen) {
		state.frozen = isFrozen;
		const canvas = document.getElementById('third');
		if (canvas) {
			applyVisualState(canvas);
		}

		if (!runtime.sketch) {
			return;
		}

		if (isFrozen) {
			runtime.sketch.noLoop();
			runtime.sketch.redraw();
			return;
		}

		runtime.sketch.loop();
	},
	setActive(isActive) {
		const canvas = document.getElementById('third');
		if (!canvas) {
			return;
		}

		canvas.style.filter = isActive ? 'brightness(1)' : 'brightness(0.85)';
	},
};
