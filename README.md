# AURA.OS 🌌 — Fluid Hand-Gesture Web Canvas

A high-performance, open-source client-side gesture interactive canvas designed with beautiful, minimal iOS UI aesthetics. Powered by **MediaPipe WebAssembly** (WASM) and built with **Vite + React 19**, it maps physical hand coordinates into spatial commands in real-time.

---

## ✨ Key Features

- 🎨 **Air Painting (Single-Hand)**: Paint glowing vector paths in thin air by bringing your thumb and index finger together.
- 🔮 **Multihand Portal Lens**: Bring both hands into view to create a spatial portal. The bounding box between your fingers unlocks vibrant full-color scanning matrices.
- 🎵 **Interactive Theremin Synth**: Draw with spatial sound feedback! Moves along the X-axis shift the oscillator frequency (pitch), while vertical shifts sweep the low-pass filter cutoff (resonance).
- 💻 **Intelligent Web Simulator**: No webcam? No problem. A fully interactive, clickable desktop simulator lets you control virtual hands to test layouts.
- 📱 **Sleek Apple Aesthetic**: Highly polished, ultra-modern interface optimized for responsive viewing on desktop, tablet, and mobile browsers. No bloated telemetry or complex menus — just instant, beautiful creation.

---

## 🚀 Getting Started

Experience the next-gen gesture canvas in just three commands:

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/aura-os.git
cd aura-os
npm install
```

### 2. Launch Local Dev Server
```bash
npm run dev
```
*Your application will boot up at `http://localhost:3000` with instant hot-reloading.*

### 3. Build for Production
```bash
npm run build
```
*This compiles high-efficiency minified static assets ready to be served on any modern hosting provider (Vercel, Netlify, Cloudflare).*

---

## 🛠️ Tech Stack & Architecture

- **Frontend Core**: [React 19](https://react.dev/) & [TypeScript](https://www.typescriptlang.org/)
- **Build System**: [Vite 6](https://vite.dev/)
- **Visuals & Layout**: [Tailwind CSS v4](https://tailwindcss.com/) & [Motion](https://motion.dev/) (elegant animations)
- **Neural Processor**: [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) (ultra-lightweight real-time ML modeling)
- **Audio Synthesis**: Web Audio API (custom oscillator & biquad filters)

---

## 📂 Project Structure

```text
├── src/
│   ├── components/
│   │   └── HandTracker.tsx   # Core webcam processor, canvas painter & simulator
│   ├── lib/
│   │   └── synth.ts          # Custom Web Audio synthesizer 
│   ├── App.tsx               # Minimal, elegant iOS HUD main wrapper
│   ├── index.css             # Tailwind v4 configuration, font styling & glows
│   └── main.tsx              # React mounting root
├── index.html                # Entry HTML wrapper
├── tsconfig.json             # TypeScript rules configuration
└── vite.config.ts            # Fast bundling alias setups
```

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
Feel free to fork, experiment, and integrate into your custom spatial computing solutions!
