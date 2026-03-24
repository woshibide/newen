import * as THREE from 'https://esm.sh/three@0.164.1';
import { GPUComputationRenderer } from 'https://esm.sh/three@0.164.1/examples/jsm/misc/GPUComputationRenderer.js';

const DEFAULT_PARTICLE_COUNT = 150000;
const TARGET_BOUNDS = new THREE.Vector3(2.6, 1.45, 0.6);
const SIM_BOUNDS = new THREE.Vector3(9.8, 5.6, 2.4);
const CAMERA_DOLLY_MIN = 2.6;
const CAMERA_DOLLY_MAX = 26;
const CAMERA_DOLLY_SCROLL_SENSITIVITY = 0.0016;
const BASE_WORD = 'newen';
const DEBUG_GPU = true;
const DEBUG_INTERVAL_SECONDS = 1;

const PHASES = {
	formSeconds: 1.5,
	flockSeconds: 12.5,
	regroupSeconds: 4.7,
};

const state = {
	word: BASE_WORD,
	particleCount: DEFAULT_PARTICLE_COUNT,
	pointSize: 1.8,
	wireframe: false,
	frozen: true,
};

const runtime = {
	initialized: false,
	canvas: null,
	renderer: null,
	scene: null,
	camera: null,
	clock: null,
	points: null,
	particlesMaterial: null,
	gpuCompute: null,
	positionVariable: null,
	velocityVariable: null,
	targetTexture: null,
	resizeObserver: null,
	animationLoopBound: null,
	modeBlend: 1,
	lastDebugAt: -Infinity,
	debugPositionBuffer: null,
	debugVelocityBuffer: null,
	tmpProjectVector: new THREE.Vector3(),
	particleCount: DEFAULT_PARTICLE_COUNT,
	textureSize: Math.ceil(Math.sqrt(DEFAULT_PARTICLE_COUNT)),
};

function getTextureSizeForCount(particleCount) {
	return Math.ceil(Math.sqrt(particleCount));
}

function clampCameraDistance(value) {
	return Math.max(CAMERA_DOLLY_MIN, Math.min(CAMERA_DOLLY_MAX, value));
}

function setCameraDistance(nextDistance) {
	if (!runtime.camera) {
		return;
	}

	runtime.camera.position.z = clampCameraDistance(nextDistance);
}

function handleWheelDolly(event) {
	if (!runtime.camera) {
		return;
	}

	event.preventDefault();
	const scale = Math.exp(event.deltaY * CAMERA_DOLLY_SCROLL_SENSITIVITY);
	setCameraDistance(runtime.camera.position.z * scale);
}

function clampWord(value) {
	const normalized = String(value ?? '').trim();
	if (normalized.length === 0) {
		return BASE_WORD;
	}

	return normalized.slice(0, 12);
}

function clampPointSize(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.pointSize;
	}

	return Math.max(0.8, Math.min(8, parsed));
}

function clampParticleCount(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return state.particleCount;
	}

	const rounded = Math.round(parsed);
	return Math.max(5000, Math.min(500000, rounded));
}

function smoothStep01(value) {
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
}

function getCycleMode(elapsedSeconds) {
	const total = PHASES.formSeconds + PHASES.flockSeconds + PHASES.regroupSeconds;
	const t = elapsedSeconds % total;

	if (t <= PHASES.formSeconds) {
		return 1;
	}

	if (t <= PHASES.formSeconds + PHASES.flockSeconds) {
		const local = (t - PHASES.formSeconds) / PHASES.flockSeconds;
		return 1 - smoothStep01(local);
	}

	const local = (t - PHASES.formSeconds - PHASES.flockSeconds) / PHASES.regroupSeconds;
	return smoothStep01(local);
}

function applyVisualState(canvasElement) {
	canvasElement.style.background = 'transparent';
	canvasElement.style.outline = state.wireframe ? '1px dashed rgba(255,255,255,0.45)' : 'none';
	canvasElement.dataset.frozen = String(state.frozen);
}

