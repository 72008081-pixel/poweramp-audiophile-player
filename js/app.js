/**
 * Powerify: Spotify UI x Poweramp Audiophile Engine
 * Master Coordinator: Web Audio API Float32, Spotify Track Table,
 * Background Audio con Pantalla Apagada en Celulares (Xiaomi 15 / Android),
 * MediaSession API Completa, Mobile Now Playing Modal y Ecualizador de 10 Bandas.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elementos principales del DOM
  const audioElement = document.getElementById('audio-core');
  const mainCanvas = document.getElementById('visualizer-canvas');
  const eqCurveCanvas = document.getElementById('eq-curve-canvas');
  const lyricsContainer = document.getElementById('lyrics-display');
  const rightSidebarLyrics = document.getElementById('sidebar-live-lyrics-preview');
  const mobileLyricsPreview = document.getElementById('mobile-live-lyrics-preview');

  // Inicializar subsistemas
  const audioEngine = new AudioEngine(audioElement);
  const visualizer = new AudioVisualizer(mainCanvas, audioEngine);
  const libraryManager = new LibraryManager();
  const lyricsEngine = new LyricsEngine(lyricsContainer, {
    sidebarPreview: rightSidebarLyrics,
    mobilePreview: mobileLyricsPreview
  });
  lyricsEngine.setSeekCallback((time) => {
    audioElement.currentTime = time;
  });
  const gDriveSync = new GoogleDriveSync(libraryManager);

  window.gDriveSync = gDriveSync;
  window.libraryManager = libraryManager;
  window.audioEngine = audioEngine;
  window.visualizer = visualizer;

  let isPlaying = false;
  let isShuffle = false;
  let repeatMode = 'off'; // 'off', 'all', 'one'
  let currentSpeed = 1.0;
  let isSeeking = false;
  let currentRightSidebarTab = 'spotify'; // 'spotify' | 'poweramp'

  // --- Desbloqueo del AudioContext y Asegurar Segundo Plano ---
  const unlockAudio = async () => {
    if (!audioEngine.isInitialized) {
      await audioEngine.init();
      visualizer.start();
      updateEQCurve();
      updateHardwareBadge();
    } else if (audioEngine.audioCtx && audioEngine.audioCtx.state === 'suspended') {
      await audioEngine.audioCtx.resume();
    }
  };

  // Resistencia a la suspensión del sistema operativo (Xiaomi 15 / Android Screen Off)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isPlaying) {
      if (audioEngine.audioCtx && audioEngine.audioCtx.state === 'suspended') {
        audioEngine.audioCtx.resume().catch(() => {});
      }
    }
  });

  // --- Carga y Reproducción de una Pista con Soporte de Pantalla Apagada ---
  const loadTrack = async (track) => {
    if (!track) return;

    await unlockAudio();

    audioElement.src = track.streamUrl || '';
    audioElement.playbackRate = currentSpeed;
    audioElement.loop = (repeatMode === 'one');

    // Actualizar UI del Reproductor Inferior, Banner Hero, Panel Derecho y Modal Móvil
    updateNowPlayingInfo(track);

    // Cargar letras sincronizadas
    lyricsEngine.load(track.lyrics || '');

    // Actualizar estados de botones de favorito
    updateFavButton(track.id);

    // Configurar MediaSession API para Controles Nativos en Pantalla de Bloqueo
    setupMediaSession(track);

    try {
      await audioElement.play();
      isPlaying = true;
      updatePlayPauseUI(true);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch (e) {
      console.warn('Reproducción en espera:', e);
      isPlaying = false;
      updatePlayPauseUI(false);
    }
  };

  // --- Integración Robusta de MediaSession API para Xiaomi 15 (Pantalla Apagada) ---
  const setupMediaSession = (track) => {
    if (!('mediaSession' in navigator)) return;

    const coverUrl = track.coverUrl || `assets/covers/cover_${((track.index || 0) % 241) + 1}.jpg`;
    const absoluteCoverUrl = new URL(coverUrl, window.location.href).href;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Música Ulicito',
      artist: track.artist || 'Ulianov Cuba',
      album: track.album || 'MÚSICA ULICITO',
      artwork: [
        { src: absoluteCoverUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: absoluteCoverUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: absoluteCoverUrl, sizes: '192x192', type: 'image/jpeg' },
        { src: absoluteCoverUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: absoluteCoverUrl, sizes: '384x384', type: 'image/jpeg' },
        { src: absoluteCoverUrl, sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => {
      audioElement.play().catch(() => {});
      isPlaying = true;
      updatePlayPauseUI(true);
      navigator.mediaSession.playbackState = 'playing';
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      audioElement.pause();
      isPlaying = false;
      updatePlayPauseUI(false);
      navigator.mediaSession.playbackState = 'paused';
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      playPrev();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNext();
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime && audioElement.duration) {
        audioElement.currentTime = details.seekTime;
      }
    });

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skip = details.seekOffset || 10;
      audioElement.currentTime = Math.max(audioElement.currentTime - skip, 0);
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skip = details.seekOffset || 10;
      audioElement.currentTime = Math.min(audioElement.currentTime + skip, audioElement.duration || 0);
    });

    navigator.mediaSession.setActionHandler('stop', () => {
      audioElement.pause();
      audioElement.currentTime = 0;
      isPlaying = false;
      updatePlayPauseUI(false);
      navigator.mediaSession.playbackState = 'none';
    });
  };

  // Actualiza títulos, carátulas y fondos dinámicos (Desktop y Móvil)
  const updateNowPlayingInfo = (track) => {
    const titleEl = document.getElementById('player-track-title');
    const artistEl = document.getElementById('player-track-artist');
    const coverImg = document.getElementById('player-album-cover');
    const rightCover = document.getElementById('right-panel-cover');
    const rightTitle = document.getElementById('right-panel-title');
    const rightArtist = document.getElementById('right-panel-artist');
    const mobileCover = document.getElementById('mobile-player-cover');
    const mobileTitle = document.getElementById('mobile-player-title');
    const mobileArtist = document.getElementById('mobile-player-artist');

    if (titleEl) titleEl.textContent = track.title;
    if (artistEl) artistEl.textContent = track.artist;
    if (rightTitle) rightTitle.textContent = track.title;
    if (rightArtist) rightArtist.textContent = track.artist;
    if (mobileTitle) mobileTitle.textContent = track.title;
    if (mobileArtist) mobileArtist.textContent = track.artist;

    const coverUrl = track.coverUrl || `assets/covers/cover_${((track.index || 0) % 241) + 1}.jpg`;
    const heroCover = document.getElementById('hero-album-cover');
    if (heroCover) heroCover.src = coverUrl;
    if (coverImg) coverImg.src = coverUrl;
    if (rightCover) rightCover.src = coverUrl;
    if (mobileCover) mobileCover.src = coverUrl;

    // Colores reactivos suaves para el banner y fondo ambiental
    window.ColorExtractor.extractColors(coverUrl).then(colors => {
      visualizer.setAccentColor(colors.accent, colors.glow);
      const heroBanner = document.querySelector('.spotify-hero-banner');
      if (heroBanner && colors.c1) {
        heroBanner.style.background = `linear-gradient(to bottom, ${colors.c1Dark || 'rgba(160, 20, 60, 0.7)'} 0%, rgba(18, 18, 18, 0.95) 100%)`;
      }
    });

    updateAudiophileBadge(track);
  };

  const updateAudiophileBadge = (track) => {
    const badgeEl = document.getElementById('audiophile-specs-badge');
    if (!badgeEl) return;

    const isHiRes = (track.bitDepth && track.bitDepth >= 24) || (track.sampleRate && track.sampleRate > 44100);
    const formatName = track.format || track.extension || 'FLAC';
    const sampleRateKhz = track.sampleRate ? (track.sampleRate / 1000).toFixed(1) : '48.0';
    const bitDepthText = track.bitDepth ? `${track.bitDepth}-bit` : '16-bit';

    badgeEl.innerHTML = `
      <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider ${
        isHiRes ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/20' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
      }">
        <i data-lucide="sparkles" class="w-3 h-3 mr-1 inline"></i>
        ${formatName} ${isHiRes ? '24-BIT HI-RES' : 'LOSSLESS'}
      </span>
      <span class="text-[10px] font-mono text-slate-300 flex items-center space-x-1">
        <span>${bitDepthText} / ${sampleRateKhz}kHz</span>
      </span>
    `;
    if (window.lucide) window.lucide.createIcons();
  };

  const updateHardwareBadge = () => {
    const hwInfo = audioEngine.getHardwareInfo();
    const hwEl = document.getElementById('hw-specs-details');
    if (hwEl) {
      hwEl.textContent = `Salida DAC: ${hwInfo.sampleRate} Hz | Motor: ${hwInfo.bitDepth} | Latencia: ${hwInfo.outputLatency}`;
    }
  };

  const updatePlayPauseUI = (playing) => {
    const btnBar = document.getElementById('btn-play-pause');
    const btnHero = document.getElementById('btn-hero-play');
    const btnMobileMini = document.getElementById('mobile-mini-btn-play');
    const btnMobileModal = document.getElementById('mobile-btn-play-pause');

    const barIcon = playing
      ? `<i data-lucide="pause" class="w-5 h-5 text-black fill-current"></i>`
      : `<i data-lucide="play" class="w-5 h-5 text-black fill-current translate-x-0.5"></i>`;

    const heroIcon = playing
      ? `<i data-lucide="pause" class="w-7 h-7 text-black fill-current"></i>`
      : `<i data-lucide="play" class="w-7 h-7 text-black fill-current translate-x-0.5"></i>`;

    const mobileModalIcon = playing
      ? `<i data-lucide="pause" class="w-7 h-7 text-black fill-current"></i>`
      : `<i data-lucide="play" class="w-7 h-7 text-black fill-current translate-x-0.5"></i>`;

    if (btnBar) btnBar.innerHTML = barIcon;
    if (btnHero) btnHero.innerHTML = heroIcon;
    if (btnMobileMini) btnMobileMini.innerHTML = playing ? `<i data-lucide="pause" class="w-4 h-4 fill-black"></i>` : `<i data-lucide="play" class="w-4 h-4 fill-black translate-x-0.5"></i>`;
    if (btnMobileModal) btnMobileModal.innerHTML = mobileModalIcon;

    if (window.lucide) window.lucide.createIcons();
    libraryManager.renderTrackList();
  };

  const updateFavButton = (trackId) => {
    const btnBar = document.getElementById('player-btn-fav');
    const rightFav = document.getElementById('right-panel-fav');
    const mobileMiniFav = document.getElementById('mobile-mini-btn-fav');
    const mobileModalFav = document.getElementById('mobile-modal-fav');
    const isFav = libraryManager.isFavorite(trackId);

    const barIcon = `<i data-lucide="heart" class="w-5 h-5 ${isFav ? 'fill-[#1ed760] text-[#1ed760]' : 'text-slate-400'}"></i>`;
    const rightIcon = `<i data-lucide="${isFav ? 'check-circle' : 'plus-circle'}" class="w-6 h-6 ${isFav ? 'text-[#1ed760]' : 'text-slate-400'}"></i>`;

    if (btnBar) btnBar.innerHTML = barIcon;
    if (rightFav) rightFav.innerHTML = rightIcon;
    if (mobileMiniFav) mobileMiniFav.innerHTML = `<i data-lucide="heart" class="w-5 h-5 ${isFav ? 'fill-[#1ed760] text-[#1ed760]' : 'text-slate-400'}"></i>`;
    if (mobileModalFav) mobileModalFav.innerHTML = `<i data-lucide="heart" class="w-7 h-7 ${isFav ? 'fill-[#1ed760] text-[#1ed760]' : 'text-slate-400'}"></i>`;

    if (window.lucide) window.lucide.createIcons();
  };

  // --- Controles de Reproducción ---
  const togglePlayPause = async () => {
    await unlockAudio();

    if (audioElement.paused) {
      if (!audioElement.src && libraryManager.tracks.length > 0) {
        loadTrack(libraryManager.tracks[0]);
        return;
      }
      try {
        await audioElement.play();
        isPlaying = true;
        updatePlayPauseUI(true);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      } catch (err) {
        console.warn('Error al reanudar:', err);
      }
    } else {
      audioElement.pause();
      isPlaying = false;
      updatePlayPauseUI(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }
  };

  const playNext = () => {
    const next = libraryManager.getNextTrack(isShuffle);
    if (next) loadTrack(next);
  };

  const playPrev = () => {
    if (audioElement.currentTime > 3) {
      audioElement.currentTime = 0;
      return;
    }
    const prev = libraryManager.getPrevTrack();
    if (prev) loadTrack(prev);
  };

  // --- Aleatorio (Shuffle) Fisher-Yates con Punto Verde Spotify ---
  const toggleShuffle = () => {
    isShuffle = !isShuffle;
    libraryManager.initShuffleQueue();
    updateShuffleUI();
  };

  const updateShuffleUI = () => {
    const shuffleBtn = document.getElementById('btn-shuffle');
    const heroShuffleBtn = document.getElementById('btn-hero-shuffle');
    const mobileShuffleBtn = document.getElementById('mobile-btn-shuffle');

    [shuffleBtn, heroShuffleBtn, mobileShuffleBtn].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('active', isShuffle);
      btn.classList.toggle('text-[#1ed760]', isShuffle);
      btn.classList.toggle('text-slate-400', !isShuffle);
    });
  };

  // --- Repetir (Repeat) 3 Estados: Off -> All -> One ---
  const toggleRepeat = () => {
    if (repeatMode === 'off') {
      repeatMode = 'all';
      audioElement.loop = false;
    } else if (repeatMode === 'all') {
      repeatMode = 'one';
      audioElement.loop = true; // Bucle instantáneo nativo sin pausas
    } else {
      repeatMode = 'off';
      audioElement.loop = false;
    }
    updateRepeatUI();
  };

  const updateRepeatUI = () => {
    const repeatBtn = document.getElementById('btn-repeat');
    const mobileRepeatBtn = document.getElementById('mobile-btn-repeat');
    const badge = document.getElementById('repeat-badge-one');
    const mobileBadge = document.getElementById('mobile-repeat-badge-one');

    const updateSingle = (btn, bdg) => {
      if (!btn) return;
      if (repeatMode === 'off') {
        btn.classList.remove('active', 'text-[#1ed760]');
        btn.classList.add('text-slate-400');
        if (bdg) bdg.classList.add('hidden');
      } else if (repeatMode === 'all') {
        btn.classList.remove('text-slate-400');
        btn.classList.add('active', 'text-[#1ed760]');
        if (bdg) bdg.classList.add('hidden');
      } else if (repeatMode === 'one') {
        btn.classList.remove('text-slate-400');
        btn.classList.add('active', 'text-[#1ed760]');
        if (bdg) bdg.classList.remove('hidden');
      }
    };

    updateSingle(repeatBtn, badge);
    updateSingle(mobileRepeatBtn, mobileBadge);
  };

  // --- Eventos del elemento HTML <audio> (Actualización de Tiempo y MediaSession) ---
  audioElement.addEventListener('timeupdate', () => {
    if (isSeeking) return;

    const current = audioElement.currentTime;
    const duration = audioElement.duration || 0;

    const seekSlider = document.getElementById('player-seek-slider');
    const mobileSeekSlider = document.getElementById('mobile-seek-slider');
    const miniProgressBar = document.getElementById('mobile-mini-progress');

    const timeCur = document.getElementById('time-current');
    const timeDur = document.getElementById('time-duration');
    const mobileTimeCur = document.getElementById('mobile-time-current');
    const mobileTimeDur = document.getElementById('mobile-time-duration');

    const progressPercent = duration > 0 ? (current / duration) * 100 : 0;

    if (seekSlider) seekSlider.value = progressPercent;
    if (mobileSeekSlider) mobileSeekSlider.value = progressPercent;
    if (miniProgressBar) miniProgressBar.style.width = `${progressPercent}%`;

    const formattedCur = formatTime(current);
    const formattedDur = duration > 0 ? formatTime(duration) : '0:00';

    if (timeCur) timeCur.textContent = formattedCur;
    if (timeDur && duration > 0) timeDur.textContent = formattedDur;
    if (mobileTimeCur) mobileTimeCur.textContent = formattedCur;
    if (mobileTimeDur && duration > 0) mobileTimeDur.textContent = formattedDur;

    lyricsEngine.update(current);

    // Actualizar posición para la barra de bloqueo nativa de Android / Xiaomi 15
    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: audioElement.playbackRate || 1,
          position: Math.min(current, duration)
        });
      } catch (e) {}
    }
  });

  // Salto automático continuo de canciones con pantalla apagada
  audioElement.addEventListener('ended', () => {
    if (repeatMode === 'one') {
      audioElement.currentTime = 0;
      audioElement.play().catch(() => {});
      return;
    }
    if (repeatMode === 'off' && libraryManager.isLastTrackInList() && !isShuffle) {
      isPlaying = false;
      updatePlayPauseUI(false);
      return;
    }
    playNext();
  });

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- Modal Móvil Now Playing (Xiaomi 15) ---
  window.openMobilePlayer = () => {
    const modal = document.getElementById('mobile-now-playing-modal');
    if (modal) modal.classList.add('open');
  };

  window.closeMobilePlayer = () => {
    const modal = document.getElementById('mobile-now-playing-modal');
    if (modal) modal.classList.remove('open');
  };

  window.toggleMobileEQ = () => {
    const panel = document.getElementById('right-sidebar-panel');
    if (panel) {
      panel.classList.toggle('hidden');
      setRightSidebarView('poweramp');
    }
    window.closeMobilePlayer();
  };

  // --- Configuración del Ecualizador Poweramp UI (10 Bandas) ---
  const initEqualizerUI = () => {
    const container = document.getElementById('eq-sliders-container');
    if (!container) return;
    container.innerHTML = '';

    audioEngine.frequencies.forEach((freq, idx) => {
      const label = audioEngine.bandLabels[idx];
      const initialGain = audioEngine.gains[idx];

      const bandCol = document.createElement('div');
      bandCol.className = 'eq-band-col flex flex-col items-center justify-between h-36 py-1 select-none';

      bandCol.innerHTML = `
        <span class="text-[9px] font-mono font-bold text-cyan-400 band-db-readout" id="band-db-${idx}">
          ${initialGain > 0 ? '+' : ''}${initialGain.toFixed(1)}
        </span>
        <div class="relative flex-1 flex items-center justify-center my-1">
          <input 
            type="range" 
            min="-15" 
            max="15" 
            step="0.1" 
            value="${initialGain}" 
            orient="vertical"
            class="eq-vertical-slider" 
            id="eq-slider-${idx}"
            data-index="${idx}"
          />
        </div>
        <span class="text-[9px] font-mono font-medium text-slate-400 tracking-tighter">${label}</span>
      `;

      const slider = bandCol.querySelector('.eq-vertical-slider');
      const dbLabel = bandCol.querySelector('.band-db-readout');

      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        audioEngine.setBandGain(idx, val);
        dbLabel.textContent = (val > 0 ? '+' : '') + val.toFixed(1);
        updateEQCurve();
      });

      slider.addEventListener('dblclick', () => {
        slider.value = 0;
        audioEngine.setBandGain(idx, 0);
        dbLabel.textContent = '0.0';
        updateEQCurve();
      });

      container.appendChild(bandCol);
    });

    // Control de Pre-Amp
    const preAmpSlider = document.getElementById('eq-preamp-slider');
    const preAmpDbLabel = document.getElementById('preamp-db-readout');

    if (preAmpSlider) {
      preAmpSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        audioEngine.setPreAmp(val);
        if (preAmpDbLabel) preAmpDbLabel.textContent = (val > 0 ? '+' : '') + val.toFixed(1) + ' dB';
        updateEQCurve();
      });

      preAmpSlider.addEventListener('dblclick', () => {
        preAmpSlider.value = 0;
        audioEngine.setPreAmp(0);
        if (preAmpDbLabel) preAmpDbLabel.textContent = '0.0 dB';
        updateEQCurve();
      });
    }

    // Selector de Presets
    const presetSelect = document.getElementById('eq-preset-selector');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        const key = e.target.value;
        audioEngine.applyPreset(key);
        syncEQSlidersWithEngine();
        updateEQCurve();
      });
    }

    // Interruptor Bypass
    const bypassToggle = document.getElementById('eq-bypass-toggle');
    if (bypassToggle) {
      bypassToggle.addEventListener('change', (e) => {
        audioEngine.setBypass(!e.target.checked);
        const led = document.getElementById('eq-status-led');
        if (led) {
          if (e.target.checked) {
            led.classList.remove('bg-slate-600');
            led.classList.add('bg-cyan-400', 'shadow-cyan-400');
          } else {
            led.classList.remove('bg-cyan-400', 'shadow-cyan-400');
            led.classList.add('bg-slate-600');
          }
        }
        updateEQCurve();
      });
    }

    // Botón Reset Flat
    const resetFlatBtn = document.getElementById('btn-eq-reset-flat');
    if (resetFlatBtn) {
      resetFlatBtn.addEventListener('click', () => {
        audioEngine.resetFlat();
        if (presetSelect) presetSelect.value = 'flat';
        syncEQSlidersWithEngine();
        updateEQCurve();
      });
    }
  };

  const syncEQSlidersWithEngine = () => {
    audioEngine.frequencies.forEach((_, idx) => {
      const slider = document.getElementById(`eq-slider-${idx}`);
      const label = document.getElementById(`band-db-${idx}`);
      const val = audioEngine.gains[idx];
      if (slider) slider.value = val;
      if (label) label.textContent = (val > 0 ? '+' : '') + val.toFixed(1);
    });

    const preAmpSlider = document.getElementById('eq-preamp-slider');
    const preAmpDbLabel = document.getElementById('preamp-db-readout');
    if (preAmpSlider) preAmpSlider.value = audioEngine.preAmpDb;
    if (preAmpDbLabel) preAmpDbLabel.textContent = (audioEngine.preAmpDb > 0 ? '+' : '') + audioEngine.preAmpDb.toFixed(1) + ' dB';
  };

  const updateEQCurve = () => {
    if (eqCurveCanvas) {
      window.AudioVisualizer.drawEQCurve(eqCurveCanvas, audioEngine);
    }
  };

  // --- Toggle y Pestañas del Panel Lateral Derecho ---
  window.toggleRightSidebar = () => {
    const panel = document.getElementById('right-sidebar-panel');
    if (panel) panel.classList.toggle('hidden');
  };

  const setRightSidebarView = (viewName) => {
    currentRightSidebarTab = viewName;
    const spotifyView = document.getElementById('view-spotify-now-playing');
    const powerampView = document.getElementById('view-poweramp-studio');
    const tabSpotify = document.getElementById('tab-btn-spotify-view');
    const tabPoweramp = document.getElementById('tab-btn-poweramp-view');

    if (viewName === 'spotify') {
      if (spotifyView) spotifyView.classList.remove('hidden');
      if (powerampView) powerampView.classList.add('hidden');
      if (tabSpotify) {
        tabSpotify.classList.add('text-white', 'border-b-2', 'border-[#1ed760]');
        tabSpotify.classList.remove('text-slate-400');
      }
      if (tabPoweramp) {
        tabPoweramp.classList.remove('text-cyan-400', 'border-b-2', 'border-cyan-400');
        tabPoweramp.classList.add('text-slate-400');
      }
    } else {
      if (spotifyView) spotifyView.classList.add('hidden');
      if (powerampView) powerampView.classList.remove('hidden');
      if (tabPoweramp) {
        tabPoweramp.classList.add('text-cyan-400', 'border-b-2', 'border-cyan-400');
        tabPoweramp.classList.remove('text-slate-400');
      }
      if (tabSpotify) {
        tabSpotify.classList.remove('text-white', 'border-b-2', 'border-[#1ed760]');
        tabSpotify.classList.add('text-slate-400');
      }
      updateEQCurve();
    }
  };

  // --- Enlazar Todos los Botones y Controles (Desktop & Móvil) ---
  const bindEvents = () => {
    // 1. Play / Pause
    const playBtnBar = document.getElementById('btn-play-pause');
    const playBtnHero = document.getElementById('btn-hero-play');
    const playBtnMobileMini = document.getElementById('mobile-mini-btn-play');
    const playBtnMobileModal = document.getElementById('mobile-btn-play-pause');

    [playBtnBar, playBtnHero, playBtnMobileMini, playBtnMobileModal].forEach(btn => {
      if (btn) btn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlayPause();
      });
    });

    // 2. Next / Prev
    const nextBtn = document.getElementById('btn-next');
    const prevBtn = document.getElementById('btn-prev');
    const mobileNextMini = document.getElementById('mobile-mini-btn-next');
    const mobileNextModal = document.getElementById('mobile-btn-next');
    const mobilePrevModal = document.getElementById('mobile-btn-prev');

    if (nextBtn) nextBtn.addEventListener('click', playNext);
    if (prevBtn) prevBtn.addEventListener('click', playPrev);
    if (mobileNextMini) mobileNextMini.addEventListener('click', (e) => { e.stopPropagation(); playNext(); });
    if (mobileNextModal) mobileNextModal.addEventListener('click', playNext);
    if (mobilePrevModal) mobilePrevModal.addEventListener('click', playPrev);

    // 3. Shuffle
    const shuffleBtn = document.getElementById('btn-shuffle');
    const heroShuffleBtn = document.getElementById('btn-hero-shuffle');
    const mobileShuffleBtn = document.getElementById('mobile-btn-shuffle');

    if (shuffleBtn) shuffleBtn.addEventListener('click', toggleShuffle);
    if (mobileShuffleBtn) mobileShuffleBtn.addEventListener('click', toggleShuffle);
    if (heroShuffleBtn) {
      heroShuffleBtn.addEventListener('click', () => {
        isShuffle = true;
        updateShuffleUI();
        playNext();
      });
    }

    // 4. Repeat
    const repeatBtn = document.getElementById('btn-repeat');
    const mobileRepeatBtn = document.getElementById('mobile-btn-repeat');
    if (repeatBtn) repeatBtn.addEventListener('click', toggleRepeat);
    if (mobileRepeatBtn) mobileRepeatBtn.addEventListener('click', toggleRepeat);

    // 5. Seek Sliders (Desktop y Modal Móvil)
    const setupSeeker = (slider) => {
      if (!slider) return;
      slider.addEventListener('mousedown', () => { isSeeking = true; });
      slider.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });

      slider.addEventListener('input', (e) => {
        if (audioElement.duration) {
          const target = (parseFloat(e.target.value) / 100) * audioElement.duration;
          const timeCur = document.getElementById('time-current');
          const mobileTimeCur = document.getElementById('mobile-time-current');
          const fmt = formatTime(target);
          if (timeCur) timeCur.textContent = fmt;
          if (mobileTimeCur) mobileTimeCur.textContent = fmt;
        }
      });

      slider.addEventListener('change', (e) => {
        if (audioElement.duration) {
          const target = (parseFloat(e.target.value) / 100) * audioElement.duration;
          audioElement.currentTime = target;
        }
        isSeeking = false;
      });

      slider.addEventListener('mouseup', () => { isSeeking = false; });
      slider.addEventListener('touchend', () => { isSeeking = false; });
    };

    setupSeeker(document.getElementById('player-seek-slider'));
    setupSeeker(document.getElementById('mobile-seek-slider'));

    // 6. Volumen y Mute
    const volSlider = document.getElementById('player-volume-slider');
    const muteBtn = document.getElementById('btn-mute');
    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        audioElement.volume = val;
        audioElement.muted = false;
        updateVolumeIcon(val);
      });
    }
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        audioElement.muted = !audioElement.muted;
        updateVolumeIcon(audioElement.muted ? 0 : audioElement.volume);
      });
    }

    const updateVolumeIcon = (vol) => {
      if (!muteBtn) return;
      if (audioElement.muted || vol === 0) {
        muteBtn.innerHTML = `<i data-lucide="volume-x" class="w-4 h-4 text-rose-400"></i>`;
      } else if (vol < 0.5) {
        muteBtn.innerHTML = `<i data-lucide="volume-1" class="w-4 h-4 text-slate-300"></i>`;
      } else {
        muteBtn.innerHTML = `<i data-lucide="volume-2" class="w-4 h-4 text-slate-300"></i>`;
      }
      if (window.lucide) window.lucide.createIcons();
    };

    // 7. Favoritos
    const favBtn = document.getElementById('player-btn-fav');
    const rightFavBtn = document.getElementById('right-panel-fav');
    const mobileMiniFav = document.getElementById('mobile-mini-btn-fav');
    const mobileModalFav = document.getElementById('mobile-modal-fav');

    const toggleCurrentFav = (e) => {
      if (e) e.stopPropagation();
      const cur = libraryManager.getCurrentTrack();
      if (cur) {
        libraryManager.toggleFavorite(cur.id);
        updateFavButton(cur.id);
      }
    };

    if (favBtn) favBtn.addEventListener('click', toggleCurrentFav);
    if (rightFavBtn) rightFavBtn.addEventListener('click', toggleCurrentFav);
    if (mobileMiniFav) mobileMiniFav.addEventListener('click', toggleCurrentFav);
    if (mobileModalFav) mobileModalFav.addEventListener('click', toggleCurrentFav);

    // 8. Panel Derecho y Pestañas
    const btnToggleRightSidebar = document.getElementById('btn-toggle-right-sidebar');
    const btnCloseRightSidebar = document.getElementById('btn-close-right-sidebar');
    const tabSpotify = document.getElementById('tab-btn-spotify-view');
    const tabPoweramp = document.getElementById('tab-btn-poweramp-view');
    const btnBarEqToggle = document.getElementById('btn-bar-eq-toggle');

    if (btnToggleRightSidebar) btnToggleRightSidebar.addEventListener('click', window.toggleRightSidebar);
    if (btnCloseRightSidebar) btnCloseRightSidebar.addEventListener('click', window.toggleRightSidebar);

    if (tabSpotify) tabSpotify.addEventListener('click', () => setRightSidebarView('spotify'));
    if (tabPoweramp) tabPoweramp.addEventListener('click', () => setRightSidebarView('poweramp'));

    if (btnBarEqToggle) {
      btnBarEqToggle.addEventListener('click', () => {
        const panel = document.getElementById('right-sidebar-panel');
        if (panel && panel.classList.contains('hidden')) {
          panel.classList.remove('hidden');
        }
        setRightSidebarView('poweramp');
      });
    }

    // 9. Letras Sincronizadas
    const btnToggleLyrics = document.getElementById('btn-toggle-lyrics');
    const btnCloseLyrics = document.getElementById('btn-close-lyrics');
    const lyricsModal = document.getElementById('lyrics-drawer-modal');

    if (btnToggleLyrics && lyricsModal) {
      btnToggleLyrics.addEventListener('click', () => lyricsModal.classList.toggle('hidden'));
    }
    if (btnCloseLyrics && lyricsModal) {
      btnCloseLyrics.addEventListener('click', () => lyricsModal.classList.add('hidden'));
    }

    // 10. Modos de Visualizador
    const visModeBtns = document.querySelectorAll('.btn-vis-mode');
    visModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        visualizer.setMode(mode);
        visModeBtns.forEach(b => b.classList.remove('active', 'bg-cyan-500/20', 'text-cyan-300'));
        btn.classList.add('active', 'bg-cyan-500/20', 'text-cyan-300');
      });
    });

    // 11. Búsqueda y Debounce
    const searchInput = document.getElementById('spotify-search-input');
    const clearSearchBtn = document.getElementById('btn-clear-search');
    let searchDebounce;

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (clearSearchBtn) clearSearchBtn.classList.toggle('hidden', !val);

        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          libraryManager.setSearchQuery(val);
        }, 200);
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        libraryManager.setSearchQuery('');
      });
    }

    // 12. Selector de Ordenación
    const sortSelect = document.getElementById('library-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        libraryManager.setSortBy(e.target.value);
      });
    }

    // 13. Teclado Multimedia y Atajos (Desktop)
    document.addEventListener('keydown', (e) => {
      if (['input', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'ArrowRight' && e.ctrlKey) {
        playNext();
      } else if (e.code === 'ArrowLeft' && e.ctrlKey) {
        playPrev();
      } else if (e.code === 'KeyM') {
        if (muteBtn) muteBtn.click();
      } else if (e.code === 'KeyS') {
        toggleShuffle();
      } else if (e.code === 'KeyR') {
        toggleRepeat();
      }
    });
  };

  // --- Arranque del Sistema ---
  libraryManager.setTrackChangeCallback((track) => {
    loadTrack(track);
  });

  libraryManager.setLibraryLoadedCallback((tracks) => {
    console.log(`[Powerify] ${tracks.length} pistas cargadas automáticamente desde Google Drive.`);
    if (tracks.length > 0 && !audioElement.src) {
      const first = tracks[0];
      audioElement.src = first.streamUrl || '';
      updateNowPlayingInfo(first);
      updateFavButton(first.id);
      setupMediaSession(first);
      lyricsEngine.load(first.lyrics || '');
    }
  });

  // Manejo de errores de red en audioElement con fallback resiliente
  audioElement.addEventListener('error', () => {
    const err = audioElement.error;
    console.warn('[AudioCore] Evento de error en audio:', err ? err.code : 'unknown');
    if (audioElement.src && !audioElement.src.endsWith('track_1.mp3')) {
      console.log('[AudioCore] Conmutando a audio de reserva verificado: assets/audio/track_1.mp3');
      audioElement.src = 'assets/audio/track_1.mp3';
      if (isPlaying) audioElement.play().catch(() => {});
    }
  });

  initEqualizerUI();
  bindEvents();
  updateShuffleUI();
  updateRepeatUI();

  // Inicializar biblioteca automáticamente sin pedir archivos ni carpetas
  await libraryManager.init();

  if (window.lucide) window.lucide.createIcons();
});
