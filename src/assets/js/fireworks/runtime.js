/**
 * runtime.js — 运行时：初始化装配、全局态与背景解析、文字烟花词表、自动连放/终场/长曝光开关。
 */

'use strict';

const appConfig = window.FireworksAppConfig;
const { createDefaultState, createStore } = window.FireworksAppStore;
const { createBackgroundManager } = window.FireworksBackgroundManager;
const backgroundLibrary = window.FireworksBackgroundLibrary;
const {
  queryNodes,
  populateControls,
  renderApp,
  renderBackgroundGallery,
  setBackgroundStatus,
  bindAppControls,
} = window.FireworksAppUI;

const IS_MOBILE = window.innerWidth <= 640;
const IS_DESKTOP = window.innerWidth > 800;
const IS_HEADER = IS_DESKTOP && window.innerHeight < 300;
const IS_HIGH_END_DEVICE = (() => {
  const hardwareConcurrency = navigator.hardwareConcurrency;
  if (!hardwareConcurrency) {
    return false;
  }

  const minimumCoreCount = window.innerWidth <= 1024 ? 4 : 8;
  return hardwareConcurrency >= minimumCoreCount;
})();

const MAX_WIDTH = 7680;
const MAX_HEIGHT = 4320;
const GRAVITY = 0.9;

const QUALITY_LOW = appConfig.qualityLevels.low;
const QUALITY_NORMAL = appConfig.qualityLevels.normal;
const QUALITY_HIGH = appConfig.qualityLevels.high;

const SKY_LIGHT_NONE = appConfig.skyLightingModes.none;
const SKY_LIGHT_DIM = appConfig.skyLightingModes.dim;
const SKY_LIGHT_NORMAL = appConfig.skyLightingModes.normal;

const COLOR = {
  Red: '#ff0043',
  Green: '#14fc56',
  Blue: '#1e7fff',
  Purple: '#e60aff',
  Gold: '#ffbf36',
  White: '#ffffff',
};

const INVISIBLE = '_INVISIBLE_';
const PI_2 = Math.PI * 2;
const PI_HALF = Math.PI * 0.5;

const COLOR_CODES = Object.values(COLOR);
const COLOR_CODES_W_INVIS = [...COLOR_CODES, INVISIBLE];
const COLOR_TUPLES = COLOR_CODES.reduce((tuples, colorCode) => {
  tuples[colorCode] = {
    r: Number.parseInt(colorCode.slice(1, 3), 16),
    g: Number.parseInt(colorCode.slice(3, 5), 16),
    b: Number.parseInt(colorCode.slice(5, 7), 16),
  };
  return tuples;
}, {});

function getDefaultScaleFactor() {
  if (IS_MOBILE) {
    return 0.9;
  }

  if (IS_HEADER) {
    return 0.75;
  }

  return 1;
}

let simSpeed = 1;
let stageW;
let stageH;
let quality = 1;
let isLowQuality = false;
let isNormalQuality = false;
let isHighQuality = true;

const trailsStage = new Stage('trails-canvas');
const mainStage = new Stage('main-canvas');
const stages = [trailsStage, mainStage];

const randomWords = appConfig.defaultWords.slice();
const wordDotCache = new Map();

const appNodes = queryNodes();
const store = createStore(
  createDefaultState({
    isDesktop: IS_DESKTOP,
    isHeader: IS_HEADER,
    isHighEndDevice: IS_HIGH_END_DEVICE,
    defaultScaleFactor: getDefaultScaleFactor(),
    fullscreen: isFullscreen(),
  }),
  !IS_HEADER
);

const backgroundManager = createBackgroundManager({
  container: appNodes.canvasContainer,
  onStatusChange(message, state) {
    setBackgroundStatus(appNodes, message, state);
  },
});

let backgroundGalleryItems = [];
let renderedGalleryItems = null;
let renderedGallerySelectedId = '';

const wordBurstTracker = {
  shellsSinceLastBurst: 0,
  forceNextBurst: true,
  reset() {
    this.shellsSinceLastBurst = 0;
    this.forceNextBurst = false;
  },
  queueBurst() {
    this.forceNextBurst = true;
  },
  shouldCreateBurst(shell) {
    if (!store.state.config.wordShell || shell.disableWord || !shell.comet) {
      return false;
    }

    if (shell.forceWordBurst || this.forceNextBurst) {
      this.reset();
      return true;
    }

    this.shellsSinceLastBurst += 1;
    if (this.shellsSinceLastBurst >= appConfig.wordBurstInterval) {
      this.shellsSinceLastBurst = 0;
      return true;
    }

    return false;
  },
};

function fullscreenEnabled() {
  return fscreen.fullscreenEnabled;
}

function isFullscreen() {
  return Boolean(fscreen.fullscreenElement);
}

function toggleFullscreen() {
  if (!fullscreenEnabled()) {
    return;
  }

  if (isFullscreen()) {
    fscreen.exitFullscreen();
    return;
  }

  fscreen.requestFullscreen(document.documentElement);
}