function createTextSampleTexture(word, textureSize, width = 1024, height = 512) {
	const text = clampWord(word);
	const offscreen = document.createElement('canvas');
	offscreen.width = width;
	offscreen.height = height;

	const ctx = offscreen.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		throw new Error('2d canvas context not available for text sampling');
	}

	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = 'rgba(255,255,255,1)';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	let fontSize = Math.floor(height * 0.64);
	ctx.font = `900 ${fontSize}px "Arial Black", "Segoe UI", sans-serif`;

	let metrics = ctx.measureText(text);
	const maxTextWidth = width * 0.8;
	if (metrics.width > maxTextWidth) {
		fontSize = Math.max(64, Math.floor((fontSize * maxTextWidth) / Math.max(metrics.width, 1)));
		ctx.font = `900 ${fontSize}px "Arial Black", "Segoe UI", sans-serif`;
		metrics = ctx.measureText(text);
	}

	ctx.fillText(text, width * 0.5, height * 0.52);

	const image = ctx.getImageData(0, 0, width, height);
	const alphaThreshold = 20;
	const candidates = [];

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = (y * width + x) * 4 + 3;
			if (image.data[index] > alphaThreshold) {
				candidates.push({ x, y });
			}
		}
	}

	if (candidates.length === 0) {
		candidates.push({ x: width * 0.5, y: height * 0.5 });
	}

	const totalTexels = textureSize * textureSize;
	const sampledPositions = new Float32Array(totalTexels * 4);

	for (let i = 0; i < totalTexels; i += 1) {
		const sample = candidates[Math.floor(Math.random() * candidates.length)];
		const nx = (sample.x / (width - 1)) * 2 - 1;
		const ny = 1 - (sample.y / (height - 1)) * 2;

		const jitterX = (Math.random() - 0.5) * 0.035;
		const jitterY = (Math.random() - 0.5) * 0.035;
		const jitterZ = (Math.random() - 0.5) * 0.12;

		sampledPositions[i * 4 + 0] = nx * TARGET_BOUNDS.x + jitterX;
		sampledPositions[i * 4 + 1] = ny * TARGET_BOUNDS.y + jitterY;
		sampledPositions[i * 4 + 2] = jitterZ;
		sampledPositions[i * 4 + 3] = 1;
	}

	const initialTexture = new THREE.DataTexture(
		sampledPositions,
		textureSize,
		textureSize,
		THREE.RGBAFormat,
		THREE.FloatType,
	);
	initialTexture.needsUpdate = true;
	initialTexture.magFilter = THREE.NearestFilter;
	initialTexture.minFilter = THREE.NearestFilter;

	const targetTexture = initialTexture.clone();
	targetTexture.needsUpdate = true;
	targetTexture.magFilter = THREE.NearestFilter;
	targetTexture.minFilter = THREE.NearestFilter;

	return { initialTexture, targetTexture };
}

function createInitialVelocityTexture(gpuCompute) {
	const texture = gpuCompute.createTexture();
	const data = texture.image.data;

	for (let i = 0; i < data.length; i += 4) {
		data[i + 0] = (Math.random() - 0.5) * 0.24;
		data[i + 1] = (Math.random() - 0.5) * 0.24;
		data[i + 2] = (Math.random() - 0.5) * 0.12;
		data[i + 3] = 1;
	}

	return texture;
}

function getPositionShader() {
	return `
		uniform float uDelta;
		uniform vec3 uBounds;
		uniform sampler2D targetPosition;

		bool invalidFloat(float value) {
			return (value != value) || abs(value) > 1e6;
		}

		bool invalidVec3(vec3 value) {
			return invalidFloat(value.x) || invalidFloat(value.y) || invalidFloat(value.z);
		}

		void main() {
			vec2 uv = gl_FragCoord.xy / resolution.xy;
			vec3 pos = texture2D(texturePosition, uv).xyz;
			vec3 vel = texture2D(textureVelocity, uv).xyz;
			vec3 targetPos = texture2D(targetPosition, uv).xyz;

			if (invalidVec3(pos)) {
				pos = targetPos;
			}

			if (invalidVec3(vel)) {
				vel = vec3(0.0);
			}

			pos += vel * uDelta;
			pos = clamp(pos, -uBounds, uBounds);

			if (invalidVec3(pos)) {
				pos = targetPos;
			}

			gl_FragColor = vec4(pos, 1.0);
		}
	`;
}

