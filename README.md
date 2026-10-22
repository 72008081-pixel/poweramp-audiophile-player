# 🎵 Poweramp Audiophile Web Player (Hi-Res Audio Engine)

Reproductor de música web de grado audiófilo con soporte nativo para audio sin pérdida (**FLAC 24-bit / 96 kHz**, WAV, ALAC, MP3), procesador interno en coma flotante de 32-bits (**Float32**), ecualizador gráfico profesional de 10 bandas con control de preamplificación analógica, y fondo dinámico ambiental reactivo al arte del álbum (estilo Apple Music & Poweramp v3).

Diseñado con interfaz responsiva ultra-fluida optimizada tanto para computadoras de alto rendimiento (**MSI Laptop**) como dispositivos móviles (**Xiaomi 15**).

---

## 🌟 Características Principales

### 1. Motor de Audio de Máxima Fidelidad (Web Audio API)
- **Procesamiento Float32**: Cadena de audio interna sin pérdida ni compresión en coma flotante de 32 bits a la frecuencia de muestreo nativa del convertidor digital-analógico (DAC) del sistema (44.1 kHz, 48.0 kHz, 96.0 kHz o 192.0 kHz).
- **Soporte Nativo FLAC**: Decodificación binaria de bloques `STREAMINFO` y `METADATA_BLOCK_PICTURE` sin librerías pesadas externas, extrayendo carátulas en alta definición y profundidad de bits en milisegundos.
- **Badge Técnico Audiófilo**: Visualización en tiempo real de formato, tasa de muestreo, bits por muestra y estado del DAC (ej. `FLAC HI-RES 24-bit / 48.0 kHz • DAC Direct 48.0 kHz Float32`).

### 2. Ecualizador Gráfico Profesional de 10 Bandas (Poweramp Style)
- **10 Bandas de Frecuencia ISO**: `31 Hz`, `62 Hz`, `125 Hz`, `250 Hz`, `500 Hz`, `1 kHz`, `2 kHz`, `4 kHz`, `8 kHz`, `16 kHz`.
- **Rango de Ganancia**: Ajuste fino de `-15.0 dB` a `+15.0 dB` con paso de `0.1 dB` y reseteo inmediato a `0.0 dB` con doble clic.
- **Control Pre-Amp**: Preamplificador con ganancia analógica compensada de `-15 dB` a `+15 dB`.
- **Curva Analítica en Tiempo Real**: Cálculo y graficado matemático de la respuesta en frecuencia combinada en Canvas (dB vs Hz).
- **10 Presets Audiófilos Calibrados**: *Flat (Referencia Neutra)*, *Audiophile Warm*, *Bass Extreme*, *V-Shape*, *Vocal Clarity*, *Rock & Metal*, *Electronic / Synthwave*, *Acoustic / Classical*, *Treble Sparkle* y *Late Night*.
- **Interruptor Bypass con LED Neón**: Conmutación inmediata sin desconexión del grafo de audio.

### 3. Interfaz Visual & Fondo Dinámico Reactivo
- **Ambient Blur Mesh (Apple Music)**: Extracción en tiempo real de los colores dominantes y vibrantes de la carátula con Canvas, proyectando un fondo difuminado y gradientes radiales que mutan suavemente con cada canción.
- **Disco de Vinilo Giratorio**: Carátula central con textura de surcos de vinilo, orificio central y rotación fluida durante la reproducción.
- **Visualizador de Espectro a 60 FPS**: 3 modos seleccionables:
  1. *Poweramp Bars*: Barras de espectro con indicador de retención de pico (*Peak Hold*).
  2. *Osciloscopio Neón*: Forma de onda en el dominio del tiempo.
  3. *Nebula Circular*: Ondas radiales alrededor del centro.
- **Medidores VU Estéreo (L / R)**: Detección RMS en tiempo real con escalas en decibelios.

### 4. Vinculación de Carpeta Local y Persistencia (Base de Datos)
- **File System Access API (`showDirectoryPicker`)**: Vinculación directa con tu carpeta de música local: `F:\FOTOS XIAOMI 15-2026\MÚSICA ULICITO`.
- **Persistencia en IndexedDB (`AudiophileDB`)**: Guarda el manejador de la carpeta, por lo que al volver a abrir la página, puedes reconectar tu biblioteca con un solo clic sin tener que buscar la ruta de nuevo.
- **Base de Datos Local Offline**: Almacena en el navegador favoritos, historial, lista de reproducción y presets personalizados.
- **Opción de Almacenamiento en la Nube (`ulianovksi@gmail.com`)**: Preparado para sincronizar estados y listas de reproducción mediante Google Drive / almacenamiento en la nube o GitHub Pages.

