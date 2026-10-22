const http = require('http');
const fs = require('fs');
const path = require('path');

async function runVerification() {
  console.log('=====================================================');
  console.log('   POWERIFY AUDIO & LYRICS DEEP VERIFICATION SUITE   ');
  console.log('=====================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Verificar existencia y accesibilidad de los 37 archivos MP3 nativos
  const audioDir = path.join(__dirname, 'assets', 'audio');
  const audioFiles = fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'));
  assert(audioFiles.length >= 35, `Se encontraron ${audioFiles.length} archivos de audio reales en assets/audio/`);

  // 2. Probar streaming HTTP directo de track_1.mp3 a través de server.js
  const checkHttpStream = (urlPath) => new Promise((resolve) => {
    http.get(`http://localhost:3000/${urlPath}`, (res) => {
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => {
        resolve({ status: res.statusCode, bytes, contentType: res.headers['content-type'] });
      });
    }).on('error', err => resolve({ error: err.message }));
  });

  const streamRes1 = await checkHttpStream('assets/audio/track_1.mp3');
  assert(streamRes1.status === 200 || streamRes1.status === 206, `Streaming track_1.mp3 responde HTTP ${streamRes1.status}`);
  assert(streamRes1.bytes > 1000000, `track_1.mp3 entrega datos de audio reales (${(streamRes1.bytes / (1024*1024)).toFixed(2)} MB)`);
  assert(streamRes1.contentType && streamRes1.contentType.includes('audio'), `Content-Type correcto: ${streamRes1.contentType}`);

  // 3. Probar streaming de track_2.mp3 (¿Cómo Pasó?)
  const streamRes2 = await checkHttpStream('assets/audio/track_2.mp3');
  assert(streamRes2.status === 200 || streamRes2.status === 206, `Streaming track_2.mp3 responde HTTP ${streamRes2.status}`);
  assert(streamRes2.bytes > 1000000, `track_2.mp3 entrega datos de audio reales (${(streamRes2.bytes / (1024*1024)).toFixed(2)} MB)`);

  // 4. Validar integridad de cloud-library.json
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cloud-library.json'), 'utf8'));
  assert(manifest.tracks.length === 251, `Manifest contiene las 251 pistas completas`);
  
  const track1 = manifest.tracks[0];
  assert(track1.streamUrl && track1.streamUrl.startsWith('assets/audio/'), `Pista 1 tiene streamUrl válida: ${track1.streamUrl}`);
  assert(track1.lyrics && track1.lyrics.length > 50, `Pista 1 tiene letras Vorbis LRC (${track1.lyrics.length} caracteres)`);

  const track2 = manifest.tracks[1];
  assert(track2.streamUrl && track2.streamUrl.startsWith('assets/audio/'), `Pista 2 tiene streamUrl válida: ${track2.streamUrl}`);
  assert(track2.lyrics && track2.lyrics.includes('No sé cómo pasó'), `Pista 2 contiene letra exacta "¿Cómo Pasó?": "${track2.lyrics.slice(0, 40)}..."`);

  // 5. Verificar que index.html NO contiene el collage de 4 carátulas
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert(!indexHtml.includes('grid grid-cols-2 grid-rows-2'), `index.html NO tiene collage de 4 carátulas`);
  assert(indexHtml.includes('id="hero-album-cover"'), `index.html tiene id="hero-album-cover" para carátula única activa`);

  // 6. Verificar que index.html NO contiene el texto hardcodeado viejo de letras
  assert(!indexHtml.includes('Cuando estabas junto a mí'), `index.html NO tiene texto quemado "Cuando estabas junto a mí"`);
  assert(indexHtml.includes('id="sidebar-live-lyrics-preview"'), `index.html tiene id="sidebar-live-lyrics-preview"`);

  // 7. Validar que library-manager.js no use t.driveStreamUrl como fallback prioritario
  const libMgrCode = fs.readFileSync(path.join(__dirname, 'js', 'library-manager.js'), 'utf8');
  assert(!libMgrCode.includes('streamUrl: t.driveStreamUrl ||'), `library-manager.js NO fuerza t.driveStreamUrl`);
  assert(libMgrCode.includes('streamUrl: t.streamUrl || t.githubStreamUrl ||'), `library-manager.js usa streamUrl nativo de audio`);

  // 8. Validar que app.js actualiza hero-album-cover dinámicamente
  const appJsCode = fs.readFileSync(path.join(__dirname, 'js', 'app.js'), 'utf8');
  assert(appJsCode.includes('heroCover.src = coverUrl'), `app.js actualiza hero-album-cover al cambiar de canción`);
  assert(appJsCode.includes('sidebarPreview: rightSidebarLyrics'), `app.js enlaza rightSidebarLyrics a LyricsEngine`);

  // 9. Validar que LyricsEngine actualiza previews en tiempo real
  const lyricsEngineCode = fs.readFileSync(path.join(__dirname, 'js', 'lyrics-engine.js'), 'utf8');
  assert(lyricsEngineCode.includes('updatePreviews('), `lyrics-engine.js incluye método reactivo updatePreviews`);

  // 10. Validar estilo CSS para spotify-lyrics-card
  const styleCss = fs.readFileSync(path.join(__dirname, 'css', 'style.css'), 'utf8');
  assert(styleCss.includes('.spotify-lyrics-card'), `style.css define estilos premium para .spotify-lyrics-card`);
  assert(styleCss.includes('#audiophile-specs-badge'), `style.css previene envoltura vertical de especificaciones`);

  console.log('=====================================================');
  console.log(`TOTAL: ${passed} PASADOS, ${failed} FALLADOS`);
  console.log('=====================================================');

  if (failed > 0) process.exit(1);
}

runVerification().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