function getVelocityShader() {
	return `
		uniform float uTime;
		uniform float uDelta;
		uniform float uMode;
		uniform float uMaxSpeed;
		uniform vec3 uBounds;
		uniform sampler2D targetPosition;

		float hash11(float p) {
			p = fract(p * 0.1031);
			p *= p + 33.33;
			p *= p + p;
			return fract(p);
		}

		vec2 hash22(vec2 p) {
			float n = sin(dot(p, vec2(41.0, 289.0)));
			return fract(vec2(262144.0, 32768.0) * n);
		}

		bool invalidFloat(float value) {
			return (value != value) || abs(value) > 1e6;
		}

		bool invalidVec3(vec3 value) {
			return invalidFloat(value.x) || invalidFloat(value.y) || invalidFloat(value.z);
		}

		void main() {
			vec2 uv = gl_FragCoord.xy / resolution.xy;
			vec3 selfPos = texture2D(texturePosition, uv).xyz;
			vec3 selfVel = texture2D(textureVelocity, uv).xyz;
			vec3 targetPos = texture2D(targetPosition, uv).xyz;

			if (invalidVec3(selfPos)) {
				selfPos = targetPos;
			}

			if (invalidVec3(selfVel)) {
				vec2 seed = hash22(uv + uTime * 0.1);
				selfVel = vec3(seed - 0.5, hash11(seed.x * 31.7) - 0.5) * 0.08;
			}

			vec3 separation = vec3(0.0);
			vec3 alignment = vec3(0.0);
			vec3 cohesion = vec3(0.0);
			float alignCount = 0.0;
			float cohesionCount = 0.0;

			float sepRadius = 0.55;
			float alignRadius = 1.45;
			float cohRadius = 2.05;

			for (int i = 0; i < 32; i++) {
				float fi = float(i);
				vec2 noise = hash22(uv + vec2(fi * 0.13, fi * 0.71) + uTime * 0.12);
				vec2 sampleUv = fract(uv + noise + vec2(fi * 0.017, fi * 0.031));
				vec3 otherPos = texture2D(texturePosition, sampleUv).xyz;
				vec3 otherVel = texture2D(textureVelocity, sampleUv).xyz;

				vec3 offset = otherPos - selfPos;
				float dist = length(offset) + 1e-5;

				if (dist < sepRadius) {
					separation -= normalize(offset) * (sepRadius - dist) / sepRadius;
				}

				if (dist < alignRadius) {
					alignment += otherVel;
					alignCount += 1.0;
				}

				if (dist < cohRadius) {
					cohesion += otherPos;
					cohesionCount += 1.0;
				}
			}

			vec3 boidsForce = vec3(0.0);

			if (alignCount > 0.0) {
				vec3 avgVel = alignment / alignCount;
				boidsForce += (avgVel - selfVel) * 1.25;
			}

			if (cohesionCount > 0.0) {
				vec3 center = cohesion / cohesionCount;
				boidsForce += (center - selfPos) * 0.82;
			}

			boidsForce += separation * 1.55;

			vec3 wander = vec3(
				hash11(dot(uv, vec2(17.1, 67.2)) + uTime * 0.31) - 0.5,
				hash11(dot(uv, vec2(43.7, 11.9)) - uTime * 0.29) - 0.5,
				hash11(dot(uv, vec2(91.3, 29.5)) + uTime * 0.27) - 0.5
			) * 0.9;

			vec3 flow = vec3(
				sin(selfPos.y * 1.7 + uTime * 0.9) + cos(selfPos.z * 1.2 - uTime * 1.2),
				sin(selfPos.z * 1.4 - uTime * 0.8) + cos(selfPos.x * 1.5 + uTime * 1.1),
				sin(selfPos.x * 1.3 + uTime * 1.0) + cos(selfPos.y * 1.6 - uTime * 0.95)
			);

			vec3 attractor = vec3(
				sin(uTime * 0.23) * uBounds.x * 0.62,
				cos(uTime * 0.17) * uBounds.y * 0.58,
				sin(uTime * 0.21) * uBounds.z * 0.52
			);
			vec3 toAttractor = attractor - selfPos;
			float toAttractorLen = length(toAttractor) + 1e-5;
			vec3 orbit = vec3(-toAttractor.y, toAttractor.x, sin(uTime + uv.x * 20.0)) / toAttractorLen;

			vec3 toTarget = targetPos - selfPos;
			float targetDist = length(toTarget);
			vec3 targetForce = vec3(0.0);
			if (targetDist > 1e-5) {
				targetForce = normalize(toTarget) * min(targetDist, 4.5) * 1.95;
			}

			float flockMix = 1.0 - clamp(uMode, 0.0, 1.0);
			vec3 accelFlock = boidsForce * 2.7 + flow * 3.8 + orbit * 1.6 + wander;
			vec3 accelText = boidsForce * 0.2 + targetForce;
			vec3 accel = mix(accelFlock, accelText, clamp(uMode, 0.0, 1.0));
			if (toAttractorLen > 1e-4) {
				accel += (toAttractor / toAttractorLen) * (0.35 * flockMix);
			}
			accel = clamp(accel, vec3(-18.0), vec3(18.0));

			selfVel += accel * uDelta;

			float speed = length(selfVel);
			if (speed > uMaxSpeed) {
				selfVel *= uMaxSpeed / speed;
			}

			float damping = mix(0.9965, 0.945, clamp(uMode, 0.0, 1.0));
			selfVel *= damping;

			vec3 wallPush = vec3(0.0);
			wallPush.x = smoothstep(uBounds.x * 0.6, uBounds.x, abs(selfPos.x)) * -sign(selfPos.x);
			wallPush.y = smoothstep(uBounds.y * 0.6, uBounds.y, abs(selfPos.y)) * -sign(selfPos.y);
			wallPush.z = smoothstep(uBounds.z * 0.6, uBounds.z, abs(selfPos.z)) * -sign(selfPos.z);
			selfVel += wallPush * 0.22;

			if (invalidVec3(selfVel)) {
				selfVel = vec3(0.0);
			}

			gl_FragColor = vec4(selfVel, 1.0);
		}
	`;
}

