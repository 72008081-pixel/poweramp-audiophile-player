/**
 * Audiophile Library Manager
 * Administra la biblioteca musical local mediante:
 * 1. Detección automática del Servidor Local de Streaming (Node/Python con acceso a F:\...)
 * 2. File System Access API (showDirectoryPicker) con persistencia en IndexedDB
 * 3. Fallback universal <input type="file" webkitdirectory>
 * 4. Drag & Drop directo
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
              streamUrl: `/api/stream?id=${encodeURIComponent(t.id)}`,
              coverUrl: t.hasCover ? `/api/cover?id=${encodeURIComponent(t.id)}` : null,
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

  /**
   * Apertura interactiva usando la File System Access API
   */
  async openDirectoryPicker() {
    if (!window.showDirectoryPicker) {
      // Fallback a input webkitdirectory
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

  /**
   * Reconectar carpeta guardada en IndexedDB
   */
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

  /**
   * Escanea recursivamente un DirectoryHandle de la File System Access API
   */
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

    // Procesar metadatos en segundo plano con FlacParser
    const parsedTracks = [];
    for (let i = 0; i < audioFiles.length; i++) {
      const { file, path } = audioFiles[i];
      const meta = await window.FlacParser.parse(file);
      const streamUrl = URL.createObjectURL(file);

      parsedTracks.push({
        id: 'local_' + i,
        fileName: file.name,
        path: path,
        extension: meta.format,
        sizeBytes: file.size,
        sizeMB: meta.sizeMB,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        year: meta.year,
        hasLyrics: meta.hasLyrics,
        lyrics: meta.lyrics,
        hasCover: !!meta.coverUrl,
        coverUrl: meta.coverUrl,
        format: meta.format,
        sampleRate: meta.sampleRate,
        bitDepth: meta.bitDepth,
        channels: meta.channels,
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

  /**
   * Carga desde elementos <input type="file">
   */
  async loadFromFileInput(fileList) {
    const allowedExts = new Set(['flac', 'wav', 'mp3', 'm4a', 'aac', 'ogg']);
    const loadingIndicator = document.getElementById('library-loading-overlay');
    if (loadingIndicator) loadingIndicator.classList.remove('hidden');

    const parsedTracks = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const ext = file.name.split('.').pop().toLowerCase();
      if (allowedExts.has(ext)) {
        const meta = await window.FlacParser.parse(file);
        const streamUrl = URL.createObjectURL(file);

        parsedTracks.push({
          id: 'input_' + i,
          fileName: file.name,
          path: file.webkitRelativePath || file.name,
          extension: meta.format,
          sizeBytes: file.size,
          sizeMB: meta.sizeMB,
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          year: meta.year,
          hasLyrics: meta.hasLyrics,
          lyrics: meta.lyrics,
          hasCover: !!meta.coverUrl,
          coverUrl: meta.coverUrl,
          format: meta.format,
          sampleRate: meta.sampleRate,
          bitDepth: meta.bitDepth,
          channels: meta.channels,
          streamUrl,
          fileRef: file,
          isServerStream: false
        });
      }
    }

    this.tracks = parsedTracks;
    this.applyFilterAndSort();

    if (loadingIndicator) loadingIndicator.classList.add('hidden');
    if (this.onLibraryLoadedCallback) this.onLibraryLoadedCallback(this.tracks);
  }

  setFilter(filter) {
    this.currentFilter = filter;
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

    // Filtros por formato o favoritos
    if (this.currentFilter === 'flac') {
      result = result.filter(t => t.extension === 'FLAC');
    } else if (this.currentFilter === 'wav') {
      result = result.filter(t => t.extension === 'WAV');
    } else if (this.currentFilter === 'mp3') {
      result = result.filter(t => t.extension === 'MP3');
    } else if (this.currentFilter === 'fav') {
      result = result.filter(t => this.favorites.has(t.id));
    }

    // Filtro por búsqueda
    if (this.searchQuery) {
      result = result.filter(t => 
        t.title.toLowerCase().includes(this.searchQuery) ||
        t.artist.toLowerCase().includes(this.searchQuery) ||
        t.album.toLowerCase().includes(this.searchQuery) ||
        t.fileName.toLowerCase().includes(this.searchQuery)
      );
    }

    // Ordenamiento
    if (this.sortBy === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (this.sortBy === 'artist') {
      result.sort((a, b) => a.artist.localeCompare(b.artist));
    } else if (this.sortBy === 'album') {
      result.sort((a, b) => a.album.localeCompare(b.album));
    } else if (this.sortBy === 'size') {
      result.sort((a, b) => b.sizeBytes - a.sizeBytes);
    }

    this.filteredTracks = result;
    this.renderTrackList();
    this.updateStats();
  }

  updateStats() {
    const totalEl = document.getElementById('stat-total-tracks');
    const flacEl = document.getElementById('stat-flac-count');
    const hiResEl = document.getElementById('stat-hires-count');

    if (totalEl) totalEl.textContent = this.tracks.length;
    if (flacEl) {
      const flacCount = this.tracks.filter(t => t.extension === 'FLAC').length;
      flacEl.textContent = flacCount;
    }
    if (hiResEl) {
      const hiresCount = this.tracks.filter(t => t.bitDepth >= 24 || t.sampleRate > 44100).length;
      hiResEl.textContent = hiresCount;
    }
  }

  renderTrackList() {
    const listContainer = document.getElementById('track-list-container');
    if (!listContainer) return;

    if (this.filteredTracks.length === 0) {
      listContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center p-8 text-center text-slate-400">
          <i data-lucide="music-2" class="w-12 h-12 mb-3 opacity-30"></i>
          <p class="font-medium text-base">No hay pistas en la lista</p>
          <p class="text-xs text-slate-500 mt-1">Haz clic en "Cargar Carpeta" para sincronizar tus pistas de alta fidelidad.</p>
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

      const div = document.createElement('div');
      div.className = `track-item group flex items-center justify-between p-3 rounded-xl transition-all duration-200 cursor-pointer ${
        isCurrent ? 'bg-cyan-500/15 border border-cyan-500/30' : 'hover:bg-white/5 border border-transparent'
      }`;
      div.dataset.id = track.id;

      const fmt = track.format || track.extension || 'FLAC';
      const isHiRes = (track.bitDepth && track.bitDepth >= 24) || (track.sampleRate && track.sampleRate > 44100);
      const badgeClass = fmt === 'FLAC' 
        ? (isHiRes ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 shadow-sm shadow-amber-400/10' : 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30')
        : 'bg-slate-700 text-slate-300';

      const thumbSrc = track.coverUrl || window.ColorExtractor.generateFallbackCover(track.title, track.artist);
      const trackNum = (index + 1).toString().padStart(2, '0');

      div.innerHTML = `
        <div class="flex items-center space-x-3 overflow-hidden flex-1">
          <!-- Número de pista / Indicador de reproducción estilo Spotify -->
          <span class="w-6 text-center text-xs font-mono font-semibold text-slate-500 group-hover:hidden flex-shrink-0">
            ${isCurrent ? '<i data-lucide="volume-2" class="w-4 h-4 text-emerald-400 inline"></i>' : trackNum}
          </span>
          <span class="w-6 text-center text-xs text-white hidden group-hover:flex items-center justify-center flex-shrink-0">
            <i data-lucide="play" class="w-4 h-4 text-emerald-400 fill-current"></i>
          </span>

          <!-- Carátula del Álbum -->
          <div class="relative w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-slate-900 shadow-md">
            <img src="${thumbSrc}" alt="Carátula" class="w-full h-full object-cover" loading="lazy" onerror="this.src=window.ColorExtractor.generateFallbackCover('${track.title.replace(/'/g, '')}', '${track.artist.replace(/'/g, '')}')" />
            ${isCurrent ? `
              <div class="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span class="flex space-x-0.5 items-end h-3.5">
                  <span class="w-0.5 bg-emerald-400 animate-pulse h-2.5"></span>
                  <span class="w-0.5 bg-emerald-400 animate-pulse h-3.5" style="animation-delay: 0.15s"></span>
                  <span class="w-0.5 bg-emerald-400 animate-pulse h-2" style="animation-delay: 0.3s"></span>
                </span>
              </div>
            ` : ''}
          </div>

          <!-- Título y Artista -->
          <div class="flex flex-col min-w-0 pr-2">
            <span class="font-medium text-sm truncate ${isCurrent ? 'text-emerald-400 font-bold' : 'text-slate-100 group-hover:text-white'}">${track.title}</span>
            <div class="flex items-center space-x-2 text-xs text-slate-400 truncate mt-0.5">
              <span class="truncate hover:underline text-slate-300">${track.artist}</span>
              <span>•</span>
              <span class="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded ${badgeClass}">
                ${fmt} ${track.bitDepth ? track.bitDepth + 'b' : '16b'}
              </span>
            </div>
          </div>
        </div>

        <!-- Botón de Favoritos y Tamaño -->
        <div class="flex items-center space-x-3 flex-shrink-0 pl-2">
          <button class="btn-fav p-1.5 rounded-lg text-slate-400 hover:text-rose-400 transition" title="Favorito">
            <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : ''}"></i>
          </button>
          <span class="text-xs font-mono text-slate-400 hidden sm:inline">${track.sizeMB} MB</span>
        </div>
      `;

      // Evento de clic para reproducir
      div.addEventListener('click', (e) => {
        if (e.target.closest('.btn-fav')) {
          e.stopPropagation();
          this.toggleFavorite(track.id);
          return;
        }
        const fullIndex = this.tracks.findIndex(t => t.id === track.id);
        if (fullIndex !== -1 && this.onTrackChangeCallback) {
          this.currentTrackIndex = fullIndex;
          this.onTrackChangeCallback(this.tracks[fullIndex]);
          this.renderTrackList(); // Refrescar indicadores activos
        }
      });

      fragment.appendChild(div);
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

  getNextTrack(isShuffle = false) {
    if (this.tracks.length === 0) return null;
    if (isShuffle) {
      const randIdx = Math.floor(Math.random() * this.tracks.length);
      this.currentTrackIndex = randIdx;
    } else {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % this.tracks.length;
    }
    this.renderTrackList();
    return this.tracks[this.currentTrackIndex];
  }

  getPrevTrack() {
    if (this.tracks.length === 0) return null;
    this.currentTrackIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;
    this.renderTrackList();
    return this.tracks[this.currentTrackIndex];
  }
}

window.LibraryManager = LibraryManager;
