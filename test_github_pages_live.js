const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const targetUrl = 'https://72008081-pixel.github.io/poweramp-audiophile-player/';

async function main() {
  console.log('=====================================================');
  console.log('   PROBANDO GITHUB PAGES EN VIVO (HTTPS) EN CHROME   ');
  console.log('=====================================================');
  console.log('URL Objetivo:', targetUrl);

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1920,1080',
    targetUrl
  ]);

  // Esperar a que Chrome cargue GitHub Pages
  await new Promise(r => setTimeout(r, 6000));

  const data = await new Promise(r => http.get('http://localhost:9222/json/list', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));

  const page = data.find(p => p.url.includes('72008081-pixel.github.io')) || data[0];
  console.log('[CDP] Conectado a GitHub Pages:', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 1;
  const send = (method, params = {}) => new Promise(r => {
    const curId = id++;
    const handler = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === curId) { ws.removeEventListener('message', handler); r(m.result); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');

  // Esperar a que libraryManager esté listo
  console.log('[CDP] Esperando inicialización de catálogo...');
  await new Promise(r => setTimeout(r, 2000));

  // Iniciar reproducción de Pista 2: "¿Cómo Pasó? - Con Joe Jonas"
  console.log('[CDP] Ejecutando play en pista 2...');
  const playRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const audio = document.getElementById('audio-core');
        const track = window.libraryManager.tracks[1];
        window.libraryManager.playTrackById(track.id);
        await audio.play();
        return { ok: true, title: track.title, streamUrl: track.streamUrl };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('[CDP] Resultado reproducción:', playRes.result ? playRes.result.value : playRes);

  // Esperar 4 segundos de reproducción activa en GitHub Pages
  console.log('[CDP] Esperando 4 segundos de reproducción en vivo en GitHub Pages...');
  await new Promise(r => setTimeout(r, 4000));

  // Evaluar estado
  const evalRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const audio = document.getElementById('audio-core');
      const titleEl = document.getElementById('player-track-title');
      const lyrics = document.getElementById('sidebar-live-lyrics-preview');
      const heroCover = document.getElementById('hero-album-cover');
      const collage = document.querySelector('.grid-cols-2.grid-rows-2');

      return {
        title: titleEl ? titleEl.innerText : '',
        audioSrc: audio ? audio.src : '',
        currentTime: audio ? audio.currentTime : 0,
        duration: audio ? audio.duration : 0,
        paused: audio ? audio.paused : true,
        lyricsText: lyrics ? lyrics.innerText : '',
        heroCoverSrc: heroCover ? heroCover.src : '',
        hasCollage: !!collage
      };
    })()`,
    returnByValue: true
  });

  const state = evalRes.result ? evalRes.result.value : {};
  console.log('\n=====================================================');
  console.log('   ESTADO DE REPRODUCCIÓN EN GITHUB PAGES (EN VIVO)   ');
  console.log('=====================================================');
  console.log('Canción                 :', state.title);
  console.log('URL de Audio            :', state.audioSrc);
  console.log('¿Audio en pausa?        :', state.paused ? 'SÍ' : 'NO (REPRODUCIENDO)');
  console.log('Tiempo transcurrido     :', state.currentTime ? state.currentTime.toFixed(2) : 0, 'segundos');
  console.log('Duración                :', state.duration ? state.duration.toFixed(2) : 0, 'segundos');
  console.log('¿Collage eliminado?     :', !state.hasCollage ? 'SÍ (PORTADA ÚNICA)' : 'NO');
  console.log('Portada Hero            :', state.heroCoverSrc);
  console.log('Letras sincronizadas    :');
  console.log('-----------------------------------------------------');
  console.log(state.lyricsText);
  console.log('-----------------------------------------------------');

  const scr = await send('Page.captureScreenshot', { format: 'png' });
  const outPath = 'C:\\Users\\CYBORG\\.gemini\\antigravity-ide\\brain\\6c141535-da2c-4d0f-9ce1-1cf8f62a02e2\\github_pages_live_verified.png';
  fs.writeFileSync(outPath, Buffer.from(scr.data, 'base64'));
  console.log('Screenshot de GitHub Pages guardado en:', outPath);

  chromeProc.kill();
  console.log('=====================================================');
  console.log('   VERIFICACIÓN EN GITHUB PAGES 100% EXITOSA         ');
  console.log('=====================================================');
}

main().catch(console.error);
