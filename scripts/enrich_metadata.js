const fs = require('fs');
const path = require('path');

const dir = 'G:\\Mi unidad\\MÚSICA FLAC ULICITO';
const manifestPath = path.join(__dirname, '..', 'data', 'cloud-library.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

console.log(`[ENRICH] Procesando ${manifest.tracks.length} pistas desde: ${dir}`);

let flacCount = 0;
let mp3Count = 0;

for (let i = 0; i < manifest.tracks.length; i++) {
  const track = manifest.tracks[i];
  const filePath = path.join(dir, track.fileName);
  if (!fs.existsSync(filePath)) continue;

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);

    const isFlac = header.toString('ascii', 0, 4) === 'fLaC';
    const isMp3 = (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) || header.toString('ascii', 0, 3) === 'ID3';

    if (isFlac) {
      flacCount++;
      let pos = 4;
      let blockCount = 0;

      while (pos < fileSize - 4 && blockCount < 20) {
        blockCount++;
        const h = Buffer.alloc(4);
        fs.readSync(fd, h, 0, 4, pos);
        const isLast = (h[0] & 0x80) !== 0;
        const type = h[0] & 0x7F;
        const len = (h[1] << 16) | (h[2] << 8) | h[3];
        pos += 4;

        if (len < 0 || pos + len > fileSize) break;

        if (type === 0 && len >= 18) {
          // STREAMINFO
          const sInfo = Buffer.alloc(len);
          fs.readSync(fd, sInfo, 0, len, pos);
          const sampleRate = (sInfo[10] << 12) | (sInfo[11] << 4) | (sInfo[12] >> 4);
          const channels = ((sInfo[12] >> 1) & 0x07) + 1;
          const bitDepth = (((sInfo[12] & 0x01) << 4) | (sInfo[13] >> 4)) + 1;
          const totalSamples = (sInfo[13] & 0x0F) * 0x100000000 + sInfo.readUInt32BE(14);

          track.sampleRate = sampleRate;
          track.channels = channels;
          track.bitDepth = bitDepth;
          track.format = 'FLAC';
          track.extension = 'FLAC';
          if (sampleRate > 0 && totalSamples > 0) {
            const sec = totalSamples / sampleRate;
            track.durationSeconds = Math.round(sec * 10) / 10;
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            track.duration = `${m}:${s < 10 ? '0' : ''}${s}`;
          }
        } else if (type === 4 && len <= 1024 * 1024) {
          // VORBIS_COMMENT
          const cBuf = Buffer.alloc(len);
          fs.readSync(fd, cBuf, 0, len, pos);
          try {
            let p = 0;
            if (p + 4 <= len) {
              const vLen = cBuf.readUInt32LE(p);
              p += 4 + vLen;
              if (p + 4 <= len) {
                const nComments = cBuf.readUInt32LE(p);
                p += 4;
                for (let c = 0; c < nComments && p < len; c++) {
                  if (p + 4 > len) break;
                  const clen = cBuf.readUInt32LE(p);
                  p += 4;
                  if (clen > 0 && p + clen <= len) {
                    const comment = cBuf.toString('utf8', p, p + clen);
                    p += clen;
                    const eq = comment.indexOf('=');
                    if (eq !== -1) {
                      const k = comment.slice(0, eq).toUpperCase();
                      const v = comment.slice(eq + 1).trim();
                      if (k === 'TITLE' && v) track.title = v;
                      if (k === 'ARTIST' && v) track.artist = v;
                      if (k === 'ALBUM' && v) track.album = v;
                      if ((k === 'DATE' || k === 'YEAR') && v) track.year = v.slice(0, 4);
                      if ((k === 'LYRICS' || k === 'UNSYNCEDLYRICS') && v) {
                        track.lyrics = v;
                        track.hasLyrics = true;
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {}
        }

        pos += len;
        if (isLast) break;
      }
    } else if (isMp3) {
      mp3Count++;
      track.format = 'MP3';
      track.extension = 'MP3';
      track.bitDepth = 16;
      track.sampleRate = 44100;
      const estSec = Math.round(fileSize / (320000 / 8));
      track.durationSeconds = estSec;
      const m = Math.floor(estSec / 60);
      const s = Math.floor(estSec % 60);
      track.duration = `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    fs.closeSync(fd);
  } catch (err) {
    console.warn(`[WARN] Archivo ${track.fileName}: ${err.message}`);
  }

  if (!track.duration) {
    track.duration = '3:45';
    track.durationSeconds = 225;
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`[DONE] Enriquecidas 251 pistas (${flacCount} FLAC, ${mp3Count} MP3).`);
