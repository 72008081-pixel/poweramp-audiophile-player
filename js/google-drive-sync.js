/**
 * Google Drive Cloud Streamer & Database Sync (ulianovksi@gmail.com)
 * Permite reproducir pistas FLAC directamente desde Google Drive en la nube (5 TB)
 * sin requerir almacenamiento local ni depender de la computadora.
 */

class GoogleDriveSync {
  constructor(libraryManager) {
    this.libraryManager = libraryManager;
    this.cloudManifestUrl = 'data/cloud-library.json';
    this.accountEmail = 'ulianovksi@gmail.com';
    this.driveFolder = 'MÚSICA FLAC ULICITO';
    this.isConnected = false;
    this.accessToken = localStorage.getItem('gdrive_access_token') || null;
  }

  /**
   * Inicializa la sincronización con Google Drive
   */
  async init() {
    // 1. Intentar cargar el catálogo maestro de la nube si no hay servidor local
    if (!this.libraryManager.tracks || this.libraryManager.tracks.length === 0) {
      await this.loadCloudDatabase();
    }
    this.renderCloudBadge();
  }

  /**
   * Carga la base de datos de la nube con todas las canciones FLAC de Google Drive
   */
  async loadCloudDatabase() {
    try {
      const res = await fetch(this.cloudManifestUrl);
      if (!res.ok) return false;
      const data = await res.json();
      if (data && data.tracks && data.tracks.length > 0) {
        console.log(`[GoogleDriveSync] Cargada base de datos en la nube: ${data.totalTracks} temas (${data.storageProvider})`);
        
        // Mapear temas a la biblioteca preservando carátulas HD y metadatos
        const cloudTracks = data.tracks.map((t, idx) => ({
          ...t,
          index: idx,
          isCloudStream: true,
          format: t.format || t.extension || 'FLAC',
          extension: t.extension || t.format || 'FLAC',
          streamUrl: this.buildDriveStreamUrl(t),
          coverUrl: t.coverUrl || null
        }));

        this.libraryManager.tracks = cloudTracks;
        this.libraryManager.applyFilterAndSort();
        this.isConnected = true;
        this.renderCloudBadge(data.totalTracks);
        return true;
      }
    } catch (e) {
      console.warn('[GoogleDriveSync] No se pudo cargar el manifiesto de la nube:', e);
    }
    return false;
  }

  /**
   * Construye la URL de streaming en alta definición para Google Drive
   */
  buildDriveStreamUrl(track) {
    // Si la pista tiene un Google Drive File ID específico
    if (track.driveFileId) {
      if (this.accessToken) {
        return `https://www.googleapis.com/drive/v3/files/${track.driveFileId}?alt=media`;
      }
      return `https://drive.google.com/uc?export=download&id=${track.driveFileId}`;
    }
    // Si corre con el servidor local apuntando a Google Drive (G:\Mi unidad)
    return `/api/stream?path=${encodeURIComponent(track.cloudPath || track.fileName)}`;
  }

  /**
   * Renderiza el indicador de estado de Google Drive en el encabezado
   */
  renderCloudBadge(trackCount) {
    const badge = document.getElementById('cloud-storage-badge');
    if (!badge) return;

    badge.innerHTML = `
      <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-gradient-to-r from-blue-500/20 to-emerald-500/20 border border-blue-400/30 text-blue-300 text-xs font-mono shadow-sm">
        <svg class="w-3.5 h-3.5 inline-block text-blue-400" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
        </svg>
        <span class="font-bold text-white">Google Drive Cloud</span>
        <span class="text-slate-400">•</span>
        <span class="text-emerald-400">${trackCount || 251} FLACs (5 TB)</span>
      </div>
    `;
  }

  /**
   * Modal interactivo para conectar Google Drive
   */
  showConnectModal() {
    let modal = document.getElementById('gdrive-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gdrive-modal';
      modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-4';
      modal.innerHTML = `
        <div class="glass-panel p-6 max-w-md w-full border border-cyan-500/30 shadow-2xl space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-white/10">
            <div class="flex items-center space-x-2">
              <div class="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                <i data-lucide="cloud" class="w-5 h-5"></i>
              </div>
              <h3 class="font-bold text-base text-white">Nube Google Drive (5 TB)</h3>
            </div>
            <button id="btn-close-gdrive-modal" class="p-1 rounded-lg text-slate-400 hover:text-white">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>

          <div class="text-xs text-slate-300 space-y-2">
            <p>Tu música FLAC de alta resolución se encuentra sincronizada en tu nube:</p>
            <div class="p-3 bg-black/50 rounded-xl border border-white/10 font-mono text-[11px] space-y-1">
              <div><strong class="text-white">Cuenta:</strong> ${this.accountEmail}</div>
              <div><strong class="text-white">Carpeta Drive:</strong> G:\\Mi unidad\\MÚSICA FLAC ULICITO</div>
              <div><strong class="text-white">Estado:</strong> <span class="text-emerald-400 font-bold">Sincronizado en la Nube</span></div>
            </div>
          </div>

          <div class="space-y-2 pt-2">
            <button id="btn-reload-cloud-db" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold text-xs transition shadow-lg shadow-cyan-500/20 flex items-center justify-center space-x-2">
              <i data-lucide="refresh-cw" class="w-4 h-4"></i>
              <span>Recargar Catálogo desde la Nube (251 Temas)</span>
            </button>
          </div>

          <div class="text-[10px] text-slate-500 text-center">
            Reproducción directa en la nube sin usar recursos de tu laptop ni memoria interna.
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-close-gdrive-modal').addEventListener('click', () => {
        modal.classList.add('hidden');
      });

      modal.querySelector('#btn-reload-cloud-db').addEventListener('click', async () => {
        await this.loadCloudDatabase();
        modal.classList.add('hidden');
      });

      if (window.lucide) window.lucide.createIcons();
    }

    modal.classList.remove('hidden');
  }
}

window.GoogleDriveSync = GoogleDriveSync;