function createRenderMaterial() {
	return new THREE.ShaderMaterial({
		uniforms: {
			uPositionTexture: { value: null },
			uVelocityTexture: { value: null },
			uPointSize: { value: state.pointSize },
		},
		vertexShader: `
			attribute vec2 reference;
			uniform sampler2D uPositionTexture;
			uniform sampler2D uVelocityTexture;
			uniform float uPointSize;
			varying float vSpeed;

			void main() {
				vec3 particlePosition = texture2D(uPositionTexture, reference).xyz;
				vec3 velocity = texture2D(uVelocityTexture, reference).xyz;
				vSpeed = length(velocity);

				vec4 mvPosition = modelViewMatrix * vec4(particlePosition, 1.0);
				float depthScale = 48.0 / (16.0 + max(-mvPosition.z, 0.001));
				gl_PointSize = clamp(uPointSize * depthScale, 0.6, 24.0);
				gl_Position = projectionMatrix * mvPosition;
			}
		`,
		fragmentShader: `
			varying float vSpeed;

			void main() {
				vec2 centered = gl_PointCoord - vec2(0.5);
				float d = length(centered);
				if (d > 0.5) {
					discard;
				}

				vec3 cold = vec3(0.56, 0.78, 1.0);
				vec3 warm = vec3(1.0, 0.92, 0.72);
				float blend = clamp(vSpeed * 4.0, 0.0, 1.0);
				vec3 color = mix(cold, warm, blend);
				float alpha = 1.0 - smoothstep(0.06, 0.5, d);

				gl_FragColor = vec4(color, alpha);
			}
		`,
		transparent: true,
		depthWrite: false,
		depthTest: false,
		blending: THREE.AdditiveBlending,
	});
}

