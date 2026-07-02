import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, Activity, Compass, Zap, HelpCircle } from 'lucide-react';
import HandTracker from './components/HandTracker';

export default function App() {
  // Stats updated live from the HandTracker component
  const [trackerStats, setTrackerStats] = useState({
    fps: 60,
    handsDetected: 0,
    pinchDistance: 1.0,
    isPinching: false,
    gestureMode: 'NO_HANDS' as 'DRAWING' | 'COLOR_PORTAL' | 'NO_HANDS' | 'SIMULATING',
    lastCoords: { x: 0, y: 0 },
    portalSize: { width: 0, height: 0 }
  });

  // Dynamic rotation angle based on fingers/interaction
  const [interactionAngle, setInteractionAngle] = useState<number>(42.0831);

  // Trace actual coordinate rotation or float naturally
  useEffect(() => {
    if (trackerStats.gestureMode === 'NO_HANDS') {
      const interval = setInterval(() => {
        setInteractionAngle(prev => {
          const delta = (Math.random() - 0.5) * 0.4;
          return parseFloat((prev + delta).toFixed(4));
        });
      }, 500);
      return () => clearInterval(interval);
    } else {
      // Calculate angle from the index coordinate to center of screen
      const dx = trackerStats.lastCoords.x - window.innerWidth / 2;
      const dy = trackerStats.lastCoords.y - window.innerHeight / 2;
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      setInteractionAngle(parseFloat((deg < 0 ? deg + 360 : deg).toFixed(4)));
    }
  }, [trackerStats.lastCoords, trackerStats.gestureMode]);

  // Map gesture mode to readable minimal labels
  const getGestureLabel = () => {
    switch (trackerStats.gestureMode) {
      case 'DRAWING':
        return trackerStats.isPinching ? 'Pinch Paint' : 'Hover Tracking';
      case 'COLOR_PORTAL':
        return 'Color Portal Reveal';
      case 'SIMULATING':
        return 'Simulator Mode Active';
      case 'NO_HANDS':
      default:
        return 'Scanning Hand...';
    }
  };

  return (
    <div className="w-full h-screen max-w-7xl mx-auto p-3 md:p-6 flex flex-col justify-between overflow-hidden select-none box-border bg-[#0F0F0F] text-[#E5E5E5]">
      
      {/* HEADER SECTION - Sleek Apple UI */}
      <header className="flex justify-between items-center mb-4 md:mb-6 shrink-0 border-b border-[#1A1A1A] pb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-white font-display">
              AURA<span className="text-[#00FF5F] text-glow-green">.</span>OS
            </h1>
            <div className="absolute -bottom-1 left-0 w-8 h-0.5 bg-gradient-to-r from-[#00FF5F] to-[#00F0FF]" />
          </div>
          <span className="hidden sm:inline-block text-[10px] tracking-[0.25em] text-[#666] uppercase font-semibold border-l border-[#222] pl-3">
            Spatial Interactive Core
          </span>
        </div>
        
        {/* Live Minimal HUD Statuses */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 border border-[#222] rounded-full flex items-center gap-2 bg-[#141414]/90 backdrop-blur-md">
            <div className={`w-1.5 h-1.5 rounded-full ${trackerStats.handsDetected > 0 ? 'bg-[#00FF5F] animate-pulse glow-green' : 'bg-zinc-600'}`}></div>
            <span className="text-[10px] font-mono tracking-wider text-zinc-300 uppercase">
              {trackerStats.handsDetected > 0 ? `${trackerStats.handsDetected} Hand` : 'No Input'}
            </span>
          </div>

          <div className="px-3 py-1 border border-[#222] rounded-full flex items-center gap-1.5 bg-[#141414]/90 backdrop-blur-md text-[10px] font-mono text-zinc-400">
            <Activity className="w-3 h-3 text-[#00F0FF]" />
            <span>{trackerStats.fps} FPS</span>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER - Maximized to 100% width and height */}
      <main className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative rounded-2xl md:rounded-3xl border border-[#222] bg-[#0A0A0A]">
        <HandTracker onStatsUpdate={setTrackerStats} />
      </main>

      {/* FOOTER METRIC HUD BAR - Compressed and beautifully aligned */}
      <footer className="mt-4 pt-3 border-t border-[#1A1A1A] flex flex-wrap justify-between items-center gap-3 text-[11px] font-mono shrink-0">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-zinc-500">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-600">STATE:</span>
            <span className="font-semibold text-white tracking-wide">{getGestureLabel()}</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="text-zinc-600">ORIENTATION:</span>
            <span className="text-zinc-300">θ = {interactionAngle}°</span>
          </div>
          <div className="hidden md:flex items-center gap-1.5">
            <span className="text-zinc-600">PINCH SPAN:</span>
            <span className={`font-semibold ${trackerStats.isPinching ? 'text-[#00FF5F]' : 'text-zinc-400'}`}>
              {trackerStats.pinchDistance.toFixed(3)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#00FF5F]" />
            <span className="text-zinc-400">NOMINAL</span>
          </div>
        </div>
        
        {/* Animated micro-equalizer visual */}
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 items-end h-4">
            {[0, 1, 2, 3, 4].map((index) => {
              const heightValues = trackerStats.gestureMode === 'NO_HANDS' 
                ? [4, 8, 6, 10, 4] 
                : trackerStats.isPinching 
                  ? [12, 18, 14, 20, 10] 
                  : [8, 12, 10, 14, 6];
              const h = heightValues[index] + (Math.sin(Date.now() / 150 + index) * (trackerStats.gestureMode === 'NO_HANDS' ? 1 : 3));
              
              return (
                <div 
                  key={index} 
                  className={`w-1 rounded-full transition-all duration-150 ${
                    trackerStats.gestureMode !== 'NO_HANDS' 
                      ? trackerStats.isPinching 
                        ? 'bg-[#00FF5F] glow-green' 
                        : 'bg-[#00F0FF]' 
                      : 'bg-zinc-800'
                  }`}
                  style={{ height: `${Math.max(2, h)}px` }}
                />
              );
            })}
          </div>
          <span className="text-[10px] text-zinc-600">SYS_V0.4</span>
        </div>
      </footer>
    </div>
  );
}
