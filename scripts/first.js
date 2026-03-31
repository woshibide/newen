const MAX_TEXT_LENGTH = 25;
const FONT_URL = new URL('../assets/fonts/MatterSQTRIAL-SemiBold.otf', import.meta.url).href;
const FONT_FALLBACK_URL = new URL('../assets/fonts/SourceSans3-wght.ttf', import.meta.url).href;
const P5_CDN_URL = 'https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js';
const HOLD_DURATION_MS = 50;
const FLIGHT_DURATION_MS = 15000;
const RETURN_DURATION_MS = 5000;
const MIN_PARTICLE_COUNT = 500;
const MAX_PARTICLE_COUNT = 5000;
const PARTICLE_STEP = 50;
const MIN_TIMESCALE = 0.1;
const MAX_TIMESCALE = 2;
const MIN_GLYPH_SIZE = 6;
const MAX_GLYPH_SIZE = 72;
const MIN_DISTANCE = 0.05;
const MAX_DISTANCE = 15.0;
const MIN_COHESION = 0.1;
const MAX_COHESION = 5;
const MIN_SEPARATION = 0;
const MAX_SEPARATION = 10;
const MIN_MAX_VELOCITY = 0.5;
const MAX_MAX_VELOCITY = 500;
const MIN_FORCE = 0.1;
const MAX_FORCE = 5;
const MIN_ALIGNMENT = 0;
const MAX_ALIGNMENT = 5;
const MIN_FLOW = 0;
const MAX_FLOW = 5;
const MIN_ORBIT = 0;
const MAX_ORBIT = 50;

const state = {
	speed: 1,
	enabled: true,
	frozen: true,
	targetText: 'newen',
	particleText: '',
	particleCount: 2000,
	glyphSize: 12,
	distance: 1,
	cohesionStrength: 0.2,
	separationStrength: 5,
	maxVelocity: 300,
	forceStrength: 1,
	flowStrength: 1.1,
	alignmentStrength: 0.6,
	orbitStrength: 3,
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
	flightElapsedMs: 0,
	returnElapsedMs: 0,
	simTimeSeconds: 0,
	returnRequested: false,
	isReturning: false,
	keyboardBound: false,
	wheelTarget: null,
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

function clampTimescale(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.speed;
	}

	return Math.max(MIN_TIMESCALE, Math.min(MAX_TIMESCALE, parsed));
}

function clampGlyphSize(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.glyphSize;
	}

	return Math.max(MIN_GLYPH_SIZE, Math.min(MAX_GLYPH_SIZE, parsed));
}

function clampDistance(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.distance;
	}

	return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, parsed));
}

function clampCohesion(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.cohesionStrength;
	}

	return Math.max(MIN_COHESION, Math.min(MAX_COHESION, parsed));
}

function clampSeparation(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.separationStrength;
	}

	return Math.max(MIN_SEPARATION, Math.min(MAX_SEPARATION, parsed));
}

function clampMaxVelocity(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.maxVelocity;
	}

	return Math.max(MIN_MAX_VELOCITY, Math.min(MAX_MAX_VELOCITY, parsed));
}

function clampForce(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.forceStrength;
	}

	return Math.max(MIN_FORCE, Math.min(MAX_FORCE, parsed));
}

function clampAlignment(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.alignmentStrength;
	}

	return Math.max(MIN_ALIGNMENT, Math.min(MAX_ALIGNMENT, parsed));
}

function clampFlow(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.flowStrength;
	}

	return Math.max(MIN_FLOW, Math.min(MAX_FLOW, parsed));
}

function clampOrbit(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.orbitStrength;
	}

	return Math.max(MIN_ORBIT, Math.min(MAX_ORBIT, parsed));
}

function syncDistanceControlInput() {
	const control = document.querySelector('#controls input[data-key="distance"]');
	if (control instanceof HTMLInputElement) {
		control.value = String(state.distance);
	}
}

function handleDistanceWheel(event) {
	if (!isFirstCanvasActive()) {
		return;
	}

	event.preventDefault();
	const scale = Math.exp(-event.deltaY * 0.0016);
	state.distance = clampDistance(state.distance * scale);
	syncDistanceControlInput();

	if (runtime.sketch && state.frozen) {
		runtime.sketch.redraw();
	}
}

