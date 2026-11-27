import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { LiveSessionStatus, LiveVoiceName } from '../../hooks/useLiveVoiceSession';
import type { AvatarExpression } from '../../hooks/useAvatarExpression';
import {
  buildHologramTextures,
  type AvatarPresetId,
  type CustomFaceTraits,
} from '../../utils/hologramAvatar';
import { createParticleSpriteTexture } from './avatar3d/avatarTextures';
import {
  createArticulatedAvatarRig,
  type ArticulatedAvatarRig,
  type AvatarPoseInput,
} from './avatar3d/avatarRigBuilder';

interface LiveVoiceAvatarCanvasProps {
  status: LiveSessionStatus;
  voiceName: LiveVoiceName;
  levelsRef: React.MutableRefObject<{ input: number; output: number }>;
  avatarSrc: string;
  isPrestyledHologram: boolean;
  avatarPreset?: AvatarPresetId;
  customTraits?: CustomFaceTraits;
  expression?: AvatarExpression;
  expressionIntensity?: number;
  isStreaming?: boolean;
  isDark?: boolean;
  resetViewCounter?: number;
}

const STATUS_ACCENT_COLORS: Record<LiveSessionStatus, number> = {
  idle: 0x38bdf8,
  connecting: 0xfbbf24,
  listening: 0x10b981,
  speaking: 0x22d3ee,
  muted: 0x818cf8,
  error: 0x60a5fa,
};

// Pre-allocated expression accent targets (zero GC inside animation loop)
const EXPRESSION_JOYFUL_COLOR = new THREE.Color(0x10b981);
const EXPRESSION_ANALYTICAL_COLOR = new THREE.Color(0x6366f1);
const EXPRESSION_THINKING_COLOR = new THREE.Color(0xfbbf24);

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = debugExt
      ? String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || '')
      : String(gl.getParameter(gl.RENDERER) || '');
    const loseExt = gl.getExtension('WEBGL_lose_context');
    if (loseExt) loseExt.loseContext();
    return /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(rendererStr);
  } catch {
    return true;
  }
}