function createParticleGeometry(particleCount, textureSize) {
	const geometry = new THREE.BufferGeometry();
	const positions = new Float32Array(particleCount * 3);
	const reference = new Float32Array(particleCount * 2);

	for (let i = 0; i < particleCount; i += 1) {
		const x = i % textureSize;
		const y = Math.floor(i / textureSize);
		reference[i * 2 + 0] = (x + 0.5) / textureSize;
		reference[i * 2 + 1] = (y + 0.5) / textureSize;
	}

	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('reference', new THREE.BufferAttribute(reference, 2));

	return geometry;
}

function rebuildTextTargets(word) {
	if (!runtime.initialized || !runtime.gpuCompute || !runtime.positionVariable || !runtime.velocityVariable) {
		return;
	}

	const nextWord = clampWord(word);
	const { initialTexture, targetTexture } = createTextSampleTexture(nextWord, runtime.textureSize);
	const velocityTexture = createInitialVelocityTexture(runtime.gpuCompute);

	runtime.gpuCompute.renderTexture(initialTexture, runtime.positionVariable.renderTargets[0]);
	runtime.gpuCompute.renderTexture(initialTexture, runtime.positionVariable.renderTargets[1]);
	runtime.gpuCompute.renderTexture(velocityTexture, runtime.velocityVariable.renderTargets[0]);
	runtime.gpuCompute.renderTexture(velocityTexture, runtime.velocityVariable.renderTargets[1]);

	runtime.particlesMaterial.uniforms.uPositionTexture.value = runtime.positionVariable.renderTargets[0].texture;
	runtime.particlesMaterial.uniforms.uVelocityTexture.value = runtime.velocityVariable.renderTargets[0].texture;

	if (runtime.targetTexture) {
		runtime.targetTexture.dispose();
	}

	runtime.targetTexture = targetTexture;
	runtime.velocityVariable.material.uniforms.targetPosition.value = runtime.targetTexture;
	runtime.positionVariable.material.uniforms.targetPosition.value = runtime.targetTexture;
	runtime.modeBlend = 1;

	initialTexture.dispose();
}

function disposeSimulation() {
	if (runtime.renderer) {
		runtime.renderer.setAnimationLoop(null);
	}

	if (runtime.resizeObserver) {
		runtime.resizeObserver.disconnect();
		runtime.resizeObserver = null;
	}

	if (runtime.canvas) {
		runtime.canvas.removeEventListener('wheel', handleWheelDolly);
	}

	if (runtime.points) {
		runtime.scene?.remove(runtime.points);
		runtime.points.geometry.dispose();
		runtime.points.material.dispose();
		runtime.points = null;
	}

	if (runtime.targetTexture) {
		runtime.targetTexture.dispose();
		runtime.targetTexture = null;
	}

	if (runtime.gpuCompute && typeof runtime.gpuCompute.dispose === 'function') {
		runtime.gpuCompute.dispose();
	}

	runtime.particlesMaterial = null;
	runtime.gpuCompute = null;
	runtime.positionVariable = null;
	runtime.velocityVariable = null;
	runtime.scene = null;
	runtime.camera = null;
	runtime.clock = null;
	runtime.debugPositionBuffer = null;
	runtime.debugVelocityBuffer = null;
	runtime.lastDebugAt = -Infinity;
	runtime.initialized = false;

	if (runtime.renderer) {
		runtime.renderer.dispose();
		runtime.renderer = null;
	}
}

function rebuildSimulationForParticleCount(nextParticleCount) {
	if (!runtime.canvas) {
		return;
	}

	const shouldFreezeAfterRebuild = state.frozen;
	disposeSimulation();
	buildSimulation(runtime.canvas, nextParticleCount);

	if (shouldFreezeAfterRebuild) {
		stopAnimation();
		return;
	}

	startAnimation();
}

function updateSize() {
	if (!runtime.renderer || !runtime.camera || !runtime.canvas?.parentElement) {
		return;
	}

	const width = Math.max(140, runtime.canvas.parentElement.clientWidth);
	const height = Math.max(140, runtime.canvas.parentElement.clientHeight);

	runtime.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	runtime.renderer.setSize(width, height, false);
	runtime.camera.aspect = width / height;
	runtime.camera.updateProjectionMatrix();
}

