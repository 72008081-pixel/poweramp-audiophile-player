/**
 * Real-Time Synchronized Lyrics Engine (LRC / Karaoke Style)
 * Decodifica etiquetas temporizadas [mm:ss.xx] y realiza scroll interactivo fluido.
 */

class LyricsEngine {
  constructor(containerElement) {
    this.container = containerElement;
    this.lyricsLines = [];
    this.currentIndex = -1;
    this.isSynced = false;
    this.onSeekCallback = null;
  }

  setSeekCallback(cb) {
    this.onSeekCallback = cb;
  }

  /**
   * Carga y parsea la cadena de texto de letras (LRC o texto plano)
   * @param {string} rawLyrics 
   */
  load(rawLyrics) {
    this.lyricsLines = [];
    this.currentIndex = -1;
    this.isSynced = false;

    if (!rawLyrics || !rawLyrics.trim()) {
      this.renderEmpty('Sin letras disponibles para esta pista.');
      return;
    }

    const lines = rawLyrics.split(/\r?\n/);
    const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\]/g;
    const parsed = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let match;
      let hasTime = false;
      const times = [];

      // Extraer todas las marcas de tiempo si hay múltiples [00:10.00][00:20.00]
      while ((match = timeRegex.exec(trimmed)) !== null) {
        hasTime = true;
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const millis = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const totalSeconds = minutes * 60 + seconds + millis / 1000;
        times.push(totalSeconds);
      }

      const text = trimmed.replace(/\[\d{2}:\d{2}\.?\d{0,3}\]/g, '').trim();

      if (hasTime && text) {
        for (const t of times) {
          parsed.push({ time: t, text });
        }
      } else if (!hasTime && text && !text.startsWith('[ti:') && !text.startsWith('[ar:') && !text.startsWith('[by:')) {
        parsed.push({ time: null, text });
      }
    }

    // Si tiene marcas de tiempo, ordenar cronológicamente
    if (parsed.some(p => p.time !== null)) {
      this.isSynced = true;
      parsed.sort((a, b) => (a.time || 0) - (b.time || 0));
    }

    this.lyricsLines = parsed;
    this.render();
  }

  renderEmpty(msg) {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-center text-slate-400 py-12">
        <i data-lucide="mic-off" class="w-12 h-12 mb-3 opacity-40"></i>
        <p class="text-sm font-medium">${msg}</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  render() {
    if (!this.container) return;
    if (this.lyricsLines.length === 0) {
      this.renderEmpty('Sin letras disponibles.');
      return;
    }

    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'lyrics-scroll-wrapper flex flex-col space-y-4 py-16 px-4';

    this.lyricsLines.forEach((item, index) => {
      const p = document.createElement('p');
      p.className = 'lyric-line transition-all duration-300 text-lg md:text-xl font-medium cursor-pointer text-slate-400 hover:text-white';
      p.textContent = item.text;
      p.dataset.index = index;
      if (item.time !== null) {
        p.dataset.time = item.time;
      }

      p.addEventListener('click', () => {
        if (item.time !== null && this.onSeekCallback) {
          this.onSeekCallback(item.time);
        }
      });

      wrapper.appendChild(p);
    });

    this.container.appendChild(wrapper);
  }

  /**
   * Actualiza el tiempo actual y enfoca la línea activa
   * @param {number} currentTime en segundos
   */
  update(currentTime) {
    if (!this.isSynced || this.lyricsLines.length === 0 || !this.container) return;

    let activeIndex = -1;
    for (let i = 0; i < this.lyricsLines.length; i++) {
      if (this.lyricsLines[i].time !== null && this.lyricsLines[i].time <= currentTime + 0.15) {
        activeIndex = i;
      } else if (this.lyricsLines[i].time > currentTime) {
        break;
      }
    }

    if (activeIndex !== this.currentIndex) {
      this.currentIndex = activeIndex;
      const lines = this.container.querySelectorAll('.lyric-line');
      lines.forEach((el, idx) => {
        if (idx === activeIndex) {
          el.classList.add('active-lyric', 'text-white', 'scale-105');
          el.classList.remove('text-slate-400');
          // Auto scroll centrado
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          el.classList.remove('active-lyric', 'text-white', 'scale-105');
          el.classList.add('text-slate-400');
        }
      });
    }
  }
}

window.LyricsEngine = LyricsEngine;
