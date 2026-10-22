"""
Poweramp Audiophile Server (Python 3 Nativo)
Servidor de streaming con soporte para HTTP Range (206 Partial Content).
Zero dependencias externas.
"""

import os
import sys
import json
import socket
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("PORT", 3000))
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
GDRIVE_DIR = r"G:\Mi unidad\MÚSICA FLAC ULICITO"
LOCAL_FALLBACK = r"F:\FOTOS XIAOMI 15-2026\MÚSICA ULICITO"
MUSIC_DIR = os.environ.get("MUSIC_DIR", GDRIVE_DIR if os.path.exists(GDRIVE_DIR) else LOCAL_FALLBACK)


MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
}

def parse_flac_metadata(file_path):
    try:
        with open(file_path, "rb") as f:
            if f.read(4) != b"fLaC":
                return None
            meta = {
                "format": "FLAC",
                "sampleRate": 44100,
                "channels": 2,
                "bitDepth": 16,
                "tags": {},
                "hasCover": False
            }
            while True:
                h = f.read(4)
                if len(h) < 4:
                    break
                is_last = (h[0] & 0x80) != 0
                btype = h[0] & 0x7F
                length = (h[1] << 16) | (h[2] << 8) | h[3]
                data = f.read(length)
                if btype == 0 and len(data) >= 18:
                    sr = (data[10] << 12) | (data[11] << 4) | (data[12] >> 4)
                    channels = ((data[12] >> 1) & 0x07) + 1
                    bps = (((data[12] & 0x01) << 4) | (data[13] >> 4)) + 1
                    meta["sampleRate"] = sr
                    meta["channels"] = channels
                    meta["bitDepth"] = bps
                elif btype == 4:
                    try:
                        vlen = int.from_bytes(data[0:4], "little")
                        offset = 4 + vlen
                        count = int.from_bytes(data[offset:offset+4], "little")
                        offset += 4
                        for _ in range(count):
                            if offset >= len(data): break
                            clen = int.from_bytes(data[offset:offset+4], "little")
                            offset += 4
                            comm = data[offset:offset+clen].decode("utf-8", errors="ignore")
                            offset += clen
                            if "=" in comm:
                                k, v = comm.split("=", 1)
                                meta["tags"][k.upper()] = v
                    except Exception:
                        pass
                elif btype == 6:
                    meta["hasCover"] = True
                if is_last:
                    break
            return meta
    except Exception:
        return None

def extract_flac_cover(file_path):
    try:
        with open(file_path, "rb") as f:
            if f.read(4) != b"fLaC": return None
            while True:
                h = f.read(4)
                if len(h) < 4: break
                is_last = (h[0] & 0x80) != 0
                btype = h[0] & 0x7F
                length = (h[1] << 16) | (h[2] << 8) | h[3]
                data = f.read(length)
                if btype == 6:
                    mime_len = int.from_bytes(data[4:8], "big")
                    mime = data[8:8+mime_len].decode("ascii", errors="ignore")
                    off = 8 + mime_len
                    desc_len = int.from_bytes(data[off:off+4], "big")
                    off += 4 + desc_len + 16
                    pic_len = int.from_bytes(data[off:off+4], "big")
                    off += 4
                    return (mime or "image/jpeg", data[off:off+pic_len])
                if is_last: break
    except Exception:
        pass
    return None

def scan_music(dir_path):
    if not os.path.exists(dir_path): return []
    res = []
    exts = {".flac", ".wav", ".mp3", ".m4a", ".aac", ".ogg"}
    import base64
    for root, _, files in os.walk(dir_path):
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            if ext in exts:
                fp = os.path.join(root, fn)
                try:
                    size = os.path.getsize(fp)
                except OSError:
                    size = 0
                meta = parse_flac_metadata(fp) if ext == ".flac" else None
                base_name = os.path.splitext(fn)[0]
                title = base_name
                artist = "Artista Desconocido"
                album = "Álbum Desconocido"
                lyrics = ""
                year = ""
                if " - " in base_name:
                    p = base_name.split(" - ")
                    title = p[0].strip()
                    artist = " - ".join(p[1:]).strip()
                if meta and meta.get("tags"):
                    t = meta["tags"]
                    title = t.get("TITLE", title)
                    artist = t.get("ARTIST", t.get("ALBUMARTIST", artist))
                    album = t.get("ALBUM", album)
                    year = t.get("YEAR", t.get("DATE", ""))[:4]
                    lyrics = t.get("LYRICS", t.get("UNSYNCEDLYRICS", ""))
                
                b64_id = base64.urlsafe_b64encode(fp.encode("utf-8")).decode("ascii")
                res.append({
                    "id": b64_id,
                    "path": fp,
                    "fileName": fn,
                    "relativePath": os.path.relpath(fp, dir_path),
                    "extension": ext.replace(".", "").upper(),
                    "sizeBytes": size,
                    "sizeMB": round(size / (1024 * 1024), 2),
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "year": year,
                    "hasLyrics": bool(lyrics),
                    "lyrics": lyrics,
                    "hasCover": meta.get("hasCover", False) if meta else False,
                    "format": meta.get("format", ext.replace(".", "").upper()) if meta else ext.replace(".", "").upper(),
                    "sampleRate": meta.get("sampleRate", 44100) if meta else 44100,
                    "bitDepth": meta.get("bitDepth", 16) if meta else 16,
                    "channels": meta.get("channels", 2) if meta else 2
                })
    return res