function logDebugStats(delta, elapsed) {
	if (!DEBUG_GPU) {
		return;
	}

	if (!runtime.renderer || !runtime.gpuCompute || !runtime.positionVariable || !runtime.velocityVariable || !runtime.camera) {
		return;
	}

	if (elapsed - runtime.lastDebugAt < DEBUG_INTERVAL_SECONDS) {
		return;
	}

	runtime.lastDebugAt = elapsed;

	const texelCount = runtime.textureSize * runtime.textureSize;
	if (!runtime.debugPositionBuffer || runtime.debugPositionBuffer.length !== texelCount * 4) {
		runtime.debugPositionBuffer = new Float32Array(texelCount * 4);
	}

	if (!runtime.debugVelocityBuffer || runtime.debugVelocityBuffer.length !== texelCount * 4) {
		runtime.debugVelocityBuffer = new Float32Array(texelCount * 4);
	}

	const posTarget = runtime.gpuCompute.getCurrentRenderTarget(runtime.positionVariable);
	const velTarget = runtime.gpuCompute.getCurrentRenderTarget(runtime.velocityVariable);

	try {
		runtime.renderer.readRenderTargetPixels(posTarget, 0, 0, runtime.textureSize, runtime.textureSize, runtime.debugPositionBuffer);
		runtime.renderer.readRenderTargetPixels(velTarget, 0, 0, runtime.textureSize, runtime.textureSize, runtime.debugVelocityBuffer);
	} catch (error) {
		console.warn('[second debug] readRenderTargetPixels failed', error);
		return;
	}

	let finitePositionCount = 0;
	let finiteVelocityCount = 0;
	let outOfBoundsCount = 0;
	let nearZeroSpeedCount = 0;
	let visibleEstimateCount = 0;
	let visibleEstimateHits = 0;

	const projectStride = 29;

	for (let i = 0; i < runtime.particleCount; i += 1) {
		const base = i * 4;
		const px = runtime.debugPositionBuffer[base + 0];
		const py = runtime.debugPositionBuffer[base + 1];
		const pz = runtime.debugPositionBuffer[base + 2];
		const vx = runtime.debugVelocityBuffer[base + 0];
		const vy = runtime.debugVelocityBuffer[base + 1];
		const vz = runtime.debugVelocityBuffer[base + 2];

		const positionFinite = Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz);
		const velocityFinite = Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz);

		if (positionFinite) {
			finitePositionCount += 1;
			if (
				Math.abs(px) > SIM_BOUNDS.x * 1.25 ||
				Math.abs(py) > SIM_BOUNDS.y * 1.25 ||
				Math.abs(pz) > SIM_BOUNDS.z * 1.25
			) {
				outOfBoundsCount += 1;
			}
		}

		if (velocityFinite) {
			finiteVelocityCount += 1;
			const speedSq = vx * vx + vy * vy + vz * vz;
			if (speedSq < 0.000025) {
				nearZeroSpeedCount += 1;
			}
		}

		if (positionFinite && i % projectStride === 0) {
			runtime.tmpProjectVector.set(px, py, pz).project(runtime.camera);
			visibleEstimateCount += 1;
			if (
				runtime.tmpProjectVector.x >= -1 &&
				runtime.tmpProjectVector.x <= 1 &&
				runtime.tmpProjectVector.y >= -1 &&
				runtime.tmpProjectVector.y <= 1 &&
				runtime.tmpProjectVector.z >= -1 &&
				runtime.tmpProjectVector.z <= 1
			) {
				visibleEstimateHits += 1;
			}
		}
	}

	const visibleEstimateRatio = visibleEstimateCount > 0 ? visibleEstimateHits / visibleEstimateCount : 0;

	console.debug('[second debug] gpu stats', {
		particles: runtime.particleCount,
		textureSize: runtime.textureSize,
		delta,
		elapsed,
		mode: runtime.modeBlend,
		pointSize: state.pointSize,
		finitePositionCount,
		finiteVelocityCount,
		outOfBoundsCount,
		nearZeroSpeedCount,
		visibleEstimateRatio,
	});
}