function togglePause(toggle) {
  const nextValue = typeof toggle === 'boolean' ? toggle : !store.state.paused;
  if (store.state.paused !== nextValue) {
    store.setState({ paused: nextValue });
  }
}

function toggleSound(toggle) {
  const nextValue =
    typeof toggle === 'boolean' ? toggle : !store.state.soundEnabled;
  store.setState({ soundEnabled: nextValue });
}

function toggleMenu(toggle) {
  const nextValue =
    typeof toggle === 'boolean' ? toggle : !store.state.menuOpen;
  store.setState({ menuOpen: nextValue });
}

function updateConfig(nextConfig) {
  nextConfig = nextConfig || {};
  const previousConfig = store.state.config;
  const mergedConfig = { ...previousConfig, ...nextConfig };
  const includesWordShellUpdate = Object.prototype.hasOwnProperty.call(
    nextConfig,
    'wordShell'
  );

  if (includesWordShellUpdate) {
    mergedConfig.wordShellConfigured = true;
  }

  if (!previousConfig.wordShell && mergedConfig.wordShell) {
    wordBurstTracker.queueBurst();
  } else if (previousConfig.wordShell && !mergedConfig.wordShell) {
    wordBurstTracker.reset();
  }

  store.setState({ config: mergedConfig });
  configDidUpdate();
}

function configDidUpdate() {
  quality = qualitySelector();
  isLowQuality = quality === QUALITY_LOW;
  isNormalQuality = quality === QUALITY_NORMAL;
  isHighQuality = quality === QUALITY_HIGH;

  if (skyLightingSelector() === SKY_LIGHT_NONE) {
    appNodes.canvasContainer.style.backgroundColor = '#000';
  }

  Spark.drawWidth = quality === QUALITY_HIGH ? 0.75 : 1;
}

const isRunning = (state = store.state) => !state.paused && !state.menuOpen;
const soundEnabledSelector = (state = store.state) => state.soundEnabled;
const canPlaySoundSelector = (state = store.state) =>
  isRunning(state) && soundEnabledSelector(state);
const qualitySelector = () => Number(store.state.config.quality);
const shellNameSelector = () => store.state.config.shell;
const shellSizeSelector = () => Number(store.state.config.size);
const finaleSelector = () => store.state.config.finale;
const skyLightingSelector = () => Number(store.state.config.skyLighting);
const scaleFactorSelector = () => store.state.config.scaleFactor;

function handleStateChange(state, previousState) {
  const currentCanPlaySound = canPlaySoundSelector(state);
  const previousCanPlaySound = canPlaySoundSelector(previousState);
  if (currentCanPlaySound === previousCanPlaySound) {
    return;
  }

  if (currentCanPlaySound) {
    soundManager.resumeAll();
    return;
  }

  soundManager.pauseAll();
}

function commitBackgroundSettings(result) {
  if (!result.ok || result.cancelled) {
    return;
  }

  const hasEffectiveBackground = Boolean(result.settings.value);
  store.setState({
    background: {
      ...result.settings,
      configured: hasEffectiveBackground,
    },
  });

  if (!hasEffectiveBackground) {
    applyResolvedBackground();
  }
}

function handleBackgroundApply(rawValue) {
  backgroundManager
    .applyBackground({ value: rawValue })
    .then(commitBackgroundSettings);
}

function handleBackgroundClear() {
  backgroundManager.clearBackground();
  store.setState({
    background: {
      mode: 'none',
      value: '',
      configured: false,
    },
  });
  applyResolvedBackground();
}

function getSelectedBackgroundId() {
  const background = store.state.background;
  return background.configured && background.mode === 'library'
    ? background.value
    : '';
}

function renderGalleryWithSelection() {
  const selectedId = getSelectedBackgroundId();
  if (
    renderedGalleryItems === backgroundGalleryItems &&
    renderedGallerySelectedId === selectedId
  ) {
    return;
  }

  renderedGalleryItems = backgroundGalleryItems;
  renderedGallerySelectedId = selectedId;
  renderBackgroundGallery(appNodes, backgroundGalleryItems, selectedId);
}

function refreshBackgroundGallery() {
  const listPromise = backgroundLibrary.isSupported()
    ? backgroundLibrary.listImages()
    : Promise.resolve([]);
  return listPromise
    .then((items) => {
      backgroundGalleryItems = items;
      renderGalleryWithSelection();
    })
    .catch(() => {
      backgroundGalleryItems = [];
      renderGalleryWithSelection();
    });
}

async function handleBackgroundUpload(file) {
  backgroundManager.setStatus(
    fwT('processingImage', '正在处理图片'),
    'loading'
  );

  try {
    const record = await backgroundLibrary.addImage(file);
    backgroundGalleryItems = [...backgroundGalleryItems, record];
    renderGalleryWithSelection();
    commitBackgroundSettings(await backgroundManager.applyLibraryImage(record));
  } catch (error) {
    backgroundManager.setStatus(
      error && error.message
        ? error.message
        : fwT('saveFailed', '图片保存失败'),
      'error'
    );
  }
}