CACHED_TRACKS = []
if os.path.exists(MUSIC_DIR):
    print(f"[BIBLIOTECA] Escaneando {MUSIC_DIR}...")
    CACHED_TRACKS = scan_music(MUSIC_DIR)
    print(f"[BIBLIOTECA] ¡Listo! {len(CACHED_TRACKS)} canciones cargadas.")

class AudiophileHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        global CACHED_TRACKS, MUSIC_DIR
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "online",
                "musicDir": MUSIC_DIR,
                "exists": os.path.exists(MUSIC_DIR),
                "trackCount": len(CACHED_TRACKS)
            }).encode("utf-8"))
            return

        if path == "/api/tracks":
            if not CACHED_TRACKS and os.path.exists(MUSIC_DIR):
                CACHED_TRACKS = scan_music(MUSIC_DIR)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "musicDir": MUSIC_DIR,
                "total": len(CACHED_TRACKS),
                "tracks": CACHED_TRACKS
            }).encode("utf-8"))
            return

        if path == "/api/cover":
            import base64
            fp = ""
            if "id" in qs:
                try:
                    fp = base64.urlsafe_b64decode(qs["id"][0].encode("ascii")).decode("utf-8")
                except Exception: pass
            elif "path" in qs:
                fp = qs["path"][0]
            if fp and os.path.exists(fp):
                res = extract_flac_cover(fp)
                if res:
                    mime, data = res
                    self.send_response(200)
                    self.send_header("Content-Type", mime)
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Cache-Control", "public, max-age=86400")
                    self.end_headers()
                    self.wfile.write(data)
                    return
            self.send_response(404)
            self.end_headers()
            return

        if path == "/api/stream":
            import base64
            fp = ""
            if "id" in qs:
                try:
                    fp = base64.urlsafe_b64decode(qs["id"][0].encode("ascii")).decode("utf-8")
                except Exception: pass
            elif "path" in qs:
                fp = qs["path"][0]

            if not fp or not os.path.exists(fp):
                self.send_response(404)
                self.end_headers()
                return

            ext = os.path.splitext(fp)[1].lower()
            mime = MIME_TYPES.get(ext, "application/octet-stream")
            file_size = os.path.getsize(fp)

            range_header = self.headers.get("Range")
            if range_header and range_header.startswith("bytes="):
                parts = range_header.replace("bytes=", "").split("-")
                start = int(parts[0])
                end = int(parts[1]) if parts[1] else file_size - 1
                if start >= file_size or end >= file_size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{file_size}")
                    self.end_headers()
                    return
                chunk_len = (end - start) + 1
                self.send_response(206)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(chunk_len))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                with open(fp, "rb") as f:
                    f.seek(start)
                    self.wfile.write(f.read(chunk_len))
            else:
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(file_size))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                with open(fp, "rb") as f:
                    while chunk := f.read(64 * 1024):
                        self.wfile.write(chunk)
            return

        # Archivo estático
        req_path = path.lstrip("/")
        if not req_path:
            req_path = "index.html"
        full_path = os.path.join(STATIC_DIR, req_path)
        if os.path.exists(full_path) and os.path.isfile(full_path):
            ext = os.path.splitext(full_path)[1].lower()
            mime = MIME_TYPES.get(ext, "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(os.path.getsize(full_path)))
            self.end_headers()
            with open(full_path, "rb") as f:
                self.wfile.write(f.read())
            return

        self.send_response(404)
        self.end_headers()

def run():
    server = HTTPServer(("0.0.0.0", PORT), AudiophileHandler)
    host_name = socket.gethostname()
    try:
        ip = socket.gethostbyname(host_name)
    except Exception:
        ip = "127.0.0.1"
    print(f"\n🎵 Poweramp Python Audiophile Server en http://localhost:{PORT}")
    print(f"📱 Acceso móvil (Xiaomi 15) en red Wi-Fi: http://{ip}:{PORT}\n")
    server.serve_forever()

if __name__ == "__main__":
    run()
