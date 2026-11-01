// Motor de reprodução: fila, aleatório, repetir, equalizador, velocidade, timer de sono
// e controles na tela de bloqueio (Media Session).
import { getFile } from './db.js';

export const EQ_BANDS = [60, 150, 400, 1000, 2400, 15000];
export const EQ_PRESETS = {
  Normal: [0, 0, 0, 0, 0, 0],
  Graves: [8, 6, 2, 0, -1, 1],
  Vocal: [-2, -1, 3, 6, 4, 1],
  Rock: [5, 3, -2, 1, 4, 6],
  'Acústico': [3, 2, 1, 3, 4, 3],
  Noturno: [2, 1, 0, -2, -4, -6],
};

export class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = [];        // músicas na ordem original
    this.order = [];        // índices de this.queue na ordem de reprodução
    this.pos = -1;          // posição atual em this.order
    this.shuffle = false;
    this.repeat = 'off';    // 'off' | 'all' | 'one'
    this.rate = 1;
    this.contextName = '';
    this.objectUrl = null;
    this.coverUrl = null;
    this.sleepAt = null;    // timestamp em ms ou 'end' (fim da música)
    this.sleepTimer = null;
    this.eq = { preset: 'Normal', gains: EQ_PRESETS.Normal.slice(), normalize: false };
    this.graph = null;      // Web Audio (só é criado quando o equalizador é usado)

    this.audio.addEventListener('ended', () => this.onEnded());
    for (const ev of ['play', 'pause', 'loadedmetadata']) this.audio.addEventListener(ev, () => this.emit('change'));
    this.audio.addEventListener('timeupdate', () => this.emit('time'));
    this.setupMediaSession();
  }

  get current() { return this.pos >= 0 ? this.queue[this.order[this.pos]] : null; }
  get playing() { return !this.audio.paused; }
  emit(type) { this.dispatchEvent(new Event(type)); }

  // ---------- Fila ----------
  async playList(tracks, startId, contextName = '') {
    if (!tracks.length) return;
    this.queue = tracks.slice();
    this.contextName = contextName;
    const start = Math.max(0, this.queue.findIndex((t) => t.id === startId));
    this.buildOrder(start);
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

  upcoming() { return this.order.slice(this.pos + 1).map((i) => this.queue[i]); }

  async jumpTo(offset) { // offset dentro de upcoming()
    this.pos = this.pos + 1 + offset;
    await this.load();
  }

  removeUpcoming(offset) {
    this.order.splice(this.pos + 1 + offset, 1);
    this.emit('change');
  }

  clearUpcoming() {
    this.order = this.order.slice(0, this.pos + 1);
    this.emit('change');
  }

  playNext(track) {
    let i = this.queue.findIndex((t) => t.id === track.id);
    if (i < 0) { this.queue.push(track); i = this.queue.length - 1; }
    const existing = this.order.indexOf(i, this.pos + 1);
    if (existing > -1) this.order.splice(existing, 1);
    this.order.splice(this.pos + 1, 0, i);
    this.emit('change');
  }

  async load(autoplay = true, startAt = 0) {
    const track = this.current;
    if (!track) return;
    const blob = await getFile(track.id);
    if (!blob) return;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(blob);
    this.audio.src = this.objectUrl;
    this.audio.playbackRate = this.rate;
    if (startAt) this.audio.addEventListener('loadedmetadata', () => { this.audio.currentTime = startAt; }, { once: true });
    this.updateMediaSession(track);
    this.autoplayed = autoplay;
    this.emit('track');
    if (autoplay) {
      try { await this.audio.play(); } catch (e) { console.warn(e); }
    }
    this.emit('change');
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) { this.resumeGraph(); this.audio.play(); } else this.audio.pause();
  }

  async next(fromEnded = false) {
    if (!this.order.length) return;
    if (this.pos < this.order.length - 1) this.pos++;
    else if (this.repeat === 'all' || !fromEnded) this.pos = 0;
    else { this.audio.pause(); this.audio.currentTime = 0; this.emit('change'); return; }
    await this.load();
  }

  async prev() {
    if (!this.order.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.pos = this.pos > 0 ? this.pos - 1 : this.order.length - 1;
    await this.load();
  }

  onEnded() {
    this.emit('ended');
    if (this.sleepAt === 'end') { this.cancelSleep(); this.audio.currentTime = 0; this.emit('change'); return; }
    if (this.repeat === 'one') { this.audio.currentTime = 0; this.audio.play(); } else this.next(true);
  }

  seek(fraction) {
    if (this.audio.duration) this.audio.currentTime = fraction * this.audio.duration;
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.current) this.buildOrder(this.order[this.pos]);
    this.emit('change');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.emit('change');
  }

  cycleRate() {
    const rates = [1, 1.25, 1.5, 0.75];
    this.rate = rates[(rates.indexOf(this.rate) + 1) % rates.length];
    this.audio.playbackRate = this.rate;
    this.emit('change');
  }

  patchTrack(track) {
    const i = this.queue.findIndex((t) => t.id === track.id);
    if (i >= 0) this.queue[i] = track;
  }

  removeTrack(id) {
    const i = this.queue.findIndex((t) => t.id === id);
    if (i < 0) return;
    const wasCurrent = this.current && this.current.id === id;
    const curIndex = wasCurrent ? -1 : this.order[this.pos];
    this.queue.splice(i, 1);
    this.order = this.order.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
    if (wasCurrent) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.pos = this.order.length ? Math.min(this.pos, this.order.length - 1) : -1;
      if (this.pos >= 0) this.load(false);
    } else {
      this.pos = this.order.indexOf(curIndex > i ? curIndex - 1 : curIndex);
    }
    this.emit('track');
    this.emit('change');
  }

  // ---------- Timer de sono ----------
  setSleep(minutes) { // número de minutos, 'end' ou null
    this.cancelSleep();
    if (minutes === 'end') this.sleepAt = 'end';
    else if (minutes) {
      this.sleepAt = Date.now() + minutes * 60000;
      this.sleepTimer = setTimeout(() => { this.audio.pause(); this.cancelSleep(); }, minutes * 60000);
    }
    this.emit('change');
  }
  cancelSleep() {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.sleepAt = null;
    this.emit('change');
  }

  // ---------- Equalizador (Web Audio) ----------
  // Só liga o Web Audio quando precisa: assim o áudio em segundo plano continua
  // funcionando normalmente para quem não usa o equalizador.
  setEq({ preset, gains, normalize }) {
    if (preset !== undefined) this.eq.preset = preset;
    if (gains) this.eq.gains = gains.slice();
    if (normalize !== undefined) this.eq.normalize = normalize;
    const active = this.eq.normalize || this.eq.gains.some((g) => g !== 0);
    if (active) this.ensureGraph();
    if (this.graph) {
      this.graph.filters.forEach((f, i) => { f.gain.value = this.eq.gains[i]; });
      this.graph.compressor.threshold.value = this.eq.normalize ? -24 : 0;
      this.graph.compressor.ratio.value = this.eq.normalize ? 4 : 1;
    }
    this.emit('change');
  }

  ensureGraph() {
    if (this.graph) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(this.audio);
    const filters = EQ_BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.1;
      return f;
    });
    const compressor = ctx.createDynamicsCompressor();
    let node = source;
    for (const f of filters) { node.connect(f); node = f; }
    node.connect(compressor);
    compressor.connect(ctx.destination);
    this.graph = { ctx, filters, compressor };
  }

  resumeGraph() {
    if (this.graph && this.graph.ctx.state === 'suspended') this.graph.ctx.resume();
  }

  // ---------- Tela de bloqueio ----------
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* não suportado */ } };
    set('play', () => { this.resumeGraph(); this.audio.play(); });
    set('pause', () => this.audio.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => { if (d.seekTime != null) this.audio.currentTime = d.seekTime; });
  }

  updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
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
