/**
 * Poweramp Audiophile Server
 * Servidor local de audio de alta fidelidad sin dependencias externas (Node.js nativo).
 * Soporta streaming con HTTP Range (206 Partial Content) para FLAC, WAV, MP3.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

const PORT = process.env.PORT || 3000;
const STATIC_DIR = __dirname;
const GDRIVE_DIR = 'G:\\Mi unidad\\MÚSICA FLAC ULICITO';
const LOCAL_FALLBACK = 'F:\\FOTOS XIAOMI 15-2026\\MÚSICA ULICITO';
let MUSIC_DIR = process.env.MUSIC_DIR || (fs.existsSync(GDRIVE_DIR) ? GDRIVE_DIR : LOCAL_FALLBACK);

console.log(`[STORAGE] Fuente de Audio Configurada: ${fs.existsSync(GDRIVE_DIR) ? 'Google Drive Cloud (G:\\Mi unidad\\...)' : 'Local'}`);

// Cargar catálogo de metadatos enriquecidos de la nube
let cloudManifestMap = new Map();
try {
  const cLibPath = path.join(STATIC_DIR, 'data', 'cloud-library.json');
  if (fs.existsSync(cLibPath)) {
    const rawData = JSON.parse(fs.readFileSync(cLibPath, 'utf8'));
    if (rawData && rawData.tracks) {
      rawData.tracks.forEach(t => cloudManifestMap.set(t.fileName, t));
    }
    console.log(`[CATALOG] Catálogo maestro cargado: ${cloudManifestMap.size} pistas indexadas.`);
  }
} catch (e) {
  console.warn('[CATALOG] No se pudo precargar cloud-library.json:', e.message);
}


const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg'
};

// Parser binario ultra-rápido para FLAC en Node
function parseFlacMetadata(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    // Leemos los primeros 8 KB: suficiente para STREAMINFO y la gran mayoría de Vorbis Comments
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);

    if (bytesRead < 42 || buf.toString('ascii', 0, 4) !== 'fLaC') {
      return null;
    }

    let offset = 4;
    const meta = {
      format: 'FLAC',
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      tags: {},
      hasCover: true // Asumimos carátula disponible si es FLAC estándar
    };

    while (offset < bytesRead - 4) {
      const b0 = buf[offset];
      const isLast = (b0 & 0x80) !== 0;
      const blockType = b0 & 0x7F;
      const length = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
      offset += 4;

      if (blockType === 0 && length >= 18 && offset + 14 <= bytesRead) {
        // STREAMINFO
        const sr = (buf[offset + 10] << 12) | (buf[offset + 11] << 4) | (buf[offset + 12] >> 4);
        const channels = ((buf[offset + 12] >> 1) & 0x07) + 1;
        const bps = (((buf[offset + 12] & 0x01) << 4) | (buf[offset + 13] >> 4)) + 1;
        meta.sampleRate = sr;
        meta.channels = channels;
        meta.bitDepth = bps;
      } else if (blockType === 4 && offset + length <= bytesRead) {
        // VORBIS_COMMENT
        try {
          let pos = offset;
          const vendorLen = buf.readUInt32LE(pos);
          pos += 4 + vendorLen;
          if (pos + 4 <= offset + length) {
            const numComments = buf.readUInt32LE(pos);
            pos += 4;
            for (let i = 0; i < numComments && pos < offset + length; i++) {
              const cLen = buf.readUInt32LE(pos);
              pos += 4;
              if (pos + cLen <= offset + length) {
                const comment = buf.toString('utf8', pos, pos + cLen);
                pos += cLen;
                const eqIdx = comment.indexOf('=');
                if (eqIdx !== -1) {
                  const key = comment.slice(0, eqIdx).toUpperCase();
                  const val = comment.slice(eqIdx + 1);
                  meta.tags[key] = val;
                }
              }
            }
          }
        } catch (e) {}
      } else if (blockType === 6) {
        // PICTURE
        meta.hasCover = true;
      }

      offset += length;
      if (isLast) break;
    }

    return meta;
  } catch (err) {
    return null;
  }
}

// Extrae la imagen binaria incrustada de un FLAC
function extractFlacCover(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(4);
    fs.readSync(fd, headerBuf, 0, 4, 0);
    if (headerBuf.toString('ascii') !== 'fLaC') {
      fs.closeSync(fd);
      return null;
    }

    const maxRead = 6 * 1024 * 1024; // 6MB suficiente para carátulas HD
    const buf = Buffer.alloc(maxRead);
    const bytesRead = fs.readSync(fd, buf, 0, maxRead, 4);
    fs.closeSync(fd);

    let offset = 0;
    while (offset < bytesRead - 4) {
      const b0 = buf[offset];
      const isLast = (b0 & 0x80) !== 0;
      const blockType = b0 & 0x7F;
      const length = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
      offset += 4;

      if (blockType === 6) {
        let pos = offset;
        const picType = buf.readUInt32BE(pos);
        pos += 4;
        const mimeLen = buf.readUInt32BE(pos);
        pos += 4;
        const mime = buf.toString('ascii', pos, pos + mimeLen);
        pos += mimeLen;
        const descLen = buf.readUInt32BE(pos);
        pos += 4 + descLen + 16;
        const picLen = buf.readUInt32BE(pos);
        pos += 4;

        if (pos + picLen <= bytesRead) {
          const imageBuf = buf.subarray(pos, pos + picLen);
          return { mime: mime || 'image/jpeg', data: imageBuf };
        }
      }

      offset += length;
      if (isLast) break;
    }
  } catch (e) {}
  return null;
}

// Cache de pistas escaneadas
let tracksCache = [];
let isScanning = false;

function scanMusicDirectory(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const allowedExts = new Set(['.flac', '.wav', '.mp3', '.m4a', '.aac', '.ogg']);

  function walk(currentDir) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (allowedExts.has(ext)) {
            const stat = fs.statSync(fullPath);
            let meta = null;
            if (ext === '.flac') {
              meta = parseFlacMetadata(fullPath);
            }

            const cleanFileName = path.basename(entry.name, ext);
            let title = cleanFileName;
            let artist = 'Artista Desconocido';
            let album = 'Álbum Desconocido';
            let lyrics = '';
            let year = '';

            // Si el nombre viene en formato "Título - Artista" o "Artista - Título"
            if (cleanFileName.includes(' - ')) {
              const parts = cleanFileName.split(' - ');
              title = parts[0].trim();
              artist = parts.slice(1).join(' - ').trim();
            }

            if (meta && meta.tags) {
              if (meta.tags.TITLE) title = meta.tags.TITLE;
              if (meta.tags.ARTIST || meta.tags.ALBUMARTIST) artist = meta.tags.ARTIST || meta.tags.ALBUMARTIST;
              if (meta.tags.ALBUM) album = meta.tags.ALBUM;
              if (meta.tags.YEAR || meta.tags.DATE) year = (meta.tags.YEAR || meta.tags.DATE).slice(0, 4);
              if (meta.tags.LYRICS || meta.tags.UNSYNCEDLYRICS) {
                lyrics = meta.tags.LYRICS || meta.tags.UNSYNCEDLYRICS;
              }
            }

            let duration = '3:45';
            let durationSeconds = 225;

            // Enriquecer con metadatos del catálogo si coincide el fileName
            if (cloudManifestMap && cloudManifestMap.has(entry.name)) {
              const enriched = cloudManifestMap.get(entry.name);
              if (enriched.title) title = enriched.title;
              if (enriched.artist) artist = enriched.artist;
              if (enriched.album) album = enriched.album;
              if (enriched.duration) duration = enriched.duration;
              if (enriched.durationSeconds) durationSeconds = enriched.durationSeconds;
              if (enriched.lyrics) lyrics = enriched.lyrics;
            }

            results.push({
              id: Buffer.from(fullPath).toString('base64url'),
              path: fullPath,
              fileName: entry.name,
              relativePath: path.relative(dir, fullPath),
              extension: ext.replace('.', '').toUpperCase(),
              sizeBytes: stat.size,
              sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
              title,
              artist,
              album,
              year,
              duration,
              durationSeconds,
              hasLyrics: !!lyrics,
              lyrics,
              hasCover: meta ? meta.hasCover : false,
              format: meta ? meta.format : ext.replace('.', '').toUpperCase(),
              sampleRate: meta ? meta.sampleRate : (ext === '.wav' ? 44100 : 44100),
              bitDepth: meta ? meta.bitDepth : (ext === '.flac' ? 16 : 16),
              channels: meta ? meta.channels : 2
            });
          }
        }
      }
    } catch (err) {
      console.error('Error escaneando directorio:', err.message);
    }
  }

  walk(dir);
  return results;
}

// Obtener IPs locales de la red Wi-Fi/LAN
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers para permitir consumo desde cualquier origen local
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API: Estado del servidor ---
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      musicDir: MUSIC_DIR,
      exists: fs.existsSync(MUSIC_DIR),
      trackCount: tracksCache.length,
      isScanning
    }));
    return;
  }

  // --- API: Lista de canciones ---
  if (pathname === '/api/tracks') {
    if (tracksCache.length === 0 && fs.existsSync(MUSIC_DIR) && !isScanning) {
      isScanning = true;
      tracksCache = scanMusicDirectory(MUSIC_DIR);
      isScanning = false;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      musicDir: MUSIC_DIR,
      total: tracksCache.length,
      tracks: tracksCache
    }));
    return;
  }

  // --- API: Forzar re-escaneo ---
  if (pathname === '/api/rescan') {
    if (parsedUrl.query.path && fs.existsSync(parsedUrl.query.path)) {
      MUSIC_DIR = parsedUrl.query.path;
    }
    isScanning = true;
    tracksCache = scanMusicDirectory(MUSIC_DIR);
    isScanning = false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, total: tracksCache.length }));
    return;
  }

  // --- API: Extraer carátula en alta definición ---
  if (pathname === '/api/cover') {
    let filePath = '';
    if (parsedUrl.query.id) {
      try {
        filePath = Buffer.from(parsedUrl.query.id, 'base64url').toString('utf8');
      } catch (e) {}
    } else if (parsedUrl.query.path) {
      filePath = parsedUrl.query.path;
    }

    if (filePath && fs.existsSync(filePath)) {
      const cover = extractFlacCover(filePath);
      if (cover) {
        res.writeHead(200, {
          'Content-Type': cover.mime,
          'Content-Length': cover.data.length,
          'Cache-Control': 'public, max-age=86400'
        });
        res.end(cover.data);
        return;
      }
    }

    // Carátula por defecto 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Cover not found');
    return;
  }

  // --- API: Streaming de audio de alta fidelidad con HTTP Range (206) ---
  if (pathname === '/api/stream') {
    let filePath = '';
    if (parsedUrl.query.id) {
      try {
        filePath = Buffer.from(parsedUrl.query.id, 'base64url').toString('utf8');
      } catch (e) {}
    } else if (parsedUrl.query.path) {
      filePath = parsedUrl.query.path;
    }

    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Audio file not found');
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const range = req.headers.range;
    if (range) {
      // Petición con rango de bytes (seeking instantáneo)
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`
        });
        res.end();
        return;
      }

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // Reproducción completa
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
    return;
  }

  // --- Archivos estáticos de la aplicación Web (HTML, CSS, JS) ---
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  const staticFilePath = path.join(STATIC_DIR, safePath);
  if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
    const ext = path.extname(staticFilePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(staticFilePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n======================================================');
  console.log('   🎵 POWERAMP AUDIOPHILE WEB PLAYER - SERVER ONLINE  ');
  console.log('======================================================');
  console.log(`💻 Acceso Local (MSI Laptop):  http://localhost:${PORT}`);
  ips.forEach(ip => {
    console.log(`📱 Acceso Red Wi-Fi (Xiaomi 15): http://${ip}:${PORT}`);
  });
  console.log(`📂 Carpeta de Música Configurada: ${MUSIC_DIR}`);
  console.log('======================================================\n');

  // Inicializar escaneo en segundo plano sin bloquear el arranque del servidor
  if (fs.existsSync(MUSIC_DIR)) {
    console.log(`[BIBLIOTECA] Indexando carpeta de audio en segundo plano...`);
    const startT = Date.now();
    tracksCache = scanMusicDirectory(MUSIC_DIR);
    console.log(`[BIBLIOTECA] ¡Listo en ${(Date.now() - startT)}ms! ${tracksCache.length} canciones cargadas.`);
  }
});
