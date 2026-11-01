// Motor de reprodução: fila, aleatório, repetir e controles na tela de bloqueio (Media Session).
import { getFile } from './db.js';

export class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = [];        // lista de tracks na ordem original
    this.order = [];        // índices na ordem de reprodução (embaralhada ou não)
    this.pos = -1;          // posição atual dentro de this.order
    this.shuffle = false;
    this.repeat = 'off';    // 'off' | 'all' | 'one'
    this.objectUrl = null;
    this.coverUrl = null;

    this.audio.addEventListener('ended', () => this.onEnded());
    for (const ev of ['play', 'pause', 'timeupdate', 'loadedmetadata']) {
      this.audio.addEventListener(ev, () => this.emit());
    }
    this.setupMediaSession();
  }

  get current() {
    return this.pos >= 0 ? this.queue[this.order[this.pos]] : null;
  }

  get playing() {
    return !this.audio.paused;
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }

  // Começa a tocar uma lista a partir de uma música
  async playList(tracks, startId) {
    this.queue = tracks.slice();
    const startIndex = Math.max(0, this.queue.findIndex((t) => t.id === startId));
    this.buildOrder(startIndex);
    await this.load();
  }

  buildOrder(startIndex) {
    const idx = this.queue.map((_, i) => i);
    if (this.shuffle) {
      const rest = idx.filter((i) => i !== startIndex);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      this.order = [startIndex, ...rest];
      this.pos = 0;
    } else {
      this.order = idx;
      this.pos = startIndex;
    }
  }

  async load(autoplay = true) {
    const track = this.current;
    if (!track) return;
    const blob = await getFile(track.id);
    if (!blob) return;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(blob);
    this.audio.src = this.objectUrl;
    this.updateMediaSession(track);
    if (autoplay) {
      try { await this.audio.play(); } catch (e) { console.warn(e); }
    }
    this.emit();
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.audio.play(); else this.audio.pause();
  }

  async next(fromEnded = false) {
    if (!this.order.length) return;
    if (this.pos < this.order.length - 1) this.pos++;
    else if (this.repeat === 'all' || !fromEnded) this.pos = 0;
    else { this.audio.pause(); this.audio.currentTime = 0; this.emit(); return; }
    await this.load();
  }

  async prev() {
    if (!this.order.length) return;
    // como nos players de verdade: se já passou de 3s, volta ao início da música
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.pos = this.pos > 0 ? this.pos - 1 : this.order.length - 1;
    await this.load();
  }

  onEnded() {
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.audio.play();
    } else {
      this.next(true);
    }
  }

  seek(fraction) {
    if (this.audio.duration) this.audio.currentTime = fraction * this.audio.duration;
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.current) {
      const currentIndex = this.order[this.pos];
      this.buildOrder(currentIndex);
    }
    this.emit();
  }

  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.emit();
  }

  // Atualiza dados de uma música que está na fila (ex.: favoritou)
  patchTrack(track) {
    const i = this.queue.findIndex((t) => t.id === track.id);
    if (i >= 0) this.queue[i] = track;
  }

  // Remove uma música apagada da fila
  removeTrack(id) {
    const i = this.queue.findIndex((t) => t.id === id);
    if (i < 0) return;
    const wasCurrent = this.current && this.current.id === id;
    this.queue.splice(i, 1);
    const curIndex = wasCurrent ? -1 : this.order[this.pos];
    this.order = this.order.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
    if (wasCurrent) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.pos = this.order.length ? Math.min(this.pos, this.order.length - 1) : -1;
      if (this.pos >= 0) this.load(false);
    } else {
      this.pos = this.order.indexOf(curIndex > i ? curIndex - 1 : curIndex);
    }
    this.emit();
  }

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* não suportado */ } };
    set('play', () => this.audio.play());
    set('pause', () => this.audio.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => { if (d.seekTime != null) this.audio.currentTime = d.seekTime; });
  }

  updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    if (this.coverUrl) URL.revokeObjectURL(this.coverUrl);
    this.coverUrl = track.cover ? URL.createObjectURL(track.cover) : null;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || '',
      artwork: this.coverUrl
        ? [{ src: this.coverUrl, sizes: '512x512', type: track.cover.type }]
        : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
}
