/**
 * Poweramp Audiophile Player - Master Application Controller
 * Coordina Web Audio API, Motor de Letras, Visualizador Canvas, Gestor de Biblioteca
 * y la Interfaz Adaptativa (Desktop MSI / Mobile Xiaomi 15).
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

  let isPlaying = false;
  let isShuffle = false;
  let repeatMode = 'off'; // 'off', 'all', 'one'
  let currentSpeed = 1.0;

  // --- Inicialización del AudioContext tras primer gesto del usuario ---
  const unlockAudio = async () => {
    if (!audioEngine.isInitialized) {
      await audioEngine.init();
      visualizer.start();
      updateEQCurve();
      updateHardwareBadge();
    }
  };

  // --- Carga y Reproducción de una Pista ---
  const loadTrack = async (track) => {
    if (!track) return;

    await unlockAudio();

    // Actualizar fuente del audio
    audioElement.src = track.streamUrl;
    audioElement.playbackRate = currentSpeed;

    // Actualizar información visual del Reproductor
    const titleEl = document.getElementById('player-track-title');
    const artistEl = document.getElementById('player-track-artist');
    const albumEl = document.getElementById('player-track-album');
    const coverImg = document.getElementById('player-album-cover');
    const vinylCover = document.getElementById('player-vinyl-cover');

    if (titleEl) titleEl.textContent = track.title;
    if (artistEl) artistEl.textContent = track.artist;
    if (albumEl) albumEl.textContent = track.album || 'Álbum Desconocido';

    const coverUrl = track.coverUrl || window.ColorExtractor.generateFallbackCover(track.title, track.artist);
    if (coverImg) coverImg.src = coverUrl;
    if (vinylCover) vinylCover.src = coverUrl;

    // Extraer colores y actualizar fondo dinámico
    const colors = await window.ColorExtractor.extractColors(coverUrl);
    visualizer.setAccentColor(colors.accent, colors.glow);

    // Actualizar Badge Audiófilo Hi-Res
    updateAudiophileBadge(track);

    // Cargar letras sincronizadas o mostrar fallback
    lyricsEngine.load(track.lyrics || '');

    // Actualizar botón de favorito
    updateFavButton(track.id);

    // MediaSession API para pantalla de bloqueo (Android Xiaomi 15 / Windows MSI)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }]
      });
    }

    try {
      await audioElement.play();
      isPlaying = true;
      updatePlayPauseUI(true);
    } catch (e) {
      console.warn('Auto-play esperando interacción:', e);
      isPlaying = false;
      updatePlayPauseUI(false);
    }
  };

  // Actualiza el badge con especificaciones técnicas (Poweramp Style)
  const updateAudiophileBadge = (track) => {
    const badgeEl = document.getElementById('audiophile-specs-badge');
    if (!badgeEl) return;

    const isHiRes = track.bitDepth >= 24 || track.sampleRate > 44100;
    const formatName = track.extension || 'FLAC';
    const sampleRateKhz = (track.sampleRate / 1000).toFixed(1);
    const bitDepthText = track.bitDepth ? `${track.bitDepth}-bit` : '16-bit';
    const dacRateKhz = audioEngine.audioCtx ? (audioEngine.audioCtx.sampleRate / 1000).toFixed(1) : '48.0';

    badgeEl.innerHTML = `
      <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold font-mono tracking-wider ${
        isHiRes ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/20' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
      }">
        <i data-lucide="sparkles" class="w-3 h-3 mr-1 inline"></i>
        ${formatName} ${isHiRes ? 'HI-RES' : 'LOSSLESS'}
      </span>
      <span class="text-[11px] font-mono text-slate-300 flex items-center space-x-1">
        <span>${bitDepthText} / ${sampleRateKhz} kHz</span>
        <span class="text-slate-500">•</span>
        <span class="text-cyan-400">DAC ${dacRateKhz} kHz Float32</span>
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
    const btn = document.getElementById('btn-play-pause');
    const vinylCard = document.getElementById('vinyl-wrapper');
    if (!btn) return;

    if (playing) {
      btn.innerHTML = `<i data-lucide="pause" class="w-7 h-7 text-black fill-current"></i>`;
      btn.classList.add('shadow-lg', 'shadow-cyan-500/40', 'scale-105');
      if (vinylCard) vinylCard.classList.add('playing');
    } else {
      btn.innerHTML = `<i data-lucide="play" class="w-7 h-7 text-black fill-current translate-x-0.5"></i>`;
      btn.classList.remove('shadow-lg', 'shadow-cyan-500/40', 'scale-105');
      if (vinylCard) vinylCard.classList.remove('playing');
    }
    if (window.lucide) window.lucide.createIcons();
  };

  const updateFavButton = (trackId) => {
    const btn = document.getElementById('player-btn-fav');
    if (!btn) return;
    const isFav = libraryManager.isFavorite(trackId);
    btn.innerHTML = `<i data-lucide="heart" class="w-6 h-6 ${isFav ? 'fill-rose-500 text-rose-500' : 'text-slate-400'}"></i>`;
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
      await audioElement.play();
      isPlaying = true;
      updatePlayPauseUI(true);
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
    const current = audioElement.currentTime;
    const duration = audioElement.duration || 0;

    // Actualizar barras de progreso y tiempos
    const seekSlider = document.getElementById('player-seek-slider');
    const timeCur = document.getElementById('time-current');
    const timeDur = document.getElementById('time-duration');

    if (seekSlider && duration > 0) {
      seekSlider.value = (current / duration) * 100;
    }

    if (timeCur) timeCur.textContent = formatTime(current);
    if (timeDur && duration > 0) timeDur.textContent = formatTime(duration);

    // Sincronizar motor de letras
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
      bandCol.className = 'eq-band-col flex flex-col items-center justify-between h-48 py-1 select-none';

      bandCol.innerHTML = `
        <span class="text-[10px] font-mono font-semibold text-cyan-400 band-db-readout" id="band-db-${idx}">
          ${initialGain > 0 ? '+' : ''}${initialGain.toFixed(1)}
        </span>
        <div class="relative flex-1 flex items-center justify-center my-2">
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
        <span class="text-[11px] font-mono font-medium text-slate-300 tracking-tight">${label}</span>
      `;

      const slider = bandCol.querySelector('.eq-vertical-slider');
      const dbLabel = bandCol.querySelector('.band-db-readout');

      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        audioEngine.setBandGain(idx, val);
        dbLabel.textContent = (val > 0 ? '+' : '') + val.toFixed(1);
        updateEQCurve();
      });

      // Doble clic para resetear banda a 0 dB
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
    // Play / Pause
    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) playBtn.addEventListener('click', togglePlayPause);

    // Siguiente / Anterior
    const nextBtn = document.getElementById('btn-next');
    const prevBtn = document.getElementById('btn-prev');
    if (nextBtn) nextBtn.addEventListener('click', playNext);
    if (prevBtn) prevBtn.addEventListener('click', playPrev);

    // Barra de tiempo interactiva (Scrubbing)
    const seekSlider = document.getElementById('player-seek-slider');
    if (seekSlider) {
      seekSlider.addEventListener('input', (e) => {
        if (audioElement.duration) {
          const target = (parseFloat(e.target.value) / 100) * audioElement.duration;
          audioElement.currentTime = target;
        }
      });
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
        if (audioElement.muted) {
          updateVolumeIcon(0);
        } else {
          updateVolumeIcon(audioElement.volume);
        }
      });
    }

    const updateVolumeIcon = (vol) => {
      if (!muteBtn) return;
      if (audioElement.muted || vol === 0) {
        muteBtn.innerHTML = `<i data-lucide="volume-x" class="w-5 h-5 text-rose-400"></i>`;
      } else if (vol < 0.5) {
        muteBtn.innerHTML = `<i data-lucide="volume-1" class="w-5 h-5 text-slate-300"></i>`;
      } else {
        muteBtn.innerHTML = `<i data-lucide="volume-2" class="w-5 h-5 text-slate-300"></i>`;
      }
      if (window.lucide) window.lucide.createIcons();
    };

    // Shuffle & Repeat
    const shuffleBtn = document.getElementById('btn-shuffle');
    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', () => {
        isShuffle = !isShuffle;
        shuffleBtn.classList.toggle('text-cyan-400', isShuffle);
        shuffleBtn.classList.toggle('text-slate-400', !isShuffle);
      });
    }

    const repeatBtn = document.getElementById('btn-repeat');
    if (repeatBtn) {
      repeatBtn.addEventListener('click', () => {
        if (repeatMode === 'off') repeatMode = 'all';
        else if (repeatMode === 'all') repeatMode = 'one';
        else repeatMode = 'off';

        repeatBtn.classList.toggle('text-cyan-400', repeatMode !== 'off');
        repeatBtn.classList.toggle('text-slate-400', repeatMode === 'off');

        const badge = document.getElementById('repeat-badge-one');
        if (badge) badge.classList.toggle('hidden', repeatMode !== 'one');
      });
    }

    // Favorito en el reproductor
    const favBtn = document.getElementById('player-btn-fav');
    if (favBtn) {
      favBtn.addEventListener('click', () => {
        const cur = libraryManager.getCurrentTrack();
        if (cur) {
          libraryManager.toggleFavorite(cur.id);
          updateFavButton(cur.id);
        }
      });
    }

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

    // Carga de Carpeta interactiva
    const btnOpenFolder = document.getElementById('btn-open-folder');
    if (btnOpenFolder) {
      btnOpenFolder.addEventListener('click', () => libraryManager.openDirectoryPicker());
    }

    const btnReconnect = document.getElementById('btn-reconnect-folder');
    if (btnReconnect) {
      btnReconnect.addEventListener('click', () => libraryManager.reconnectStoredDirectory());
    }

    // Input fallback
    const inputFolderFallback = document.getElementById('input-folder-fallback');
    if (inputFolderFallback) {
      inputFolderFallback.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          libraryManager.loadFromFileInput(e.target.files);
        }
      });
    }

    // Búsqueda y Filtros
    const searchInput = document.getElementById('library-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => libraryManager.setSearchQuery(e.target.value));
    }

    const filterPills = document.querySelectorAll('.filter-pill');
    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('active', 'bg-cyan-500', 'text-black', 'font-semibold'));
        filterPills.forEach(p => p.classList.add('bg-white/5', 'text-slate-300'));
        pill.classList.remove('bg-white/5', 'text-slate-300');
        pill.classList.add('active', 'bg-cyan-500', 'text-black', 'font-semibold');
        libraryManager.setFilter(pill.dataset.filter);
      });
    });

    const sortSelect = document.getElementById('library-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => libraryManager.setSortBy(e.target.value));
    }

    // Letras: Seek al hacer clic en línea
    lyricsEngine.setSeekCallback((seconds) => {
      audioElement.currentTime = seconds;
    });

    // Botón de alternar vista de letras en el reproductor
    const toggleLyricsBtn = document.getElementById('btn-toggle-lyrics');
    const lyricsDrawer = document.getElementById('lyrics-drawer-modal');
    if (toggleLyricsBtn && lyricsDrawer) {
      toggleLyricsBtn.addEventListener('click', () => {
        lyricsDrawer.classList.toggle('hidden');
        toggleLyricsBtn.classList.toggle('text-cyan-400');
      });
    }
    const closeLyricsBtn = document.getElementById('btn-close-lyrics');
    if (closeLyricsBtn && lyricsDrawer) {
      closeLyricsBtn.addEventListener('click', () => {
        lyricsDrawer.classList.add('hidden');
        if (toggleLyricsBtn) toggleLyricsBtn.classList.remove('text-cyan-400');
      });
    }

    // Navegación móvil adaptable (Xiaomi 15)
    const mobileNavBtns = document.querySelectorAll('.mobile-nav-btn');
    const sections = {
      library: document.getElementById('section-library'),
      player: document.getElementById('section-player'),
      equalizer: document.getElementById('section-equalizer')
    };

    mobileNavBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.section;
        mobileNavBtns.forEach(b => b.classList.remove('text-cyan-400', 'font-semibold'));
        btn.classList.add('text-cyan-400', 'font-semibold');

        // En pantallas móviles ocultar/mostrar paneles correspondientes
        if (window.innerWidth < 1024) {
          Object.keys(sections).forEach(key => {
            if (sections[key]) {
              sections[key].classList.toggle('mobile-hidden', key !== target);
              sections[key].classList.toggle('mobile-active', key === target);
            }
          });
          if (target === 'equalizer') {
            updateEQCurve();
          }
        }
      });
    });

    // Atajos de teclado para audiófilos
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
        const toggle = document.getElementById('eq-bypass-toggle');
        if (toggle) {
          toggle.checked = !toggle.checked;
          toggle.dispatchEvent(new Event('change'));
        }
      } else if (e.key === 'l' || e.key === 'L') {
        const cur = libraryManager.getCurrentTrack();
        if (cur) {
          libraryManager.toggleFavorite(cur.id);
          updateFavButton(cur.id);
        }
      }
    });

    // Soporte para gestos táctiles Swipe en carátula móvil
    const coverCard = document.getElementById('vinyl-wrapper');
    if (coverCard) {
      let touchStartX = 0;
      coverCard.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });

      coverCard.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const diffX = touchEndX - touchStartX;
        if (diffX > 60) {
          playPrev();
        } else if (diffX < -60) {
          playNext();
        }
      }, { passive: true });
    }
  };

  // Callback cuando se selecciona un tema de la biblioteca
  libraryManager.setTrackChangeCallback((track) => {
    loadTrack(track);
  });

  // Callback cuando la biblioteca carga pistas inicialmente
  libraryManager.setLibraryLoadedCallback((tracks) => {
    console.log(`[App] Biblioteca lista con ${tracks.length} temas`);
    if (tracks.length > 0 && !audioElement.src) {
      // Preparar la primera pista sin reproducir automáticamente hasta que el usuario pulse Play
      const first = tracks[0];
      libraryManager.currentTrackIndex = 0;
      audioElement.src = first.streamUrl;

      const titleEl = document.getElementById('player-track-title');
      const artistEl = document.getElementById('player-track-artist');
      const albumEl = document.getElementById('player-track-album');
      const coverImg = document.getElementById('player-album-cover');
      const vinylCover = document.getElementById('player-vinyl-cover');

      if (titleEl) titleEl.textContent = first.title;
      if (artistEl) artistEl.textContent = first.artist;
      if (albumEl) albumEl.textContent = first.album || 'Álbum Desconocido';

      const coverUrl = first.coverUrl || window.ColorExtractor.generateFallbackCover(first.title, first.artist);
      if (coverImg) coverImg.src = coverUrl;
      if (vinylCover) vinylCover.src = coverUrl;

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
