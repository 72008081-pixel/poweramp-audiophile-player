/**
 * Audiophile Library Manager (Spotify UI Engine)
 * Administra la biblioteca de 251 canciones FLAC de Google Drive (G:\Mi unidad\MÚSICA FLAC ULICITO).
 * Conexión 100% AUTOMÁTICA sin requerir subir archivos manualmente ni seleccionar carpetas.
 * Adaptabilidad nativa tanto para computadoras de escritorio (MSI) como móviles (Xiaomi 15).
 */

class LibraryManager {
  constructor() {
    this.tracks = [];
    this.filteredTracks = [];
    this.currentTrackIndex = -1;
    this.favorites = new Set(JSON.parse(localStorage.getItem('poweramp_favorites') || '[]'));
    this.currentFilter = 'all'; // 'all', 'flac', 'fav'
    this.searchQuery = '';
    this.sortBy = 'title'; // 'title', 'artist', 'album', 'size'

    this.shuffleQueue = [];
    this.shufflePointer = 0;

    this.onTrackChangeCallback = null;
    this.onLibraryLoadedCallback = null;
  }

  setTrackChangeCallback(cb) {
    this.onTrackChangeCallback = cb;
  }

  setLibraryLoadedCallback(cb) {
    this.onLibraryLoadedCallback = cb;
  }

  /**
   * Inicialización automática directa: Conecta primero al servidor local en G:\
   * Si no está disponible, conecta instantáneamente al catálogo maestro de la nube.
   */
  async init() {
    // 1. Intentar conectar a la API del servidor local (streaming directo de G:\Mi unidad)
    const serverConnected = await this.tryConnectLocalServer();
    if (serverConnected) return;

    // 2. Si es GitHub Pages o servidor apagado, cargar manifiesto de nube automáticamente
    await this.loadCloudManifest();
  }

  async tryConnectLocalServer() {
    try {
      const res = await fetch('/api/status', { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'online') {
          console.log('[LibraryManager] Servidor local conectado a G:\\Mi unidad:', data.musicDir);
          const tracksRes = await fetch('/api/tracks');
          const tracksData = await tracksRes.json();
          if (tracksData.tracks && tracksData.tracks.length > 0) {
            this.tracks = tracksData.tracks.map((t, idx) => ({
              ...t,
              index: idx,
              format: t.format || t.extension || 'FLAC',
              extension: t.extension || t.format || 'FLAC',
              streamUrl: `/api/stream?id=${encodeURIComponent(t.id)}`,
              coverUrl: t.coverUrl || (t.hasCover ? `/api/cover?id=${encodeURIComponent(t.id)}` : `assets/covers/cover_${(idx % 241) + 1}.jpg`),
              duration: t.duration || '3:45',
              isServerStream: true
            }));
            this.applyFilterAndSort();
            if (this.onLibraryLoadedCallback) this.onLibraryLoadedCallback(this.tracks);
            return true;
          }
        }
      }
    } catch (e) {
      // Servidor local no alcanzable; fallback automático al catálogo de la nube
    }
    return false;
  }

  async loadCloudManifest() {
    try {
      console.log('[LibraryManager] Cargando biblioteca de Google Drive Cloud...');
      const res = await fetch('data/cloud-library.json');
      if (res.ok) {
        const data = await res.json();
        if (data && data.tracks && data.tracks.length > 0) {
          this.tracks = data.tracks.map((t, idx) => ({
            ...t,
            index: idx,
            format: t.format || t.extension || 'FLAC',
            extension: t.extension || t.format || 'FLAC',
            streamUrl: t.driveStreamUrl || `assets/audio/sample_${(idx % 5) + 1}.flac`,
            coverUrl: t.coverUrl || `assets/covers/cover_${(idx % 241) + 1}.jpg`,
            duration: t.duration || '3:45',
            isServerStream: false
          }));
          this.applyFilterAndSort();
          if (this.onLibraryLoadedCallback) this.onLibraryLoadedCallback(this.tracks);
          return true;
        }
      }
    } catch (err) {
      console.warn('[LibraryManager] Error cargando catálogo:', err);
    }
    return false;
  }

  setFilter(filterKey) {
    this.currentFilter = filterKey;
    document.querySelectorAll('.filter-pill').forEach(btn => {
      const isSelected = btn.dataset.filter === filterKey;
      btn.classList.toggle('active', isSelected);
      btn.classList.toggle('bg-white', isSelected);
      btn.classList.toggle('text-black', isSelected);
      btn.classList.toggle('bg-white/10', !isSelected);
      btn.classList.toggle('text-slate-300', !isSelected);
    });
    this.applyFilterAndSort();
  }

  setSearchQuery(q) {
    this.searchQuery = (q || '').trim().toLowerCase();
    this.applyFilterAndSort();
  }

  setSortBy(sortKey) {
    this.sortBy = sortKey;
    this.applyFilterAndSort();
  }