function createPlaceholderTexture(fillHex: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 4;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = fillHex;
    ctx.fillRect(0, 0, 4, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Custom photo portrait shaders. বাংলা মন্তব্য: ছবির ওপর কৃত্রিম চোখ/ঠোঁট/পলক আঁকা হয় না —
// নির্দিষ্ট জায়গায় আঁকা ফিচার আসল মুখের সঙ্গে না মিললে অদ্ভুত দেখায়। ছবি অক্ষুণ্ণ থাকে; শুধু
// মাথার নড়াচড়া, কথা বলার সময় হালকা ঢেউ, কিনারার আলো আর স্ক্যান-রেখা যোগ হয়।
const HOLOGRAM_VERTEX_SHADER = /* glsl */ `
  uniform sampler2D uDepthMap;
  uniform float uTime;
  uniform float uSpeakEnergy;
  uniform float uDepthScale;

  varying vec2 vUv;
  varying float vDepth;
  varying vec3 vViewPos;

  void main() {
    vUv = uv;
    float depth = texture2D(uDepthMap, uv).r;
    vDepth = depth;

    vec3 pos = position;
    pos.z -= (pos.x * pos.x) * 0.24;
    pos.z += depth * uDepthScale;

    float voiceWave = sin(uv.y * 22.0 - uTime * 8.5) * 0.006 * uSpeakEnergy * depth;
    pos.z += voiceWave;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const HOLOGRAM_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uColorMap;
  uniform sampler2D uDepthMap;
  uniform float uTime;
  uniform float uSpeakEnergy;
  uniform float uListenEnergy;
  uniform vec3 uAccentColor;

  varying vec2 vUv;
  varying float vDepth;
  varying vec3 vViewPos;

  void main() {
    vec4 tex = texture2D(uColorMap, vUv);
    if (tex.a < 0.015) discard;

    float eps = 0.004;
    float dL = texture2D(uDepthMap, vUv - vec2(eps, 0.0)).r;
    float dR = texture2D(uDepthMap, vUv + vec2(eps, 0.0)).r;
    float dD = texture2D(uDepthMap, vUv - vec2(0.0, eps)).r;
    float dU = texture2D(uDepthMap, vUv + vec2(0.0, eps)).r;
    vec3 surfNormal = normalize(vec3((dL - dR) * 2.8, (dD - dU) * 2.8, 0.65));
    vec3 viewDir = normalize(vViewPos);
    float fresnel = pow(1.0 - clamp(abs(dot(surfNormal, viewDir)), 0.0, 1.0), 2.1);

    float fineScan = 0.93 + 0.07 * sin(vUv.y * 320.0 - uTime * 3.2);
    float sweepY = fract(uTime * 0.19);
    float sweepBand = exp(-pow((vUv.y - sweepY) * 14.0, 2.0)) * (0.24 + uSpeakEnergy * 0.4);

    vec3 violetTint = vec3(0.56, 0.38, 1.0);
    vec3 rimGlow = mix(uAccentColor, violetTint, fresnel * 0.45) * (fresnel * (0.62 + uSpeakEnergy * 0.6));

    vec3 color = tex.rgb * fineScan;
    color += rimGlow * 0.7;
    color += uAccentColor * (sweepBand * 0.28 + uListenEnergy * 0.1);


    float edgeX = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
    float edgeY = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
    float alpha = clamp(tex.a * edgeX * edgeY * (0.94 + fresnel * 0.25 + sweepBand * 0.2), 0.0, 1.0);

    gl_FragColor = vec4(color, alpha);
  }
`;

const RING_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uOffset;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uEnergy;
  varying vec2 vUv;

  void main() {
    float angle = fract(vUv.x - uTime * uSpeed + uOffset);
    float arc1 = smoothstep(0.0, 0.12, angle) * smoothstep(0.68, 0.16, angle);
    float arc2 = smoothstep(0.52, 0.64, angle) * smoothstep(0.95, 0.68, angle) * 0.6;
    float baseTrail = 0.14;
    float intensity = baseTrail + arc1 * (0.75 + uEnergy * 0.8) + arc2 * (0.55 + uEnergy * 0.55);

    vec3 col = mix(uColorA, uColorB, 0.5 + 0.5 * sin(vUv.x * 6.28318 + uTime));
    float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
    core = pow(clamp(core, 0.0, 1.0), 1.4);

    float alpha = clamp(intensity * core * (0.62 + uEnergy * 0.35), 0.0, 1.0);
    gl_FragColor = vec4(col * (1.0 + intensity * 0.42), alpha);
  }
`;

export const LiveVoiceAvatarCanvas: React.FC<LiveVoiceAvatarCanvasProps> = ({
  status,
  voiceName,
  levelsRef,
  avatarSrc,
  isPrestyledHologram,
  avatarPreset = 'female',
  customTraits,
  expression = 'neutral',
  expressionIntensity = 0.65,
  isStreaming = false,
  isDark = true,
  resetViewCounter = 0,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<LiveSessionStatus>(status);
  const voiceRef = useRef<LiveVoiceName>(voiceName);
  const presetRef = useRef<AvatarPresetId>(avatarPreset);
  const expressionRef = useRef<AvatarExpression>(expression);
  const expressionIntensityRef = useRef<number>(expressionIntensity);
  const isStreamingRef = useRef<boolean>(isStreaming);
  const isDarkRef = useRef<boolean>(isDark);
  const [contextLost, setContextLost] = useState(false);

  statusRef.current = status;
  voiceRef.current = voiceName;
  presetRef.current = avatarPreset;
  expressionRef.current = expression;
  expressionIntensityRef.current = expressionIntensity;
  isStreamingRef.current = isStreaming;
  isDarkRef.current = isDark;

  const sceneRefs = useRef<{
    renderer: THREE.WebGLRenderer;
    rigAnchor: THREE.Group;
    customBustMesh: THREE.Mesh;
    hologramMat: THREE.ShaderMaterial;
    activeRig: ArticulatedAvatarRig | null;
    controls: OrbitControls;
    camera: THREE.PerspectiveCamera;
    reactTrigger: () => void;
  } | null>(null);

  const activeTexturesRef = useRef<{
    color: THREE.CanvasTexture | null;
    depth: THREE.CanvasTexture | null;
  }>({ color: null, depth: null });

  // Reset camera framing when parent increments resetViewCounter
  useEffect(() => {
    if (resetViewCounter === 0 || !sceneRefs.current) return;
    const { camera, controls } = sceneRefs.current;
    camera.position.set(0, 0.14, 2.75);
    controls.target.set(0, 0.02, 0);
    controls.update();
  }, [resetViewCounter]);

  // Initialize Three.js Studio + Hologram Stage once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = Math.max(container.clientWidth, 120);
    const height = Math.max(container.clientHeight, 120);

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 30);
    camera.position.set(0, 0.14, 2.75);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.background = 'transparent';
    container.appendChild(renderer.domElement);

    // RoomEnvironment PBR Studio Reflections (identical intensity across GPU & Software WebGL)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.72;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // 3-Point Warm/Cool Studio Portrait Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.25);
    keyLight.position.set(1.85, 2.4, 3.1);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 10;
    }
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.78);
    fillLight.position.set(-2.3, 0.75, 2.2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x22d3ee, 1.35);
    rimLight.position.set(0.2, 1.6, -2.5);
    scene.add(rimLight);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.02, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.9;
    controls.maxDistance = 3.8;
    controls.minPolarAngle = Math.PI * 0.26;
    controls.maxPolarAngle = Math.PI * 0.68;
    controls.minAzimuthAngle = -Math.PI * 0.48;
    controls.maxAzimuthAngle = Math.PI * 0.48;
    controls.update();

    const hologramGroup = new THREE.Group();
    scene.add(hologramGroup);

    const rigAnchor = new THREE.Group();
    hologramGroup.add(rigAnchor);

    // Custom Uploaded Portrait Shader Mesh (shown only when preset === 'custom')
    const initColorTex = createPlaceholderTexture('#000000');
    const initDepthTex = createPlaceholderTexture('#808080');
    activeTexturesRef.current = { color: initColorTex, depth: initDepthTex };

    const hologramMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorMap: { value: initColorTex },
        uDepthMap: { value: initDepthTex },
        uTime: { value: 0 },
        uSpeakEnergy: { value: 0 },
        uListenEnergy: { value: 0 },
        uDepthScale: { value: 0.16 },
        uAccentColor: { value: new THREE.Color(STATUS_ACCENT_COLORS.idle) },
      },
      vertexShader: HOLOGRAM_VERTEX_SHADER,
      fragmentShader: HOLOGRAM_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const customBustGeo = new THREE.PlaneGeometry(1.78, 1.78, 96, 96);
    const customBustMesh = new THREE.Mesh(customBustGeo, hologramMat);
    customBustMesh.position.set(0, 0.04, 0);
    customBustMesh.visible = false;
    hologramGroup.add(customBustMesh);

    // Female/Male presets mount their 3D rig immediately. The custom photo portrait (or its trait-rig
    // fallback) is mounted by the swap effect below, so no mismatched rig flashes on first paint.
    const maxAnisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const activeRig: ArticulatedAvatarRig | null =
      presetRef.current === 'custom'
        ? null
        : createArticulatedAvatarRig({
            isFemale: presetRef.current !== 'male',
            maxAnisotropy,
          });
    if (activeRig) rigAnchor.add(activeRig.root);

    // Subtle Holographic Orbit Rings framing the lower bust cleanly (never crossing over the face)
    const ringConfigs = [
      { radius: 1.06, tube: 0.006, rx: 1.44, rz: 0.14, y: -0.56, speed: 0.18, offset: 0.0 },
      { radius: 1.16, tube: 0.005, rx: 1.49, rz: -0.16, y: -0.68, speed: -0.15, offset: 0.42 },
    ];
    const ringMaterials: THREE.ShaderMaterial[] = [];
    const ringMeshes: THREE.Mesh[] = [];
    const ringAnchor = new THREE.Group();
    hologramGroup.add(ringAnchor);

    ringConfigs.forEach((cfg) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: cfg.speed },
          uOffset: { value: cfg.offset },
          uColorA: { value: new THREE.Color(0x22d3ee) },
          uColorB: { value: new THREE.Color(0x8b5cf6) },
          uEnergy: { value: 0 },
        },
        vertexShader: RING_VERTEX_SHADER,
        fragmentShader: RING_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(cfg.radius, cfg.tube, 10, 96), mat);
      mesh.rotation.x = cfg.rx;
      mesh.rotation.z = cfg.rz;
      mesh.position.y = cfg.y;
      ringAnchor.add(mesh);
      ringMaterials.push(mat);
      ringMeshes.push(mesh);
    });

    // Subtle Holographic Pedestal Base Ring
    const baseEmitterGeo = new THREE.RingGeometry(0.46, 0.51, 64);
    const baseEmitterMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const baseEmitter = new THREE.Mesh(baseEmitterGeo, baseEmitterMat);
    baseEmitter.rotation.x = -Math.PI / 2;
    baseEmitter.position.y = -0.98;
    hologramGroup.add(baseEmitter);

    // Ambient Floating Hologram Micro-Particles
    const particleCount = 110;
    const pPositions = new Float32Array(particleCount * 3);
    const pPhases = new Float32Array(particleCount);
    const pRadii = new Float32Array(particleCount);
    const pBaseY = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 * 3;
      const r = 0.62 + (i % 9) * 0.085;
      const y = -0.82 + ((i * 13) % 41) * 0.038;
      pRadii[i] = r;
      pPhases[i] = angle;
      pBaseY[i] = y;
      pPositions[i * 3] = Math.cos(angle) * r;
      pPositions[i * 3 + 1] = y;
      pPositions[i * 3 + 2] = Math.sin(angle) * r * 0.65;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    const particleSpriteTex = createParticleSpriteTexture();
    const particleMat = new THREE.PointsMaterial({
      map: particleSpriteTex,
      color: 0x38bdf8,
      size: 0.048,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particleCloud = new THREE.Points(particleGeo, particleMat);
    hologramGroup.add(particleCloud);

    // Facial Reaction State Machine (pointer gaze + blinking + micro-saccades + click smile/nod)
    const pointerNdc = { x: 0, y: 0, active: false };
    let pointerDownPt = { x: 0, y: 0 };
    let reactionTimer = 0;

    const triggerFriendlyReaction = () => {
      reactionTimer = 1.45;
    };

    sceneRefs.current = {
      renderer,
      rigAnchor,
      customBustMesh,
      hologramMat,
      activeRig,
      controls,
      camera,
      reactTrigger: triggerFriendlyReaction,
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const handlePointerMove = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerNdc.active = true;
      pointerNdc.x = THREE.MathUtils.clamp(((ev.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      pointerNdc.y = THREE.MathUtils.clamp(
        -(((ev.clientY - rect.top) / rect.height) * 2 - 1),
        -1,
        1
      );
    };
    const handlePointerLeave = () => {
      pointerNdc.active = false;
      pointerNdc.x = 0;
      pointerNdc.y = 0;
    };
    const handlePointerDown = (ev: PointerEvent) => {
      pointerDownPt = { x: ev.clientX, y: ev.clientY };
    };
    const handlePointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - pointerDownPt.x, ev.clientY - pointerDownPt.y);
      // Clean click/tap without dragging orbits triggers friendly smile + blink + nod
      if (moved < 6) {
        triggerFriendlyReaction();
      }
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(Math.floor(entry.contentRect.width), 80);
        const h = Math.max(Math.floor(entry.contentRect.height), 80);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      }
    });
    resizeObserver.observe(container);

    let lastTime = performance.now();
    let elapsed = 0;
    let smoothOutput = 0;
    let smoothInput = 0;
    let smoothLookX = 0;
    let smoothLookY = 0;
    let smoothJaw = 0;
    let smoothOh = 0;
    let smoothSmile = 0.14;
    let smoothBrow = 0;
    let smoothBrowKnit = 0;
    let smoothEyeSquint = 0;
    let smoothYaw = 0;
    let smoothPitch = 0;
    let smoothRoll = 0;

    // Natural randomized blink scheduler
    let nextBlinkAt = 1.4;
    let blinkClock = -1;
    let doubleBlinkQueued = false;

    // Micro-saccade subtle eye life
    let nextSaccadeAt = 0.8;
    let saccadeOffsetX = 0;
    let saccadeOffsetY = 0;

    let disposed = false;
    let rafId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const gl = renderer.getContext() as WebGL2RenderingContext;

    const targetAccent = new THREE.Color(STATUS_ACCENT_COLORS.idle);
    const currentAccent = new THREE.Color(STATUS_ACCENT_COLORS.idle);

    // Pre-allocated pose object reused every frame (zero heap GC in tick)
    const poseFrame: AvatarPoseInput = {
      elapsed: 0,
      dt: 0,
      speakEnergy: 0,
      listenEnergy: 0,
      lookX: 0,
      lookY: 0,
      blinkAmount: 0,
      jawOpen: 0,
      visemeOh: 0,
      smileAmount: 0,
      browRaise: 0,
      browAsym: 0,
      browKnit: 0,
      eyeSquint: 0,
      headYaw: 0,
      headPitch: 0,
      headRoll: 0,
      bodyBreath: 0,
      accentColor: currentAccent,
      isMuted: false,
      isConnecting: false,
    };

    const afterDraw = (fn: () => void) => {
      if (disposed) return;
      if (isSoftwareGl) {
        if (typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          if (sync) gl.deleteSync(sync);
        }
        timerId = setTimeout(() => {
          if (!disposed) rafId = requestAnimationFrame(fn);
        }, 36);
      } else {
        rafId = requestAnimationFrame(fn);
      }
    };

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.08);
      lastTime = now;
      elapsed += dt;

      const curStatus = statusRef.current;
      const curExpression = expressionRef.current;
      const exprStrength = THREE.MathUtils.clamp(expressionIntensityRef.current || 0.65, 0.25, 1);

      targetAccent.setHex(STATUS_ACCENT_COLORS[curStatus] ?? STATUS_ACCENT_COLORS.idle);
      if (curExpression === 'joyful' || curExpression === 'happy') {
        targetAccent.lerp(EXPRESSION_JOYFUL_COLOR, 0.42 * exprStrength);
      } else if (curExpression === 'analytical') {
        targetAccent.lerp(EXPRESSION_ANALYTICAL_COLOR, 0.55 * exprStrength);
      } else if (curExpression === 'thinking') {
        targetAccent.lerp(EXPRESSION_THINKING_COLOR, 0.32 * exprStrength);
      }
      currentAccent.lerp(targetAccent, Math.min(1, dt * 5));
      rimLight.color.copy(currentAccent);

      const streamingActive = isStreamingRef.current;
      const rawOutput = levelsRef.current.output || 0;
      const rawInput = levelsRef.current.input || 0;
      const effectiveOutput = streamingActive ? Math.max(rawOutput, 0.42) : rawOutput;
      smoothOutput = THREE.MathUtils.damp(smoothOutput, effectiveOutput, 18, dt);
      smoothInput = THREE.MathUtils.damp(smoothInput, rawInput, 14, dt);

      const speakEnergy =
        curStatus === 'speaking' || streamingActive ? Math.max(0.22, smoothOutput) : smoothOutput;
      const listenEnergy = curStatus === 'listening' ? Math.max(0.18, smoothInput) : smoothInput;
      const isSpeaking = speakEnergy > 0.06;

      if (reactionTimer > 0) {
        reactionTimer = Math.max(0, reactionTimer - dt);
      }
      const clickReact = reactionTimer > 0 ? Math.sin((reactionTimer / 1.45) * Math.PI) : 0;

      // --- 1. Natural Blink Timeline (every 2.4 - 5.2s, occasional double blink, or click-triggered) ---
      if (reactionTimer > 1.38 && blinkClock < 0) {
        blinkClock = 0;
        doubleBlinkQueued = false;
      }
      if (blinkClock < 0 && elapsed >= nextBlinkAt) {
        blinkClock = 0;
        doubleBlinkQueued = Math.random() < 0.18;
      }
      let blinkAmount = 0;
      if (blinkClock >= 0) {
        blinkClock += dt;
        const blinkDur = 0.19;
        if (blinkClock < blinkDur) {
          const t = blinkClock / blinkDur;
          // Crisp eyelid snap close (fast down, smooth lift)
          blinkAmount =
            t < 0.36
              ? Math.sin((t / 0.36) * (Math.PI / 2))
              : Math.cos(((t - 0.36) / 0.64) * (Math.PI / 2));
        } else {
          blinkClock = -1;
          nextBlinkAt = doubleBlinkQueued ? elapsed + 0.14 : elapsed + 2.3 + Math.random() * 2.9;
          doubleBlinkQueued = false;
        }
      }

      // --- 2. Living Eye Gaze + Micro-Saccades ---
      if (elapsed >= nextSaccadeAt) {
        nextSaccadeAt = elapsed + 0.9 + Math.random() * 1.9;
        saccadeOffsetX = (Math.random() - 0.5) * 0.16;
        saccadeOffsetY = (Math.random() - 0.5) * 0.1;
      }
      let targetLookX = pointerNdc.active ? pointerNdc.x * 0.82 : saccadeOffsetX;
      let targetLookY = pointerNdc.active ? pointerNdc.y * 0.72 : saccadeOffsetY;
      if (curStatus === 'connecting' || curExpression === 'thinking') {
        targetLookX += 0.24;
        targetLookY += 0.2;
      } else if (curExpression === 'analytical' && !pointerNdc.active) {
        // Focused horizontal reading/code-scanning eye saccades
        targetLookX += Math.sin(elapsed * 1.55) * 0.22;
        targetLookY -= 0.14 + Math.cos(elapsed * 0.95) * 0.04;
      } else if (curStatus === 'listening' && !pointerNdc.active) {
        targetLookX *= 0.45;
        targetLookY *= 0.45;
      }
      smoothLookX = THREE.MathUtils.damp(smoothLookX, targetLookX, 11, dt);
      smoothLookY = THREE.MathUtils.damp(smoothLookY, targetLookY, 11, dt);

      // --- 3. Lip & Jaw Speech Articulation (Crisp Syllable & Vowel Viseme Modulation) ---
      let targetJaw = 0;
      let targetOh = 0;
      if (isSpeaking) {
        // Blend crisp syllable cadence with live audio amplitude for fluid, natural lip motion
        const syllable =
          0.46 +
          0.34 * Math.sin(elapsed * 13.8) +
          0.16 * Math.sin(elapsed * 21.4 + 1.1) +
          0.1 * Math.cos(elapsed * 7.8);
        targetJaw = THREE.MathUtils.clamp(
          speakEnergy * Math.max(0.08, syllable) * 0.72,
          0.05,
          0.62
        );
        const ohCycle = Math.max(0, Math.sin(elapsed * 7.2 + 0.7));
        targetOh = THREE.MathUtils.clamp(speakEnergy * ohCycle * 0.56, 0, 0.52);
      } else if (curStatus === 'listening') {
        targetJaw = 0.015;
      }
      smoothJaw = THREE.MathUtils.damp(smoothJaw, targetJaw, 24, dt);
      smoothOh = THREE.MathUtils.damp(smoothOh, targetOh, 18, dt);

      // --- 4. Smile, Focus & Eyebrow Expression ---
      const isPositiveExpr = curExpression === 'joyful' || curExpression === 'happy';
      const exprSmileBoost = isPositiveExpr
        ? 0.56 * exprStrength
        : curExpression === 'analytical'
          ? -0.09
          : curExpression === 'thinking'
            ? -0.06
            : 0;
      const targetSmile = THREE.MathUtils.clamp(
        0.15 +
          exprSmileBoost +
          (curStatus === 'listening' ? 0.18 : 0) +
          (isSpeaking ? 0.12 * (1 - smoothOh) : 0) +
          clickReact * 0.65 -
          (curStatus === 'muted' ? 0.1 : 0),
        0,
        0.9
      );
      smoothSmile = THREE.MathUtils.damp(smoothSmile, targetSmile, 8, dt);

      const targetBrow =
        (isSpeaking ? Math.max(0, Math.sin(elapsed * 3.6)) * speakEnergy * 0.55 : 0) +
        (curStatus === 'listening' ? 0.22 + listenEnergy * 0.25 : 0) +
        (isPositiveExpr ? 0.28 * exprStrength : 0) +
        clickReact * 0.45;
      smoothBrow = THREE.MathUtils.damp(smoothBrow, targetBrow, 9, dt);

      const targetBrowKnit = curExpression === 'analytical' ? 0.52 * exprStrength : 0;
      const targetEyeSquint = curExpression === 'analytical' ? 0.34 * exprStrength : 0;
      smoothBrowKnit = THREE.MathUtils.damp(smoothBrowKnit, targetBrowKnit, 8, dt);
      smoothEyeSquint = THREE.MathUtils.damp(smoothEyeSquint, targetEyeSquint, 8, dt);

      const browAsym =
        curExpression === 'analytical'
          ? 0.62 * exprStrength + Math.sin(elapsed * 1.15) * 0.14
          : curExpression === 'thinking'
            ? 0.52 + Math.sin(elapsed * 1.4) * 0.18
            : curStatus === 'listening'
              ? Math.sin(elapsed * 1.1) * 0.45
              : Math.sin(elapsed * 0.6) * 0.15;

      // --- 5. Grounded Head, Neck & Breathing Motion (keep skull steady during speech; animate lips & eyes) ---
      const breath = Math.sin(elapsed * 1.4);
      const targetYaw =
        smoothLookX * 0.22 +
        (isSpeaking ? Math.sin(elapsed * 1.05) * 0.035 : Math.sin(elapsed * 0.5) * 0.03);
      const targetPitch =
        -smoothLookY * 0.12 +
        (curExpression === 'analytical' ? 0.035 : isPositiveExpr ? -0.02 : 0) +
        (isSpeaking
          ? Math.sin(elapsed * 1.25) * 0.016
          : curStatus === 'listening'
            ? -0.018 + Math.sin(elapsed * 1.3) * 0.014
            : Math.sin(elapsed * 0.65) * 0.01) +
        clickReact * 0.07 * Math.sin(elapsed * 6.5);
      const targetRoll =
        (curExpression === 'analytical' ? -0.055 * exprStrength : 0) +
        (curExpression === 'thinking' ? 0.07 : 0) +
        (isPositiveExpr ? Math.sin(elapsed * 1.4) * 0.03 : 0) +
        (curStatus === 'listening' ? 0.05 : Math.sin(elapsed * 0.45) * 0.022) +
        (isSpeaking ? Math.sin(elapsed * 1.15) * 0.02 : 0);

      smoothYaw = THREE.MathUtils.damp(smoothYaw, targetYaw, 5, dt);
      smoothPitch = THREE.MathUtils.damp(smoothPitch, targetPitch, 5.5, dt);
      smoothRoll = THREE.MathUtils.damp(smoothRoll, targetRoll, 5, dt);

      // Apply pose to active articulated 3D rig (if 'female' or 'male')
      const curRig = sceneRefs.current?.activeRig;
      if (curRig) {
        poseFrame.elapsed = elapsed;
        poseFrame.dt = dt;
        poseFrame.speakEnergy = speakEnergy;
        poseFrame.listenEnergy = listenEnergy;
        poseFrame.lookX = smoothLookX;
        poseFrame.lookY = smoothLookY;
        poseFrame.blinkAmount = blinkAmount;
        poseFrame.jawOpen = smoothJaw;
        poseFrame.visemeOh = smoothOh;
        poseFrame.smileAmount = smoothSmile;
        poseFrame.browRaise = smoothBrow;
        poseFrame.browAsym = browAsym;
        poseFrame.browKnit = smoothBrowKnit;
        poseFrame.eyeSquint = smoothEyeSquint;
        poseFrame.headYaw = smoothYaw;
        poseFrame.headPitch = smoothPitch;
        poseFrame.headRoll = smoothRoll;
        poseFrame.bodyBreath = breath;
        poseFrame.accentColor = currentAccent;
        poseFrame.isMuted = curStatus === 'muted';
        poseFrame.isConnecting = curStatus === 'connecting';
        curRig.applyPose(poseFrame);
      }

      // Apply pose to custom photo hologram shader (if preset === 'custom')
      if (customBustMesh.visible) {
        hologramMat.uniforms.uTime.value = elapsed;
        hologramMat.uniforms.uSpeakEnergy.value = speakEnergy;
        hologramMat.uniforms.uListenEnergy.value = listenEnergy;
        hologramMat.uniforms.uAccentColor.value.copy(currentAccent);

        // বাংলা মন্তব্য: কথা বলার সময় হালকা মাথা নাড়া ও শ্বাসের মতো ছোট স্কেল — মুখ বিকৃত না করে প্রাণবন্ত।
        customBustMesh.rotation.y = smoothYaw * 0.55;
        customBustMesh.rotation.x = smoothPitch * 0.5 - smoothJaw * 0.04;
        customBustMesh.rotation.z = smoothRoll * 0.4;
        customBustMesh.scale.setScalar(1 + breath * 0.012 + speakEnergy * 0.015);
      }

      // Orbiting light rings & particles respond dynamically to speech & listening
      const ringEnergy = Math.max(speakEnergy, listenEnergy * 0.65);
      ringAnchor.rotation.y += dt * (0.14 + ringEnergy * 0.55);
      for (let i = 0; i < ringMaterials.length; i++) {
        ringMaterials[i].uniforms.uTime.value = elapsed;
        ringMaterials[i].uniforms.uEnergy.value = ringEnergy;
        ringMaterials[i].uniforms.uColorA.value.copy(currentAccent);
        const pulseScale = 1 + ringEnergy * (0.045 + i * 0.02) * Math.sin(elapsed * 4 + i);
        ringMeshes[i].scale.setScalar(pulseScale);
      }

      baseEmitterMat.color.copy(currentAccent);
      baseEmitterMat.opacity = 0.22 + ringEnergy * 0.32;

      particleMat.color.copy(currentAccent);
      particleMat.opacity = 0.45 + ringEnergy * 0.38;
      particleCloud.rotation.y += dt * (0.16 + ringEnergy * 0.42);

      const posAttr = particleGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < particleCount; i++) {
        const yOff = Math.sin(elapsed * 1.2 + pPhases[i]) * 0.035;
        const rPulse = pRadii[i] * (1 + ringEnergy * 0.09);
        const ang = pPhases[i] + elapsed * 0.12;
        posAttr.setX(i, Math.cos(ang) * rPulse);
        posAttr.setZ(i, Math.sin(ang) * rPulse * 0.68);
        posAttr.setY(i, pBaseY[i] + yOff);
      }
      posAttr.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);
      afterDraw(tick);
    };

    afterDraw(tick);

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();

      if (sceneRefs.current?.activeRig) {
        sceneRefs.current.activeRig.dispose();
        sceneRefs.current.activeRig = null;
      }
      sceneRefs.current = null;

      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints) {
          const renderable = obj as THREE.Mesh | THREE.Points;
          renderable.geometry.dispose();
          if (Array.isArray(renderable.material)) {
            renderable.material.forEach((m) => m.dispose());
          } else {
            renderable.material.dispose();
          }
        }
      });

      envTarget.dispose();
      activeTexturesRef.current.color?.dispose();
      activeTexturesRef.current.depth?.dispose();
      particleSpriteTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [levelsRef]);

  // Swap cleanly between Female/Male 3D rigs and the uploaded photo portrait without recreating WebGLRenderer.
  // বাংলা মন্তব্য: নিজের ছবি বাছলে আর কৃত্রিম 3D মাথার ওপর ছবি বসানো হয় না (চোখ/ঠোঁট/চুল দুবার
  // দেখা যেত)। ছবিটাই নরম কিনারার 3D পোর্ট্রেট হিসেবে দেখায়; ছবি না থাকলে তবেই 3D রিগ।
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    let cancelled = false;

    const maxAnisotropy = Math.min(4, refs.renderer.capabilities.getMaxAnisotropy());
    const unmountRig = () => {
      if (refs.activeRig) {
        refs.rigAnchor.remove(refs.activeRig.root);
        refs.activeRig.dispose();
        refs.activeRig = null;
      }
    };
    const mountRig = (nextRig: ArticulatedAvatarRig) => {
      unmountRig();
      refs.customBustMesh.visible = false;
      refs.rigAnchor.add(nextRig.root);
      refs.activeRig = nextRig;
    };
    const mountTraitRig = () =>
      mountRig(
        createArticulatedAvatarRig({
          isFemale: customTraits?.genderCue === 'female',
          maxAnisotropy,
          customTraits,
        })
      );

    if (avatarPreset !== 'custom') {
      mountRig(createArticulatedAvatarRig(avatarPreset !== 'male', maxAnisotropy));
      refs.reactTrigger();
      return;
    }

    if (!avatarSrc) {
      mountTraitRig();
      return;
    }

    buildHologramTextures(avatarSrc, isPrestyledHologram)
      .then(({ colorCanvas, depthCanvas }) => {
        if (cancelled || !sceneRefs.current) return;
        const colorTex = new THREE.CanvasTexture(colorCanvas);
        // ShaderMaterial writes raw values — keep the photo's sRGB bytes untouched for true colours
        colorTex.colorSpace = THREE.NoColorSpace;
        colorTex.anisotropy = maxAnisotropy;
        const depthTex = new THREE.CanvasTexture(depthCanvas);
        depthTex.colorSpace = THREE.NoColorSpace;

        activeTexturesRef.current.color?.dispose();
        activeTexturesRef.current.depth?.dispose();
        activeTexturesRef.current = { color: colorTex, depth: depthTex };
        refs.hologramMat.uniforms.uColorMap.value = colorTex;
        refs.hologramMat.uniforms.uDepthMap.value = depthTex;

        unmountRig();
        refs.customBustMesh.visible = true;
        refs.reactTrigger();
      })
      .catch(() => {
        // Image decode failed → fall back to a trait-matched 3D rig (no photo projection)
        if (!cancelled && sceneRefs.current) mountTraitRig();
      });

    return () => {
      cancelled = true;
    };
  }, [avatarPreset, avatarSrc, customTraits, isPrestyledHologram]);

  return (
    <div
      ref={mountRef}
      data-testid="live-voice-3d-canvas"
      title="Drag to orbit · Move cursor for eye tracking · Click to smile & nod"
      className="w-full h-full relative select-none touch-none cursor-grab active:cursor-grabbing bg-transparent"
    >
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-cyan-300 pointer-events-none">
          Restoring 3D avatar viewport...
        </div>
      )}
    </div>
  );
};
