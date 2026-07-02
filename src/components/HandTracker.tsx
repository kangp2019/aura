import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { 
  Camera, CameraOff, Sparkles, RefreshCw, Volume2, VolumeX, 
  Trash2, Download, Zap, MousePointer, Hand, Sliders, Palette
} from 'lucide-react';
import { synth } from '../lib/synth';

// Available brush colors
export const BRUSH_COLORS = [
  { name: 'Neon Green', value: '#00FF5F', shadow: 'rgba(0, 255, 95, 0.5)' },
  { name: 'Laser Pink', value: '#FF007F', shadow: 'rgba(255, 0, 127, 0.5)' },
  { name: 'Cyber Cyan', value: '#00F0FF', shadow: 'rgba(0, 240, 255, 0.5)' },
  { name: 'Matrix Yellow', value: '#FFDF00', shadow: 'rgba(255, 223, 0, 0.5)' },
  { name: 'Sun Orange', value: '#FF6A00', shadow: 'rgba(255, 106, 0, 0.5)' },
  { name: 'Rainbow', value: 'rainbow', shadow: 'rgba(255, 255, 255, 0.5)' }
];

// Brush presets
export const BRUSH_STYLES = [
  { id: 'neon', name: 'Neon Glow', icon: '✨' },
  { id: 'stars', name: 'Star Particles', icon: '⭐' },
  { id: 'bubbles', name: 'Soap Bubbles', icon: '🫧' },
  { id: 'fireworks', name: 'Magic Sparkler', icon: '🎇' },
  { id: 'squares', name: 'Digital Blocks', icon: '⏹️' },
  { id: 'ribbon', name: 'Fluid Ribbon', icon: '🎗️' }
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  maxLife: number;
  life: number;
  type: string;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
  speed: number;
}

interface HandTrackerProps {
  onStatsUpdate: (stats: {
    fps: number;
    handsDetected: number;
    pinchDistance: number;
    isPinching: boolean;
    gestureMode: 'DRAWING' | 'COLOR_PORTAL' | 'NO_HANDS' | 'SIMULATING';
    lastCoords: { x: number; y: number };
    portalSize: { width: number; height: number };
  }) => void;
}

