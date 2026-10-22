/**
 * Powerify: Spotify UI x Poweramp Audiophile Engine
 * Master Coordinator: Web Audio API Float32, Spotify Track Table,
 * Poweramp 10-Band EQ, 60fps Canvas Visualizer y Google Drive Cloud.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elementos principales del DOM
  const audioElement = document.getElementById('audio-core');
  const mainCanvas = document.getElementById('visualizer-canvas');
  const eqCurveCanvas = document.getElementById('eq-curve-canvas');
  const lyricsContainer = document.getElementById('lyrics-display');

  // Inicializar subsistemas
  const audioEngine = new AudioEngine(audioElement);
  const visualizer = new AudioVisualizer(mainCanvas, audioEngine);
  const libraryManager = new LibraryManager();
  const lyricsEngine = new LyricsEngine(lyricsContainer);
  const gDriveSync = new GoogleDriveSync(libraryManager);
  window.gDriveSync = gDriveSync;
  window.libraryManager = libraryManager;

  let isPlaying = false;
  let isShuffle = false;
  let repeatMode = 'off'; // 'off', 'all', 'one'
  let currentSpeed = 1.0;
  let isSeeking = false;

  // --- Inicialización del AudioContext tras primer gesto del usuario ---
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

  // --- Carga y Reproducción de una Pista ---
  const loadTrack = async (track) => {
    if (!track) return;

    await unlockAudio();

    // Detener demo sintetizado si estaba sonando
    audioEngine.stopSynthesizedDemo();

    // Actualizar fuente del audio
    audioElement.src = track.streamUrl || '';
    audioElement.playbackRate = currentSpeed;

    // Actualizar información visual en el Reproductor Inferior y Banner Hero
    const titleEl = document.getElementById('player-track-title');
    const artistEl = document.getElementById('player-track-artist');
    const coverImg = document.getElementById('player-album-cover');
    const heroCover = document.getElementById('hero-album-cover');
    const heroTitle = document.getElementById('hero-playlist-title');

    if (titleEl) titleEl.textContent = track.title;
    if (artistEl) artistEl.textContent = track.artist;
    if (heroTitle && track.album) heroTitle.textContent = track.album;

    const coverUrl = track.coverUrl || window.ColorExtractor.generateFallbackCover(track.title, track.artist);
    if (coverImg) coverImg.src = coverUrl;
    if (heroCover) heroCover.src = coverUrl;

    // Extraer colores para iluminar suavemente el banner y fondo
    window.ColorExtractor.extractColors(coverUrl).then(colors => {
      visualizer.setAccentColor(colors.accent, colors.glow);
      const heroBanner = document.querySelector('.spotify-hero-banner');
      if (heroBanner && colors.c1) {
        heroBanner.style.background = `linear-gradient(to bottom, ${colors.c1Dark || 'rgba(16, 185, 129, 0.3)'} 0%, rgba(12, 13, 18, 0.95) 100%)`;
      }
    });

    // Actualizar Badge Audiófilo Hi-Res
    updateAudiophileBadge(track);

    // Cargar letras sincronizadas
    lyricsEngine.load(track.lyrics || '');

    // Actualizar botón de favorito
    updateFavButton(track.id);

    // MediaSession API para pantalla de bloqueo (Windows MSI / Xiaomi 15)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'Música Ulicito',
        artwork: [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }]
      });
    }

    try {
      await audioElement.play();
      isPlaying = true;
      updatePlayPauseUI(true);
    } catch (e) {
      console.warn('Esperando interacción o error de red:', e);
      isPlaying = false;
      updatePlayPauseUI(false);
    }
  };

  // Manejo de errores de carga de audio (ejemplo: si en GitHub Pages aún no se vincula la carpeta)
  audioElement.addEventListener('error', (e) => {
    console.warn('[AudioElement] Archivo no accesible directamente en red estática:', e);
    const cur = libraryManager.getCurrentTrack();
    // Iniciar demo sintetizado con sub-graves y agudos para que el usuario pueda probar el EQ
    audioEngine.startSynthesizedDemo();
    isPlaying = true;
    updatePlayPauseUI(true);

    // Mostrar modal informativo
    const modal = document.getElementById('drive-guide-modal');
    if (modal) modal.classList.remove('hidden');
  });

  // Actualiza el badge con especificaciones técnicas (Poweramp Style)
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

    const barIcon = playing
      ? `<i data-lucide="pause" class="w-5 h-5 text-black fill-current"></i>`
      : `<i data-lucide="play" class="w-5 h-5 text-black fill-current translate-x-0.5"></i>`;

    const heroIcon = playing
      ? `<i data-lucide="pause" class="w-7 h-7 text-black fill-current"></i>`
      : `<i data-lucide="play" class="w-7 h-7 text-black fill-current translate-x-0.5"></i>`;

    if (btnBar) btnBar.innerHTML = barIcon;
    if (btnHero) btnHero.innerHTML = heroIcon;

    if (window.lucide) window.lucide.createIcons();
  };

  const updateFavButton = (trackId) => {
    const btnBar = document.getElementById('player-btn-fav');
    const btnHero = document.getElementById('btn-hero-fav');
    const isFav = libraryManager.isFavorite(trackId);

    const icon = `<i data-lucide="heart" class="w-5 h-5 ${isFav ? 'fill-rose-500 text-rose-500' : 'text-slate-400'}"></i>`;
    if (btnBar) btnBar.innerHTML = icon;
    if (btnHero) btnHero.innerHTML = `<i data-lucide="heart" class="w-6 h-6 ${isFav ? 'fill-rose-500 text-rose-500' : 'text-slate-400'}"></i>`;

    if (window.lucide) window.lucide.createIcons();
  };

  // --- Controles de Reproducción ---
  const togglePlayPause = async () => {
    await unlockAudio();

    if (audioEngine.demoInterval) {
      // Si está en modo demo sintetizado
      audioEngine.stopSynthesizedDemo();
      isPlaying = false;
      updatePlayPauseUI(false);
      return;
    }

    if (audioElement.paused) {
      if (!audioElement.src && libraryManager.tracks.length > 0) {
        loadTrack(libraryManager.tracks[0]);
        return;
      }
      try {
        await audioElement.play();
        isPlaying = true;
        updatePlayPauseUI(true);
      } catch (err) {
        audioEngine.startSynthesizedDemo();
        isPlaying = true;
        updatePlayPauseUI(true);
      }
    } else {
      audioElement.pause();
      isPlaying = false;
      updatePlayPauseUI(false);
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

  // --- Eventos del elemento HTML <audio> ---
  audioElement.addEventListener('timeupdate', () => {
    if (isSeeking) return; // Evitar saltos de cursor mientras el usuario arrastra la barra

    const current = audioElement.currentTime;
    const duration = audioElement.duration || 0;

    const seekSlider = document.getElementById('player-seek-slider');
    const timeCur = document.getElementById('time-current');
    const timeDur = document.getElementById('time-duration');

    if (seekSlider && duration > 0) {
      seekSlider.value = (current / duration) * 100;
    }

    if (timeCur) timeCur.textContent = formatTime(current);
    if (timeDur && duration > 0) timeDur.textContent = formatTime(duration);

    lyricsEngine.update(current);
  });

  audioElement.addEventListener('ended', () => {
    if (repeatMode === 'one') {
      audioElement.currentTime = 0;
      audioElement.play();
    } else {
      playNext();
    }
  });

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- Configuración del Ecualizador UI (10 Bandas) ---
  const initEqualizerUI = () => {
    const container = document.getElementById('eq-sliders-container');
    if (!container) return;
    container.innerHTML = '';

    // Renderizar los 10 sliders de frecuencia
    audioEngine.frequencies.forEach((freq, idx) => {
      const label = audioEngine.bandLabels[idx];
      const initialGain = audioEngine.gains[idx];

      const bandCol = document.createElement('div');
      bandCol.className = 'eq-band-col flex flex-col items-center justify-between h-44 py-1 select-none';

      bandCol.innerHTML = `
        <span class="text-[9px] font-mono font-bold text-cyan-400 band-db-readout" id="band-db-${idx}">
          ${initialGain > 0 ? '+' : ''}${initialGain.toFixed(1)}
        </span>
        <div class="relative flex-1 flex items-center justify-center my-1.5">
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
        <span class="text-[10px] font-mono font-medium text-slate-300 tracking-tighter">${label}</span>
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

  // --- Enlazar Botones y Controles Principales ---
  const bindEvents = () => {
    // Play / Pause Principal e Inferior
    const playBtnBar = document.getElementById('btn-play-pause');
    const playBtnHero = document.getElementById('btn-hero-play');
    if (playBtnBar) playBtnBar.addEventListener('click', togglePlayPause);
    if (playBtnHero) playBtnHero.addEventListener('click', togglePlayPause);

    // Siguiente / Anterior
    const nextBtn = document.getElementById('btn-next');
    const prevBtn = document.getElementById('btn-prev');
    if (nextBtn) nextBtn.addEventListener('click', playNext);
    if (prevBtn) prevBtn.addEventListener('click', playPrev);

    // Barra de tiempo interactiva (Scrubbing sin jitter)
    const seekSlider = document.getElementById('player-seek-slider');
    if (seekSlider) {
      seekSlider.addEventListener('mousedown', () => { isSeeking = true; });
      seekSlider.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });

      seekSlider.addEventListener('input', (e) => {
        if (audioElement.duration) {
          const target = (parseFloat(e.target.value) / 100) * audioElement.duration;
          const timeCur = document.getElementById('time-current');
          if (timeCur) timeCur.textContent = formatTime(target);
        }
      });

      seekSlider.addEventListener('change', (e) => {
        if (audioElement.duration) {
          const target = (parseFloat(e.target.value) / 100) * audioElement.duration;
          audioElement.currentTime = target;
        }
        isSeeking = false;
      });

      seekSlider.addEventListener('mouseup', () => { isSeeking = false; });
      seekSlider.addEventListener('touchend', () => { isSeeking = false; });
    }

    // Volumen y Mute
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

    // Shuffle & Repeat
    const shuffleBtn = document.getElementById('btn-shuffle');
    const heroShuffleBtn = document.getElementById('btn-hero-shuffle');
    const toggleShuffle = () => {
      isShuffle = !isShuffle;
      if (shuffleBtn) shuffleBtn.classList.toggle('text-emerald-400', isShuffle);
      if (heroShuffleBtn) heroShuffleBtn.classList.toggle('text-emerald-400', isShuffle);
    };
    if (shuffleBtn) shuffleBtn.addEventListener('click', toggleShuffle);
    if (heroShuffleBtn) heroShuffleBtn.addEventListener('click', toggleShuffle);

    const repeatBtn = document.getElementById('btn-repeat');
    if (repeatBtn) {
      repeatBtn.addEventListener('click', () => {
        if (repeatMode === 'off') repeatMode = 'all';
        else if (repeatMode === 'all') repeatMode = 'one';
        else repeatMode = 'off';

        repeatBtn.classList.toggle('text-emerald-400', repeatMode !== 'off');
        const badge = document.getElementById('repeat-badge-one');
        if (badge) badge.classList.toggle('hidden', repeatMode !== 'one');
      });
    }

    // Toggle de Poweramp Studio (EQ + Visualizer)
    const studioPanel = document.getElementById('poweramp-studio-panel');
    const btnToggleStudio = document.getElementById('btn-toggle-poweramp-studio');
    const btnBarEqToggle = document.getElementById('btn-bar-eq-toggle');

    const toggleStudio = () => {
      if (!studioPanel) return;
      studioPanel.classList.toggle('hidden');
      updateEQCurve();
    };
    if (btnToggleStudio) btnToggleStudio.addEventListener('click', toggleStudio);
    if (btnBarEqToggle) btnBarEqToggle.addEventListener('click', toggleStudio);

    // Modos de Visualizador
    const visModeBtns = document.querySelectorAll('.btn-vis-mode');
    visModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        visualizer.setMode(mode);
        visModeBtns.forEach(b => b.classList.remove('active', 'bg-cyan-500/20', 'text-cyan-300'));
        btn.classList.add('active', 'bg-cyan-500/20', 'text-cyan-300');
      });
    });

    // Buscador Central Spotify con Debounce y botón limpiar
    const searchInput = document.getElementById('spotify-search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');
    let searchTimeout = null;

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (btnClearSearch) btnClearSearch.classList.toggle('hidden', !val);

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          libraryManager.setSearchQuery(val);
        }, 150);
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        searchInput.value = '';
        btnClearSearch.classList.add('hidden');
        libraryManager.setSearchQuery('');
        searchInput.focus();
      });
    }

    // Filtros de formato
    const filterPills = document.querySelectorAll('.filter-pill');
    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('active', 'bg-emerald-500', 'text-black', 'font-semibold'));
        filterPills.forEach(p => p.classList.add('bg-white/5', 'text-slate-300'));
        pill.classList.remove('bg-white/5', 'text-slate-300');
        pill.classList.add('active', 'bg-emerald-500', 'text-black', 'font-semibold');
        libraryManager.setFilter(pill.dataset.filter);
      });
    });

    const sortSelect = document.getElementById('library-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => libraryManager.setSortBy(e.target.value));
    }

    // Vincular Carpeta de Google Drive / Local
    const bindFolderAction = () => libraryManager.openDirectoryPicker();
    const btnLinkDrive = document.getElementById('sidebar-btn-link-drive');
    const btnModalLinkDrive = document.getElementById('btn-modal-link-drive');
    const btnCloseDriveGuide = document.getElementById('btn-close-drive-guide');
    const btnDemoAudio = document.getElementById('btn-start-demo-audio');

    if (btnLinkDrive) btnLinkDrive.addEventListener('click', bindFolderAction);
    if (btnModalLinkDrive) btnModalLinkDrive.addEventListener('click', () => {
      document.getElementById('drive-guide-modal').classList.add('hidden');
      bindFolderAction();
    });
    if (btnCloseDriveGuide) btnCloseDriveGuide.addEventListener('click', () => {
      document.getElementById('drive-guide-modal').classList.add('hidden');
    });
    if (btnDemoAudio) btnDemoAudio.addEventListener('click', async () => {
      document.getElementById('drive-guide-modal').classList.add('hidden');
      await unlockAudio();
      audioEngine.startSynthesizedDemo();
      isPlaying = true;
      updatePlayPauseUI(true);
    });

    // Letras: Seek al hacer clic en línea
    lyricsEngine.setSeekCallback((seconds) => {
      audioElement.currentTime = seconds;
    });

    // Toggle de letras
    const btnToggleLyrics = document.getElementById('btn-toggle-lyrics');
    const btnHeroLyrics = document.getElementById('btn-hero-lyrics');
    const lyricsModal = document.getElementById('lyrics-drawer-modal');
    const btnCloseLyrics = document.getElementById('btn-close-lyrics');

    const toggleLyrics = () => {
      if (lyricsModal) lyricsModal.classList.toggle('hidden');
    };
    if (btnToggleLyrics) btnToggleLyrics.addEventListener('click', toggleLyrics);
    if (btnHeroLyrics) btnHeroLyrics.addEventListener('click', toggleLyrics);
    if (btnCloseLyrics) btnCloseLyrics.addEventListener('click', () => lyricsModal.classList.add('hidden'));

    // Atajos de teclado audiófilos
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        audioElement.currentTime = Math.min(audioElement.duration || 0, audioElement.currentTime + 5);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        audioElement.currentTime = Math.max(0, audioElement.currentTime - 5);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        audioElement.volume = Math.min(1, audioElement.volume + 0.05);
        if (volSlider) volSlider.value = audioElement.volume;
        updateVolumeIcon(audioElement.volume);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        audioElement.volume = Math.max(0, audioElement.volume - 0.05);
        if (volSlider) volSlider.value = audioElement.volume;
        updateVolumeIcon(audioElement.volume);
      } else if (e.key === 'm' || e.key === 'M') {
        audioElement.muted = !audioElement.muted;
        updateVolumeIcon(audioElement.muted ? 0 : audioElement.volume);
      } else if (e.key === 'e' || e.key === 'E') {
        toggleStudio();
      }
    });
  };

  // Callback al seleccionar pista
  libraryManager.setTrackChangeCallback((track) => {
    loadTrack(track);
  });

  // Callback al cargar biblioteca inicialmente
  libraryManager.setLibraryLoadedCallback((tracks) => {
    console.log(`[Powerify] Biblioteca lista con ${tracks.length} temas`);
    if (tracks.length > 0 && !audioElement.src) {
      const first = tracks[0];
      libraryManager.currentTrackIndex = 0;

      const titleEl = document.getElementById('player-track-title');
      const artistEl = document.getElementById('player-track-artist');
      const coverImg = document.getElementById('player-album-cover');
      const heroCover = document.getElementById('hero-album-cover');

      if (titleEl) titleEl.textContent = first.title;
      if (artistEl) artistEl.textContent = first.artist;

      const coverUrl = first.coverUrl || window.ColorExtractor.generateFallbackCover(first.title, first.artist);
      if (coverImg) coverImg.src = coverUrl;
      if (heroCover) heroCover.src = coverUrl;

      window.ColorExtractor.extractColors(coverUrl).then(colors => {
        visualizer.setAccentColor(colors.accent, colors.glow);
      });

      updateAudiophileBadge(first);
      lyricsEngine.load(first.lyrics || '');
      updateFavButton(first.id);
      libraryManager.renderTrackList();
    }
  });

  // Inicializar UI y listeners
  initEqualizerUI();
  bindEvents();
  await libraryManager.init();
  await gDriveSync.init();

  if (window.lucide) {
    window.lucide.createIcons();
  }
});