function animationLoop() {
	if (!runtime.renderer || !runtime.gpuCompute || !runtime.positionVariable || !runtime.velocityVariable) {
		return;
	}

	const delta = Math.min(runtime.clock.getDelta(), 1 / 30);
	const elapsed = runtime.clock.getElapsedTime();
	runtime.modeBlend = getCycleMode(elapsed);

	runtime.positionVariable.material.uniforms.uDelta.value = delta;
	runtime.velocityVariable.material.uniforms.uTime.value = elapsed;
	runtime.velocityVariable.material.uniforms.uDelta.value = delta;
	runtime.velocityVariable.material.uniforms.uMode.value = runtime.modeBlend;

	runtime.gpuCompute.compute();
	logDebugStats(delta, elapsed);

	runtime.particlesMaterial.uniforms.uPositionTexture.value = runtime.gpuCompute.getCurrentRenderTarget(runtime.positionVariable).texture;
	runtime.particlesMaterial.uniforms.uVelocityTexture.value = runtime.gpuCompute.getCurrentRenderTarget(runtime.velocityVariable).texture;

	runtime.renderer.render(runtime.scene, runtime.camera);
}

function startAnimation() {
	if (!runtime.renderer || !runtime.animationLoopBound) {
		return;
	}

	runtime.clock.start();
	runtime.renderer.setAnimationLoop(runtime.animationLoopBound);
}

function stopAnimation() {
	if (!runtime.renderer) {
		return;
	}

	runtime.renderer.setAnimationLoop(null);
	runtime.renderer.render(runtime.scene, runtime.camera);
}

function buildSimulation(canvas, particleCount = state.particleCount) {
	runtime.canvas = canvas;
	runtime.particleCount = clampParticleCount(particleCount);
	runtime.textureSize = getTextureSizeForCount(runtime.particleCount);
	runtime.scene = new THREE.Scene();
	runtime.camera = new THREE.PerspectiveCamera(44, 1, 0.01, 160);
	runtime.camera.position.set(0, 0, 12.5);
	runtime.clock = new THREE.Clock();
	canvas.addEventListener('wheel', handleWheelDolly, { passive: false });
	if (DEBUG_GPU && runtime.particleCount !== 100000) {
		console.warn('[second debug] particle count differs from expected 100000', { particleCount: runtime.particleCount });
	}

	runtime.renderer = new THREE.WebGLRenderer({
		canvas,
		alpha: true,
		antialias: true,
		powerPreference: 'high-performance',
	});
	runtime.renderer.outputColorSpace = THREE.SRGBColorSpace;

	const gpuCompute = new GPUComputationRenderer(runtime.textureSize, runtime.textureSize, runtime.renderer);
	const { initialTexture, targetTexture } = createTextSampleTexture(state.word, runtime.textureSize);
	const velocityTexture = createInitialVelocityTexture(gpuCompute);

	const positionVariable = gpuCompute.addVariable('texturePosition', getPositionShader(), initialTexture);
	const velocityVariable = gpuCompute.addVariable('textureVelocity', getVelocityShader(), velocityTexture);

	gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
	gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);

	positionVariable.material.uniforms.uDelta = { value: 0 };
	positionVariable.material.uniforms.uBounds = { value: SIM_BOUNDS };
	positionVariable.material.uniforms.targetPosition = { value: targetTexture };

	velocityVariable.material.uniforms.uTime = { value: 0 };
	velocityVariable.material.uniforms.uDelta = { value: 0 };
	velocityVariable.material.uniforms.uMode = { value: 1 };
	velocityVariable.material.uniforms.uMaxSpeed = { value: 12.5 };
	velocityVariable.material.uniforms.uBounds = { value: SIM_BOUNDS };
	velocityVariable.material.uniforms.targetPosition = { value: targetTexture };

	const initError = gpuCompute.init();
	if (initError) {
		throw new Error(initError);
	}

	runtime.gpuCompute = gpuCompute;
	runtime.positionVariable = positionVariable;
	runtime.velocityVariable = velocityVariable;
	runtime.targetTexture = targetTexture;

	const geometry = createParticleGeometry(runtime.particleCount, runtime.textureSize);
	runtime.particlesMaterial = createRenderMaterial();
	runtime.points = new THREE.Points(geometry, runtime.particlesMaterial);
	runtime.points.frustumCulled = false;
	runtime.scene.add(runtime.points);

	runtime.particlesMaterial.uniforms.uPositionTexture.value = runtime.gpuCompute.getCurrentRenderTarget(runtime.positionVariable).texture;
	runtime.particlesMaterial.uniforms.uVelocityTexture.value = runtime.gpuCompute.getCurrentRenderTarget(runtime.velocityVariable).texture;

	updateSize();

	runtime.resizeObserver = new ResizeObserver(() => {
		updateSize();
	});
	runtime.resizeObserver.observe(canvas.parentElement ?? canvas);

	runtime.animationLoopBound = animationLoop;
	runtime.initialized = true;

	initialTexture.dispose();
}