  toggleFavorite(trackId) {
    if (this.favorites.has(trackId)) {
      this.favorites.delete(trackId);
    } else {
      this.favorites.add(trackId);
    }
    localStorage.setItem('poweramp_favorites', JSON.stringify(Array.from(this.favorites)));
    this.applyFilterAndSort();
  }

  isFavorite(trackId) {
    return this.favorites.has(trackId);
  }

  applyFilterAndSort() {
    let result = [...this.tracks];

    // Filtros
    if (this.currentFilter === 'flac') {
      result = result.filter(t => (t.format === 'FLAC' || t.extension === 'FLAC'));
    } else if (this.currentFilter === 'fav') {
      result = result.filter(t => this.favorites.has(t.id));
    }

    // Búsqueda en vivo
    if (this.searchQuery) {
      result = result.filter(t => 
        (t.title && t.title.toLowerCase().includes(this.searchQuery)) ||
        (t.artist && t.artist.toLowerCase().includes(this.searchQuery)) ||
        (t.album && t.album.toLowerCase().includes(this.searchQuery)) ||
        (t.fileName && t.fileName.toLowerCase().includes(this.searchQuery))
      );
    }

    // Ordenamiento
    if (this.sortBy === 'title') {
      result.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (this.sortBy === 'artist') {
      result.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    } else if (this.sortBy === 'album') {
      result.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
    } else if (this.sortBy === 'size') {
      result.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
    }

    this.filteredTracks = result;
    this.initShuffleQueue();
    this.renderTrackList();
    this.updateStats();
  }

  updateStats() {
    const totalEl = document.getElementById('stat-total-tracks');
    const heroCountEl = document.getElementById('hero-track-count');
    const sidebarStats = document.getElementById('sidebar-track-stats');

    const total = this.tracks.length;
    if (totalEl) totalEl.textContent = total;
    if (heroCountEl) heroCountEl.textContent = `${total} canciones`;
    if (sidebarStats) sidebarStats.textContent = `${total} pistas • 6.43 GB`;
  }

  /**
   * Renderizado responsivo para Desktop (MSI) y Móvil (Xiaomi 15)
   */
  renderTrackList() {
    const listContainer = document.getElementById('track-list-container');
    if (!listContainer) return;

    if (this.filteredTracks.length === 0) {
      listContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-center text-slate-400">
          <i data-lucide="music" class="w-12 h-12 mb-3 text-slate-600"></i>
          <p class="font-bold text-base text-white">No se encontraron canciones</p>
          <p class="text-xs text-slate-500 mt-1">Prueba con otro término de búsqueda o selecciona otra categoría.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    listContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    this.filteredTracks.forEach((track, index) => {
      const isCurrent = this.currentTrackIndex !== -1 && this.tracks[this.currentTrackIndex]?.id === track.id;
      const isFav = this.isFavorite(track.id);

      const row = document.createElement('div');
      row.className = `spotify-track-row group flex sm:grid sm:grid-cols-12 gap-3 px-2 sm:px-3 py-2 items-center cursor-pointer select-none text-xs font-medium text-slate-300 ${
        isCurrent ? 'playing bg-white/10' : ''
      }`;
      row.dataset.id = track.id;

      const trackNum = index + 1;
      const thumbSrc = track.coverUrl || `assets/covers/cover_${(index % 241) + 1}.jpg`;
      const isHiRes = (track.bitDepth && track.bitDepth >= 24) || (track.sampleRate && track.sampleRate > 44100);

      row.innerHTML = `
        <!-- Columna 1: # / Play Icon / Equalizer Bars (Solo Desktop) -->
        <div class="hidden sm:flex col-span-1 items-center justify-center text-slate-400 font-mono text-sm relative">
          ${
            isCurrent
              ? `<div class="spotify-equalizer-bars"><span></span><span></span><span></span><span></span></div>`
              : `<span class="group-hover:hidden text-slate-400">${trackNum}</span>
                 <i data-lucide="play" class="w-4 h-4 text-white fill-current hidden group-hover:inline-block"></i>`
          }
        </div>

        <!-- Columna 2: Carátula + Título + Artista -->
        <div class="flex-1 sm:col-span-5 flex items-center space-x-3 min-w-0 pr-1">
          <div class="relative w-10 h-10 sm:w-10 sm:h-10 flex-shrink-0">
            <img src="${thumbSrc}" alt="Cover" class="w-full h-full rounded-md object-cover bg-slate-800 shadow" loading="lazy" />
            <!-- Indicador ecualizador móvil sobre la carátula si está sonando -->
            ${isCurrent ? `<div class="sm:hidden absolute inset-0 bg-black/50 rounded-md flex items-center justify-center"><div class="spotify-equalizer-bars"><span></span><span></span><span></span><span></span></div></div>` : ''}
          </div>
          <div class="flex flex-col min-w-0">
            <span class="track-title font-semibold text-xs sm:text-sm truncate ${isCurrent ? 'text-[#1ed760]' : 'text-white'} group-hover:underline">
              ${escapeHtml(track.title)}
            </span>
            <div class="flex items-center space-x-1.5 text-xs text-[#b3b3b3] truncate">
              <span class="truncate">${escapeHtml(track.artist)}</span>
              <span class="sm:hidden text-[9px] px-1 rounded font-mono ${isHiRes ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}">
                ${track.format || 'FLAC'}
              </span>
            </div>
          </div>
        </div>

        <!-- Columna 3: Álbum (Solo Desktop) -->
        <div class="col-span-3 hidden sm:block truncate text-xs text-[#b3b3b3] group-hover:text-white transition">
          ${escapeHtml(track.album || 'MÚSICA ULICITO')}
        </div>

        <!-- Columna 4: Calidad Audiófila (Solo Desktop) -->
        <div class="col-span-2 hidden sm:block text-center">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
            isHiRes ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
          }">
            ${track.format || 'FLAC'} ${isHiRes ? '24B' : '16B'}
          </span>
        </div>

        <!-- Columna 5: Duración y Corazón -->
        <div class="sm:col-span-1 flex items-center justify-end space-x-2 text-right pr-1 flex-shrink-0">
          <button class="btn-fav p-1 text-slate-400 hover:text-[#1ed760] transition ${isFav ? 'text-[#1ed760]' : 'opacity-0 sm:group-hover:opacity-100'}" title="Favorito">
            <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-[#1ed760]' : ''}"></i>
          </button>
          <span class="font-mono text-xs text-[#b3b3b3] w-9 text-right">${track.duration || '3:45'}</span>
        </div>
      `;

      // Evento de clic en la fila
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-fav')) {
          e.stopPropagation();
          this.toggleFavorite(track.id);
          return;
        }
        const fullIndex = this.tracks.findIndex(t => t.id === track.id);
        if (fullIndex !== -1 && this.onTrackChangeCallback) {
          this.currentTrackIndex = fullIndex;
          this.onTrackChangeCallback(this.tracks[fullIndex]);
          this.renderTrackList();
        }
      });

      fragment.appendChild(row);
    });

