const MAX_TEXT_LENGTH = 25;
const FONT_URL = new URL('../assets/fonts/SourceSans3-wght.ttf', import.meta.url).href;
const P5_CDN_URL = 'https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js';
const HOLD_DURATION_MS = 50;
const FLIGHT_DURATION_MS = 15000;
const RETURN_DURATION_MS = 5000;
const MIN_PARTICLE_COUNT = 40;
const MAX_PARTICLE_COUNT = 1200;
const PARTICLE_STEP = 20;

const state = {
	speed: 6,
	enabled: true,
	frozen: true,
	targetText: 'newen',
	particleText: '',
	particleCount: 2500,
};

const runtime = {
	sketch: null,
	hostCanvas: null,
	font: null,
	maskWidth: 0,
	maskHeight: 0,
	insideMap: null,
	insideSamples: [],
	originPoints: [],
	flock: [],
	needsMaskRefresh: true,
	needsReseed: true,
	timelineStartMs: null,
};

let p5LoaderPromise = null;

function clampText(value, fallback) {
	const normalized = String(value ?? '').slice(0, MAX_TEXT_LENGTH);
	return normalized.trim().length > 0 ? normalized : fallback;
}

function clampParticleCount(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.particleCount;
	}

	return Math.max(MIN_PARTICLE_COUNT, Math.min(MAX_PARTICLE_COUNT, Math.round(parsed)));
}

