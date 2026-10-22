/**
 * Audiophile Web Audio Engine (Inspirado en Poweramp v3)
 * Procesa audio en coma flotante de 32-bits (Float32) a la frecuencia nativa del DAC/SO.
 * Incluye Ecualizador Gráfico de 10 Bandas, Pre-Amp con compensación analógica,
 * Analizador FFT de 2048 puntos y presets de estudio audiófilo.
 */

class AudioEngine {
  constructor(audioElement) {
    this.audioElement = audioElement;
    this.audioCtx = null;
    this.sourceNode = null;
    this.preAmpNode = null;
    this.filterNodes = [];
    this.pannerNode = null;
    this.analyserNode = null;
    this.masterGainNode = null;
    this.isInitialized = false;
    this.isBypassed = false;

    // Frecuencias estándar ISO para ecualizador de 10 bandas
    this.frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.bandLabels = ['31Hz', '62Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];
    this.gains = new Array(10).fill(0.0); // Valores en dB (-15 a +15 dB)
    this.preAmpDb = 0.0; // Pre-Amp en dB (-15 a +15 dB)

    // Presets audiófilos calibrados
    this.presets = {
      flat: { name: 'Flat (Referencia Estudio)', preAmp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      warm: { name: 'Audiophile Warm (Cálido)', preAmp: -1, bands: [3.5, 2.8, 1.8, 0.8, 0.0, 0.0, 0.5, 1.2, 2.0, 2.5] },
      bass: { name: 'Bass Extreme (Poweramp Club)', preAmp: -3.5, bands: [9.0, 7.5, 5.0, 2.0, 0.0, -1.0, 0.0, 1.0, 2.5, 3.0] },
      vshape: { name: 'V-Shape (Punch & Brillo)', preAmp: -2.5, bands: [7.0, 5.5, 3.0, 0.5, -2.0, -1.5, 1.0, 3.5, 6.0, 7.5] },
      vocal: { name: 'Vocal Clarity (Voces Claras)', preAmp: -1, bands: [-2.0, -1.5, 0.0, 2.5, 4.5, 5.0, 3.8, 2.0, 0.5, -1.0] },
      rock: { name: 'Rock & Metal (Dinámico)', preAmp: -2, bands: [5.0, 3.5, 2.0, 0.0, -1.0, 0.0, 2.0, 4.0, 5.5, 6.0] },
      electronic: { name: 'Electronic / Synthwave', preAmp: -3, bands: [6.5, 5.5, 2.0, 0.0, -1.5, 1.5, 2.5, 4.5, 6.0, 6.5] },
      acoustic: { name: 'Acoustic / Classical (Espacioso)', preAmp: 0, bands: [3.0, 2.5, 1.5, 0.0, 0.0, 0.0, 1.5, 2.5, 3.5, 4.0] },
      treble: { name: 'Treble Sparkle (Aire)', preAmp: -1.5, bands: [-3.0, -2.0, -1.0, 0.0, 0.0, 2.0, 4.0, 6.5, 8.5, 10.0] },
      latenight: { name: 'Late Night (Compensado)', preAmp: 1, bands: [2.0, 1.5, 0.0, -2.0, -2.5, -2.0, -1.0, 0.0, 1.0, 1.5] }
    };
  }

  /**
   * Inicializa la cadena de nodos Web Audio API tras interacción del usuario
   */
  async init() {
    if (this.isInitialized) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    // Usamos latencyHint: 'playback' para maximizar estabilidad de búfer y calidad
    this.audioCtx = new AudioContextClass({
      latencyHint: 'playback'
    });

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    // 1. Fuente desde el elemento HTMLMediaElement
    this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement);

    // 2. Pre-Amplificador (GainNode)
    this.preAmpNode = this.audioCtx.createGain();
    this.updatePreAmpGain();

    // 3. Cadena de 10 BiquadFilterNodes
    this.filterNodes = this.frequencies.map((freq, index) => {
      const filter = this.audioCtx.createBiquadFilter();
      if (index === 0) {
        filter.type = 'lowshelf';
        filter.frequency.value = freq;
      } else if (index === this.frequencies.length - 1) {
        filter.type = 'highshelf';
        filter.frequency.value = freq;
      } else {
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.414; // Factor Q optimizado para espaciado de 1 octava
      }
      filter.gain.value = this.gains[index];
      return filter;
    });

    // 4. Balance estéreo
    if (this.audioCtx.createStereoPanner) {
      this.pannerNode = this.audioCtx.createStereoPanner();
      this.pannerNode.pan.value = 0.0;
    }

    // 5. Analizador de Espectro FFT
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 2048; // 1024 bins de frecuencia para alta resolución
    this.analyserNode.smoothingTimeConstant = 0.85; // Suavizado fluido
    this.analyserNode.minDecibels = -90;
    this.analyserNode.maxDecibels = -10;

    // 6. Master Gain
    this.masterGainNode = this.audioCtx.createGain();
    this.masterGainNode.gain.value = 1.0;

    // Conectar el grafo: Source -> PreAmp -> EQ[0..9] -> Panner -> Analyser -> MasterGain -> Destination
    let currentNode = this.sourceNode;
    currentNode.connect(this.preAmpNode);
    currentNode = this.preAmpNode;

    for (const filter of this.filterNodes) {
      currentNode.connect(filter);
      currentNode = filter;
    }

    if (this.pannerNode) {
      currentNode.connect(this.pannerNode);
      currentNode = this.pannerNode;
    }

    currentNode.connect(this.analyserNode);
    this.analyserNode.connect(this.masterGainNode);
    this.masterGainNode.connect(this.audioCtx.destination);

    this.isInitialized = true;
    console.log(`[AudioEngine] Web Audio Engine activo a ${this.audioCtx.sampleRate} Hz (Float32)`);
  }

  /**
   * Actualiza el valor de Pre-Amp en decibelios
   * @param {number} db Valor de -15 a +15 dB
   */
  setPreAmp(db) {
    this.preAmpDb = Math.max(-15, Math.min(15, db));
    this.updatePreAmpGain();
  }

  updatePreAmpGain() {
    if (!this.preAmpNode) return;
    if (this.isBypassed) {
      this.preAmpNode.gain.setTargetAtTime(1.0, this.audioCtx.currentTime, 0.02);
      return;
    }
    // Conversión de dB a ganancia lineal: gain = 10^(dB / 20)
    const linearGain = Math.pow(10, this.preAmpDb / 20);
    this.preAmpNode.gain.setTargetAtTime(linearGain, this.audioCtx.currentTime, 0.02);
  }

  /**
   * Modifica la ganancia de una banda específica
   * @param {number} bandIndex Índice de 0 a 9
   * @param {number} db Valor de -15 a +15 dB
   */
  setBandGain(bandIndex, db) {
    if (bandIndex < 0 || bandIndex >= this.frequencies.length) return;
    this.gains[bandIndex] = Math.max(-15, Math.min(15, db));
    if (this.filterNodes[bandIndex] && !this.isBypassed) {
      this.filterNodes[bandIndex].gain.setTargetAtTime(this.gains[bandIndex], this.audioCtx.currentTime, 0.02);
    }
  }

  /**
   * Aplica un preset completo
   * @param {string} presetKey 
   */
  applyPreset(presetKey) {
    const preset = this.presets[presetKey];
    if (!preset) return;
    this.preAmpDb = preset.preAmp;
    this.gains = [...preset.bands];
    this.updateAllFilters();
    this.updatePreAmpGain();
  }

  /**
   * Restablece todas las bandas a plano (Flat)
   */
  resetFlat() {
    this.applyPreset('flat');
  }

  updateAllFilters() {
    if (!this.filterNodes.length) return;
    for (let i = 0; i < this.filterNodes.length; i++) {
      const targetGain = this.isBypassed ? 0.0 : this.gains[i];
      this.filterNodes[i].gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.02);
    }
  }

