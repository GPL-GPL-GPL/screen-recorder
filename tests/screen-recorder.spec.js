const { test, expect } = require('@playwright/test');

async function installBrowserMocks(page, options = {}) {
  await page.addInitScript((opts) => {
    window.__mediaCalls = { display: [], user: [] };
    window.__stoppedTracks = [];
    window.__downloads = [];
    window.__objectUrls = [];
    window.__revokedUrls = [];
    window.__recorders = [];
    window.__ffmpeg = { writes: [], execs: [], deletes: [], loaded: false };
    window.__speechStarts = 0;

    let trackId = 0;
    class FakeTrack extends EventTarget {
      constructor(kind) {
        super();
        this.kind = kind;
        this.id = `${kind}-${++trackId}`;
        this.enabled = true;
        this.readyState = 'live';
      }

      stop() {
        if (this.readyState === 'ended') return;
        this.readyState = 'ended';
        window.__stoppedTracks.push(this.id);
      }

      getSettings() {
        return this.kind === 'video'
          ? { width: 1920, height: 1080, frameRate: 30 }
          : {};
      }
    }

    class FakeMediaStream {
      constructor(tracks = []) {
        this._tracks = tracks.slice();
      }

      getTracks() {
        return this._tracks.slice();
      }

      getVideoTracks() {
        return this._tracks.filter((track) => track.kind === 'video');
      }

      getAudioTracks() {
        return this._tracks.filter((track) => track.kind === 'audio');
      }

      addTrack(track) {
        this._tracks.push(track);
      }
    }

    class FakeMediaRecorder {
      constructor(stream, recorderOptions = {}) {
        this.stream = stream;
        this.mimeType = recorderOptions.mimeType || 'video/webm';
        this.state = 'inactive';
        this.timeslice = null;
        window.__recorders.push(this);
      }

      start(timeslice) {
        this.state = 'recording';
        this.timeslice = timeslice;
      }

      pause() {
        if (this.state === 'recording') this.state = 'paused';
      }

      resume() {
        if (this.state === 'paused') this.state = 'recording';
      }

      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        if (this.ondataavailable) {
          this.ondataavailable({
            data: new Blob(['mock recording'], { type: this.mimeType || 'video/webm' })
          });
        }
        setTimeout(() => {
          if (this.onstop) this.onstop();
        }, 0);
      }

      static isTypeSupported(type) {
        return type.startsWith('video/webm');
      }
    }

    class FakeAudioContext {
      createMediaStreamDestination() {
        return { stream: new FakeMediaStream([new FakeTrack('audio')]) };
      }

      createMediaStreamSource() {
        return { connect() {} };
      }

      close() {
        return Promise.resolve();
      }
    }

    class FakeSpeechRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = '';
      }

      start() {
        window.__speechStarts += 1;
        setTimeout(() => {
          if (!this.onresult) return;
          this.onresult({
            resultIndex: 0,
            results: [
              {
                isFinal: true,
                0: { transcript: 'hello desktop' }
              }
            ]
          });
        }, 0);
      }

      stop() {
        if (this.onend) setTimeout(() => this.onend(), 0);
      }
    }

    Object.defineProperty(window, 'MediaStream', { value: FakeMediaStream, configurable: true });
    Object.defineProperty(window, 'MediaRecorder', { value: FakeMediaRecorder, configurable: true });
    Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true });
    Object.defineProperty(window, 'webkitAudioContext', { value: FakeAudioContext, configurable: true });
    Object.defineProperty(window, 'SpeechRecognition', { value: FakeSpeechRecognition, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeSpeechRecognition, configurable: true });

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getDisplayMedia: async (constraints) => {
          window.__mediaCalls.display.push(constraints);
          if (opts.displayError) {
            const err = new Error(opts.displayError.message || 'Screen denied');
            err.name = opts.displayError.name || 'NotAllowedError';
            throw err;
          }
          const tracks = [new FakeTrack('video')];
          if (constraints && constraints.audio) tracks.push(new FakeTrack('audio'));
          return new FakeMediaStream(tracks);
        },
        getUserMedia: async (constraints) => {
          window.__mediaCalls.user.push(constraints);
          if (constraints && constraints.video && opts.webcamError) {
            throw new Error(opts.webcamError);
          }
          if (constraints && constraints.audio && opts.micError) {
            throw new Error(opts.micError);
          }
          const tracks = [];
          if (constraints && constraints.audio) tracks.push(new FakeTrack('audio'));
          if (constraints && constraints.video) tracks.push(new FakeTrack('video'));
          return new FakeMediaStream(tracks);
        }
      },
      configurable: true
    });

    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.load = function load() {};

    window.document.pictureInPictureEnabled = true;
    HTMLVideoElement.prototype.requestPictureInPicture = function requestPictureInPicture() {
      window.document.pictureInPictureElement = this;
      this.dispatchEvent(new Event('enterpictureinpicture'));
      return Promise.resolve();
    };
    window.document.exitPictureInPicture = function exitPictureInPicture() {
      const el = window.document.pictureInPictureElement;
      window.document.pictureInPictureElement = null;
      if (el) el.dispatchEvent(new Event('leavepictureinpicture'));
      return Promise.resolve();
    };

    let objectUrlId = 0;
    window.URL.createObjectURL = (blob) => {
      const url = `blob:mock-${++objectUrlId}`;
      window.__objectUrls.push({ url, type: blob && blob.type, size: blob && blob.size });
      return url;
    };
    window.URL.revokeObjectURL = (url) => {
      window.__revokedUrls.push(url);
    };

    HTMLAnchorElement.prototype.click = function click() {
      window.__downloads.push({ href: this.href, download: this.download });
    };

    window.__SCREEN_RECORDER_TEST_FFMPEG__ = {
      load: async () => {
        window.__ffmpeg.loaded = true;
      },
      on(event, cb) {
        this._listeners = this._listeners || {};
        this._listeners[event] = cb;
      },
      off(event) {
        if (this._listeners) delete this._listeners[event];
      },
      writeFile: async (name, data) => {
        window.__ffmpeg.writes.push({ name, length: data.length });
      },
      exec: async function exec(args) {
        window.__ffmpeg.execs.push(args);
        if (opts.ffmpegHang) {
          return new Promise((resolve, reject) => {
            this._rejectExec = reject;
          });
        }
        if (this._listeners && this._listeners.progress) {
          this._listeners.progress({ progress: 0.5 });
          this._listeners.progress({ progress: 1 });
        }
        if (opts.ffmpegError) throw new Error(opts.ffmpegError);
      },
      readFile: async () => new Uint8Array([1, 2, 3, 4]),
      deleteFile: async (name) => {
        window.__ffmpeg.deletes.push(name);
      },
      terminate: function terminate() {
        window.__ffmpeg.terminated = true;
        if (this._rejectExec) this._rejectExec(new Error('cancelled'));
      }
    };
  }, options);
}

