/**
 * FLAC & Audio Binary Metadata Parser (Client-Side)
 * Decodifica STREAMINFO (Frecuencia, Bits, Canales), VORBIS_COMMENT (Etiquetas, Letras)
 * y PICTURE (Carátula JPEG/PNG) directamente desde el archivo local sin dependencias.
 */

class FlacParser {
  /**
   * Lee y parsea los metadatos de un archivo de audio (File o Blob).
   * @param {File|Blob} file 
   * @returns {Promise<Object>}
   */
  static async parse(file) {
    const ext = file.name ? file.name.split('.').pop().toLowerCase() : '';
    if (ext === 'flac') {
      return this.parseFlacFile(file);
    } else {
      return this.parseGenericAudio(file);
    }
  }

  static async parseFlacFile(file) {
    try {
      // Leemos hasta 5MB del inicio para capturar STREAMINFO, comentarios y carátula
      const sliceSize = Math.min(file.size, 5 * 1024 * 1024);
      const buffer = await file.slice(0, sliceSize).arrayBuffer();
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);

      // Verificar cabecera "fLaC"
      const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (magic !== 'fLaC') {
        return this.parseGenericAudio(file);
      }

      let offset = 4;
      const meta = {
        format: 'FLAC',
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
        tags: {},
        coverUrl: null,
        lyrics: '',
        hasLyrics: false
      };

      while (offset < buffer.byteLength - 4) {
        const b0 = bytes[offset];
        const isLast = (b0 & 0x80) !== 0;
        const blockType = b0 & 0x7F;
        const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 4;

        if (offset + length > buffer.byteLength) {
          // Bloque excede el slice leído
          break;
        }

        if (blockType === 0 && length >= 18) {
          // STREAMINFO
          const sr = (bytes[offset + 10] << 12) | (bytes[offset + 11] << 4) | (bytes[offset + 12] >> 4);
          const channels = ((bytes[offset + 12] >> 1) & 0x07) + 1;
          const bps = (((bytes[offset + 12] & 0x01) << 4) | (bytes[offset + 13] >> 4)) + 1;
          meta.sampleRate = sr;
          meta.channels = channels;
          meta.bitDepth = bps;
        } else if (blockType === 4 && length > 8) {
          // VORBIS_COMMENT
          try {
            let pos = offset;
            const vendorLen = view.getUint32(pos, true);
            pos += 4 + vendorLen;
            if (pos + 4 <= offset + length) {
              const numComments = view.getUint32(pos, true);
              pos += 4;
              const decoder = new TextDecoder('utf-8');
              for (let i = 0; i < numComments && pos < offset + length; i++) {
                const cLen = view.getUint32(pos, true);
                pos += 4;
                if (pos + cLen <= offset + length) {
                  const commBytes = bytes.subarray(pos, pos + cLen);
                  const comment = decoder.decode(commBytes);
                  pos += cLen;
                  const eqIdx = comment.indexOf('=');
                  if (eqIdx !== -1) {
                    const key = comment.slice(0, eqIdx).toUpperCase();
                    const val = comment.slice(eqIdx + 1);
                    if (!meta.tags[key]) meta.tags[key] = val;
                  }
                }
              }
            }
          } catch (e) {
            console.warn('Error leyendo Vorbis Comments:', e);
          }
        } else if (blockType === 6) {
          // METADATA_BLOCK_PICTURE
          try {
            let pos = offset;
            const picType = view.getUint32(pos, false);
            pos += 4;
            const mimeLen = view.getUint32(pos, false);
            pos += 4;
            const mime = String.fromCharCode(...bytes.subarray(pos, pos + mimeLen));
            pos += mimeLen;
            const descLen = view.getUint32(pos, false);
            pos += 4 + descLen + 16; // saltar desc + width(4) + height(4) + depth(4) + colors(4)
            const picLen = view.getUint32(pos, false);
            pos += 4;

            if (pos + picLen <= buffer.byteLength) {
              const picData = bytes.subarray(pos, pos + picLen);
              const blob = new Blob([picData], { type: mime || 'image/jpeg' });
              meta.coverUrl = URL.createObjectURL(blob);
            }
          } catch (e) {
            console.warn('Error extrayendo carátula FLAC:', e);
          }
        }

        offset += length;
        if (isLast) break;
      }

      // Procesar etiquetas a propiedades limpias
      const cleanFileName = file.name.replace(/\.[^/.]+$/, "");
      let title = cleanFileName;
      let artist = 'Artista Desconocido';
      let album = 'Álbum Desconocido';
      let year = '';

      if (cleanFileName.includes(' - ')) {
        const parts = cleanFileName.split(' - ');
        title = parts[0].trim();
        artist = parts.slice(1).join(' - ').trim();
      }

      if (meta.tags) {
        if (meta.tags.TITLE) title = meta.tags.TITLE;
        if (meta.tags.ARTIST || meta.tags.ALBUMARTIST) artist = meta.tags.ARTIST || meta.tags.ALBUMARTIST;
        if (meta.tags.ALBUM) album = meta.tags.ALBUM;
        if (meta.tags.YEAR || meta.tags.DATE) year = (meta.tags.YEAR || meta.tags.DATE).slice(0, 4);
        if (meta.tags.LYRICS || meta.tags.UNSYNCEDLYRICS) {
          meta.lyrics = meta.tags.LYRICS || meta.tags.UNSYNCEDLYRICS;
          meta.hasLyrics = true;
        }
      }

      return {
        format: 'FLAC',
        title,
        artist,
        album,
        year,
        sampleRate: meta.sampleRate,
        bitDepth: meta.bitDepth,
        channels: meta.channels,
        coverUrl: meta.coverUrl,
        lyrics: meta.lyrics,
        hasLyrics: meta.hasLyrics,
        sizeBytes: file.size,
        sizeMB: (file.size / (1024 * 1024)).toFixed(2)
      };
    } catch (err) {
      console.warn('Error parseando FLAC:', err);
      return this.parseGenericAudio(file);
    }
  }

  static parseGenericAudio(file) {
    const cleanFileName = file.name ? file.name.replace(/\.[^/.]+$/, "") : "Pista de Audio";
    const ext = file.name ? file.name.split('.').pop().toUpperCase() : 'AUDIO';
    let title = cleanFileName;
    let artist = 'Artista Desconocido';

    if (cleanFileName.includes(' - ')) {
      const parts = cleanFileName.split(' - ');
      title = parts[0].trim();
      artist = parts.slice(1).join(' - ').trim();
    }

    return {
      format: ext,
      title,
      artist,
      album: 'Álbum Local',
      year: '',
      sampleRate: ext === 'WAV' ? 44100 : 44100,
      bitDepth: ext === 'WAV' ? 16 : 16,
      channels: 2,
      coverUrl: null,
      lyrics: '',
      hasLyrics: false,
      sizeBytes: file.size || 0,
      sizeMB: ((file.size || 0) / (1024 * 1024)).toFixed(2)
    };
  }
}

window.FlacParser = FlacParser;
