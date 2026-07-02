class GestureSynth {
  private ctx: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private isActive: boolean = false;

  constructor() {
    // Initialized lazily on user interaction to comply with browser audio policies
  }

  private init() {
    if (this.ctx) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();
      
      this.filterNode = this.ctx.createBiquadFilter();
      this.filterNode.type = 'lowpass';
      this.filterNode.frequency.setValueAtTime(1000, this.ctx.currentTime);
      this.filterNode.Q.setValueAtTime(3, this.ctx.currentTime);

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);

      this.filterNode.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);
    } catch (e) {
      console.error('Failed to initialize AudioContext:', e);
    }
  }

  public start() {
    this.init();
    if (!this.ctx || this.isActive) return;

    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      this.oscillator = this.ctx.createOscillator();
      // Cyberpunk sci-fi sound: triangle or sawtooth wave
      this.oscillator.type = 'triangle'; 
      this.oscillator.frequency.setValueAtTime(220, this.ctx.currentTime);
      
      this.oscillator.connect(this.filterNode!);
      this.oscillator.start();
      
      // Smooth fade-in
      this.gainNode!.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gainNode!.gain.setValueAtTime(0, this.ctx.currentTime);
      this.gainNode!.gain.linearRampToValueAtTime(0.08, this.ctx.currentTime + 0.15); // quiet, comfortable level
      
      this.isActive = true;
    } catch (e) {
      console.error('Error starting synthesizer:', e);
    }
  }

  public update(frequency: number, resonanceY: number) {
    if (!this.ctx || !this.isActive || !this.oscillator || !this.filterNode) return;

    const clampedFreq = Math.max(80, Math.min(1200, frequency));
    const clampedRes = Math.max(100, Math.min(3000, (1 - resonanceY) * 2000 + 200));

    // Smooth transition to avoid clicking
    const now = this.ctx.currentTime;
    this.oscillator.frequency.setTargetAtTime(clampedFreq, now, 0.05);
    this.filterNode.frequency.setTargetAtTime(clampedRes, now, 0.05);
  }

  public stop() {
    if (!this.ctx || !this.isActive || !this.oscillator || !this.gainNode) return;

    try {
      const now = this.ctx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1); // Smooth fade-out
      
      const osc = this.oscillator;
      setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
        } catch (e) {}
      }, 150);

      this.isActive = false;
    } catch (e) {
      console.error('Error stopping synthesizer:', e);
    }
  }

  public setVolume(vol: number) {
    if (!this.ctx || !this.gainNode) return;
    this.gainNode.gain.setValueAtTime(Math.max(0, Math.min(0.2, vol)), this.ctx.currentTime);
  }

  public triggerWhoosh() {
    this.init();
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const now = this.ctx.currentTime;
      
      // Create white noise buffer for realistic breath blowing / mist whoosh
      const bufferSize = this.ctx.sampleRate * 1.5; // 1.5 seconds
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(300, now);
      noiseFilter.frequency.exponentialRampToValueAtTime(1000, now + 0.35);
      noiseFilter.frequency.exponentialRampToValueAtTime(180, now + 1.3);
      noiseFilter.Q.setValueAtTime(2.2, now);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0, now);
      noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.25);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
      
      noiseNode.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
    } catch (e) {
      console.error('Error playing whoosh sound:', e);
    }
  }

  public triggerSpark() {
    this.init();
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const now = this.ctx.currentTime;
      
      // High frequency spark crackle + low sub bass thunder boom
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.linearRampToValueAtTime(35, now + 0.7);
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);
      
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.7);
    } catch (e) {}
  }
}

export const synth = new GestureSynth();
