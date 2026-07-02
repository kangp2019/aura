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

  // App Settings States
  const [activeColor, setActiveColor] = useState(BRUSH_COLORS[0]);
  const [brushSize, setBrushSize] = useState<number>(6);
  const [brushStyle, setBrushStyle] = useState<string>('neon');
  const [pinchThreshold, setPinchThreshold] = useState<number>(0.04);
  const [grayscaleBackdrop, setGrayscaleBackdrop] = useState<number>(90); // grayscale percentage
  const [enableAudio, setEnableAudio] = useState<boolean>(false);
  const [showMesh, setShowMesh] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [foggyGlassMode, setFoggyGlassMode] = useState<boolean>(false);

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
        await initWebcam();

        if (active) {
          setIsReady(true);
          setLoadingProgress(100);
        }
      } catch (err: any) {
        console.error('Webcam / MediaPipe error, falling back to mouse simulation:', err);
        if (active) {
          setCameraError(err.message || 'Webcam access denied or model loading failed.');
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
    if (!videoRef.current) return;

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
    } catch (err: any) {
      throw new Error('Webcam API rejected: Please allow camera access in frame or use Simulator.');
    }
  };

  // Turn Camera On/Off Toggle
  const toggleCamera = async () => {
    if (useSimulator) {
      setUseSimulator(false);
      try {
        await initWebcam();
      } catch (e: any) {
        setCameraError(e.message);
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
    const count = brushStyle === 'stars' ? 5 : 2;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2 + 1;
      particles.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5, // float up
        color: colorVal === 'rainbow' ? `hsl(${rainbowHue.current}, 90%, 60%)` : colorVal,
        size: Math.random() * 4 + 2,
        maxLife: Math.random() * 20 + 15,
        life: 0,
        type: brushStyle
      });
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

    // Create a download link
    const link = document.createElement('a');
    link.download = `AURA-OS-SNAPSHOT-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

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

        // Draw background video: Grayscale + Dimmed to stand out HUD graphics
        ctx.filter = `grayscale(${grayscaleBackdrop}%) brightness(40%) contrast(110%)`;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';

        // Detect Hands with MediaPipe
        let result: any = null;
        if (handLandmarkerRef.current) {
          result = handLandmarkerRef.current.detectForVideo(video, now);
        }

        if (result && result.landmarks && result.landmarks.length > 0) {
          handsDetected = result.landmarks.length;
          
          if (handsDetected === 1) {
            gestureMode = 'DRAWING';
            // Single Hand Drawing Mode
            const hand = result.landmarks[0];
            const thumb = hand[4];  // Thumb Tip
            const index = hand[8];  // Index Tip

            // Normalize coordinate
            const tx = (1 - thumb.x) * canvas.width;
            const ty = thumb.y * canvas.height;
            const ix = (1 - index.x) * canvas.width;
            const iy = index.y * canvas.height;

            trackingX = ix;
            trackingY = iy;

            // Compute distance in 3D Space
            const dx = thumb.x - index.x;
            const dy = thumb.y - index.y;
            const dz = thumb.z - index.z;
            pinchDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            isPinching = pinchDistance < pinchThreshold;

            if (isPinching) {
              const currentPt = { x: ix, y: iy };
              
              // Trigger shockwave & burst on first contact frame
              if (!wasPinchingRef.current) {
                triggerPinchBurst(ix, iy, brushColorValue);
                wasPinchingRef.current = true;
              }

              // Draw continuous line
              if (lastDrawingPointRef.current) {
                drawSegment(drawCtx, lastDrawingPointRef.current, currentPt, brushColorValue, brushStyle, brushSize);
              }

              // Emit Brush Particle Effect
              spawnParticles(ix, iy, brushColorValue);
              
              lastDrawingPointRef.current = currentPt;

              // Synth Audio trigger
              if (enableAudio) {
                synth.start();
                // Map coordinates to frequency: X bounds [0, width] -> [150, 850] Hz, Y bounds [0, height] -> [0.1, 0.9] res
                const freq = 150 + (ix / canvas.width) * 700;
                const filterRes = iy / canvas.height;
                synth.update(freq, filterRes);
              }
            } else {
              wasPinchingRef.current = false;
              lastDrawingPointRef.current = null;
              if (enableAudio) synth.stop();
            }

            // Draw visual connection reticle on top
            ctx.beginPath();
            ctx.strokeStyle = isPinching ? '#00FF5F' : 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.moveTo(tx, ty);
            ctx.lineTo(ix, iy);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw finger-tip nodes
            ctx.beginPath();
            ctx.arc(tx, ty, 6, 0, Math.PI * 2);
            ctx.fillStyle = activeColor.value === 'rainbow' ? '#FFF' : brushColorValue;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(ix, iy, 8, 0, Math.PI * 2);
            ctx.strokeStyle = isPinching ? '#00FF5F' : '#FFF';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Ripple on pinch
            if (isPinching) {
              ctx.beginPath();
              ctx.arc(ix, iy, 12 + Math.sin(now / 100) * 4, 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(0, 255, 95, 0.5)';
              ctx.stroke();
            }

          } else if (handsDetected >= 2) {
            // Two Hands: Lens reveal mode
            gestureMode = 'COLOR_PORTAL';
            lastDrawingPointRef.current = null;
            if (enableAudio) synth.stop();

            const h1 = result.landmarks[0];
            const h2 = result.landmarks[1];

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
          }

          // Optionally draw hands skeleton mesh
          if (showMesh) {
            drawHandMesh(ctx, result.landmarks);
          }
        } else {
          lastDrawingPointRef.current = null;
          if (enableAudio) synth.stop();
        }

      } else {
        // ------------------------------------
        // SECTION B: FALLBACK DESKTOP SIMULATOR
        // ------------------------------------
        gestureMode = 'SIMULATING';
        handsDetected = simHandsMode === 'single' ? 1 : 2;

        // Draw synthetic background matrix grid for cyberpunk HUD
        ctx.fillStyle = '#0F0F0F';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
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
        ctx.fillText(`MODE: ${simHandsMode === 'single' ? '1-Hand Paint' : '2-Hand Portal'}`, 32, 58);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillText('DRAG INTERACTIVE NODES', 32, 74);

        if (simHandsMode === 'single') {
          // Single Hand Drawing Simulator
          const handX = simHand1.x * canvas.width;
          const handY = simHand1.y * canvas.height;
          trackingX = handX;
          trackingY = handY;
          isPinching = simHand1.isPinching;
          pinchDistance = isPinching ? 0.01 : 0.08;

          if (isPinching) {
            const currentPt = { x: handX, y: handY };

            // Trigger shockwave & burst on first contact frame
            if (!wasPinchingRef.current) {
              triggerPinchBurst(handX, handY, brushColorValue);
              wasPinchingRef.current = true;
            }

            if (lastDrawingPointRef.current) {
              drawSegment(drawCtx, lastDrawingPointRef.current, currentPt, brushColorValue, brushStyle, brushSize);
            }
            
            spawnParticles(handX, handY, brushColorValue);
            lastDrawingPointRef.current = currentPt;

            if (enableAudio) {
              synth.start();
              const freq = 150 + (handX / canvas.width) * 700;
              const filterRes = handY / canvas.height;
              synth.update(freq, filterRes);
            }
          } else {
            wasPinchingRef.current = false;
            lastDrawingPointRef.current = null;
            if (enableAudio) synth.stop();
          }

          // Draw Simulated Hand Rig Visualizer
          ctx.beginPath();
          ctx.arc(handX, handY, isPinching ? 15 : 25, 0, Math.PI * 2);
          ctx.strokeStyle = isPinching ? '#00FF5F' : 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Connective lines to look mechanical
          ctx.beginPath();
          ctx.moveTo(handX, handY);
          ctx.lineTo(handX - 25, handY + 40);
          ctx.lineTo(handX + 25, handY + 40);
          ctx.closePath();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.stroke();

          // Finger tip dots
          ctx.beginPath();
          ctx.arc(handX - 5, handY - (isPinching ? 2 : 12), 4, 0, Math.PI * 2);
          ctx.arc(handX + 5, handY - (isPinching ? 2 : 12), 4, 0, Math.PI * 2);
          ctx.fillStyle = isPinching ? '#00FF5F' : 'rgba(255, 255, 255, 0.6)';
          ctx.fill();

          ctx.fillStyle = '#FFF';
          ctx.font = '10px monospace';
          ctx.fillText('INDEX_TIP', handX + 15, handY - 10);
        } else {
          // Double Hand Lens Simulator
          lastDrawingPointRef.current = null;
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
          
          // Draw a sci-fi scanning clipping area
          ctx.beginPath();
          ctx.rect(px_min, py_min, pw, ph);
          ctx.clip();

          // Within the clip, draw the video stream in full-color
          if (!useSimulator && videoRef.current) {
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          } else {
            // Simulator Color reveal: draw a vibrant futuristic grid of colors
            const grad = ctx.createLinearGradient(px_min, py_min, px_max, py_max);
            grad.addColorStop(0, '#00FF5F');
            grad.addColorStop(0.5, '#00F0FF');
            grad.addColorStop(1, '#FF007F');
            ctx.fillStyle = grad;
            ctx.fillRect(px_min, py_min, pw, ph);

            // Overlay scanning digital matrix code inside the portal
            ctx.fillStyle = 'rgba(15, 15, 15, 0.4)';
            ctx.fillRect(px_min, py_min, pw, ph);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            for (let x = px_min + 15; x < px_max; x += 15) {
              ctx.beginPath();
              ctx.moveTo(x, py_min);
              ctx.lineTo(x, py_max);
              ctx.stroke();
            }
          }

          ctx.restore();

          // Draw HUD Double Border
          ctx.strokeStyle = '#00FF5F';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(px_min, py_min, pw, ph);

          ctx.strokeStyle = 'rgba(0, 255, 95, 0.3)';
          ctx.lineWidth = 8;
          ctx.strokeRect(px_min - 4, py_min - 4, pw + 8, ph + 8);

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
        p.x += p.vx;
        p.y += p.vy;
        p.life += 1;

        const ratio = p.life / p.maxLife;
        const opacity = 1 - ratio;
        const currentSize = p.size * (1 - ratio * 0.5);

        ctx.fillStyle = p.color;
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
          ctx.fillRect(p.x - currentSize / 2, p.y - currentSize / 2, currentSize, currentSize);
        } else {
          // Sparkle circle
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
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
  }, [isReady, useSimulator, grayscaleBackdrop, activeColor, brushSize, brushStyle, pinchThreshold, enableAudio, showMesh, simHandsMode, simHand1, simHand2, foggyGlassMode, initializeFog]);

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
        <div className="absolute top-4 left-4 z-20 flex flex-wrap gap-2 max-w-[calc(100%-2rem)]">
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
            <span>{foggyGlassMode ? 'Foggy Glass (雾气擦玻璃): ON' : '🌧️ Foggy Glass (哈气擦玻璃)'}</span>
          </button>

          {useSimulator && (
            <div className="flex bg-[#151515] border border-[#333] rounded-full p-0.5">
              <button
                id="sim-single-btn"
                onClick={() => setSimHandsMode('single')}
                className={`px-3 py-1 text-[9px] uppercase font-mono rounded-full tracking-wider transition-all ${
                  simHandsMode === 'single' ? 'bg-[#333] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                1 Hand Draw
              </button>
              <button
                id="sim-double-btn"
                onClick={() => setSimHandsMode('double')}
                className={`px-3 py-1 text-[9px] uppercase font-mono rounded-full tracking-wider transition-all ${
                  simHandsMode === 'double' ? 'bg-[#333] text-[#00FF5F]' : 'text-gray-400 hover:text-[#00FF5F]'
                }`}
              >
                2 Hand Portal
              </button>
            </div>
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
          <div className="mt-2 p-3 md:p-4 bg-[#181818] rounded-2xl border border-white/5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 transition-all duration-300">
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

            {/* Hand Mesh grid toggle */}
            <div className="flex items-center justify-between h-full pt-1">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Skeleton Mesh Grid</span>
              <button
                id="mesh-toggle-btn"
                onClick={() => setShowMesh(!showMesh)}
                className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-xl border transition-all cursor-pointer ${
                  showMesh 
                    ? 'bg-[#00FF5F]/15 border-[#00FF5F] text-[#00FF5F]' 
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                }`}
              >
                {showMesh ? 'Visible' : 'Hidden'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
