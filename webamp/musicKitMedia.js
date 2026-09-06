const URL_PREFIX = "musickit:";

const BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

export function trackUrlForSongId(songId) {
  return `${URL_PREFIX}${songId}`;
}

export function makeMusicKitMediaClass(music) {
  return class BoundMusicKitMedia extends MusicKitMedia {
    constructor() {
      super(music);
    }
  };
}

class MusicKitMedia {
  constructor(music) {
    this._music = music;
    this._listeners = new Map();
    this._disposers = [];
    this._sources = new WeakSet();
    this.routed = false;

    this._context = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._context.createAnalyser();
    this._analyser.fftSize = 2048;
    this._analyser.smoothingTimeConstant = 0;

    this._staticSource = this._context.createGain();
    this._preamp = this._context.createGain();
    this._panner = this._context.createStereoPanner();

    let output = this._preamp;
    this._bands = {};
    BANDS.forEach((band, i) => {
      const filter = this._context.createBiquadFilter();
      this._bands[band] = filter;
      filter.type =
        i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = band;
      filter.gain.value = 0;
      output.connect(filter);
      output = filter;
    });
    output.connect(this._panner);

    this._staticSource.connect(this._preamp);
    this._panner.connect(this._context.destination);
    this._panner.connect(this._analyser);

    this._on(MusicKit.Events.playbackTimeDidChange, () => {
      this._trigger("timeupdate");
    });

    this._on(MusicKit.Events.playbackDurationDidChange, () => {
      this._trigger("fileLoaded");
    });

    this._on(MusicKit.Events.playbackStateDidChange, ({ state }) => {
      const States = MusicKit.PlaybackStates;
      switch (state) {
        case States.playing:
          this._routeAudio();
          this._trigger("stopWaiting");
          this._trigger("playing");
          break;
        case States.loading:
        case States.waiting:
        case States.stalled:
          this._trigger("waiting");
          break;
        case States.paused:
        case States.stopped:
          this._trigger("stopWaiting");
          break;
        case States.completed:
        case States.ended:
          this._trigger("stopWaiting");
          this._trigger("ended");
          break;
      }
      this._trigger("timeupdate");
    });
  }

  _routeAudio() {
    if (this._music.isAuthorized) return;
    const el = document.querySelector("audio");
    if (el == null || el.crossOrigin !== "anonymous" || this._sources.has(el)) {
      return;
    }
    try {
      this._context.createMediaElementSource(el).connect(this._staticSource);
      this._sources.add(el);
      this.routed = true;
      if (this._context.state === "suspended") {
        this._context.resume();
      }
    } catch (err) {
      console.error("Could not route Apple Music audio into Web Audio", err);
    }
  }

  _on(event, handler) {
    this._music.addEventListener(event, handler);
    this._disposers.push(() => this._music.removeEventListener(event, handler));
  }

  _trigger(event, ...args) {
    const callbacks = this._listeners.get(event);
    if (callbacks != null) {
      for (const callback of callbacks) {
        callback(...args);
      }
    }
  }

  on(event, callback) {
    let callbacks = this._listeners.get(event);
    if (callbacks == null) {
      callbacks = [];
      this._listeners.set(event, callbacks);
    }
    callbacks.push(callback);
  }

  duration() {
    return this._music.currentPlaybackDuration || 0;
  }

  timeElapsed() {
    return this._music.currentPlaybackTime || 0;
  }

  timeRemaining() {
    return this.duration() - this.timeElapsed();
  }

  percentComplete() {
    const duration = this.duration();
    return duration === 0 ? 0 : (this.timeElapsed() / duration) * 100;
  }

  async play() {
    await this._music.play();
  }

  pause() {
    this._music.pause();
  }

  stop() {
    this._music.stop();
  }

  seekToTime(time) {
    this._music.seekToTime(Math.max(0, Math.min(time, this.duration())));
    this._trigger("timeupdate");
  }

  seekToPercentComplete(percent) {
    this.seekToTime(this.duration() * (percent / 100));
  }

  async loadFromUrl(url, autoPlay) {
    if (!url.startsWith(URL_PREFIX)) {
      console.error(`MusicKitMedia cannot play non-MusicKit URL: ${url}`);
      this._trigger("ended");
      return;
    }
    const songId = url.slice(URL_PREFIX.length);
    this._trigger("waiting");
    try {
      await this._music.setQueue({ songs: [songId], startPlaying: false });
      this._trigger("fileLoaded");
      if (autoPlay) {
        await this.play();
      }
    } catch (err) {
      console.error("Failed to load Apple Music track", songId, err);
      this._trigger("ended");
    } finally {
      this._trigger("stopWaiting");
    }
  }

  setVolume(volume) {
    this._music.volume = volume / 100;
  }

  setBalance(balance) {
    this._panner.pan.value = balance / 100;
  }

  setPreamp(value) {
    this._preamp.gain.value = Math.pow(10, ((value / 100) * 24 - 12) / 20);
  }

  setEqBand(band, value) {
    this._bands[band].gain.value = (value / 100) * 24 - 12;
  }

  disableEq() {
    this._staticSource.disconnect();
    this._staticSource.connect(this._panner);
  }

  enableEq() {
    this._staticSource.disconnect();
    this._staticSource.connect(this._preamp);
  }

  getAnalyser() {
    return this._analyser;
  }

  dispose() {
    for (const dispose of this._disposers) {
      dispose();
    }
    this._disposers = [];
    this._listeners.clear();
    this._music.stop();
    this._context.close();
  }
}

export default MusicKitMedia;
