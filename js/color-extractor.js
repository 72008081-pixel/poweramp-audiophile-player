/**
 * Dynamic Ambient Color Extractor
 * Extrae colores predominantes y vibrantes de la carátula activa usando Canvas
 * e inyecta variables CSS fluidas para generar fondos ambientales estilo Apple Music / Poweramp.
 */

class ColorExtractor {
  static defaultColors = {
    c1: '#1a1f35',
    c2: '#0d111a',
    accent: '#00f0ff',
    glow: 'rgba(0, 240, 255, 0.25)',
    textColor: '#ffffff'
  };

  /**
   * Extrae los colores de una URL de imagen o elemento Image
   * @param {string|HTMLImageElement} imageSource 
   * @returns {Promise<Object>}
   */
  static async extractColors(imageSource) {
    if (!imageSource) {
      this.applyColors(this.defaultColors);
      return this.defaultColors;
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const size = 64; // Muestreo eficiente de 64x64
          canvas.width = size;
          canvas.height = size;

          ctx.drawImage(img, 0, 0, size, size);
          const imageData = ctx.getImageData(0, 0, size, size).data;

          const colorCounts = [];
          const step = 4; // Muestrear cada 4 píxeles para velocidad

          for (let i = 0; i < imageData.length; i += 4 * step) {
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];
            const a = imageData[i + 3];

            if (a < 128) continue; // Ignorar píxeles transparentes

            // Calcular luminosidad y saturación
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const lum = (max + min) / 510;
            const sat = max === min ? 0 : (max - min) / (lum > 0.5 ? (510 - max - min) : (max + min));

            // Descartar extremos (demasiado oscuros o blancos puros)
            if (lum < 0.1 || lum > 0.92) continue;

            colorCounts.push({ r, g, b, sat, lum });
          }

          if (colorCounts.length === 0) {
            this.applyColors(this.defaultColors);
            return resolve(this.defaultColors);
          }

          // Ordenar por saturación (colores vivos y ricos)
          colorCounts.sort((a, b) => b.sat - a.sat);

          const dominant = colorCounts[0] || { r: 30, g: 60, b: 120 };
          // Buscar segundo color que tenga diferencia tonal con el dominante
          let secondary = colorCounts.find(c => {
            const dist = Math.hypot(c.r - dominant.r, c.g - dominant.g, c.b - dominant.b);
            return dist > 60;
          }) || colorCounts[Math.floor(colorCounts.length / 2)] || { r: 100, g: 30, b: 80 };

          // Generar versión neon/acento
          const accentR = Math.min(255, Math.floor(dominant.r * 1.3));
          const accentG = Math.min(255, Math.floor(dominant.g * 1.3));
          const accentB = Math.min(255, Math.floor(dominant.b * 1.3));

          const result = {
            c1: `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`,
            c2: `rgb(${secondary.r}, ${secondary.g}, ${secondary.b})`,
            c1Dark: `rgba(${dominant.r}, ${dominant.g}, ${dominant.b}, 0.65)`,
            c2Dark: `rgba(${secondary.r}, ${secondary.g}, ${secondary.b}, 0.55)`,
            accent: `rgb(${accentR}, ${accentG}, ${accentB})`,
            glow: `rgba(${accentR}, ${accentG}, ${accentB}, 0.35)`,
            rawDominant: dominant,
            rawSecondary: secondary
          };

          this.applyColors(result);
          resolve(result);
        } catch (err) {
          console.warn('Error extrayendo colores de imagen:', err);
          this.applyColors(this.defaultColors);
          resolve(this.defaultColors);
        }
      };

      img.onerror = () => {
        this.applyColors(this.defaultColors);
        resolve(this.defaultColors);
      };

      if (typeof imageSource === 'string') {
        img.src = imageSource;
      } else if (imageSource instanceof HTMLImageElement) {
        img.src = imageSource.src;
      }
    });
  }

  /**
   * Aplica las variables CSS en la raíz para animar fluidamente el fondo dinámico
   */
  static applyColors(colors) {
    const root = document.documentElement;
    root.style.setProperty('--ambient-c1', colors.c1 || this.defaultColors.c1);
    root.style.setProperty('--ambient-c2', colors.c2 || this.defaultColors.c2);
    root.style.setProperty('--ambient-accent', colors.accent || this.defaultColors.accent);
    root.style.setProperty('--ambient-glow', colors.glow || this.defaultColors.glow);
  }

  /**
   * Genera un arte de carátula en SVG DataURL basado en el título del tema (para canciones sin carátula)
   */
  static generateFallbackCover(title, artist) {
    const stringToColor = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
      return '#' + '00000'.substring(0, 6 - c.length) + c;
    };

    const c1 = stringToColor(title || 'Música');
    const c2 = stringToColor(artist || 'Audiophile');
    const initials = (title || 'Hi-Res').substring(0, 2).toUpperCase();

    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1}" />
          <stop offset="100%" stop-color="${c2}" />
        </linearGradient>
        <radialGradient id="vinyl" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.15)" />
          <stop offset="70%" stop-color="rgba(0,0,0,0.6)" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.9)" />
        </radialGradient>
      </defs>
      <rect width="500" height="500" rx="40" fill="url(#grad)" />
      <circle cx="250" cy="250" r="210" fill="url(#vinyl)" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
      <circle cx="250" cy="250" r="160" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5" />
      <circle cx="250" cy="250" r="110" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5" />
      <circle cx="250" cy="250" r="60" fill="#0c0e14" stroke="rgba(255,255,255,0.3)" stroke-width="2" />
      <circle cx="250" cy="250" r="15" fill="#ffffff" />
      <text x="250" y="440" font-family="system-ui, sans-serif" font-size="28" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="3" opacity="0.9">${initials}</text>
    </svg>`;

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
}

window.ColorExtractor = ColorExtractor;
