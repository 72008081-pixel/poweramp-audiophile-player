/**
 * Audiophile Library Manager (Spotify UI Engine)
 * Administra la biblioteca de 251 canciones FLAC de Google Drive (5 TB)
 * Implementa renderizado de tabla idéntico a Spotify, cola Shuffle Fisher-Yates,
 * filtrado por formatos/favoritos y sincronización con el servidor local y la nube.
 */

class LibraryManager {
  constructor() {
    this.tracks = [];
    this.filteredTracks = [];
    this.currentTrackIndex = -1;
    this.favorites = new Set(JSON.parse(localStorage.getItem('poweramp_favorites') || '[]'));
    this.currentFilter = 'all'; // 'all', 'flac', 'wav', 'mp3', 'fav'
    this.searchQuery = '';
    this.sortBy = 'title'; // 'title', 'artist', 'album', 'size'

    this.shuffleQueue = [];
    this.shufflePointer = 0;

    this.onTrackChangeCallback = null;
    this.onLibraryLoadedCallback = null;
    this.dbName = 'PowerampAudiophileDB';
  }

  setTrackChangeCallback(cb) {
    this.onTrackChangeCallback = cb;
  }

  setLibraryLoadedCallback(cb) {
    this.onLibraryLoadedCallback = cb;
  }

  async init() {
    // 1. Intentar conectar con el Servidor Local primero
    const serverConnected = await this.tryConnectLocalServer();
    if (serverConnected) return;

    // 2. Si no hay servidor local, verificar si hay un directorio guardado en IndexedDB
    await this.checkStoredDirectoryHandle();
  }