    listContainer.appendChild(fragment);
    if (window.lucide) window.lucide.createIcons();
  }

  getCurrentTrack() {
    if (this.currentTrackIndex >= 0 && this.currentTrackIndex < this.tracks.length) {
      return this.tracks[this.currentTrackIndex];
    }
    return null;
  }

  initShuffleQueue() {
    const list = this.filteredTracks.length > 0 ? this.filteredTracks : this.tracks;
    this.shuffleQueue = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].id !== this.tracks[this.currentTrackIndex]?.id) {
        this.shuffleQueue.push(i);
      }
    }
    for (let i = this.shuffleQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffleQueue[i], this.shuffleQueue[j]] = [this.shuffleQueue[j], this.shuffleQueue[i]];
    }
    this.shufflePointer = 0;
  }

  getNextTrack(isShuffle = false) {
    const list = this.filteredTracks.length > 0 ? this.filteredTracks : this.tracks;
    if (list.length === 0) return null;

    if (isShuffle) {
      if (!this.shuffleQueue || this.shuffleQueue.length === 0 || this.shufflePointer >= this.shuffleQueue.length) {
        this.initShuffleQueue();
      }
      if (this.shuffleQueue.length > 0) {
        const nextIdx = this.shuffleQueue[this.shufflePointer++];
        const targetTrack = list[nextIdx] || list[0];
        this.currentTrackIndex = this.tracks.findIndex(t => t.id === targetTrack.id);
        this.renderTrackList();
        return this.getCurrentTrack();
      }
    }

    let curFilteredIdx = list.findIndex(t => t.id === this.tracks[this.currentTrackIndex]?.id);
    if (curFilteredIdx === -1) curFilteredIdx = 0;
    const nextFilteredIdx = (curFilteredIdx + 1) % list.length;
    const targetTrack = list[nextFilteredIdx];
    this.currentTrackIndex = this.tracks.findIndex(t => t.id === targetTrack.id);
    this.renderTrackList();
    return this.getCurrentTrack();
  }

  getPrevTrack() {
    const list = this.filteredTracks.length > 0 ? this.filteredTracks : this.tracks;
    if (list.length === 0) return null;

    let curFilteredIdx = list.findIndex(t => t.id === this.tracks[this.currentTrackIndex]?.id);
    if (curFilteredIdx === -1) curFilteredIdx = 0;
    const prevFilteredIdx = (curFilteredIdx - 1 + list.length) % list.length;
    const targetTrack = list[prevFilteredIdx];
    this.currentTrackIndex = this.tracks.findIndex(t => t.id === targetTrack.id);
    this.renderTrackList();
    return this.getCurrentTrack();
  }

  isLastTrackInList() {
    const list = this.filteredTracks.length > 0 ? this.filteredTracks : this.tracks;
    if (list.length === 0) return true;
    const curFilteredIdx = list.findIndex(t => t.id === this.tracks[this.currentTrackIndex]?.id);
    return curFilteredIdx === list.length - 1;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.LibraryManager = LibraryManager;