  /**
   * Activa o desactiva el ecualizador (Bypass)
   * @param {boolean} bypass 
   */
  setBypass(bypass) {
    this.isBypassed = !!bypass;
    this.updateAllFilters();
    this.updatePreAmpGain();
  }

  /**
   * Ajuste de balance estéreo (-1 izquierda, 0 centro, +1 derecha)
   */
  setPan(val) {
    if (this.pannerNode) {
      this.pannerNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, val)), this.audioCtx.currentTime, 0.02);
    }
  }

  /**
   * Calcula la curva de respuesta en frecuencia combinada del ecualizador
   * Evalúa la magnitud matemática de los 10 filtros en 100 frecuencias logarítmicas
   * @param {number} points Número de puntos para la curva (ej. 100)
   * @returns {Array<{freq: number, db: number}>}
   */
  getFrequencyCurve(points = 100) {
    if (!this.audioCtx || this.filterNodes.length === 0) {
      return [];
    }

    const minFreq = 20;
    const maxFreq = 20000;
    const freqArray = new Float32Array(points);

    // Generar frecuencias con espaciado logarítmico (como escucha el oído humano)
    for (let i = 0; i < points; i++) {
      freqArray[i] = minFreq * Math.pow(maxFreq / minFreq, i / (points - 1));
    }

    const totalDb = new Float32Array(points).fill(this.isBypassed ? 0 : this.preAmpDb);
    const magResponse = new Float32Array(points);
    const phaseResponse = new Float32Array(points);

    if (!this.isBypassed) {
      for (const filter of this.filterNodes) {
        filter.getFrequencyResponse(freqArray, magResponse, phaseResponse);
        for (let i = 0; i < points; i++) {
          const mag = Math.max(1e-6, magResponse[i]);
          totalDb[i] += 20 * Math.log10(mag);
        }
      }
    }

    const curveData = [];
    for (let i = 0; i < points; i++) {
      curveData.push({
        freq: freqArray[i],
        db: totalDb[i]
      });
    }
    return curveData;
  }

  /**
   * Obtiene datos de audio en tiempo real para visualización
   */
  getFrequencyData(targetArray) {
    if (!this.analyserNode) return;
    this.analyserNode.getByteFrequencyData(targetArray);
  }

  getTimeDomainData(targetArray) {
    if (!this.analyserNode) return;
    this.analyserNode.getByteTimeDomainData(targetArray);
  }

  /**
   * Información técnica del hardware de audio (para Badge audiófilo)
   */
  getHardwareInfo() {
    if (!this.audioCtx) {
      return {
        sampleRate: 48000,
        state: 'suspended',
        bitDepth: '32-bit Float',
        latency: 'Baja'
      };
    }
    return {
      sampleRate: this.audioCtx.sampleRate,
      state: this.audioCtx.state,
      bitDepth: '32-bit Float Internal',
      baseLatency: this.audioCtx.baseLatency ? (this.audioCtx.baseLatency * 1000).toFixed(1) + ' ms' : 'N/A',
      outputLatency: this.audioCtx.outputLatency ? (this.audioCtx.outputLatency * 1000).toFixed(1) + ' ms' : 'Direct'
    };
  }
}

window.AudioEngine = AudioEngine;