function applyVisualState(canvasElement) {
	canvasElement.style.opacity = '1';
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

function easeInOutCubic(value) {
	const t = Math.max(0, Math.min(1, value));
	if (t < 0.5) {
		return 4 * t * t * t;
	}

	return 1 - ((-2 * t + 2) ** 3) / 2;
}

function easeOutCubic(value) {
	const t = Math.max(0, Math.min(1, value));
	return 1 - ((1 - t) ** 3);
}

function getCycleState(p) {
	const totalDuration = HOLD_DURATION_MS + FLIGHT_DURATION_MS + RETURN_DURATION_MS;
	if (runtime.timelineStartMs === null) {
		runtime.timelineStartMs = p.millis();
	}

	const elapsed = (p.millis() - runtime.timelineStartMs) % totalDuration;

	if (elapsed < HOLD_DURATION_MS) {
		return {
			phase: 'hold',
			launchProgress: 0,
			returnProgress: 0,
		};
	}

	if (elapsed < HOLD_DURATION_MS + FLIGHT_DURATION_MS) {
		const t = (elapsed - HOLD_DURATION_MS) / FLIGHT_DURATION_MS;
		return {
			phase: 'flight',
			launchProgress: easeInOutCubic(t),
			returnProgress: 0,
		};
	}

	const returnT = (elapsed - HOLD_DURATION_MS - FLIGHT_DURATION_MS) / RETURN_DURATION_MS;
	return {
		phase: 'return',
		launchProgress: 1,
		returnProgress: easeInOutCubic(returnT),
	};
}

function seekForce(p, boid, targetX, targetY, maxSpeed, maxForce) {
	const desired = p.createVector(targetX - boid.position.x, targetY - boid.position.y);
	const distance = desired.mag();
	if (distance < 0.1) {
		return p.createVector(0, 0);
	}

	desired.setMag(maxSpeed);
	return desired.sub(boid.velocity).limit(maxForce);
}

function pointIsInside(x, y) {
	if (!runtime.insideMap) {
		return false;
	}

	const clampedX = Math.max(0, Math.min(runtime.maskWidth - 1, Math.floor(x)));
	const clampedY = Math.max(0, Math.min(runtime.maskHeight - 1, Math.floor(y)));
	return runtime.insideMap[clampedY * runtime.maskWidth + clampedX] === 1;
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

function buildOriginPointsForText(p, text, drawX, drawY, fontSize, sampleFactor) {
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

function buildTextMask(p) {
	if (!runtime.font) {
		return;
	}

	const text = clampText(state.targetText, 'newen');
	state.targetText = text;

	const width = Math.max(20, p.width);
	const height = Math.max(20, p.height);
	const layer = p.createGraphics(width, height);
	layer.pixelDensity(1);
	layer.clear();
	layer.background(0);
	layer.fill(255);
	layer.noStroke();
	layer.textFont(runtime.font);

	const estimatedSize = Math.min(width / (text.length * 0.56), height * 0.45);
	const fontSize = Math.max(64, Math.min(estimatedSize, 300));
	const bounds = runtime.font.textBounds(text, 0, 0, fontSize);
	const drawX = (width - bounds.w) / 2 - bounds.x;
	const drawY = (height - bounds.h) / 2 - bounds.y;

	const sampleFactors = [0.08, 0.12, 0.16, 0.24, 0.34, 0.46, 0.6];
	let originPoints = [];
	for (let index = 0; index < sampleFactors.length; index += 1) {
		const points = buildOriginPointsForText(p, text, drawX, drawY, fontSize, sampleFactors[index]);
		if (points.length > originPoints.length) {
			originPoints = points;
		}
		if (originPoints.length >= state.particleCount) {
			break;
		}
	}

	layer.textSize(fontSize);
	layer.text(text, drawX, drawY);
	layer.loadPixels();

	const insideMap = new Uint8Array(width * height);
	const insideSamples = [];
	const stride = Math.max(2, Math.floor(Math.sqrt((width * height) / Math.max(80, state.particleCount * 1.4))));

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixelIndex = (y * width + x) * 4;
			const value = layer.pixels[pixelIndex];
			if (value > 15) {
				insideMap[y * width + x] = 1;
				if (x % stride === 0 && y % stride === 0) {
					insideSamples.push({ x, y });
				}
			}
		}
	}

	if (insideSamples.length === 0) {
		insideSamples.push({ x: width * 0.5, y: height * 0.5 });
	}

	if (originPoints.length === 0) {
		originPoints = [{ x: width * 0.25, y: height * 0.25, glyph: getFallbackGlyphForIndex(text, 0) }];
	}

	runtime.maskWidth = width;
	runtime.maskHeight = height;
	runtime.insideMap = insideMap;
	runtime.insideSamples = insideSamples;
	runtime.originPoints = originPoints;
	runtime.needsMaskRefresh = false;
	runtime.needsReseed = true;
}

function createFlock(p) {
	const flock = [];
	const sampleCount = runtime.originPoints.length;

	for (let index = 0; index < state.particleCount; index += 1) {
		const sampleIndex = Math.floor((index / state.particleCount) * sampleCount) % sampleCount;
		const sample = runtime.originPoints[sampleIndex];
		const origin = p.createVector(sample.x, sample.y);
		const fallbackGlyph = sample.glyph ?? getFallbackGlyphForIndex(state.targetText, 0);
		flock.push({
			position: origin.copy(),
			origin,
			fallbackGlyph,
			velocity: p.createVector(0, 0),
			acceleration: p.createVector(0, 0),
		});
	}

	runtime.flock = flock;
	runtime.needsReseed = false;
	runtime.timelineStartMs = p.millis();
}

function spatialKey(x, y, cellSize) {
	const cx = Math.floor(x / cellSize);
	const cy = Math.floor(y / cellSize);
	return `${cx}|${cy}`;
}

function buildSpatialHash(cellSize) {
	const grid = new Map();
	for (let index = 0; index < runtime.flock.length; index += 1) {
		const boid = runtime.flock[index];
		const key = spatialKey(boid.position.x, boid.position.y, cellSize);
		if (!grid.has(key)) {
			grid.set(key, []);
		}
		grid.get(key).push(index);
	}
	return grid;
}

function updateFlock(p, launchProgress, returnProgress) {
	if (runtime.flock.length === 0) {
		return;
	}

	const motionMix = Math.max(0, launchProgress * (1 - returnProgress * 0.72));
	if (motionMix < 0.001) {
		return;
	}

	const maxSpeed = (0.25 + (1.2 + state.speed * 1.1) * motionMix);
	const maxForce = (0.02 + (0.05 + state.speed * 0.014) * motionMix);
	const neighborRadius = 26 + state.speed * 2.5;
	const separationRadius = 13 + state.speed * 1.4;
	const neighborRadiusSq = neighborRadius * neighborRadius;
	const separationRadiusSq = separationRadius * separationRadius;
	const cellSize = neighborRadius;
	const grid = buildSpatialHash(cellSize);
	const alignWeight = 6;
	const cohesionWeight = 0.5;
	const separationWeight = 5.75;
	const homeWeight = 0.45 + (0.85 * returnProgress);
	const wanderStrength = (0.3 + state.speed * 0.0025) * motionMix;
	const limitSq = (maxForce * 4) * (maxForce * 4);

	for (let index = 0; index < runtime.flock.length; index += 1) {
		const boid = runtime.flock[index];
		let alignmentX = 0;
		let alignmentY = 0;
		let cohesionX = 0;
		let cohesionY = 0;
		let separationX = 0;
		let separationY = 0;
		let neighbors = 0;
		let steeringX = 0;
		let steeringY = 0;
		const centerX = Math.floor(boid.position.x / cellSize);
		const centerY = Math.floor(boid.position.y / cellSize);

		for (let oy = -1; oy <= 1; oy += 1) {
			for (let ox = -1; ox <= 1; ox += 1) {
				const key = `${centerX + ox}|${centerY + oy}`;
				const bucket = grid.get(key);
				if (!bucket) {
					continue;
				}

				for (let b = 0; b < bucket.length; b += 1) {
					const neighborIndex = bucket[b];
					if (neighborIndex === index) {
						continue;
					}

					const neighbor = runtime.flock[neighborIndex];
					const dx = boid.position.x - neighbor.position.x;
					const dy = boid.position.y - neighbor.position.y;
					const distanceSq = dx * dx + dy * dy;

					if (distanceSq > neighborRadiusSq || distanceSq < 0.0001) {
						continue;
					}

					neighbors += 1;
					alignmentX += neighbor.velocity.x;
					alignmentY += neighbor.velocity.y;
					cohesionX += neighbor.position.x;
					cohesionY += neighbor.position.y;

					if (distanceSq < separationRadiusSq) {
						const scale = 1 / Math.sqrt(distanceSq);
						separationX += dx * scale;
						separationY += dy * scale;
					}
				}
			}
		}

		if (neighbors > 0) {
			alignmentX /= neighbors;
			alignmentY /= neighbors;
			let alignMag = Math.hypot(alignmentX, alignmentY);
			if (alignMag > 0.0001) {
				alignmentX = (alignmentX / alignMag) * maxSpeed - boid.velocity.x;
				alignmentY = (alignmentY / alignMag) * maxSpeed - boid.velocity.y;
				alignMag = Math.hypot(alignmentX, alignmentY);
				if (alignMag > maxForce) {
					alignmentX = (alignmentX / alignMag) * maxForce;
					alignmentY = (alignmentY / alignMag) * maxForce;
				}
				steeringX += alignmentX * alignWeight;
				steeringY += alignmentY * alignWeight;
			}

			cohesionX /= neighbors;
			cohesionY /= neighbors;
			let desiredX = cohesionX - boid.position.x;
			let desiredY = cohesionY - boid.position.y;
			let desiredMag = Math.hypot(desiredX, desiredY);
			if (desiredMag > 0.0001) {
				desiredX = (desiredX / desiredMag) * maxSpeed - boid.velocity.x;
				desiredY = (desiredY / desiredMag) * maxSpeed - boid.velocity.y;
				desiredMag = Math.hypot(desiredX, desiredY);
				if (desiredMag > maxForce) {
					desiredX = (desiredX / desiredMag) * maxForce;
					desiredY = (desiredY / desiredMag) * maxForce;
				}
				steeringX += desiredX * cohesionWeight;
				steeringY += desiredY * cohesionWeight;
			}

			const separationMag = Math.hypot(separationX, separationY);
			if (separationMag > 0.0001) {
				let sepX = (separationX / separationMag) * maxSpeed - boid.velocity.x;
				let sepY = (separationY / separationMag) * maxSpeed - boid.velocity.y;
				let sepMag = Math.hypot(sepX, sepY);
				if (sepMag > maxForce) {
					sepX = (sepX / sepMag) * maxForce;
					sepY = (sepY / sepMag) * maxForce;
				}
				steeringX += sepX * separationWeight;
				steeringY += sepY * separationWeight;
			}
		}

		let homeX = boid.origin.x - boid.position.x;
		let homeY = boid.origin.y - boid.position.y;
		let homeMag = Math.hypot(homeX, homeY);
		if (homeMag > 0.0001) {
			homeX = (homeX / homeMag) * maxSpeed - boid.velocity.x;
			homeY = (homeY / homeMag) * maxSpeed - boid.velocity.y;
			homeMag = Math.hypot(homeX, homeY);
			if (homeMag > maxForce) {
				homeX = (homeX / homeMag) * maxForce;
				homeY = (homeY / homeMag) * maxForce;
			}
			steeringX += homeX * homeWeight;
			steeringY += homeY * homeWeight;
		}

		const isInside = pointIsInside(boid.position.x, boid.position.y);
		if (!isInside) {
			let recoveryX = boid.origin.x - boid.position.x;
			let recoveryY = boid.origin.y - boid.position.y;
			let recoveryMag = Math.hypot(recoveryX, recoveryY);
			if (recoveryMag > 0.0001) {
				recoveryX = (recoveryX / recoveryMag) * (maxSpeed * 1.8) - boid.velocity.x;
				recoveryY = (recoveryY / recoveryMag) * (maxSpeed * 1.8) - boid.velocity.y;
				recoveryMag = Math.hypot(recoveryX, recoveryY);
				const maxRecovery = maxForce * 2.2;
				if (recoveryMag > maxRecovery) {
					recoveryX = (recoveryX / recoveryMag) * maxRecovery;
					recoveryY = (recoveryY / recoveryMag) * maxRecovery;
				}
				steeringX += recoveryX * 2.2;
				steeringY += recoveryY * 2.2;
			}
		}

		const wanderAngle = p.random(p.TWO_PI);
		steeringX += Math.cos(wanderAngle) * wanderStrength;
		steeringY += Math.sin(wanderAngle) * wanderStrength;

		const steeringMagSq = steeringX * steeringX + steeringY * steeringY;
		if (steeringMagSq > limitSq) {
			const steeringMag = Math.sqrt(steeringMagSq);
			steeringX = (steeringX / steeringMag) * (maxForce * 4);
			steeringY = (steeringY / steeringMag) * (maxForce * 4);
		}

		boid.acceleration.x = steeringX;
		boid.acceleration.y = steeringY;
		boid.velocity.x += boid.acceleration.x;
		boid.velocity.y += boid.acceleration.y;
		const velocityMag = Math.hypot(boid.velocity.x, boid.velocity.y);
		if (velocityMag > maxSpeed) {
			boid.velocity.x = (boid.velocity.x / velocityMag) * maxSpeed;
			boid.velocity.y = (boid.velocity.y / velocityMag) * maxSpeed;
		}
		boid.position.add(boid.velocity);
		boid.velocity.x *= 0.995;
		boid.velocity.y *= 0.995;

		if (boid.position.x < 0) {
			boid.position.x = 0;
			boid.velocity.x *= -0.35;
		}
		if (boid.position.x > p.width) {
			boid.position.x = p.width;
			boid.velocity.x *= -0.35;
		}
		if (boid.position.y < 0) {
			boid.position.y = 0;
			boid.velocity.y *= -0.35;
		}
		if (boid.position.y > p.height) {
			boid.position.y = p.height;
			boid.velocity.y *= -0.35;
		}
	}
}

function holdAtOrigins() {
	for (let index = 0; index < runtime.flock.length; index += 1) {
		const boid = runtime.flock[index];
		boid.position.set(boid.origin.x, boid.origin.y);
		boid.velocity.set(0, 0);
		boid.acceleration.set(0, 0);
	}
}

function returnToOrigins(p, returnProgress) {
	const t = easeOutCubic(returnProgress);
	const blend = t * t * 0.26;
	const damping = 1 - (t * 0.32);

	for (let index = 0; index < runtime.flock.length; index += 1) {
		const boid = runtime.flock[index];
		const pull = seekForce(
			p,
			boid,
			boid.origin.x,
			boid.origin.y,
			0.6 + state.speed * 0.35,
			0.08 + t * 0.32,
		).mult(t * (1.6 + t * 1.8));

		boid.acceleration.set(0, 0);
		boid.acceleration.add(pull);
		boid.velocity.add(boid.acceleration).mult(damping);
		boid.position.add(boid.velocity);
		boid.position.lerp(boid.origin, blend);
	}
}

function drawFlock(p) {
	const customGlyph = String(state.particleText ?? '').slice(0, MAX_TEXT_LENGTH);
	const useOutlineGlyph = customGlyph.trim().length === 0;

	p.fill(240, 242, 255);
	p.textAlign(p.CENTER, p.CENTER);
	p.textSize(Math.max(7, 8 + state.speed * 0.8));

	for (let index = 0; index < runtime.flock.length; index += 1) {
		const boid = runtime.flock[index];
		const glyph = useOutlineGlyph ? (boid.fallbackGlyph ?? getFallbackGlyphForIndex(state.targetText, 0)) : customGlyph;
		p.text(glyph, boid.position.x, boid.position.y);
	}
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
			nextCanvas.id('first');
			nextCanvas.attribute('data-engine', 'p5');

			runtime.hostCanvas.remove();
			runtime.hostCanvas = nextCanvas.elt;

			// applyVisualState(runtime.hostCanvas);
			// runtime.needsMaskRefresh = true;
			// runtime.needsReseed = true;
			// p.background(6, 8, 11);

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
			runtime.needsMaskRefresh = true;
			if (state.frozen) {
				p.redraw();
			}
		};

		p.draw = () => {
			if (runtime.needsMaskRefresh) {
				buildTextMask(p);
			}

			if (runtime.needsReseed) {
				createFlock(p);
			}

			p.background(6, 8, 11);

			if (!state.frozen && state.enabled) {
				const cycleState = getCycleState(p);

				if (cycleState.phase === 'hold') {
					holdAtOrigins();
				} else {
					updateFlock(p, cycleState.launchProgress, cycleState.returnProgress);
					if (cycleState.phase === 'return') {
						returnToOrigins(p, cycleState.returnProgress);
					}
				}
			} else if (!state.enabled) {
				holdAtOrigins();
			}

			drawFlock(p);
		};
	};

	runtime.sketch = new window.p5(sketch);
}