  /**
   * Intenta conectarse a la API del servidor local para cargar automáticamente la ruta
   */
  async tryConnectLocalServer() {
    try {
      const res = await fetch('/api/status', { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'online') {
          console.log('[LibraryManager] Servidor local detectado:', data.musicDir);
          const tracksRes = await fetch('/api/tracks');
          const tracksData = await tracksRes.json();
          if (tracksData.tracks && tracksData.tracks.length > 0) {
            this.tracks = tracksData.tracks.map((t, idx) => ({
              ...t,
              index: idx,
              format: t.format || t.extension || 'FLAC',
              extension: t.extension || t.format || 'FLAC',
              streamUrl: `/api/stream?id=${encodeURIComponent(t.id)}`,
              coverUrl: t.coverUrl || (t.hasCover ? `/api/cover?id=${encodeURIComponent(t.id)}` : `assets/covers/cover_${idx + 1}.jpg`),
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
      // Servidor local no activo o ejecutando directamente como archivo estático
    }
    return false;
  }

  /**
   * Guarda el FileSystemDirectoryHandle en IndexedDB
   */
  async saveDirectoryHandle(handle) {
    return new Promise((resolve) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'music_folder');
        tx.oncomplete = () => resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  }

  /**
   * Recupera el FileSystemDirectoryHandle almacenado
   */
  async getStoredDirectoryHandle() {
    return new Promise((resolve) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readonly');
        const getReq = tx.objectStore('handles').get('music_folder');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  }

  async checkStoredDirectoryHandle() {
    const handle = await this.getStoredDirectoryHandle();
    const reconnectBtn = document.getElementById('btn-reconnect-folder');
    if (handle && reconnectBtn) {
      reconnectBtn.classList.remove('hidden');
    }
  }

  async openDirectoryPicker() {
    if (!window.showDirectoryPicker) {
      document.getElementById('input-folder-fallback').click();
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'poweramp_music_library',
        mode: 'read'
      });

      await this.saveDirectoryHandle(dirHandle);
      await this.scanDirectoryHandle(dirHandle);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error abriendo carpeta:', err);
        document.getElementById('input-folder-fallback').click();
      }
    }
  }

  async reconnectStoredDirectory() {
    const handle = await this.getStoredDirectoryHandle();
    if (!handle) return;
    try {
      const permission = await handle.requestPermission({ mode: 'read' });
      if (permission === 'granted') {
        await this.scanDirectoryHandle(handle);
      }
    } catch (e) {
      console.warn('Error reconectando carpeta guardada:', e);
      this.openDirectoryPicker();
    }
  }

  async scanDirectoryHandle(dirHandle) {
    const allowedExts = new Set(['flac', 'wav', 'mp3', 'm4a', 'aac', 'ogg']);
    const audioFiles = [];

    const loadingIndicator = document.getElementById('library-loading-overlay');
    if (loadingIndicator) loadingIndicator.classList.remove('hidden');

    async function walk(handle, currentPath = '') {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const ext = entry.name.split('.').pop().toLowerCase();
          if (allowedExts.has(ext)) {
            const file = await entry.getFile();
            audioFiles.push({ file, path: currentPath + '/' + entry.name });
          }
        } else if (entry.kind === 'directory') {
          await walk(entry, currentPath + '/' + entry.name);
        }
      }
    }

    await walk(dirHandle);

    const parsedTracks = [];
    for (let i = 0; i < audioFiles.length; i++) {
      const { file, path } = audioFiles[i];
      const meta = await window.FlacParser.parse(file);
      const streamUrl = URL.createObjectURL(file);

      parsedTracks.push({
        id: 'local_' + i,
        fileName: file.name,
        path: path,
        extension: meta.format || 'FLAC',
        format: meta.format || 'FLAC',
        sizeBytes: file.size,
        sizeMB: meta.sizeMB,
        title: meta.title || file.name.replace(/\.[^/.]+$/, ''),
        artist: meta.artist || 'Artista Desconocido',
        album: meta.album || 'MÚSICA ULICITO',
        year: meta.year || '',
        duration: meta.duration || '3:45',
        hasLyrics: meta.hasLyrics,
        lyrics: meta.lyrics,
        hasCover: !!meta.coverUrl,
        coverUrl: meta.coverUrl || `assets/covers/cover_${(i % 241) + 1}.jpg`,
        sampleRate: meta.sampleRate || 44100,
        bitDepth: meta.bitDepth || 16,
        channels: meta.channels || 2,
        streamUrl,
        fileRef: file,
        isServerStream: false
      });
    }

    this.tracks = parsedTracks;
    this.applyFilterAndSort();

    if (loadingIndicator) loadingIndicator.classList.add('hidden');
    const reconnectBtn = document.getElementById('btn-reconnect-folder');
    if (reconnectBtn) reconnectBtn.classList.add('hidden');

    if (this.onLibraryLoadedCallback) this.onLibraryLoadedCallback(this.tracks);
  }

  setFilter(filterKey) {
    this.currentFilter = filterKey;
    document.querySelectorAll('.filter-pill').forEach(btn => {
      const isSelected = btn.dataset.filter === filterKey;
      btn.classList.toggle('active', isSelected);
      btn.classList.toggle('bg-white', isSelected);
      btn.classList.toggle('text-black', isSelected);
      btn.classList.toggle('font-bold', isSelected);
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
    } else if (this.currentFilter === 'wav') {
      result = result.filter(t => (t.format === 'WAV' || t.extension === 'WAV'));
    } else if (this.currentFilter === 'mp3') {
      result = result.filter(t => (t.format === 'MP3' || t.extension === 'MP3'));
    } else if (this.currentFilter === 'fav') {
      result = result.filter(t => this.favorites.has(t.id));
    }

    // Búsqueda
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
   * Renderizado idéntico a Spotify (# | Título | Álbum | Calidad / Fecha | Duración)
   */
  renderTrackList() {
    const listContainer = document.getElementById('track-list-container');
    if (!listContainer) return;

    if (this.filteredTracks.length === 0) {
      listContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-center text-slate-400">
          <i data-lucide="music" class="w-12 h-12 mb-3 text-slate-600"></i>
          <p class="font-bold text-base text-white">No se encontraron canciones</p>
          <p class="text-xs text-slate-500 mt-1">Intenta con otro término de búsqueda o cambia de filtro.</p>
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
      row.className = `spotify-track-row group grid grid-cols-12 gap-3 px-3 py-2 items-center cursor-pointer select-none text-xs font-medium text-slate-300 ${
        isCurrent ? 'playing bg-white/10' : ''
      }`;
      row.dataset.id = track.id;

      const trackNum = index + 1;
      const thumbSrc = track.coverUrl || `assets/covers/cover_${(index % 241) + 1}.jpg`;
      const isHiRes = (track.bitDepth && track.bitDepth >= 24) || (track.sampleRate && track.sampleRate > 44100);

      row.innerHTML = `
        <!-- Columna 1: # / Play Icon / Equalizer Bars -->
        <div class="col-span-1 flex items-center justify-center text-slate-400 font-mono text-sm relative">
          ${
            isCurrent
              ? `<div class="spotify-equalizer-bars"><span></span><span></span><span></span><span></span></div>`
              : `<span class="group-hover:hidden text-slate-400">${trackNum}</span>
                 <i data-lucide="play" class="w-4 h-4 text-white fill-current hidden group-hover:inline-block"></i>`
          }
        </div>

        <!-- Columna 2: Título y Artista -->
        <div class="col-span-6 sm:col-span-5 flex items-center space-x-3 min-w-0 pr-2">
          <img src="${thumbSrc}" alt="Cover" class="w-10 h-10 rounded-md object-cover flex-shrink-0 bg-slate-800 shadow" loading="lazy" />
          <div class="flex flex-col min-w-0">
            <span class="track-title font-semibold text-sm truncate ${isCurrent ? 'text-[#1ed760]' : 'text-white'} group-hover:underline">
              ${escapeHtml(track.title)}
            </span>
            <span class="text-xs text-[#b3b3b3] truncate group-hover:text-white transition">
              ${escapeHtml(track.artist)}
            </span>
          </div>
        </div>

        <!-- Columna 3: Álbum -->
        <div class="col-span-3 hidden sm:block truncate text-xs text-[#b3b3b3] group-hover:text-white transition">
          ${escapeHtml(track.album || 'MÚSICA ULICITO')}
        </div>

        <!-- Columna 4: Calidad Audiófila -->
        <div class="col-span-2 text-center">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
            isHiRes ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
          }">
            ${track.format || 'FLAC'} ${isHiRes ? '24B' : '16B'}
          </span>
        </div>

        <!-- Columna 5: Duración y Corazón -->
        <div class="col-span-3 sm:col-span-1 flex items-center justify-end space-x-2 text-right pr-2">
          <button class="btn-fav p-1 text-slate-400 hover:text-rose-500 transition ${isFav ? 'text-rose-500' : 'opacity-0 group-hover:opacity-100'}" title="Favorito">
            <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-rose-500' : ''}"></i>
          </button>
          <span class="font-mono text-xs text-[#b3b3b3] w-10 text-right">${track.duration || '3:45'}</span>
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

  /**
   * Genera una cola de reproducción aleatoria Fisher-Yates sin repeticiones
   */
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

    // Modo secuencial normal
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
