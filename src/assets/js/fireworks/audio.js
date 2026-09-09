/**
 * audio.js — Web Audio 音效：9 个 mp3 预加载（/assets/audio/fireworks/），首次交互后解锁播放。
 */

'use strict';

const soundManager = {
  baseURL: '/assets/audio/fireworks/',
  ctx: null,
  userInteracted: false,
  decodePromise: null,
  sources: {
    lift: {
      volume: 1,
      playbackRateMin: 0.85,
      playbackRateMax: 0.95,
      fileNames: ['lift1.mp3', 'lift2.mp3', 'lift3.mp3'],
    },
    burst: {
      volume: 1,
      playbackRateMin: 0.8,
      playbackRateMax: 0.9,
      fileNames: ['burst1.mp3', 'burst2.mp3'],
    },
    burstSmall: {
      volume: 0.25,
      playbackRateMin: 0.8,
      playbackRateMax: 1,
      fileNames: ['burst-sm-1.mp3', 'burst-sm-2.mp3'],
    },
    crackle: {
      volume: 0.2,
      playbackRateMin: 1,
      playbackRateMax: 1,
      fileNames: ['crackle1.mp3'],
    },
    crackleSmall: {
      volume: 0.3,
      playbackRateMin: 1,
      playbackRateMax: 1,
      fileNames: ['crackle-sm-1.mp3'],
    },
  },
  registerInteraction() {
    if (this.userInteracted) {
      return;
    }

    this.userInteracted = true;
    this.ensureContext();
    this.resumeAll();
  },
  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (!this.decodePromise) {
      this.decodePromise = this.decodeBuffers();
    }

    return this.ctx;
  },
  preload() {
    const requests = [];

    const ensureSuccessfulResponse = (response) => {
      if (response.ok) {
        return response;
      }

      throw new Error(response.statusText);
    };

    Object.keys(this.sources).forEach((type) => {
      const source = this.sources[type];
      const sourceRequests = source.fileNames.map((fileName) =>
        fetch(this.baseURL + fileName)
          .then(ensureSuccessfulResponse)
          .then((response) => response.arrayBuffer())
      );

      Promise.all(sourceRequests).then((buffers) => {
        source.rawBuffers = buffers;
      });
      requests.push(...sourceRequests);
    });

    return Promise.all(requests);
  },
  decodeBuffers() {
    const context = this.ctx;
    const tasks = [];

    Object.keys(this.sources).forEach((type) => {
      const source = this.sources[type];
      const rawBuffers = source.rawBuffers || [];
      if (rawBuffers.length === 0) {
        source.buffers = [];
        return;
      }

      const decodeTasks = rawBuffers.map(
        (rawBuffer) =>
          new Promise((resolve, reject) => {
            context.decodeAudioData(rawBuffer.slice(0), resolve, reject);
          })
      );

      tasks.push(
        Promise.all(decodeTasks).then((buffers) => {
          source.buffers = buffers;
        })
      );
    });

    return Promise.all(tasks).catch(() => {
      Object.keys(this.sources).forEach((type) => {
        this.sources[type].buffers = this.sources[type].buffers || [];
      });
    });
  },
  pauseAll() {
    if (this.ctx) {
      this.ctx.suspend().catch(() => {});
    }
  },
  resumeAll() {
    if (!this.userInteracted) {
      return;
    }

    this.ensureContext();
    this.playSound('lift', 0);
    setTimeout(() => {
      if (this.ctx) {
        this.ctx.resume().catch(() => {});
      }
    }, 250);
  },
  _lastSmallBurstTime: 0,
  playSound(type, scale = 1) {
    scale = MyMath.clamp(scale, 0, 1);
    if (!canPlaySoundSelector() || simSpeed < 0.95 || !this.userInteracted) {
      return;
    }

    if (type === 'burstSmall') {
      const now = Date.now();
      if (now - this._lastSmallBurstTime < 20) {
        return;
      }
      this._lastSmallBurstTime = now;
    }

    const source = this.sources[type];
    if (!source) {
      throw new Error(`不存在声音类型: ${type}`);
    }

    this.ensureContext();
    if (!source.buffers || source.buffers.length === 0) {
      return;
    }

    const initialVolume = source.volume;
    const initialPlaybackRate = MyMath.random(
      source.playbackRateMin,
      source.playbackRateMax
    );
    const scaledVolume = initialVolume * scale;
    const scaledPlaybackRate = initialPlaybackRate * (2 - scale);
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = scaledVolume;

    const buffer = MyMath.randomChoice(source.buffers);
    const bufferSource = this.ctx.createBufferSource();
    bufferSource.playbackRate.value = scaledPlaybackRate;
    bufferSource.buffer = buffer;
    bufferSource.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    bufferSource.start(0);
  },
};