function updateStateFromControls(nextState) {
	let shouldRebuildWord = false;

	if (typeof nextState.word === 'string') {
		const nextWord = clampWord(nextState.word);
		if (nextWord !== state.word) {
			state.word = nextWord;
			shouldRebuildWord = true;
		}
	}

	if (nextState.pointSize !== undefined) {
		state.pointSize = clampPointSize(nextState.pointSize);
		if (runtime.particlesMaterial) {
			runtime.particlesMaterial.uniforms.uPointSize.value = state.pointSize;
		}
	}

	if (nextState.particleCount !== undefined) {
		const nextCount = clampParticleCount(nextState.particleCount);
		if (nextCount !== state.particleCount) {
			state.particleCount = nextCount;
			rebuildSimulationForParticleCount(nextCount);
		}
	}

	if (typeof nextState.wireframe === 'boolean') {
		state.wireframe = nextState.wireframe;
	}

	if (shouldRebuildWord) {
		rebuildTextTargets(state.word);
	}

	if (runtime.canvas) {
		applyVisualState(runtime.canvas);
	}
}

export const secondCanvasScript = {
	id: 'second',
	label: 'up to half a million circular particles flying. scroll to zoom in and out',
	init({ canvas }) {
		canvas.dataset.engine = 'three';
		applyVisualState(canvas);

		if (runtime.initialized) {
			return;
		}

		buildSimulation(canvas);

		if (state.frozen) {
			stopAnimation();
		} else {
			startAnimation();
		}
	},
	createControls({ currentState, onStateChange }) {
		const root = document.createElement('div');
		root.className = 'controls-group';
		root.innerHTML = `
			<label class="control-row">
				<span>word</span>
				<input type="text" maxlength="12" value="${currentState.word}" data-key="word" />
			</label>
			<label class="control-row">
				<span>particle count</span>
				<input type="range" min="5000" max="500000" step="1000" value="${currentState.particleCount}" data-key="particleCount" />
			</label>
			<label class="control-row">
				<span>point size</span>
				<input type="range" min="0.8" max="8" step="0.1" value="${currentState.pointSize}" data-key="pointSize" />
			</label>
		`;

		root.addEventListener('input', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement)) {
				return;
			}

			if (target.dataset.key === 'word') {
				onStateChange({ word: target.value });
			}

			if (target.dataset.key === 'pointSize') {
				onStateChange({ pointSize: Number(target.value) });
			}

			if (target.dataset.key === 'particleCount') {
				onStateChange({ particleCount: Number(target.value) });
			}
		});

		root.addEventListener('change', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement)) {
				return;
			}

			if (target.dataset.key === 'wireframe') {
				onStateChange({ wireframe: target.checked });
			}
		});

		return root;
	},
	getState() {
		return { ...state };
	},
	setState(nextState) {
		updateStateFromControls(nextState);
	},
	setFrozen(isFrozen) {
		state.frozen = isFrozen;
		if (runtime.canvas) {
			applyVisualState(runtime.canvas);
		}

		if (!runtime.initialized) {
			return;
		}

		if (isFrozen) {
			stopAnimation();
			return;
		}

		startAnimation();
	},
	setActive(isActive) {
		const canvas = document.getElementById('second');
		if (!canvas) {
			return;
		}

		canvas.style.filter = isActive ? 'brightness(1)' : 'brightness(0.84)';
	},
};