async function openApp(page, options) {
  await installBrowserMocks(page, options);
  await page.goto('/index-v1.html');
}

async function recordShortClip(page, { mic = false, webcam = false, transcription = false } = {}) {
  if (mic) await page.locator('#micAudio').check();
  if (webcam) await page.locator('#webcamOverlay').check();
  if (transcription) await page.locator('#transcriptionToggle').check();

  await page.locator('#btnRecord').click();
  await expect(page.locator('#btnRecord')).toBeDisabled();
  await expect(page.locator('#btnPause')).toBeEnabled();
  await expect(page.locator('#btnStop')).toBeEnabled();

  await page.locator('#btnStop').click();
  await expect(page.locator('#previewSection')).toHaveClass(/visible/);
  await expect(page.locator('#btnDownload')).toBeEnabled();
  await expect(page.locator('#btnDownloadRaw')).toBeEnabled();
}

test.describe('screen recorder v1', () => {
  test('loads with annotations hidden and base controls ready', async ({ page }) => {
    await openApp(page);

    await expect(page.locator('h1')).toHaveText('gabes screen recorder - test');
    await expect(page.locator('#btnRecord')).toBeEnabled();
    await expect(page.locator('#btnPause')).toBeDisabled();
    await expect(page.locator('#btnStop')).toBeDisabled();
    await expect(page.locator('#btnDownload')).toBeDisabled();
    await expect(page.locator('#btnDownloadRaw')).toBeDisabled();
    await expect(page.locator('#editorToolbar')).toBeHidden();
    await expect(page.locator('#annotationCanvas')).toBeHidden();
    await expect(page.locator('#btnExportAnn')).toBeHidden();
  });

  test('records system audio, mic, and webcam without aborting the flow', async ({ page }) => {
    await openApp(page);

    await recordShortClip(page, { mic: true, webcam: true });

    const state = await page.evaluate(() => ({
      displayCalls: window.__mediaCalls.display,
      userCalls: window.__mediaCalls.user,
      stoppedTracks: window.__stoppedTracks,
      recorders: window.__recorders.length,
      previewSrc: document.getElementById('previewVideo').src,
      webcamVisible: document.getElementById('webcamPanel').classList.contains('visible')
    }));

    expect(state.displayCalls).toHaveLength(1);
    expect(state.displayCalls[0]).toMatchObject({ audio: true, video: true });
    expect(state.userCalls).toHaveLength(2);
    expect(state.userCalls.some((call) => call.audio === true)).toBe(true);
    expect(state.userCalls.some((call) => Boolean(call.video))).toBe(true);
    expect(state.recorders).toBe(1);
    expect(state.previewSrc).toContain('blob:mock-');
    expect(state.webcamVisible).toBe(false);
    expect(state.stoppedTracks.length).toBeGreaterThan(0);
  });

  test('pause and resume update recorder state and controls', async ({ page }) => {
    await openApp(page);

    await page.locator('#btnRecord').click();
    await page.locator('#btnPause').click();
    await expect(page.locator('#btnPause')).toHaveText('Resume');
    await expect(page.locator('.red-dot')).toHaveClass(/paused-indicator/);
    await expect.poll(() => page.evaluate(() => window.__recorders[0].state)).toBe('paused');

    await page.locator('#btnPause').click();
    await expect(page.locator('#btnPause')).toHaveText('Pause');
    await expect.poll(() => page.evaluate(() => window.__recorders[0].state)).toBe('recording');

    await page.locator('#btnStop').click();
    await expect(page.locator('#previewSection')).toHaveClass(/visible/);
  });

  test('screen share cancellation shows a clear error and leaves controls usable', async ({ page }) => {
    await openApp(page, { displayError: { name: 'NotAllowedError', message: 'cancelled' } });

    await page.locator('#btnRecord').click();

    await expect(page.locator('#errorMessage')).toHaveClass(/visible/);
    await expect(page.locator('#errorMessage')).toHaveText('Screen sharing was cancelled.');
    await expect(page.locator('#btnRecord')).toBeEnabled();
    await expect(page.locator('#previewSection')).not.toHaveClass(/visible/);
  });

  test('webcam denial reports the issue but still records screen audio', async ({ page }) => {
    await openApp(page, { webcamError: 'camera blocked' });

    await recordShortClip(page, { webcam: true });

    await expect(page.locator('#errorMessage')).toHaveClass(/visible/);
    await expect(page.locator('#errorMessage')).toContainText('Webcam access denied');
    await expect(page.locator('#previewSection')).toHaveClass(/visible/);
  });

  test('transcription starts during recording and hides after stop', async ({ page }) => {
    await openApp(page);

    await recordShortClip(page, { transcription: true });

    const speechStarts = await page.evaluate(() => window.__speechStarts);
    expect(speechStarts).toBeGreaterThan(0);
    await expect(page.locator('#transcriptionPanel')).toBeHidden();
  });

  test('download transcodes to MP4 with H.264 video and AAC audio', async ({ page }) => {
    await openApp(page);
    await recordShortClip(page);

    await page.locator('#btnDownload').click();

    await expect.poll(() => page.evaluate(() => window.__downloads.length)).toBe(1);
    const result = await page.evaluate(() => ({
      download: window.__downloads[0],
      execArgs: window.__ffmpeg.execs[0],
      writes: window.__ffmpeg.writes,
      deletes: window.__ffmpeg.deletes
    }));

    expect(result.download.download).toMatch(/^recording-\d{4}-\d{2}-\d{2}T.*\.mp4$/);
    expect(result.execArgs).toContain('libx264');
    expect(result.execArgs).toContain('aac');
    expect(result.execArgs).toContain('+faststart');
    expect(result.execArgs).toContain('ultrafast');
    expect(result.writes[0].name).toBe('in.webm');
    expect(result.deletes).toEqual(expect.arrayContaining(['in.webm', 'out.mp4']));
  });

  test('raw download is immediately available without MP4 finalizing', async ({ page }) => {
    await openApp(page);
    await recordShortClip(page);

    await page.locator('#btnDownloadRaw').click();

    await expect.poll(() => page.evaluate(() => window.__downloads.length)).toBe(1);
    const filename = await page.evaluate(() => window.__downloads[0].download);
    expect(filename).toMatch(/^recording-raw-\d{4}-\d{2}-\d{2}T.*\.webm$/);
    expect(await page.evaluate(() => window.__ffmpeg.execs.length)).toBe(0);
  });

  test('MP4 processing stays cancellable if ffmpeg hangs', async ({ page }) => {
    await openApp(page, { ffmpegHang: true });
    await recordShortClip(page);

    await page.locator('#btnDownload').click();
    await expect(page.locator('#btnDownload')).toHaveText('Processing… 0%');
    await expect(page.locator('#btnDownload')).toBeEnabled();
    await expect(page.locator('#btnDownloadRaw')).toBeEnabled();

    await page.locator('#btnDownload').click();

    await expect(page.locator('#btnDownload')).toHaveText('Finalize MP4');
    await expect(page.locator('#errorMessage')).toContainText('cancelled');
    expect(await page.evaluate(() => window.__ffmpeg.terminated)).toBe(true);
  });

  test('download failure falls back to raw recording and restores controls', async ({ page }) => {
    await openApp(page, { ffmpegError: 'ffmpeg failed' });
    await recordShortClip(page);

    await page.locator('#btnDownload').click();

    await expect.poll(() => page.evaluate(() => window.__downloads.length)).toBe(1);
    await expect(page.locator('#errorMessage')).toContainText('Could not finalize MP4');
    await expect(page.locator('#btnDownload')).toBeEnabled();

    const filename = await page.evaluate(() => window.__downloads[0].download);
    expect(filename).toMatch(/^recording-raw-\d{4}-\d{2}-\d{2}T.*\.webm$/);
  });
});