### 5. Letras Sincronizadas en Tiempo Real (Karaoke LRC)
- Parser automático de marcas de tiempo `[mm:ss.xx]` extraídas directamente de los comentarios Vorbis de los archivos FLAC.
- Resaltado dinámico neón de la línea activa y desplazamiento automático (*auto-scroll*).
- Salto interactivo: haz clic en cualquier línea para adelantar la reproducción a ese segundo exacto.

### 6. Streaming Local Multi-Dispositivo (PC MSI & Móvil Xiaomi 15)
- Incluye servidor nativo en **Node.js (`server.js`)** y **Python 3 (`server.py`)** con soporte para **HTTP 206 Partial Content (Range Requests)**:
  - Permite reproducir instantáneamente archivos de 50MB a través de la red Wi-Fi de tu hogar sin descargar el archivo completo.
  - Abre el reproductor desde tu Xiaomi 15 navegando a `http://192.168.1.33:3000` mientras tu laptop MSI actúa como centro multimedia de alta resolución.

---

## 🚀 Cómo Iniciar el Reproductor

### Opción 1: Con un Solo Clic en Windows (Recomendado)
Haz doble clic en el archivo:
```bat
iniciar_reproductor.bat
```
El script detectará automáticamente Node.js o Python, levantará el servidor de streaming de alta fidelidad e iniciará tu navegador en `http://localhost:3000`.

### Opción 2: Desde la Terminal (Node.js)
```bash
node server.js
```

### Opción 3: Desde la Terminal (Python 3)
```bash
python server.py
```

### Opción 4: Modo 100% Estático / Cliente (Sin Servidor)
Puedes abrir `index.html` directamente en cualquier navegador moderno (Google Chrome, Microsoft Edge, Opera, Brave). Al pulsar **"Vincular Carpeta"**, selecciona tu carpeta `F:\FOTOS XIAOMI 15-2026\MÚSICA ULICITO` y la aplicación procesará todo localmente en la memoria del navegador.

---

## ⌨️ Atajos de Teclado Audiófilos

| Tecla | Acción |
| :--- | :--- |
| `Espacio` | Reproducir / Pausar |
| `Flecha Derecha` | Adelantar 5 segundos |
| `Flecha Izquierda` | Retroceder 5 segundos |
| `Flecha Arriba` | Subir volumen (+5%) |
| `Flecha Abajo` | Bajar volumen (-5%) |
| `M` | Silenciar / Activar sonido (Mute) |
| `E` | Alternar Bypass del Ecualizador |
| `L` | Agregar / Quitar de Favoritos (Like) |

---

## 📱 Acceso desde tu Xiaomi 15
1. Asegúrate de que tu laptop MSI y tu Xiaomi 15 estén conectados a la misma red Wi-Fi.
2. Inicia el servidor con `iniciar_reproductor.bat`.
3. En la consola verás la IP local (ejemplo: `http://192.168.1.33:3000`).
4. Abre Chrome en tu Xiaomi 15 e introduce esa dirección. ¡Disfruta de tus 251 archivos FLAC en streaming sin pérdida directamente en tu teléfono!

---

## 🛠️ Tecnologías Utilizadas
- **Web Audio API**: AudioContext, MediaElementSourceNode, BiquadFilterNode, AnalyserNode, GainNode, StereoPannerNode.
- **HTML5 Canvas**: Visualizador de espectro FFT a 60 FPS, osciloscopio y gráfico de curvas analíticas.
- **File System Access API & IndexedDB**: Acceso local al disco duro y persistencia de base de datos offline.
- **Tailwind CSS & Vanilla CSS**: Sistema de diseño Dark Mode, Glassmorphism y variables CSS fluidas.
- **Lucide Icons**: Iconografía SVG vectorial moderna.
- **Node.js / Python 3**: Streaming con HTTP 206 Range requests sin dependencias de terceros.

---

Desarrollado para **Ulianov** (`ulianovksi@gmail.com`).
