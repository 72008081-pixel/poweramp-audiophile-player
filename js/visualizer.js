/**
 * 60 FPS High-Fidelity Canvas Spectrum Visualizer & EQ Curve Graph
 * Inspirado en la estética técnica de Poweramp v3.
 * Modos: Poweramp Bars (Barras con Peak Hold), Waveform (Osciloscopio Neón) y Radial Nebula.
 */

class AudioVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = audioEngine;
    this.mode = 'bars'; // 'bars', 'wave', 'radial'
    this.isRunning = false;
    this.animationId = null;

    this.fftBins = 128; // Barras visuales
    this.freqData = new Uint8Array(1024);
    this.timeData = new Uint8Array(1024);
    this.peaks = new Array(this.fftBins).fill(0);
    this.peakDecay = 0.96;

    this.accentColor = '#00f0ff';
    this.accentGlow = 'rgba(0, 240, 255, 0.4)';

    this.setupResize();
  }

  setupResize() {
    const resize = () => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.floor(rect.width * dpr);
      this.canvas.height = Math.floor(rect.height * dpr);
      this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset
      this.ctx.scale(dpr, dpr);
    };

    window.addEventListener('resize', resize);
    setTimeout(resize, 50);
  }

  setMode(newMode) {
    if (['bars', 'wave', 'radial'].includes(newMode)) {
      this.mode = newMode;
    }
  }

  setAccentColor(color, glow) {
    this.accentColor = color || '#00f0ff';
    this.accentGlow = glow || 'rgba(0, 240, 255, 0.4)';
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const loop = () => {
      if (!this.isRunning) return;
      this.render();
      this.animationId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.clear();
  }

  clear() {
    if (!this.ctx || !this.width) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  render() {
    if (!this.engine || !this.engine.analyserNode) {
      this.clear();
      return;
    }

    this.engine.getFrequencyData(this.freqData);
    this.engine.getTimeDomainData(this.timeData);

    this.ctx.clearRect(0, 0, this.width, this.height);

    if (this.mode === 'bars') {
      this.renderBars();
    } else if (this.mode === 'wave') {
      this.renderWave();
    } else if (this.mode === 'radial') {
      this.renderRadial();
    }

    this.updateVUMeters();
  }

  /**
   * Renderizado de Barras estilo Poweramp con Peak-Hold
   */
  renderBars() {
    const numBars = Math.min(this.fftBins, Math.floor(this.width / 6));
    const barWidth = Math.max(2, (this.width / numBars) - 2);
    const maxHeight = this.height * 0.92;

    const grad = this.ctx.createLinearGradient(0, this.height, 0, 0);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0.15)');
    grad.addColorStop(0.5, this.accentColor);
    grad.addColorStop(1, '#ffffff');

    for (let i = 0; i < numBars; i++) {
      // Usar escala logarítmica para distribuir energía musical
      const freqIndex = Math.floor(Math.pow(i / numBars, 1.8) * (this.freqData.length * 0.7));
      const val = this.freqData[freqIndex] || 0;
      const barHeight = Math.max(2, (val / 255) * maxHeight);

      const x = i * (barWidth + 2);
      const y = this.height - barHeight;

      // Actualizar Peak Hold
      if (barHeight >= this.peaks[i]) {
        this.peaks[i] = barHeight;
      } else {
        this.peaks[i] = Math.max(0, this.peaks[i] * this.peakDecay);
      }

      // Dibujar barra con esquinas redondeadas
      this.ctx.fillStyle = grad;
      this.ctx.shadowBlur = 8;
      this.ctx.shadowColor = this.accentGlow;
      this.roundRect(x, y, barWidth, barHeight, 2);

      // Dibujar línea Peak Hold superior
      const peakY = this.height - this.peaks[i] - 2;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.shadowBlur = 4;
      this.ctx.shadowColor = '#ffffff';
      this.ctx.fillRect(x, Math.max(0, peakY), barWidth, 1.5);
    }
    this.ctx.shadowBlur = 0;
  }

  /**
   * Renderizado de Osciloscopio Neón (Forma de Onda)
   */
  renderWave() {
    const sliceWidth = this.width / this.timeData.length;
    this.ctx.lineWidth = 2.5;
    this.ctx.strokeStyle = this.accentColor;
    this.ctx.shadowBlur = 12;
    this.ctx.shadowColor = this.accentColor;
    this.ctx.beginPath();

    let x = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = this.timeData[i] / 128.0; // 0 a 2
      const y = (v * this.height) / 2;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    this.ctx.lineTo(this.width, this.height / 2);
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
  }

  /**
   * Renderizado Radial Circular (Nebula)
   */
  renderRadial() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const radius = Math.min(cx, cy) * 0.45;
    const numPoints = 80;

    this.ctx.save();
    this.ctx.translate(cx, cy);

    this.ctx.strokeStyle = this.accentColor;
    this.ctx.lineWidth = 2;
    this.ctx.shadowBlur = 15;
    this.ctx.shadowColor = this.accentGlow;
    this.ctx.beginPath();

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const freqIdx = Math.floor((i / numPoints) * (this.freqData.length * 0.5));
      const amp = (this.freqData[freqIdx] / 255) * (radius * 0.7);
      const r = radius + amp;

      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;

      if (i === 0) {
        this.ctx.moveTo(px, py);
      } else {
        this.ctx.lineTo(px, py);
      }
    }

    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.restore();
    this.ctx.shadowBlur = 0;
  }

  roundRect(x, y, w, h, radius) {
    if (w < 2 * radius) radius = w / 2;
    if (h < 2 * radius) radius = h / 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, radius);
    this.ctx.arcTo(x + w, y + h, x, y + h, 0);
    this.ctx.arcTo(x, y + h, x, y, 0);
    this.ctx.arcTo(x, y, x + w, y, radius);
    this.ctx.closePath();
    this.ctx.fill();
  }

  /**
   * Actualiza los VUMeters estéreo (izq / der) en el DOM si existen
   */
  updateVUMeters() {
    let sumLeft = 0;
    let sumRight = 0;
    const half = Math.floor(this.timeData.length / 2);

    for (let i = 0; i < half; i++) {
      const v = (this.timeData[i] - 128) / 128;
      sumLeft += v * v;
    }
    for (let i = half; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128;
      sumRight += v * v;
    }

    const rmsLeft = Math.min(100, Math.sqrt(sumLeft / half) * 220);
    const rmsRight = Math.min(100, Math.sqrt(sumRight / half) * 220);

    const vuL = document.getElementById('vu-meter-left');
    const vuR = document.getElementById('vu-meter-right');
    const vuTextL = document.getElementById('vu-db-left');
    const vuTextR = document.getElementById('vu-db-right');

    if (vuL) vuL.style.height = `${rmsLeft}%`;
    if (vuR) vuR.style.height = `${rmsRight}%`;

    if (vuTextL) {
      const dbL = rmsLeft > 0 ? (20 * Math.log10(rmsLeft / 100)).toFixed(1) : '-INF';
      vuTextL.textContent = `${dbL} dB`;
    }
    if (vuTextR) {
      const dbR = rmsRight > 0 ? (20 * Math.log10(rmsRight / 100)).toFixed(1) : '-INF';
      vuTextR.textContent = `${dbR} dB`;
    }
  }

  /**
   * Dibuja la curva analítica del EQ en el canvas dedicado de la sección de Ecualizador
   */
  static drawEQCurve(canvas, audioEngine) {
    if (!canvas || !audioEngine) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    // Dibujar rejilla técnica sutil
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    // Línea central 0 dB
    const midY = h / 2;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Líneas +6dB y -6dB
    const dbScale = (h / 2) / 18; // 18dB arriba y abajo
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY - 6 * dbScale);
    ctx.lineTo(w, midY - 6 * dbScale);
    ctx.moveTo(0, midY + 6 * dbScale);
    ctx.lineTo(w, midY + 6 * dbScale);
    ctx.stroke();
    ctx.setLineDash([]);

    // Obtener puntos de la curva analítica
    const points = audioEngine.getFrequencyCurve(120);
    if (!points.length) return;

    // Dibujar gradiente de relleno bajo la curva
    const curveGrad = ctx.createLinearGradient(0, 0, 0, h);
    curveGrad.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
    curveGrad.addColorStop(0.5, 'rgba(0, 240, 255, 0.1)');
    curveGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.beginPath();
    ctx.moveTo(0, h);

    for (let i = 0; i < points.length; i++) {
      const x = (i / (points.length - 1)) * w;
      const y = midY - (points[i].db * dbScale);
      const clampedY = Math.max(2, Math.min(h - 2, y));
      if (i === 0) {
        ctx.lineTo(x, clampedY);
      } else {
        ctx.lineTo(x, clampedY);
      }
    }

    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = curveGrad;
    ctx.fill();

    // Línea de contorno neón de la curva
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = (i / (points.length - 1)) * w;
      const y = midY - (points[i].db * dbScale);
      const clampedY = Math.max(2, Math.min(h - 2, y));
      if (i === 0) ctx.moveTo(x, clampedY);
      else ctx.lineTo(x, clampedY);
    }
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(0, 240, 255, 0.8)';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

window.AudioVisualizer = AudioVisualizer;