export default function HandTracker({ onStatsUpdate }: HandTrackerProps) {
  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const lastDrawingPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastH1PointRef = useRef<{ x: number; y: number } | null>(null);
  const lastH2PointRef = useRef<{ x: number; y: number } | null>(null);
  const wasH2PinchingRef = useRef<boolean>(false);

  // App Settings States
  const [activeColor, setActiveColor] = useState(BRUSH_COLORS[0]);
  const [brushSize, setBrushSize] = useState<number>(6);
  const [brushStyle, setBrushStyle] = useState<string>('neon');
  const [pinchThreshold, setPinchThreshold] = useState<number>(0.04);
  const [grayscaleBackdrop, setGrayscaleBackdrop] = useState<number>(90); // grayscale percentage
  const [enableAudio, setEnableAudio] = useState<boolean>(false);
  const [showMesh, setShowMesh] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [foggyGlassMode, setFoggyGlassMode] = useState<boolean>(false);
  const [cameraFilter, setCameraFilter] = useState<'slate' | 'cyberpunk' | 'matrix' | 'thermal'>('slate');
  const [lightningFlash, setLightningFlash] = useState<boolean>(false);
  const [portalShape, setPortalShape] = useState<'rectangle' | 'heart' | 'circle'>('heart');
  const [showFlash, setShowFlash] = useState<boolean>(false);
  const [isWinking, setIsWinking] = useState<boolean>(false);
  const [showWebcamInfo, setShowWebcamInfo] = useState<boolean>(true);
  const [showSimInfo, setShowSimInfo] = useState<boolean>(true);

  // Periodic eye winking micro-animation effect
  useEffect(() => {
    const interval = setInterval(() => {
      setIsWinking(true);
      setTimeout(() => setIsWinking(false), 320);
    }, 3800);
    return () => clearInterval(interval);
  }, []);

  // Status & Simulator States
  const [loadingState, setLoadingState] = useState<string>('Initializing System...');
  const [loadingProgress, setLoadingProgress] = useState<number>(10);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [useSimulator, setUseSimulator] = useState<boolean>(false);
  const [simHandsMode, setSimHandsMode] = useState<'single' | 'double'>('single');

  // Simulator Interactive States
  const [simHand1, setSimHand1] = useState<{ x: number; y: number; isPinching: boolean }>({ x: 0.3, y: 0.5, isPinching: false });
  const [simHand2, setSimHand2] = useState<{ x: number; y: number; isPinching: boolean }>({ x: 0.7, y: 0.5, isPinching: false });
  const [activeDragSim, setActiveDragSim] = useState<'hand1' | 'hand2' | null>(null);

  // Live FPS and states for animation loop
  const fpsTracker = useRef<{ lastTime: number; frames: number; fps: number }>({ lastTime: performance.now(), frames: 0, fps: 0 });
  const particles = useRef<Particle[]>([]);
  const ripples = useRef<Ripple[]>([]);
  const waterDrops = useRef<Array<{ x: number; y: number; speed: number; size: number; trailWidth: number }>>([]);
  const wasPinchingRef = useRef<boolean>(false);
  const rainbowHue = useRef<number>(0);

  // Setup MediaPipe Hand Landmarker
  useEffect(() => {
    let active = true;

    async function loadModel() {
      try {
        setLoadingState('Connecting CDN WASM HandTracker...');
        setLoadingProgress(25);
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
        );

        if (!active) return;
        setLoadingState('Downloading Spatial Hand Grid Model...');
        setLoadingProgress(60);

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2
        });

        if (!active) return;
        handLandmarkerRef.current = landmarker;
        setLoadingState('Starting High-Speed Optical Capture...');
        setLoadingProgress(85);

        // Try getting Webcam
        const webcamSuccess = await initWebcam();

        if (active) {
          if (!webcamSuccess) {
            setCameraError('Webcam API rejected: Please allow camera access in frame or use Simulator.');
            setUseSimulator(true);
          }
          setIsReady(true);
          setLoadingProgress(100);
        }
      } catch (err: any) {
        console.warn('MediaPipe or environment loading info, defaulting to simulator:', err);
        if (active) {
          setCameraError(err?.message || 'WASM fileset not fully supported or webcam blocked.');
          setUseSimulator(true);
          setIsReady(true);
          setLoadingProgress(100);
        }
      }
    }

    loadModel();

    return () => {
      active = false;
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      synth.stop();
    };
  }, []);

  // Set up Webcam Stream
  const initWebcam = async () => {
    setCameraError(null);
    if (!videoRef.current) return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener('loadeddata', () => {
        videoRef.current?.play();
      });
      return true;
    } catch (err: any) {
      // Return false to let the caller handle it cleanly without raising uncaught exceptions
      return false;
    }
  };

  // Turn Camera On/Off Toggle
  const toggleCamera = async () => {
    if (useSimulator) {
      setUseSimulator(false);
      const success = await initWebcam();
      if (!success) {
        setCameraError('Webcam API rejected: Please allow camera access in frame or use Simulator.');
        setUseSimulator(true);
      }
    } else {
      setUseSimulator(true);
      // Stop current webcam tracks if any
      const src = videoRef.current?.srcObject as MediaStream | null;
      if (src) {
        src.getTracks().forEach(track => track.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      }
    }
  };

  // Setup Drawing Canvas Resolution Matcher
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const drawCanvas = drawingCanvasRef.current;
    if (!canvas || !drawCanvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const { width, height } = parent.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;

    // Preserve drawing canvas context while resizing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = drawCanvas.width;
    tempCanvas.height = drawCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.drawImage(drawCanvas, 0, 0);
    }

    drawCanvas.width = width;
    drawCanvas.height = height;

    const drawCtx = drawCanvas.getContext('2d');
    if (drawCtx && tempCanvas.width > 0) {
      drawCtx.drawImage(tempCanvas, 0, 0, width, height);
    }
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // Particle Spawner
  const spawnParticles = (x: number, y: number, colorVal: string) => {
    const activeColorHex = colorVal === 'rainbow' ? `hsl(${rainbowHue.current}, 90%, 60%)` : colorVal;
    
    if (brushStyle === 'bubbles') {
      // Spawns soap bubbles organically
      if (Math.random() < 0.28) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 0.8 + 0.2;
        particles.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: -Math.random() * 1.5 - 0.4, // Float up gently
          color: activeColorHex,
          size: Math.random() * 12 + 6, // Larger bubble size
          maxLife: Math.random() * 90 + 60,
          life: 0,
          type: 'bubbles'
        });
      }
    } else if (brushStyle === 'fireworks') {
      // Magic Sparkler / Burning embers
      const count = 4;
      for (let i = 0; i < count; i++) {
        const angle = -Math.random() * Math.PI - 0.1; // shoot upwards/outwards
        const speed = Math.random() * 2.8 + 1.2;
        particles.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 0.8,
          vy: Math.sin(angle) * speed - 0.5,
          color: Math.random() < 0.38 ? '#FFDF00' : (Math.random() < 0.5 ? '#FF6A00' : '#FF1A00'),
          size: Math.random() * 3 + 1.5,
          maxLife: Math.random() * 45 + 20,
          life: 0,
          type: 'fireworks'
        });
      }
    } else {
      const count = brushStyle === 'stars' ? 5 : 2;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2 + 1;
        particles.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.5, // float up
          color: activeColorHex,
          size: Math.random() * 4 + 2,
          maxLife: Math.random() * 20 + 15,
          life: 0,
          type: brushStyle
        });
      }
    }
  };

  // Draw continuous lines with gorgeous visual enhancements
  const drawSegment = (
    drawCtx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    color: string,
    style: string,
    size: number
  ) => {
    drawCtx.save();
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';

    if (foggyGlassMode) {
      // Wiping glass: erase the fog!
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.beginPath();
      drawCtx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
      drawCtx.lineWidth = size * 3.5; // Wider brush for wiping window fog, very satisfying!
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();
    } else if (style === 'bubbles') {
      // Soft soapy iridescent fluid trace
      drawCtx.save();
      drawCtx.beginPath();
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = size * 1.5;
      drawCtx.globalAlpha = 0.08;
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();

      drawCtx.beginPath();
      drawCtx.strokeStyle = '#FFFFFF';
      drawCtx.lineWidth = size * 0.4;
      drawCtx.globalAlpha = 0.15;
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();
      drawCtx.restore();
    } else if (style === 'fireworks') {
      // Glowing embers spark trail
      drawCtx.save();
      drawCtx.beginPath();
      drawCtx.strokeStyle = '#FF8800';
      drawCtx.lineWidth = size * 0.4;
      drawCtx.globalAlpha = 0.25;
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();
      drawCtx.restore();
    } else if (style === 'neon') {
      // 1. Wide halo glow layer
      drawCtx.beginPath();
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = size * 2.8;
      drawCtx.globalAlpha = 0.16;
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();

      // 2. Medium vibrant glow layer
      drawCtx.beginPath();
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = size * 1.4;
      drawCtx.globalAlpha = 0.45;
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();

      // 3. Bright high-contrast white core
      drawCtx.beginPath();
      drawCtx.strokeStyle = '#FFFFFF';
      drawCtx.lineWidth = size * 0.35;
      drawCtx.globalAlpha = 1.0;
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();
    } else if (style === 'ribbon') {
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const perpX = Math.sin(angle) * (size * 1.6);
      const perpY = -Math.cos(angle) * (size * 1.6);

      // Thread A (Offset left)
      drawCtx.beginPath();
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = size * 0.25;
      drawCtx.globalAlpha = 0.7;
      drawCtx.moveTo(p1.x - perpX, p1.y - perpY);
      drawCtx.lineTo(p2.x - perpX, p2.y - perpY);
      drawCtx.stroke();

      // Thread B (Main center)
      drawCtx.beginPath();
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = size * 0.6;
      drawCtx.globalAlpha = 1.0;
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();

      // Thread C (Offset right)
      drawCtx.beginPath();
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = size * 0.25;
      drawCtx.globalAlpha = 0.7;
      drawCtx.moveTo(p1.x + perpX, p1.y + perpY);
      drawCtx.lineTo(p2.x + perpX, p2.y + perpY);
      drawCtx.stroke();
    } else {
      // Default: Clean smooth solid line
      drawCtx.beginPath();
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = size;
      drawCtx.globalAlpha = 1.0;
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();
    }
    drawCtx.restore();
  };

  // Pinch Shockwave Ripple and Twinkle Starburst Spawner
  const triggerPinchBurst = (x: number, y: number, colorVal: string) => {
    const burstColor = colorVal === 'rainbow' ? `hsl(${rainbowHue.current}, 100%, 65%)` : colorVal;
    
    // Spawns 14 energetic star particles flying outwards in directions
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const speed = Math.random() * 4.5 + 2.5;
      particles.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: burstColor,
        size: Math.random() * 4.5 + 2.5,
        maxLife: Math.random() * 30 + 15,
        life: 0,
        type: 'stars'
      });
    }

    // Expanding spatial sonar ring ripple
    ripples.current.push({
      x,
      y,
      radius: 6,
      maxRadius: 75 + Math.random() * 15,
      color: burstColor,
      alpha: 0.9,
      speed: 3.5
    });
  };

  // Fill the drawing canvas with beautiful foggy window mist
  const initializeFog = useCallback(() => {
    const drawCanvas = drawingCanvasRef.current;
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    
    // Gradient for realistic fog: slightly darker towards bottom, soft bluish tint
    const grad = ctx.createLinearGradient(0, 0, 0, drawCanvas.height);
    grad.addColorStop(0, 'rgba(235, 243, 250, 0.96)');
    grad.addColorStop(1, 'rgba(215, 227, 240, 0.98)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    
    // Add micro-condensation drops to simulate a foggy surface
    for (let i = 0; i < 350; i++) {
      const rx = Math.random() * drawCanvas.width;
      const ry = Math.random() * drawCanvas.height;
      const rRad = Math.random() * 3 + 1;
      ctx.beginPath();
      ctx.arc(rx, ry, rRad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fill();
    }
    ctx.restore();
    waterDrops.current = [];
  }, []);

  // Erase the draw canvas
  const clearCanvas = () => {
    const drawCanvas = drawingCanvasRef.current;
    if (drawCanvas) {
      const ctx = drawCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        if (foggyGlassMode) {
          initializeFog();
        }
      }
    }
    particles.current = [];
    waterDrops.current = [];
  };

  // Toggle Foggy Glass mode
  const toggleFoggyMode = () => {
    setFoggyGlassMode(prev => {
      const next = !prev;
      if (next) {
        setTimeout(() => {
          initializeFog();
        }, 50);
      } else {
        const drawCanvas = drawingCanvasRef.current;
        if (drawCanvas) {
          const ctx = drawCanvas.getContext('2d');
          ctx?.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        }
      }
      return next;
    });
  };

  // Download canvas doodle
  const saveSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Trigger photographic white flash overlay
    setShowFlash(true);
    setTimeout(() => {
      setShowFlash(false);
    }, 180);

    // Play digital camera shutter sound
    synth.triggerShutter();

    // Create a download link
    const link = document.createElement('a');
    link.download = `AURA-OS-SNAPSHOT-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Keyboard listener to simulate Eye Wink Snapshot via Space, W, or B keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' || 
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === ' ' || key === 'b' || key === 'w') {
        e.preventDefault();
        saveSnapshot();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Draw HUD Mesh landmarks
  const drawHandMesh = (ctx: CanvasRenderingContext2D, landmarks: any[]) => {
    ctx.strokeStyle = 'rgba(0, 255, 95, 0.4)';
    ctx.fillStyle = '#00FF5F';
    ctx.lineWidth = 1.5;

    // Define connections for fingers
    const connections = [
      [0, 1, 2, 3, 4], // Thumb
      [0, 5, 6, 7, 8], // Index
      [9, 10, 11, 12], // Middle
      [13, 14, 15, 16], // Ring
      [0, 17, 18, 19, 20], // Pinky
      [5, 9, 13, 17] // Palm bridge
    ];

    landmarks.forEach(hand => {
      // Draw Connections
      connections.forEach(path => {
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const pt = hand[path[i]];
          // Mirror-flipped mapping
          const x = (1 - pt.x) * ctx.canvas.width;
          const y = pt.y * ctx.canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      // Draw Joint Nodes
      hand.forEach((pt: any) => {
        const x = (1 - pt.x) * ctx.canvas.width;
        const y = pt.y * ctx.canvas.height;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  };

  // Draw sci-fi customizable portal shape frame
  const drawPortalPath = (context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shape: 'rectangle' | 'heart' | 'circle', offset: number = 0) => {
    context.beginPath();
    if (shape === 'circle') {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.max(5, Math.min(w, h) / 2 + offset);
      context.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (shape === 'heart') {
      const cx = x - offset;
      const cy = y - offset;
      const cw = w + offset * 2;
      const ch = h + offset * 2;
      context.moveTo(cx + cw / 2, cy + ch * 0.25);
      context.bezierCurveTo(cx + cw * 0.15, cy, cx, cy + ch * 0.2, cx, cy + ch * 0.5);
      context.bezierCurveTo(cx, cy + ch * 0.75, cx + cw * 0.35, cy + ch * 0.9, cx + cw / 2, cy + ch);
      context.bezierCurveTo(cx + cw * 0.65, cy + ch * 0.9, cx + cw, cy + ch * 0.75, cx + cw, cy + ch * 0.5);
      context.bezierCurveTo(cx + cw, cy + ch * 0.2, cx + cw * 0.85, cy, cx + cw / 2, cy + ch * 0.25);
    } else {
      context.rect(x - offset, y - offset, w + offset * 2, h + offset * 2);
    }
  };

  // Draw procedural fractal lightning bolt
  const drawLightningBolt = (ctx: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(215, 245, 255, 0.95)';
    ctx.lineWidth = Math.random() * 2.5 + 1.5;
    ctx.shadowColor = 'rgba(0, 180, 255, 0.8)';
    ctx.shadowBlur = 15;
    
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    
    let currentX = startX;
    let currentY = startY;
    const steps = 10;
    const dx = (endX - startX) / steps;
    const dy = (endY - startY) / steps;
    
    for (let i = 1; i < steps; i++) {
      // Add random displacement for classic jagged look
      currentX += dx + (Math.random() - 0.5) * 30;
      currentY += dy + (Math.random() - 0.5) * 12;
      ctx.lineTo(currentX, currentY);
    }
    
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
  };

  // Trigger manual or automatic lightning event
  const triggerLightning = () => {
    setLightningFlash(true);
    if (enableAudio) {
      synth.triggerSpark();
    }
    setTimeout(() => {
      setLightningFlash(false);
    }, 150);
  };

  // Add warm breath mist to simulate breathing on the glass
  const breatheMist = () => {
    const drawCanvas = drawingCanvasRef.current;
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    
    // Draw a soft, warm breath fog layer centered on the screen
    const grad = ctx.createRadialGradient(
      drawCanvas.width / 2, drawCanvas.height / 2, 40,
      drawCanvas.width / 2, drawCanvas.height / 2, drawCanvas.width * 0.55
    );
    grad.addColorStop(0, 'rgba(238, 244, 250, 0.94)');
    grad.addColorStop(0.4, 'rgba(228, 238, 248, 0.82)');
    grad.addColorStop(1, 'rgba(215, 227, 240, 0.4)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    
    // Sprout fresh condensation drops
    for (let i = 0; i < 180; i++) {
      const rx = Math.random() * drawCanvas.width;
      const ry = Math.random() * drawCanvas.height;
      const rRad = Math.random() * 2.2 + 0.8;
      ctx.beginPath();
      ctx.arc(rx, ry, rRad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fill();
    }
    ctx.restore();
    
    if (enableAudio) {
      synth.triggerWhoosh();
    }
  };

  // Main Render Loop
  useEffect(() => {
    if (!isReady) return;

    const canvas = canvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!canvas || !drawingCanvas) return;

    const ctx = canvas.getContext('2d');
    const drawCtx = drawingCanvas.getContext('2d');
    if (!ctx || !drawCtx) return;

    let lastTime = performance.now();

    const loop = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      // Update FPS Tracker
      fpsTracker.current.frames++;
      if (now - fpsTracker.current.lastTime >= 1000) {
        fpsTracker.current.fps = Math.round((fpsTracker.current.frames * 1000) / (now - fpsTracker.current.lastTime));
        fpsTracker.current.frames = 0;
        fpsTracker.current.lastTime = now;
      }

      // Increment rainbow color hue
      rainbowHue.current = (rainbowHue.current + 1.5) % 360;
      const brushColorValue = activeColor.value === 'rainbow' 
        ? `hsl(${rainbowHue.current}, 95%, 60%)` 
        : activeColor.value;

      // Reset main composite canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let gestureMode: 'DRAWING' | 'COLOR_PORTAL' | 'NO_HANDS' | 'SIMULATING' = 'NO_HANDS';
      let handsDetected = 0;
      let pinchDistance = 1.0;
      let isPinching = false;
      let trackingX = 0;
      let trackingY = 0;
      let portalRect: { x_min: number; y_min: number; x_max: number; y_max: number } | null = null;

      // ------------------------------------
      // SECTION A: PROCESS SOURCE (WEBCAM OR SIMULATOR)
      // ------------------------------------
      if (!useSimulator && videoRef.current && videoRef.current.readyState >= 2) {
        const video = videoRef.current;
        handsDetected = 0;

        // Draw background video: Applied CSS filters to stand out HUD graphics
        let appliedFilter = `grayscale(${grayscaleBackdrop}%) brightness(40%) contrast(110%)`;
        if (cameraFilter === 'cyberpunk') {
          appliedFilter = `hue-rotate(130deg) saturate(2.5) brightness(35%) contrast(125%)`;
        } else if (cameraFilter === 'matrix') {
          appliedFilter = `hue-rotate(60deg) saturate(1.8) sepia(0.6) brightness(30%) contrast(140%)`;
        } else if (cameraFilter === 'thermal') {
          appliedFilter = `invert(1) hue-rotate(180deg) saturate(3) brightness(45%) contrast(130%)`;
        }
        ctx.filter = appliedFilter;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';

        // Detect Hands with MediaPipe
        let result: any = null;
        if (handLandmarkerRef.current) {
          result = handLandmarkerRef.current.detectForVideo(video, now);
        }

        if (result && result.landmarks && result.landmarks.length > 0) {
          const landmarksToProcess = [...result.landmarks];
          if (landmarksToProcess.length === 1) {
            // Synthesize a symmetric second hand by mirroring across the screen center
            const h1 = landmarksToProcess[0];
            const h2 = h1.map((pt: any) => ({
              x: 1 - pt.x,
              y: 1 - pt.y,
              z: pt.z
            }));
            landmarksToProcess.push(h2);
          }

          handsDetected = 2; // Treat as double hand portal view
          gestureMode = 'COLOR_PORTAL';

          const h1 = landmarksToProcess[0];
          const h2 = landmarksToProcess[1];

          // Bounding points
          const h1_thumb = h1[4];
          const h1_index = h1[8];
          const h2_thumb = h2[4];
          const h2_index = h2[8];

          const all_x = [h1_thumb.x, h1_index.x, h2_thumb.x, h2_index.x];
          const all_y = [h1_thumb.y, h1_index.y, h2_thumb.y, h2_index.y];

          const x_min = Math.max(0, Math.min(...all_x));
          const y_min = Math.max(0, Math.min(...all_y));
          const x_max = Math.min(1, Math.max(...all_x));
          const y_max = Math.min(1, Math.max(...all_y));

          portalRect = { x_min, y_min, x_max, y_max };

          // Hand 1 coordinates & pinch
          const h1_ix = (1 - h1_index.x) * canvas.width;
          const h1_iy = h1_index.y * canvas.height;
          const h1_dx = h1_thumb.x - h1_index.x;
          const h1_dy = h1_thumb.y - h1_index.y;
          const h1_dz = h1_thumb.z - h1_index.z;
          const h1_dist = Math.sqrt(h1_dx * h1_dx + h1_dy * h1_dy + h1_dz * h1_dz);
          const h1_isPinching = h1_dist < pinchThreshold;

          // Hand 2 coordinates & pinch
          const h2_ix = (1 - h2_index.x) * canvas.width;
          const h2_iy = h2_index.y * canvas.height;
          const h2_dx = h2_thumb.x - h2_index.x;
          const h2_dy = h2_thumb.y - h2_index.y;
          const h2_dz = h2_thumb.z - h2_index.z;
          const h2_dist = Math.sqrt(h2_dx * h2_dx + h2_dy * h2_dy + h2_dz * h2_dz);
          const h2_isPinching = h2_dist < pinchThreshold;

          // Provide general tracking coordinates for popping bubbles
          trackingX = h1_ix;
          trackingY = h1_iy;

          // Process Hand 1 drawing/wiping
          if (h1_isPinching) {
            const pt1 = { x: h1_ix, y: h1_iy };
            if (!wasPinchingRef.current) {
              triggerPinchBurst(h1_ix, h1_iy, brushColorValue);
              wasPinchingRef.current = true;
            }
            if (lastH1PointRef.current) {
              drawSegment(drawCtx, lastH1PointRef.current, pt1, brushColorValue, brushStyle, brushSize);
            }
            spawnParticles(h1_ix, h1_iy, brushColorValue);
            lastH1PointRef.current = pt1;

            if (enableAudio) {
              synth.start();
              const freq = 150 + (h1_ix / canvas.width) * 700;
              const filterRes = h1_iy / canvas.height;
              synth.update(freq, filterRes);
            }
          } else {
            lastH1PointRef.current = null;
          }

          // Process Hand 2 drawing/wiping
          if (h2_isPinching) {
            const pt2 = { x: h2_ix, y: h2_iy };
            if (!wasH2PinchingRef.current) {
              triggerPinchBurst(h2_ix, h2_iy, brushColorValue);
              wasH2PinchingRef.current = true;
            }
            if (lastH2PointRef.current) {
              drawSegment(drawCtx, lastH2PointRef.current, pt2, brushColorValue, brushStyle, brushSize);
            }
            spawnParticles(h2_ix, h2_iy, brushColorValue);
            lastH2PointRef.current = pt2;
          } else {
            lastH2PointRef.current = null;
          }

          if (!h1_isPinching && !h2_isPinching) {
            wasPinchingRef.current = false;
            wasH2PinchingRef.current = false;
            if (enableAudio) synth.stop();
          }

          // Optionally draw hands skeleton mesh
          if (showMesh) {
            drawHandMesh(ctx, landmarksToProcess);
          }
        } else {
          lastH1PointRef.current = null;
          lastH2PointRef.current = null;
          wasPinchingRef.current = false;
          wasH2PinchingRef.current = false;
          if (enableAudio) synth.stop();
        }

      } else {
        // ------------------------------------
        // SECTION B: FALLBACK DESKTOP SIMULATOR
        // ------------------------------------
        gestureMode = 'SIMULATING';
        handsDetected = simHandsMode === 'single' ? 1 : 2;

        // Draw synthetic background matrix grid with dynamic theme color
        let bgColor = '#0F0F0F';
        let gridColor = 'rgba(255, 255, 255, 0.05)';
        if (cameraFilter === 'cyberpunk') {
          bgColor = '#160822';
          gridColor = 'rgba(235, 115, 255, 0.08)';
        } else if (cameraFilter === 'matrix') {
          bgColor = '#04160a';
          gridColor = 'rgba(0, 255, 95, 0.08)';
        } else if (cameraFilter === 'thermal') {
          bgColor = '#1e0505';
          gridColor = 'rgba(255, 135, 0, 0.12)';
        }
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        // Drawing Grid Lines
        for (let i = 0; i < canvas.width; i += 40) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, canvas.height);
          ctx.stroke();
        }
        for (let i = 0; i < canvas.height; i += 40) {
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(canvas.width, i);
          ctx.stroke();
        }

        // Draw a simulated webcam preview panel in the corner
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.strokeRect(20, 20, 160, 95);
        ctx.fillStyle = 'rgba(10, 10, 10, 0.75)';
        ctx.fillRect(20, 20, 160, 95);
        ctx.fillStyle = '#00FF5F';
        ctx.font = 'bold 9px var(--font-sans)';
        ctx.fillText('● SIMULATOR ACTIVE', 32, 40);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '9px var(--font-sans)';
        ctx.fillText(`MODE: ${simHandsMode === 'single' ? 'Symmetric' : 'Manual 2-Hand'}`, 32, 58);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = '9px var(--font-sans)';
        ctx.fillText('DRAG INTERACTIVE NODES', 32, 74);

        if (simHandsMode === 'single') {
          // Single Hand Symmetric Portal Simulator
          const h1x = simHand1.x;
          const h1y = simHand1.y;
          const h2x = 1 - simHand1.x;
          const h2y = 1 - simHand1.y;

          const x_min = Math.min(h1x, h2x);
          const y_min = Math.min(h1y, h2y);
          const x_max = Math.max(h1x, h2x);
          const y_max = Math.max(h1y, h2y);

          portalRect = { x_min, y_min, x_max, y_max };

          const h1_ix = h1x * canvas.width;
          const h1_iy = h1y * canvas.height;
          const h2_ix = h2x * canvas.width;
          const h2_iy = h2y * canvas.height;

          trackingX = h1_ix;
          trackingY = h1_iy;
          isPinching = simHand1.isPinching;

          if (isPinching) {
            const pt1 = { x: h1_ix, y: h1_iy };
            const pt2 = { x: h2_ix, y: h2_iy };

            if (!wasPinchingRef.current) {
              triggerPinchBurst(h1_ix, h1_iy, brushColorValue);
              triggerPinchBurst(h2_ix, h2_iy, brushColorValue);
              wasPinchingRef.current = true;
            }

            if (lastH1PointRef.current) {
              drawSegment(drawCtx, lastH1PointRef.current, pt1, brushColorValue, brushStyle, brushSize);
            }
            if (lastH2PointRef.current) {
              drawSegment(drawCtx, lastH2PointRef.current, pt2, brushColorValue, brushStyle, brushSize);
            }

            spawnParticles(h1_ix, h1_iy, brushColorValue);
            spawnParticles(h2_ix, h2_iy, brushColorValue);

            lastH1PointRef.current = pt1;
            lastH2PointRef.current = pt2;

            if (enableAudio) {
              synth.start();
              const freq = 150 + (h1_ix / canvas.width) * 700;
              const filterRes = h1_iy / canvas.height;
              synth.update(freq, filterRes);
            }
          } else {
            wasPinchingRef.current = false;
            lastH1PointRef.current = null;
            lastH2PointRef.current = null;
            if (enableAudio) synth.stop();
          }

          // Draw Simulated Rigs (both real and mirrored)
          const handsToDraw = [
            { x: h1x, y: h1y, isPinching, label: 'SIM_HAND_REAL' },
            { x: h2x, y: h2y, isPinching, label: 'SIM_HAND_SYMMETRIC' }
          ];

          handsToDraw.forEach((hand, idx) => {
            const hx = hand.x * canvas.width;
            const hy = hand.y * canvas.height;
            ctx.beginPath();
            ctx.arc(hx, hy, hand.isPinching ? 15 : 25, 0, Math.PI * 2);
            ctx.strokeStyle = idx === 0 ? '#00FF5F' : 'rgba(0, 255, 95, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Connective lines to look mechanical
            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(hx - 25, hy + 40);
            ctx.lineTo(hx + 25, hy + 40);
            ctx.closePath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.stroke();

            // Finger tip dots
            ctx.beginPath();
            ctx.arc(hx - 5, hy - (hand.isPinching ? 2 : 12), 4, 0, Math.PI * 2);
            ctx.arc(hx + 5, hy - (hand.isPinching ? 2 : 12), 4, 0, Math.PI * 2);
            ctx.fillStyle = hand.isPinching ? '#00FF5F' : 'rgba(255, 255, 255, 0.6)';
            ctx.fill();
            
            ctx.fillStyle = idx === 0 ? '#00FF5F' : 'rgba(0, 255, 95, 0.7)';
            ctx.font = '10px monospace';
            ctx.fillText(hand.label, hx + 12, hy - 5);
          });
        } else {
          // Double Hand Lens Simulator (Manual / Asymmetric)
          lastH1PointRef.current = null;
          lastH2PointRef.current = null;
          wasPinchingRef.current = false;
          if (enableAudio) synth.stop();

          const h1x = simHand1.x;
          const h1y = simHand1.y;
          const h2x = simHand2.x;
          const h2y = simHand2.y;

          const x_min = Math.min(h1x, h2x);
          const y_min = Math.min(h1y, h2y);
          const x_max = Math.max(h1x, h2x);
          const y_max = Math.max(h1y, h2y);

          portalRect = { x_min, y_min, x_max, y_max };

          // Draw Simulated Rigs
          [simHand1, simHand2].forEach((hand, idx) => {
            const hx = hand.x * canvas.width;
            const hy = hand.y * canvas.height;
            ctx.beginPath();
            ctx.arc(hx, hy, 20, 0, Math.PI * 2);
            ctx.strokeStyle = '#00FF5F';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            ctx.fillStyle = '#00FF5F';
            ctx.font = '10px monospace';
            ctx.fillText(`SIM_H${idx + 1}`, hx + 12, hy - 5);
          });
        }
      }

      // ------------------------------------
      // SECTION C: DRAW DYNAMIC COLOR PORTAL (LENS REVEAL)
      // ------------------------------------
      let finalPortalWidth = 0;
      let finalPortalHeight = 0;

      if (portalRect) {
        // Calculate dimensions scaled to canvas
        // Convert to flipped view if using webcam, but portalRect calculation has already handled mirroring or coordinates
        const px_min = portalRect.x_min * canvas.width;
        const py_min = portalRect.y_min * canvas.height;
        const px_max = portalRect.x_max * canvas.width;
        const py_max = portalRect.y_max * canvas.height;

        const pw = px_max - px_min;
        const ph = py_max - py_min;
        
        finalPortalWidth = pw;
        finalPortalHeight = ph;

        if (pw > 10 && ph > 10) {
          ctx.save();
          
          // Draw a sci-fi scanning clipping area based on customizable portalShape
          drawPortalPath(ctx, px_min, py_min, pw, ph, portalShape);
          ctx.clip();

          // Within the clip, draw the video stream in full-color
          if (!useSimulator && videoRef.current) {
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          } else {
            // Simulator Color reveal: draw a vibrant futuristic grid of colors
            const grad = ctx.createLinearGradient(px_min, py_min, px_max, py_max);
            grad.addColorStop(0, portalShape === 'heart' ? '#FF2A6D' : '#00FF5F');
            grad.addColorStop(0.5, '#00F0FF');
            grad.addColorStop(1, '#FF007F');
            ctx.fillStyle = grad;
            ctx.fillRect(px_min - 20, py_min - 20, pw + 40, ph + 40);

            // Overlay scanning digital matrix code inside the portal
            ctx.fillStyle = 'rgba(15, 15, 15, 0.4)';
            ctx.fillRect(px_min - 20, py_min - 20, pw + 40, ph + 40);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            for (let x = px_min + 15; x < px_max; x += 15) {
              ctx.beginPath();
              ctx.moveTo(x, py_min - 20);
              ctx.lineTo(x, py_max + 20);
              ctx.stroke();
            }
          }

          ctx.restore();

          // Draw HUD Double Border conforming to portalShape
          ctx.strokeStyle = portalShape === 'heart' ? '#FF2A6D' : '#00FF5F';
          ctx.lineWidth = 2.5;
          drawPortalPath(ctx, px_min, py_min, pw, ph, portalShape);
          ctx.stroke();

          ctx.strokeStyle = portalShape === 'heart' ? 'rgba(255, 42, 109, 0.3)' : 'rgba(0, 255, 95, 0.3)';
          ctx.lineWidth = 8;
          drawPortalPath(ctx, px_min, py_min, pw, ph, portalShape, 4);
          ctx.stroke();

          // Digital corner crosshairs
          const cLen = Math.min(20, pw / 4);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 3;

          // Top-Left Corner
          ctx.beginPath(); ctx.moveTo(px_min - 2, py_min + cLen); ctx.lineTo(px_min - 2, py_min - 2); ctx.lineTo(px_min + cLen, py_min - 2); ctx.stroke();
          // Top-Right Corner
          ctx.beginPath(); ctx.moveTo(px_max + 2 - cLen, py_min - 2); ctx.lineTo(px_max + 2, py_min - 2); ctx.lineTo(px_max + 2, py_min + cLen); ctx.stroke();
          // Bottom-Left Corner
          ctx.beginPath(); ctx.moveTo(px_min - 2, py_max - cLen); ctx.lineTo(px_min - 2, py_max + 2); ctx.lineTo(px_min + cLen, py_max + 2); ctx.stroke();
          // Bottom-Right Corner
          ctx.beginPath(); ctx.moveTo(px_max + 2 - cLen, py_max + 2); ctx.lineTo(px_max + 2, py_max + 2); ctx.lineTo(px_max + 2, py_max - cLen); ctx.stroke();

          // Draw portal HUD text label
          ctx.fillStyle = '#00FF5F';
          ctx.font = 'bold 11px var(--font-mono)';
          ctx.fillText(`PORTAL.OS ACTIVE [${Math.round(pw)}x${Math.round(ph)}]`, px_min + 6, py_min - 12);

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '9px var(--font-mono)';
          ctx.fillText(`COORD_X: ${Math.round(px_min)}-${Math.round(px_max)}`, px_min + 6, py_max + 14);
          ctx.fillText(`COORD_Y: ${Math.round(py_min)}-${Math.round(py_max)}`, px_min + 6, py_max + 26);
        }
      }

      // ------------------------------------
      // SECTION D: COMPOSITE PERSISTENT DRAWINGS
      // ------------------------------------
      // Draw the persistent user's drawing canvas on top
      ctx.shadowBlur = 0; // reset shadow
      ctx.drawImage(drawingCanvas, 0, 0);

      // ------------------------------------
      // SECTION E: DRAW & ANIMATE PARTICLES
      // ------------------------------------
      particles.current.forEach((p, idx) => {
        // Apply custom physics based on particle type
        if (p.type === 'fireworks') {
          p.vy += 0.08; // Gravity pulling ember down
          p.vx *= 0.985; // Air drag
          // Bounce off the bottom of the screen
          if (p.y > canvas.height - 6) {
            p.y = canvas.height - 6;
            p.vy = -p.vy * 0.45; // partial elasticity
            p.vx *= 0.8;
          }
        } else if (p.type === 'bubbles') {
          p.vy -= 0.015; // Float upwards
          p.vx = Math.sin((p.life + p.size * 10) / 10) * 0.5; // Smooth sway
          
          // Hover popping collision check: if hand is near bubble, pop it!
          if (handsDetected > 0 && trackingX > 0 && trackingY > 0) {
            const dist = Math.hypot(p.x - trackingX, p.y - trackingY);
            if (dist < p.size + 20) {
              p.life = p.maxLife; // Kill bubble
              
              // Sprout tiny water droplets
              for (let d = 0; d < 5; d++) {
                const spAngle = Math.random() * Math.PI * 2;
                const spSpeed = Math.random() * 2.2 + 0.8;
                particles.current.push({
                  x: p.x,
                  y: p.y,
                  vx: Math.cos(spAngle) * spSpeed,
                  vy: Math.sin(spAngle) * spSpeed - 0.5,
                  color: p.color,
                  size: Math.random() * 2 + 1,
                  maxLife: Math.random() * 12 + 6,
                  life: 0,
                  type: 'bubble_spray'
                });
              }
            }
          }
        }

        p.x += p.vx;
        p.y += p.vy;
        p.life += 1;

        const ratio = p.life / p.maxLife;
        const opacity = 1 - ratio;
        const currentSize = p.size * (1 - ratio * 0.5);

        ctx.save();
        ctx.globalAlpha = opacity;

        if (p.type === 'stars') {
          // Draw star/cross
          ctx.beginPath();
          ctx.moveTo(p.x - currentSize, p.y);
          ctx.lineTo(p.x + currentSize, p.y);
          ctx.moveTo(p.x, p.y - currentSize);
          ctx.lineTo(p.x, p.y + currentSize);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (p.type === 'squares') {
          // Digital block particle
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - currentSize / 2, p.y - currentSize / 2, currentSize, currentSize);
        } else if (p.type === 'bubbles') {
          // Glossy spherical soap bubbles with highlight glare
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
          
          const bubGrad = ctx.createRadialGradient(
            p.x - currentSize * 0.3, p.y - currentSize * 0.3, currentSize * 0.1,
            p.x, p.y, currentSize
          );
          bubGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
          bubGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.1)');
          bubGrad.addColorStop(0.8, 'rgba(255, 130, 255, 0.2)');
          bubGrad.addColorStop(0.95, 'rgba(100, 220, 255, 0.4)');
          bubGrad.addColorStop(1, 'rgba(255, 255, 255, 0.55)');
          
          ctx.fillStyle = bubGrad;
          ctx.fill();

          // Sparkle reflection dot
          ctx.beginPath();
          ctx.arc(p.x - currentSize * 0.35, p.y - currentSize * 0.35, currentSize * 0.18, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.fill();
        } else if (p.type === 'bubble_spray') {
          // Micro spray droplet
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
        } else if (p.type === 'fireworks') {
          // Fire spark ember with glowing core
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentSize * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.fill();
          
          // White core
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentSize * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.shadowBlur = 0;
          ctx.fill();
        } else {
          // Sparkle circle
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
        }

        ctx.restore();
      });

      // Filter out dead particles
      particles.current = particles.current.filter(p => p.life < p.maxLife);

      // ------------------------------------
      // SECTION E2: DRAW & ANIMATE EXPANDING RIPPLES
      // ------------------------------------
      ripples.current.forEach((r) => {
        r.radius += r.speed;
        r.alpha -= 0.02; // fade out gently

        if (r.alpha > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 2;
          ctx.globalAlpha = r.alpha;
          // Add neon shadow glow to expanding ripples
          ctx.shadowColor = r.color;
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.restore();
        }
      });

      // Filter out dead ripples
      ripples.current = ripples.current.filter(r => r.alpha > 0);

      // ------------------------------------
      // SECTION E3: FOGGY WINDOW WATER TRICKLE SYSTEM
      // ------------------------------------
      if (foggyGlassMode) {
        // Draw subtle ambient rain falling lines in background (cyberpunk grid area)
        ctx.save();
        ctx.strokeStyle = 'rgba(174, 219, 255, 0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const rx = Math.random() * canvas.width;
          const ry = Math.random() * canvas.height;
          const rlen = Math.random() * 35 + 15;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 1, ry + rlen);
          ctx.stroke();
        }
        ctx.restore();

        // 1. Spontaneous condensation droplet spawning at random top positions
        if (Math.random() < 0.015 && waterDrops.current.length < 18) {
          waterDrops.current.push({
            x: Math.random() * canvas.width,
            y: 0,
            speed: Math.random() * 1.5 + 0.8,
            size: Math.random() * 2.5 + 1.5,
            trailWidth: Math.random() * 2.5 + 2.0
          });
        }

        // 2. Trickle down new water drops from finger tip if the user is actively wiping!
        if (isPinching && Math.random() < 0.12 && waterDrops.current.length < 28) {
          waterDrops.current.push({
            x: trackingX + (Math.random() - 0.5) * 12,
            y: trackingY + 4,
            speed: Math.random() * 2.8 + 1.2,
            size: Math.random() * 3.0 + 1.8,
            trailWidth: Math.random() * 3.0 + 2.5
          });
        }

        // 3. Process and erase trails on drawingCanvas
        const drawCtx = drawingCanvas.getContext('2d');
        if (drawCtx) {
          waterDrops.current.forEach(drop => {
            const prevY = drop.y;
            drop.y += drop.speed;
            
            // Give organic wiggling slide paths
            drop.x += (Math.random() - 0.5) * 0.5;

            // Erase a trace trail through the fog
            drawCtx.save();
            drawCtx.globalCompositeOperation = 'destination-out';
            drawCtx.beginPath();
            drawCtx.strokeStyle = 'rgba(0,0,0,1)';
            drawCtx.lineWidth = drop.trailWidth;
            drawCtx.lineCap = 'round';
            drawCtx.moveTo(drop.x, prevY);
            drawCtx.lineTo(drop.x, drop.y);
            drawCtx.stroke();
            drawCtx.restore();
          });
        }

        // 4. Render interactive water drop bodies on the display canvas
        waterDrops.current.forEach(drop => {
          ctx.save();
          // Draw glass bead droplet
          ctx.beginPath();
          ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();

          // Highlight reflection glint
          ctx.beginPath();
          ctx.arc(drop.x - drop.size * 0.35, drop.y - drop.size * 0.35, drop.size * 0.22, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fill();
          ctx.restore();
        });

        // Clear out drops that fall past bottom edge
        waterDrops.current = waterDrops.current.filter(drop => drop.y < canvas.height);
      }

      // ------------------------------------
      // SECTION E4: LIGHTNING FLASH OVERLAY & BOLTS
      // ------------------------------------
      if (lightningFlash) {
        // Draw 1-2 powerful bolts of fractal lightning
        const lightningCount = Math.random() < 0.45 ? 2 : 1;
        for (let l = 0; l < lightningCount; l++) {
          const startX = Math.random() * canvas.width;
          const startY = 0;
          // Target either the tracking position (finger tip) or a random ground position
          const endX = (handsDetected > 0 && trackingX > 0) ? trackingX + (Math.random() - 0.5) * 50 : Math.random() * canvas.width;
          const endY = (handsDetected > 0 && trackingY > 0) ? trackingY : canvas.height * (0.6 + Math.random() * 0.4);
          
          drawLightningBolt(ctx, startX, startY, endX, endY);
        }
      }

      // ------------------------------------
      // SECTION F: UPDATE HUD CONTROLLER STATE
      // ------------------------------------
      onStatsUpdate({
        fps: fpsTracker.current.fps || 60,
        handsDetected,
        pinchDistance,
        isPinching,
        gestureMode,
        lastCoords: { x: Math.round(trackingX), y: Math.round(trackingY) },
        portalSize: { width: Math.round(finalPortalWidth), height: Math.round(finalPortalHeight) }
      });

      animationFrameId.current = requestAnimationFrame(loop);
    };

    animationFrameId.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isReady, useSimulator, grayscaleBackdrop, activeColor, brushSize, brushStyle, pinchThreshold, enableAudio, showMesh, simHandsMode, simHand1, simHand2, foggyGlassMode, initializeFog, cameraFilter, lightningFlash, portalShape]);

  // Simulator Mouse Down Handler
  const handleSimMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!useSimulator) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvas.width;
    const y = (e.clientY - rect.top) / canvas.height;

    // Check if clicked near Hand 1 or Hand 2 handles
    const dist1 = Math.hypot(x - simHand1.x, y - simHand1.y);
    const dist2 = Math.hypot(x - simHand2.x, y - simHand2.y);

    if (simHandsMode === 'double' && dist2 < 0.05) {
      setActiveDragSim('hand2');
    } else if (dist1 < 0.05) {
      setActiveDragSim('hand1');
    } else {
      // Default: move hand 1 here and start pinching
      setSimHand1(prev => ({ ...prev, x, y, isPinching: true }));
      setActiveDragSim('hand1');
    }
  };

  // Simulator Mouse Move Handler
  const handleSimMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!useSimulator || !activeDragSim) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / canvas.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / canvas.height));

    if (activeDragSim === 'hand1') {
      setSimHand1(prev => ({ ...prev, x, y }));
    } else if (activeDragSim === 'hand2') {
      setSimHand2(prev => ({ ...prev, x, y }));
    }
  };

  // Simulator Mouse Up Handler
  const handleSimMouseUp = () => {
    if (!useSimulator) return;
    setActiveDragSim(null);
    setSimHand1(prev => ({ ...prev, isPinching: false }));
    setSimHand2(prev => ({ ...prev, isPinching: false }));
    lastDrawingPointRef.current = null;
    if (enableAudio) synth.stop();
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0F0F0F] rounded-3xl border border-[#222] overflow-hidden">
      {/* Neural Model Loading Cover Overlay */}
      {!isReady && (
        <div className="absolute inset-0 bg-[#0F0F0F]/95 z-50 flex flex-col items-center justify-center p-6 select-none font-display">
          <div className="w-72 border border-[#333] bg-[#151515] rounded-xl p-6 text-center shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 h-1 bg-[#00FF5F] animate-pulse w-full"></div>
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-[#00FF5F] animate-spin mx-auto mb-4 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#00FF5F]" />
            </div>
            
            <h3 className="text-white text-lg font-black tracking-widest uppercase mb-1">AURA.OS GESTURE</h3>
            <span className="text-[9px] tracking-widest text-[#666] uppercase block mb-4">WASM Neural Model Syncing</span>

            {/* Simulated progress bar */}
            <div className="h-1.5 w-full bg-[#222] rounded-full overflow-hidden mb-4">
              <div 
                className="h-full bg-gradient-to-r from-[#00FF5F] to-[#00F0FF] transition-all duration-300"
                style={{ width: `${loadingProgress}%` }}
              ></div>
            </div>

            <p className="text-[#888] text-xs font-mono lowercase tracking-tighter truncate">
              {loadingState}...
            </p>
          </div>
        </div>
      )}

      {/* Hidden webcam stream used as neural input */}
      <video 
        ref={videoRef} 
        className="hidden" 
        width="640" 
        height="480" 
        playsInline 
        muted 
      />

      {/* Primary Interaction Area */}
      <div className="relative flex-1 bg-black overflow-hidden bg-grid-dots">
        {/* Photographic Shutter Flash Overlay */}
        {showFlash && (
          <div className="absolute inset-0 bg-white z-50 pointer-events-none transition-opacity duration-150 opacity-100" />
        )}

        {/* Main Canvas covering full screen */}
        <canvas 
          ref={canvasRef} 
          className="absolute inset-0 w-full h-full block cursor-crosshair z-10"
          onMouseDown={handleSimMouseDown}
          onMouseMove={handleSimMouseMove}
          onMouseUp={handleSimMouseUp}
          onMouseLeave={handleSimMouseUp}
        />
        
        {/* Persistent Paint Layer */}
        <canvas 
          ref={drawingCanvasRef} 
          className="hidden" 
        />

        {/* HUD Local Status Badges */}
        <div className="hidden sm:flex absolute top-4 left-4 z-20 flex-wrap gap-2 max-w-[calc(100%-2rem)]">
          <button 
            id="camera-toggle-btn"
            onClick={toggleCamera}
            className={`px-3 py-1.5 border rounded-full text-[10px] uppercase tracking-widest font-mono flex items-center gap-2 backdrop-blur-md transition-all duration-300 ${
              !useSimulator 
                ? 'bg-[#00FF5F]/10 border-[#00FF5F] text-[#00FF5F] glow-green' 
                : 'bg-[#151515] border-[#333] text-gray-400 hover:border-white hover:text-white'
            }`}
          >
            {!useSimulator ? <Camera className="w-3.5 h-3.5 animate-pulse" /> : <CameraOff className="w-3.5 h-3.5" />}
            <span>{!useSimulator ? 'Camera Feed' : 'Simulator Mode'}</span>
          </button>

          <button 
            id="foggy-toggle-btn"
            onClick={toggleFoggyMode}
            className={`px-3 py-1.5 border rounded-full text-[10px] uppercase tracking-widest font-mono flex items-center gap-2 backdrop-blur-md transition-all duration-300 ${
              foggyGlassMode 
                ? 'bg-blue-500/20 border-blue-400 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.4)] animate-pulse' 
                : 'bg-[#151515] border-[#333] text-gray-400 hover:border-white hover:text-white'
            }`}
            title="Rainy Window Foggy Wiping Mode"
          >
            <span>🌧️</span>
            <span>{foggyGlassMode ? 'Foggy Glass: ON' : '🌧️ Foggy Window (Mist)'}</span>
          </button>

          {foggyGlassMode && (
            <button 
              id="breathe-mist-btn"
              onClick={breatheMist}
              className="px-3 py-1.5 bg-[#151515] border border-blue-500/30 text-blue-300 hover:border-blue-400 hover:text-white rounded-full text-[10px] uppercase tracking-widest font-mono flex items-center gap-1.5 backdrop-blur-md transition-all duration-300 active:scale-95"
              title="Breathe warm mist onto the glass window"
            >
              <span>💨</span>
              <span>Blow Mist</span>
            </button>
          )}

          {foggyGlassMode && (
            <button 
              id="strike-lightning-btn"
              onClick={triggerLightning}
              className="px-3 py-1.5 bg-[#151515] border border-amber-500/30 text-amber-300 hover:border-amber-400 hover:text-white rounded-full text-[10px] uppercase tracking-widest font-mono flex items-center gap-1.5 backdrop-blur-md transition-all duration-300 active:scale-95"
              title="Strike heavy electric storm lightning!"
            >
              <span>⚡</span>
              <span>Lightning</span>
            </button>
          )}

          {useSimulator && (
            <div className="flex bg-[#151515] border border-[#333] rounded-full p-0.5">
              <button
                id="sim-single-btn"
                onClick={() => setSimHandsMode('single')}
                className={`px-3 py-1 text-[9px] uppercase font-mono rounded-full tracking-wider transition-all ${
                  simHandsMode === 'single' ? 'bg-[#333] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Symmetric Portal
              </button>
              <button
                id="sim-double-btn"
                onClick={() => setSimHandsMode('double')}
                className={`px-3 py-1 text-[9px] uppercase font-mono rounded-full tracking-wider transition-all ${
                  simHandsMode === 'double' ? 'bg-[#333] text-[#00FF5F]' : 'text-gray-400 hover:text-[#00FF5F]'
                }`}
              >
                Manual Portal
              </button>
            </div>
          )}

          {/* Portal Shape Selector */}
          <div className="flex bg-[#121212]/90 border border-zinc-800 rounded-full p-0.5 backdrop-blur-md shadow-[0_0_15px_rgba(0,0,0,0.5)]" title="Configure Portal Frame Shape">
            <button
              onClick={() => {
                setPortalShape('rectangle');
                synth.triggerShutter();
              }}
              className={`px-2.5 py-1 text-[9px] uppercase font-mono rounded-full tracking-wider transition-all flex items-center gap-1 cursor-pointer ${
                portalShape === 'rectangle' ? 'bg-[#00FF5F]/20 text-[#00FF5F] font-bold border border-[#00FF5F]/35 shadow-[0_0_8px_rgba(0,255,95,0.25)]' : 'text-gray-400 hover:text-white border border-transparent'
              }`}
            >
              <span>⏹️</span>
              <span>Rect</span>
            </button>
            <button
              onClick={() => {
                setPortalShape('circle');
                synth.triggerShutter();
              }}
              className={`px-2.5 py-1 text-[9px] uppercase font-mono rounded-full tracking-wider transition-all flex items-center gap-1 cursor-pointer ${
                portalShape === 'circle' ? 'bg-[#00F0FF]/20 text-[#00F0FF] font-bold border border-[#00F0FF]/35 shadow-[0_0_8px_rgba(0,240,255,0.25)]' : 'text-gray-400 hover:text-white border border-transparent'
              }`}
            >
              <span>🟢</span>
              <span>Circle</span>
            </button>
            <button
              onClick={() => {
                setPortalShape('heart');
                synth.triggerShutter();
              }}
              className={`px-2.5 py-1 text-[9px] uppercase font-mono rounded-full tracking-wider transition-all flex items-center gap-1 cursor-pointer ${
                portalShape === 'heart' ? 'bg-[#FF2A6D]/20 text-[#FF2A6D] font-bold border border-[#FF2A6D]/35 shadow-[0_0_8px_rgba(255,42,109,0.25)]' : 'text-gray-400 hover:text-white border border-transparent'
              }`}
            >
              <span>❤️</span>
              <span>Heart</span>
            </button>
          </div>

          {/* Interactive Wink Snapshot Badge / Button */}
          <button
            onClick={saveSnapshot}
            className="px-3 py-1 bg-[#121212]/90 border border-purple-500/30 text-purple-400 hover:border-purple-400 hover:text-white rounded-full text-[9px] uppercase tracking-wider font-mono flex items-center gap-1.5 backdrop-blur-md transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer shadow-[0_0_12px_rgba(168,85,247,0.25)] group"
            title="Wink / Blink your eye or press [Spacebar]/[B]/[W] to snap screenshot!"
          >
            <span className="text-xs group-hover:scale-125 transition-transform duration-200">
              {isWinking ? '😉' : '👁️'}
            </span>
            <span className="tracking-widest">{isWinking ? 'WINK!' : 'WINK SNAP'}</span>
          </button>
        </div>

        {/* Compact, elegant Simulator User Assistance Panel */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 max-w-sm text-right select-none pointer-events-none">
          {useSimulator ? (
            showSimInfo && (
              <div className="bg-[#101010]/92 border border-zinc-800 rounded-2xl p-3.5 backdrop-blur-md max-w-[280px] shadow-2xl transition-all duration-300 text-left pointer-events-auto relative">
                <button
                  id="close-sim-info-btn"
                  onClick={() => setShowSimInfo(false)}
                  className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-white rounded-full bg-zinc-900/50 hover:bg-zinc-800 transition-all border border-zinc-800/50 cursor-pointer"
                  title="Close help tips"
                >
                  <span className="text-[9px]">✕</span>
                </button>
                <span className="text-[9px] tracking-widest text-[#00FF5F] uppercase font-bold block mb-1 pr-4">
                  💻 INTERACTIVE SIMULATOR
                </span>
                <p className="text-[10px] text-zinc-400 leading-normal mb-2 pr-4">
                  Camera access is blocked or unavailable in this iframe. Use our responsive mouse/touch simulation below!
                </p>
                <div className="text-[9px] font-mono text-zinc-500 space-y-1 border-t border-zinc-900 pt-2">
                  <div className="flex justify-between"><span>[Cursor]</span> <span className="text-zinc-300">Hover tracking</span></div>
                  <div className="flex justify-between"><span>[Left-Click]</span> <span className="text-zinc-300">Pinch & Wipe/Paint</span></div>
                  <div className="flex justify-between"><span>[Double Hand]</span> <span className="text-zinc-300">Drag control dots</span></div>
                </div>
              </div>
            )
          ) : (
            showWebcamInfo && (
              <div className="bg-[#101010]/92 border border-[#00FF5F]/20 rounded-2xl p-3.5 backdrop-blur-md max-w-[280px] shadow-2xl transition-all duration-300 text-left pointer-events-auto relative">
                <button
                  id="close-webcam-info-btn"
                  onClick={() => setShowWebcamInfo(false)}
                  className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-white rounded-full bg-zinc-900/50 hover:bg-zinc-800 transition-all border border-zinc-800/50 cursor-pointer"
                  title="Close help tips"
                >
                  <span className="text-[9px]">✕</span>
                </button>
                <span className="text-[9px] tracking-widest text-[#00FF5F] uppercase font-bold block mb-1 pr-4">
                  📷 WEBCAM CONTROL ACTIVE
                </span>
                <p className="text-[10px] text-zinc-300 leading-normal pr-4">
                  Symmetric double-hand mode is active! Make a <strong className="text-white font-semibold">thumb-index pinch</strong> gesture to wipe/paint with symmetric dual hands!
                </p>
              </div>
            )
          )}
        </div>

      </div>

      {/* Unified iOS Style Floating Control Bar */}
      <div className="bg-[#121212]/95 border-t border-[#222] p-3 md:p-4 z-20 flex flex-col gap-3">
        
        {/* Main Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          
          {/* Left Block: Colors & Brushes */}
          <div className="flex flex-wrap items-center gap-3 justify-center sm:justify-start w-full sm:w-auto">
            {/* Palette Dot Selection (Sleek Apple style dots) */}
            <div className="flex items-center gap-1.5 p-1 bg-[#1A1A1A] rounded-full border border-white/5">
              {BRUSH_COLORS.map(color => (
                <button
                  id={`color-${color.name.toLowerCase().replace(' ', '-')}`}
                  key={color.name}
                  onClick={() => setActiveColor(color)}
                  className={`w-8 h-8 md:w-9 md:h-9 rounded-full relative transition-all duration-200 hover:scale-110 active:scale-95 flex items-center justify-center cursor-pointer`}
                  style={{ 
                    background: color.value === 'rainbow' 
                      ? 'linear-gradient(135deg, #FF007F, #00F0FF, #00FF5F)' 
                      : color.value 
                  }}
                  title={color.name}
                >
                  {activeColor.name === color.name && (
                    <div className="w-2.5 h-2.5 rounded-full bg-white shadow-md animate-pulse" />
                  )}
                </button>
              ))}
            </div>

            {/* Brush styles as simple, sleek icon capsules */}
            <div className="flex items-center gap-1 p-1 bg-[#1A1A1A] rounded-2xl border border-white/5">
              {BRUSH_STYLES.map(style => (
                <button
                  id={`brush-style-${style.id}`}
                  key={style.id}
                  onClick={() => setBrushStyle(style.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all duration-200 cursor-pointer ${
                    brushStyle === style.id 
                      ? 'bg-zinc-800 text-[#00FF5F] border border-white/10 font-bold' 
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <span className="text-sm">{style.icon}</span>
                  <span className="hidden xs:inline">{style.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right Block: Actions Dock */}
          <div className="flex items-center gap-2 justify-center w-full sm:w-auto border-t sm:border-t-0 border-[#222] pt-3 sm:pt-0">
            {/* Audio Feedback Toggle */}
            <button
              id="synth-sound-btn"
              onClick={() => setEnableAudio(!enableAudio)}
              className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all duration-200 border cursor-pointer ${
                enableAudio 
                  ? 'bg-[#00FF5F]/10 border-[#00FF5F] text-[#00FF5F] glow-green' 
                  : 'bg-[#1A1A1A] border-white/5 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
              title="Sound Synthesizer"
            >
              {enableAudio ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Clear Canvas */}
            <button
              id="clear-canvas-btn"
              onClick={clearCanvas}
              className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-[#1A1A1A] border border-white/5 text-zinc-400 hover:text-red-400 hover:border-red-900/40 hover:bg-red-950/20 flex items-center justify-center transition-all duration-200 cursor-pointer"
              title="Clear Paint"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Save snapshot */}
            <button
              id="save-snapshot-btn"
              onClick={saveSnapshot}
              className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-[#1A1A1A] border border-white/5 text-zinc-400 hover:text-white hover:border-zinc-700 flex items-center justify-center transition-all duration-200 cursor-pointer"
              title="Export Snapshot"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Sliders / Advanced Settings Toggle */}
            <button
              id="toggle-settings-btn"
              onClick={() => setShowSettings(!showSettings)}
              className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all duration-200 border cursor-pointer ${
                showSettings 
                  ? 'bg-[#00F0FF]/10 border-[#00F0FF] text-[#00F0FF]' 
                  : 'bg-[#1A1A1A] border-white/5 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
              title="Refine Settings"
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>

        </div>

        {/* Collapsible iOS Sliders Panel */}
        {showSettings && (
          <div className="mt-2 p-3 md:p-4 bg-[#181818] rounded-2xl border border-white/5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 transition-all duration-300">
            {/* Brush Size */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px] font-mono text-zinc-400 uppercase">
                <span>Brush Thickness</span>
                <span className="text-[#00FF5F] font-bold">{brushSize} px</span>
              </div>
              <input 
                id="brush-size-slider"
                type="range" 
                min="2" 
                max="30" 
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="accent-[#00FF5F] h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer w-full"
              />
            </div>

            {/* Pinch Sensitivity */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px] font-mono text-zinc-400 uppercase">
                <span>Pinch Sensitivity</span>
                <span className="text-[#00F0FF] font-bold">{Math.round(pinchThreshold * 1000)}</span>
              </div>
              <input 
                id="pinch-threshold-slider"
                type="range" 
                min="0.01" 
                max="0.08" 
                step="0.005"
                value={pinchThreshold}
                onChange={(e) => setPinchThreshold(parseFloat(e.target.value))}
                className="accent-[#00F0FF] h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer w-full"
              />
            </div>

            {/* Camera Dim % */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px] font-mono text-zinc-400 uppercase">
                <span>Backdrop Dim %</span>
                <span className="text-zinc-300 font-bold">{grayscaleBackdrop}%</span>
              </div>
              <input 
                id="camera-dim-slider"
                type="range" 
                min="0" 
                max="100" 
                value={grayscaleBackdrop}
                onChange={(e) => setGrayscaleBackdrop(parseInt(e.target.value))}
                className="accent-zinc-400 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer w-full"
              />
            </div>

            {/* Camera Filter Style Selector */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Camera Filter</span>
              <div className="flex bg-[#222] border border-zinc-800 rounded-xl p-0.5">
                {(['slate', 'cyberpunk', 'matrix', 'thermal'] as const).map(filter => {
                  const filterLabels = {
                    slate: 'Slate',
                    cyberpunk: 'Neon',
                    matrix: 'Matrix',
                    thermal: 'Heat'
                  };
                  return (
                    <button
                      key={filter}
                      onClick={() => setCameraFilter(filter)}
                      className={`flex-1 py-1 text-[9px] uppercase font-mono rounded-lg tracking-wider transition-all cursor-pointer ${
                        cameraFilter === filter 
                          ? 'bg-zinc-700 text-white font-bold' 
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {filterLabels[filter]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Portal Shape Selection */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Portal Shape</span>
              <div className="flex bg-[#222] border border-zinc-800 rounded-xl p-0.5">
                {(['rectangle', 'circle', 'heart'] as const).map(shape => {
                  const shapeLabels = {
                    rectangle: '⏹️ Rect',
                    circle: '🟢 Circ',
                    heart: '❤️ Heart'
                  };
                  return (
                    <button
                      key={shape}
                      onClick={() => {
                        setPortalShape(shape);
                        synth.triggerShutter();
                      }}
                      className={`flex-1 py-1 text-[9px] uppercase font-mono rounded-lg tracking-wider transition-all cursor-pointer ${
                        portalShape === shape 
                          ? shape === 'heart'
                            ? 'bg-[#FF2A6D]/20 text-[#FF2A6D] font-bold'
                            : shape === 'circle'
                              ? 'bg-[#00F0FF]/20 text-[#00F0FF] font-bold'
                              : 'bg-[#00FF5F]/20 text-[#00FF5F] font-bold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {shapeLabels[shape]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Input Source & Simulation mode */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Input Source</span>
              <div className="flex flex-col gap-1.5">
                <button 
                  id="settings-camera-toggle-btn"
                  onClick={toggleCamera}
                  className={`w-full py-1 px-2 border rounded-xl text-[9px] uppercase tracking-wider font-mono flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                    !useSimulator 
                      ? 'bg-[#00FF5F]/15 border-[#00FF5F]/40 text-[#00FF5F]' 
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Camera className="w-3 h-3" />
                  <span>{!useSimulator ? 'Camera Active' : 'Simulator Active'}</span>
                </button>

                {useSimulator && (
                  <div className="flex bg-[#222] border border-zinc-800 rounded-xl p-0.5">
                    <button
                      id="settings-sim-single-btn"
                      onClick={() => setSimHandsMode('single')}
                      className={`flex-1 py-1 text-[9px] uppercase font-mono rounded-lg tracking-wider transition-all cursor-pointer ${
                        simHandsMode === 'single' ? 'bg-zinc-700 text-white font-bold' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Symmetric
                    </button>
                    <button
                      id="settings-sim-double-btn"
                      onClick={() => setSimHandsMode('double')}
                      className={`flex-1 py-1 text-[9px] uppercase font-mono rounded-lg tracking-wider transition-all cursor-pointer ${
                        simHandsMode === 'double' ? 'bg-zinc-700 text-[#00FF5F] font-bold' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Manual
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Foggy Glass Environment */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Glass Window Fog</span>
              <div className="flex flex-col gap-1.5">
                <button 
                  id="settings-foggy-toggle-btn"
                  onClick={toggleFoggyMode}
                  className={`w-full py-1 px-2 border rounded-xl text-[9px] uppercase tracking-wider font-mono flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                    foggyGlassMode 
                      ? 'bg-blue-500/15 border-blue-400/40 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.2)]' 
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >
                  <span>🌧️</span>
                  <span>{foggyGlassMode ? 'Foggy Mode: ON' : 'Foggy Mode: OFF'}</span>
                </button>

                {foggyGlassMode && (
                  <div className="flex gap-1">
                    <button 
                      id="settings-breathe-mist-btn"
                      onClick={breatheMist}
                      className="flex-1 py-1 px-1.5 bg-zinc-800 border border-blue-500/20 text-blue-300 hover:text-white rounded-lg text-[9px] uppercase font-mono text-center cursor-pointer"
                    >
                      💨 Blow
                    </button>
                    <button 
                      id="settings-strike-lightning-btn"
                      onClick={triggerLightning}
                      className="flex-1 py-1 px-1.5 bg-zinc-800 border border-amber-500/20 text-amber-300 hover:text-white rounded-lg text-[9px] uppercase font-mono text-center cursor-pointer"
                    >
                      ⚡ Lightn
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Extras, Hand Mesh & Quick Screenshot */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Extras & Capture</span>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between bg-[#222] border border-zinc-800 rounded-xl px-2.5 py-1">
                  <span className="text-[9px] font-mono text-zinc-400 uppercase">Hand Mesh</span>
                  <button
                    id="settings-mesh-toggle-btn"
                    onClick={() => setShowMesh(!showMesh)}
                    className={`px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${
                      showMesh 
                        ? 'bg-[#00FF5F]/15 border-[#00FF5F] text-[#00FF5F]' 
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                    }`}
                  >
                    {showMesh ? 'Visible' : 'Hidden'}
                  </button>
                </div>

                <button
                  id="settings-wink-snap-btn"
                  onClick={saveSnapshot}
                  className="w-full py-1 px-2 bg-zinc-800 border border-purple-500/25 text-purple-400 hover:border-purple-400 hover:text-white rounded-xl text-[9px] uppercase tracking-wider font-mono flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer"
                >
                  <span>{isWinking ? '😉' : '👁️'}</span>
                  <span>Wink Snapshot</span>
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