function bindDistanceWheel(canvas) {
	if (runtime.wheelTarget === canvas) {
		return;
	}

	if (runtime.wheelTarget) {
		runtime.wheelTarget.removeEventListener('wheel', handleDistanceWheel);
	}

	canvas.addEventListener('wheel', handleDistanceWheel, { passive: false });
	runtime.wheelTarget = canvas;
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

function smoothStep01(edge0, edge1, value) {
	if (edge1 <= edge0) {
		return value >= edge1 ? 1 : 0;
	}

	const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function advanceLaunchProgress(deltaTime, timeScale) {
	runtime.flightElapsedMs += deltaTime * timeScale;
	const elapsed = Math.max(0, runtime.flightElapsedMs);
	if (elapsed < HOLD_DURATION_MS) {
		return 0;
	}

	const t = Math.min(1, (elapsed - HOLD_DURATION_MS) / FLIGHT_DURATION_MS);
	return easeInOutCubic(t);
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
		originPoints = [{ x: width * 0.5, y: height * 0.5, glyph: getFallbackGlyphForIndex(text, 0) }];
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
	runtime.flightElapsedMs = 0;
	runtime.returnElapsedMs = 0;
	runtime.simTimeSeconds = 0;
	runtime.returnRequested = false;
	runtime.isReturning = false;
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

function updateFlock(p, launchProgress, timeScale) {
	if (runtime.flock.length === 0) {
		return;
	}

	const motionMix = Math.max(0, launchProgress);
	if (motionMix < 0.001) {
		return;
	}
	const dt = Math.max(0.05, Math.min(2, timeScale));
	const simTime = runtime.simTimeSeconds;
	const centerX = p.width * 0.5;
	const centerY = p.height * 0.5;
	const flockBoundsRadius = Math.min(p.width, p.height) * 0.42;
	const attractorX = centerX + Math.sin(simTime * 0.23) * p.width * .014;
	const attractorY = centerY + Math.cos(simTime * 0.17) * p.height * .011;

	const maxSpeed = state.maxVelocity * (0.3 + motionMix * 0.7);
	const maxForce = (0.03 + (0.07 * motionMix)) * state.forceStrength;
	const neighborRadius = 8;
	const separationRadius = neighborRadius * 4;
	const neighborRadiusSq = neighborRadius * neighborRadius;
	const separationRadiusSq = separationRadius * separationRadius;
	const cellSize = neighborRadius;
	const grid = buildSpatialHash(cellSize);
	const alignWeight = state.alignmentStrength;
	const cohesionWeight = state.cohesionStrength;
	const separationWeight = state.separationStrength;
	const homeWeight = 0.01;
	const wanderStrength = 0.18 * motionMix;
	const flowWeight = 0.12 * motionMix * state.flowStrength;
	const orbitWeight = 0.01 * motionMix * state.orbitStrength;
	const centerWeight = 0.12 * motionMix; 
	const radialBoundsWeight = .95;
	const radialBoundsStart = 0.28;
	const continuousCenterPull = 0.000015; 
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
		const gridX = Math.floor(boid.position.x / cellSize);
		const gridY = Math.floor(boid.position.y / cellSize);

		for (let oy = -1; oy <= 1; oy += 1) {
			for (let ox = -1; ox <= 1; ox += 1) {
				const key = `${gridX + ox}|${gridY + oy}`;
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

		const wanderAngle = p.random(p.TWO_PI);
		steeringX += Math.cos(wanderAngle) * wanderStrength;
		steeringY += Math.sin(wanderAngle) * wanderStrength;

		const flowX = (
			Math.sin((boid.position.x * 0.015 + boid.position.y * 0.021) + simTime * 0.92) +
			Math.cos((boid.position.x * -0.018 + boid.position.y * 0.013) - simTime * 1.14)
		) * flowWeight;
		const flowY = (
			Math.sin((boid.position.x * -0.02 + boid.position.y * 0.016) + simTime * 0.87) -
			Math.cos((boid.position.x * 0.012 + boid.position.y * 0.019) - simTime * 1.06)
		) * flowWeight;
		steeringX += flowX;
		steeringY += flowY;

		const toAttractorX = attractorX - boid.position.x;
		const toAttractorY = attractorY - boid.position.y;
		const attractorLen = Math.hypot(toAttractorX, toAttractorY);
		if (attractorLen > 0.0001) {
			const nx = toAttractorX / attractorLen;
			const ny = toAttractorY / attractorLen;
			steeringX += nx * centerWeight;
			steeringY += ny * centerWeight;
			steeringX += -ny * orbitWeight;
			steeringY += nx * orbitWeight;
		}

		const offsetX = boid.position.x - centerX;
		const offsetY = boid.position.y - centerY;
		steeringX += -offsetX * continuousCenterPull;
		steeringY += -offsetY * continuousCenterPull;
		const radius = Math.hypot(offsetX, offsetY);
		if (radius > 0.0001) {
			const radialT = smoothStep01(radialBoundsStart * flockBoundsRadius, flockBoundsRadius, radius);
			const radialForce = radialT * radialBoundsWeight;
			steeringX += (-offsetX / radius) * radialForce;
			steeringY += (-offsetY / radius) * radialForce;
		}

		const steeringMagSq = steeringX * steeringX + steeringY * steeringY;
		if (steeringMagSq > limitSq) {
			const steeringMag = Math.sqrt(steeringMagSq);
			steeringX = (steeringX / steeringMag) * (maxForce * 4);
			steeringY = (steeringY / steeringMag) * (maxForce * 4);
		}

		boid.acceleration.x = steeringX;
		boid.acceleration.y = steeringY;
		boid.velocity.x += boid.acceleration.x * dt;
		boid.velocity.y += boid.acceleration.y * dt;
		const velocityMag = Math.hypot(boid.velocity.x, boid.velocity.y);
		if (velocityMag > maxSpeed) {
			boid.velocity.x = (boid.velocity.x / velocityMag) * maxSpeed;
			boid.velocity.y = (boid.velocity.y / velocityMag) * maxSpeed;
		}
		boid.position.x += boid.velocity.x * dt;
		boid.position.y += boid.velocity.y * dt;
		const damping = Math.max(0.92, 1 - (0.13 * dt));
		boid.velocity.x *= damping;
		boid.velocity.y *= damping;
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

function returnToOrigins(p, returnProgress, timeScale) {
	const t = easeOutCubic(returnProgress);
	const blend = t * t * 0.26;
	const damping = 1 - (t * 0.32);
	const dt = Math.max(0.05, Math.min(2, timeScale));

	for (let index = 0; index < runtime.flock.length; index += 1) {
		const boid = runtime.flock[index];
		const pull = seekForce(
			p,
			boid,
			boid.origin.x,
			boid.origin.y,
			0.9 + state.maxVelocity * 0.4,
			0.08 + t * 0.32,
		).mult(t * (1.6 + t * 1.8));

		boid.acceleration.set(0, 0);
		boid.acceleration.add(pull);
		boid.velocity.add(pull.mult(dt)).mult(damping);
		boid.position.x += boid.velocity.x * dt;
		boid.position.y += boid.velocity.y * dt;
		boid.position.lerp(boid.origin, blend);
	}
}

function drawFlock(p) {
	const customGlyph = String(state.particleText ?? '').slice(0, MAX_TEXT_LENGTH);
	const useOutlineGlyph = customGlyph.trim().length === 0;

	p.fill(255, 255, 255);
	p.textAlign(p.CENTER, p.CENTER);
	if (runtime.font) {
		p.textFont(runtime.font);
	}
	p.textSize(state.glyphSize);

	for (let index = 0; index < runtime.flock.length; index += 1) {
		const boid = runtime.flock[index];
		const glyph = useOutlineGlyph ? (boid.fallbackGlyph ?? getFallbackGlyphForIndex(state.targetText, 0)) : customGlyph;
		p.text(glyph, boid.position.x, boid.position.y);
	}
}

function isFirstCanvasActive() {
	const canvas = runtime.hostCanvas ?? document.getElementById('first');
	if (!canvas) {
		return false;
	}

	const wrapper = canvas.closest('.canvas-wrapper');
	if (!wrapper) {
		return true;
	}

	return wrapper.classList.contains('is-active');
}

function requestReturnToOrigins() {
	if (runtime.flock.length === 0 || runtime.isReturning) {
		return;
	}

	runtime.returnRequested = true;
	if (runtime.sketch && state.frozen) {
		runtime.sketch.redraw();
	}
}

function bindKeyboardReturnTrigger() {
	if (runtime.keyboardBound) {
		return;
	}

	window.addEventListener('keydown', (event) => {
		if (event.key.toLowerCase() !== 'r') {
			return;
		}

		const target = event.target;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			return;
		}

		if (!isFirstCanvasActive()) {
			return;
		}

		requestReturnToOrigins();
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
			runtime.font = p.loadFont(
				FONT_URL,
				(loadedFont) => {
					runtime.font = loadedFont;
				},
				() => {
					console.warn('failed to load matter font, using fallback');
					runtime.font = p.loadFont(FONT_FALLBACK_URL);
				},
			);
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
			bindDistanceWheel(runtime.hostCanvas);

			applyVisualState(runtime.hostCanvas);
			runtime.needsMaskRefresh = true;
			runtime.needsReseed = true;
			p.background(0, 0, 0);

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

			p.background(0, 0, 0);

			if (!state.frozen && state.enabled) {
				const timeScale = clampTimescale(state.speed);
				runtime.simTimeSeconds += (p.deltaTime * timeScale) / 1000;

				if (runtime.returnRequested && !runtime.isReturning) {
					runtime.returnRequested = false;
					runtime.isReturning = true;
					runtime.returnElapsedMs = 0;
				}

				if (runtime.isReturning) {
					runtime.returnElapsedMs += p.deltaTime * timeScale;
					const returnProgress = Math.min(1, runtime.returnElapsedMs / RETURN_DURATION_MS);
					returnToOrigins(p, returnProgress, timeScale);

					if (returnProgress >= 1) {
						holdAtOrigins();
						runtime.isReturning = false;
						runtime.flightElapsedMs = 0;
						runtime.returnElapsedMs = 0;
						runtime.simTimeSeconds = 0;
					}
				} else {
					const launchProgress = advanceLaunchProgress(p.deltaTime, timeScale);
					updateFlock(p, launchProgress, timeScale);
				}
			} else if (!state.enabled) {
				holdAtOrigins();
			}

			p.push();
			p.translate(p.width * 0.5, p.height * 0.5);
			p.scale(state.distance);
			p.translate(-p.width * 0.5, -p.height * 0.5);
			drawFlock(p);
			p.pop();
		};
	};

	runtime.sketch = new window.p5(sketch);
}

export const firstCanvasScript = {
	id: 'first',
	label: 'type displayed text; type text that will be used for particles. can be emojis 🏄, 🪑, 🐦',
	async init({ canvas }) {
		canvas.dataset.engine = 'p5';
		applyVisualState(canvas);
		bindKeyboardReturnTrigger();

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
				<span>speed</span>
				<input type="range" min="${MIN_TIMESCALE}" max="${MAX_TIMESCALE}" step="0.01" value="${currentState.speed}" data-key="speed" />
			</label>
			<label class="control-row">
				<span>glyph size</span>
				<input type="range" min="${MIN_GLYPH_SIZE}" max="${MAX_GLYPH_SIZE}" step="0.5" value="${currentState.glyphSize}" data-key="glyphSize" />
			</label>
			<label class="control-row">
				<span>cohesion</span>
				<input type="range" min="${MIN_COHESION}" max="${MAX_COHESION}" step="0.01" value="${currentState.cohesionStrength}" data-key="cohesionStrength" />
			</label>
			<label class="control-row">
				<span>separation</span>
				<input type="range" min="${MIN_SEPARATION}" max="${MAX_SEPARATION}" step="0.01" value="${currentState.separationStrength}" data-key="separationStrength" />
			</label>
			<label class="control-row">
				<span>max velocity</span>
				<input type="range" min="${MIN_MAX_VELOCITY}" max="${MAX_MAX_VELOCITY}" step="0.1" value="${currentState.maxVelocity}" data-key="maxVelocity" />
			</label>
			<label class="control-row">
				<span>force</span>
				<input type="range" min="${MIN_FORCE}" max="${MAX_FORCE}" step="0.01" value="${currentState.forceStrength}" data-key="forceStrength" />
			</label>
			<label class="control-row">
				<span>alignment</span>
				<input type="range" min="${MIN_ALIGNMENT}" max="${MAX_ALIGNMENT}" step="0.01" value="${currentState.alignmentStrength}" data-key="alignmentStrength" />
			</label>
			<label class="control-row">
				<span>flow</span>
				<input type="range" min="${MIN_FLOW}" max="${MAX_FLOW}" step="0.01" value="${currentState.flowStrength}" data-key="flowStrength" />
			</label>
			<label class="control-row">
				<span>orbit</span>
				<input type="range" min="${MIN_ORBIT}" max="${MAX_ORBIT}" step="0.01" value="${currentState.orbitStrength}" data-key="orbitStrength" />
			</label>
			<label class="control-row">
				<span>zoom</span>
				<input type="range" min="${MIN_DISTANCE}" max="${MAX_DISTANCE}" step="0.01" value="${currentState.distance}" data-key="distance" />
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
				onStateChange({ speed: clampTimescale(target.value) });
				return;
			}

			if (target.dataset.key === 'glyphSize') {
				onStateChange({ glyphSize: clampGlyphSize(target.value) });
				return;
			}

			if (target.dataset.key === 'cohesionStrength') {
				onStateChange({ cohesionStrength: clampCohesion(target.value) });
				return;
			}

			if (target.dataset.key === 'separationStrength') {
				onStateChange({ separationStrength: clampSeparation(target.value) });
				return;
			}

			if (target.dataset.key === 'maxVelocity') {
				onStateChange({ maxVelocity: clampMaxVelocity(target.value) });
				return;
			}

			if (target.dataset.key === 'forceStrength') {
				onStateChange({ forceStrength: clampForce(target.value) });
				return;
			}

			if (target.dataset.key === 'alignmentStrength') {
				onStateChange({ alignmentStrength: clampAlignment(target.value) });
				return;
			}

			if (target.dataset.key === 'flowStrength') {
				onStateChange({ flowStrength: clampFlow(target.value) });
				return;
			}

			if (target.dataset.key === 'orbitStrength') {
				onStateChange({ orbitStrength: clampOrbit(target.value) });
				return;
			}

			if (target.dataset.key === 'distance') {
				onStateChange({ distance: clampDistance(target.value) });
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

		if (nextState.speed !== undefined) {
			nextState.speed = clampTimescale(nextState.speed);
		}

		if (nextState.glyphSize !== undefined) {
			nextState.glyphSize = clampGlyphSize(nextState.glyphSize);
		}

		if (nextState.cohesionStrength !== undefined) {
			nextState.cohesionStrength = clampCohesion(nextState.cohesionStrength);
		}

		if (nextState.separationStrength !== undefined) {
			nextState.separationStrength = clampSeparation(nextState.separationStrength);
		}

		if (nextState.maxVelocity !== undefined) {
			nextState.maxVelocity = clampMaxVelocity(nextState.maxVelocity);
		}

		if (nextState.forceStrength !== undefined) {
			nextState.forceStrength = clampForce(nextState.forceStrength);
		}

		if (nextState.alignmentStrength !== undefined) {
			nextState.alignmentStrength = clampAlignment(nextState.alignmentStrength);
		}

		if (nextState.flowStrength !== undefined) {
			nextState.flowStrength = clampFlow(nextState.flowStrength);
		}

		if (nextState.orbitStrength !== undefined) {
			nextState.orbitStrength = clampOrbit(nextState.orbitStrength);
		}

		if (nextState.distance !== undefined) {
			nextState.distance = clampDistance(nextState.distance);
		}

		Object.assign(state, nextState);
		syncDistanceControlInput();

		if (state.targetText !== previousText) {
			runtime.needsMaskRefresh = true;
			runtime.flightElapsedMs = 0;
			runtime.simTimeSeconds = 0;
		}

		if (state.particleCount !== previousCount) {
			runtime.needsReseed = true;
			runtime.flightElapsedMs = 0;
			runtime.simTimeSeconds = 0;
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

		runtime.flightElapsedMs = 0;
		runtime.simTimeSeconds = 0;
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