export const firstCanvasScript = {
	id: 'first',
	label: 'type displayed text; type text that will be used for particles. can be emojis 🏄, 🪑, 🐦',
	async init({ canvas }) {
		canvas.dataset.engine = 'p5';
		// applyVisualState(canvas);

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
				<span>shape text</span>
				<input type="text" maxlength="${MAX_TEXT_LENGTH}" value="${currentState.targetText}" data-key="targetText" />
			</label>
			<label class="control-row">
				<span>particle text</span>
				<input type="text" maxlength="${MAX_TEXT_LENGTH}" value="${currentState.particleText}" data-key="particleText" />
			</label>
			<label class="control-row">
				<span>start particles</span>
				<input type="range" min="${MIN_PARTICLE_COUNT}" max="${MAX_PARTICLE_COUNT}" step="${PARTICLE_STEP}" value="${currentState.particleCount}" data-key="particleCount" />
			</label>
			<label class="control-row">
				<span>swarm speed</span>
				<input type="range" min="0.3" max="8" step="0.1" value="${currentState.speed}" data-key="speed" />
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

			if (target.dataset.key === 'particleCount') {
				onStateChange({ particleCount: clampParticleCount(target.value) });
				return;
			}

			if (target.dataset.key === 'speed') {
				onStateChange({ speed: Math.max(0.3, Math.min(8, Number(target.value))) });
			}
		});

		root.addEventListener('change', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement)) {
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
		const previousCount = state.particleCount;

		if (typeof nextState.targetText === 'string') {
			nextState.targetText = clampText(nextState.targetText, 'newen');
		}

		if (typeof nextState.particleText === 'string') {
			nextState.particleText = String(nextState.particleText).slice(0, MAX_TEXT_LENGTH);
		}

		if (nextState.particleCount !== undefined) {
			nextState.particleCount = clampParticleCount(nextState.particleCount);
		}

		Object.assign(state, nextState);

		if (state.targetText !== previousText) {
			runtime.needsMaskRefresh = true;
			runtime.timelineStartMs = null;
		}

		if (state.particleCount !== previousCount) {
			runtime.needsReseed = true;
			runtime.timelineStartMs = null;
		}

		const canvas = document.getElementById('first');
		if (canvas) {
			applyVisualState(canvas);
		}

		if (runtime.sketch && state.frozen) {
			runtime.sketch.redraw();
		}
	},
	setFrozen(isFrozen) {
		state.frozen = isFrozen;
		const canvas = document.getElementById('first');
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

		runtime.timelineStartMs = null;
		runtime.sketch.loop();
	},
	setActive(isActive) {
		const canvas = document.getElementById('first');
		if (!canvas) {
			return;
		}

		canvas.style.filter = isActive ? 'brightness(1)' : 'brightness(0.85)';
	},
};