async function handleBackgroundSelect(id) {
  const background = store.state.background;
  if (
    background.configured &&
    background.mode === 'library' &&
    background.value === id
  ) {
    return;
  }

  const record = await backgroundLibrary.getImage(id);
  if (!record) {
    refreshBackgroundGallery();
    return;
  }

  commitBackgroundSettings(await backgroundManager.applyLibraryImage(record));
}

async function handleBackgroundDelete(id) {
  await backgroundLibrary.deleteImage(id);
  backgroundGalleryItems = backgroundGalleryItems.filter(
    (item) => item.id !== id
  );

  const background = store.state.background;
  if (
    background.configured &&
    background.mode === 'library' &&
    background.value === id
  ) {
    handleBackgroundClear();
  }

  renderGalleryWithSelection();
}

function getCodeDefaultBackground() {
  const defaultBackground = appConfig.defaultBackground || {};
  const value =
    typeof defaultBackground.value === 'string'
      ? defaultBackground.value.trim()
      : '';

  if (!value) {
    return {
      mode: 'none',
      value: '',
      configured: false,
    };
  }

  return {
    mode: defaultBackground.mode === 'style' ? 'style' : 'image',
    value,
    configured: false,
  };
}

function resolvePreferredBackground() {
  if (store.state.background.configured && store.state.background.value) {
    return {
      source: 'user',
      background: store.state.background,
    };
  }

  const codeDefaultBackground = getCodeDefaultBackground();
  if (codeDefaultBackground.value) {
    return {
      source: 'default',
      background: codeDefaultBackground,
    };
  }

  return {
    source: 'none',
    background: {
      mode: 'none',
      value: '',
      configured: false,
    },
  };
}

function applyResolvedBackground() {
  const resolvedBackground = resolvePreferredBackground();

  if (resolvedBackground.source === 'user') {
    if (resolvedBackground.background.mode === 'library') {
      applyUserLibraryBackground();
      return;
    }

    backgroundManager
      .applyBackground(resolvedBackground.background)
      .then((result) => {
        if (result.ok) {
          backgroundManager.setStatus(
            fwT('usingWebBg', '正在使用网页端背景'),
            'success'
          );
          return;
        }

        const fallbackBackground = getCodeDefaultBackground();
        if (!fallbackBackground.value) {
          backgroundManager.clearBackground();
          backgroundManager.setStatus(
            fwT('webBgInvalid', '网页端背景无效，当前未设置默认背景'),
            'error'
          );
          return;
        }

        backgroundManager
          .applyBackground(fallbackBackground)
          .then((fallbackResult) => {
            if (fallbackResult.ok) {
              backgroundManager.setStatus(
                fwT('webBgFallback', '网页端背景无效，已回退到代码默认背景'),
                'idle'
              );
              return;
            }

            backgroundManager.clearBackground();
            backgroundManager.setStatus(
              fwT('webBgAndDefaultInvalid', '网页端背景和代码默认背景都无效'),
              'error'
            );
          });
      });
    return;
  }

  if (resolvedBackground.source === 'default') {
    backgroundManager
      .applyBackground(resolvedBackground.background)
      .then((result) => {
        if (result.ok) {
          backgroundManager.setStatus(
            fwT('usingDefaultBg', '正在使用代码默认背景'),
            'idle'
          );
          return;
        }

        backgroundManager.clearBackground();
        backgroundManager.setStatus(
          fwT('defaultBgInvalid', '代码默认背景无效，当前未显示背景'),
          'error'
        );
      });
    return;
  }

  backgroundManager.clearBackground();
}

async function applyUserLibraryBackground() {
  const record = await backgroundLibrary.getImage(store.state.background.value);
  if (record) {
    const result = await backgroundManager.applyLibraryImage(record);
    if (result.ok && !result.cancelled) {
      backgroundManager.setStatus(
        fwT('usingSavedBg', '正在使用保存的背景图'),
        'success'
      );
    }
    return;
  }

  store.setState({
    background: {
      mode: 'none',
      value: '',
      configured: false,
    },
  });

  const fallbackBackground = getCodeDefaultBackground();
  if (!fallbackBackground.value) {
    backgroundManager.clearBackground();
    backgroundManager.setStatus(
      fwT('savedBgInvalid', '保存的背景图已失效，当前未设置默认背景'),
      'error'
    );
    return;
  }

  backgroundManager
    .applyBackground(fallbackBackground)
    .then((fallbackResult) => {
      if (fallbackResult.ok) {
        backgroundManager.setStatus(
          fwT('savedBgFallback', '保存的背景图已失效，已回退到代码默认背景'),
          'idle'
        );
        return;
      }

      backgroundManager.clearBackground();
      backgroundManager.setStatus(
        fwT('savedBgAndDefaultInvalid', '保存的背景图和代码默认背景都无效'),
        'error'
      );
    });
}

fscreen.addEventListener('fullscreenchange', () => {
  store.setState({ fullscreen: isFullscreen() });
});
