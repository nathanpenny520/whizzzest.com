/**
 * engine.js — 装配入口：建舞台与双画布、绑定设置面板与控制钮、启动模拟循环与音效。
 */

'use strict';

function setLoadingStatus(status) {
  document.querySelector('.loading-init__status').textContent = status;
}

function populateAppControls() {
  populateControls(appNodes, shellNames, {
    shellSizeOptions: ['3"', '4"', '6"', '8"', '12"', '16"'].map(
      (label, index) => ({
        value: String(index),
        label,
      })
    ),
    qualityOptions: [
      { label: fwT('qualityLow', '低'), value: QUALITY_LOW },
      { label: fwT('qualityNormal', '正常'), value: QUALITY_NORMAL },
      { label: fwT('qualityHigh', '高'), value: QUALITY_HIGH },
    ],
    skyLightingOptions: [
      { label: fwT('skyNone', '不'), value: SKY_LIGHT_NONE },
      { label: fwT('skyDim', '暗'), value: SKY_LIGHT_DIM },
      { label: fwT('skyNormal', '正常'), value: SKY_LIGHT_NORMAL },
    ],
    scaleFactorOptions: appConfig.scaleFactorOptions.map((value) => ({
      value: value.toFixed(2),
      label: `${value * 100}%`,
    })),
  });
}

function init() {
  const loadingNode = document.querySelector('.loading-init');
  if (loadingNode) {
    loadingNode.remove();
  }

  appNodes.stageContainer.classList.remove('remove');
  populateAppControls();

  if (!shellTypes[store.state.config.shell]) {
    store.setState({
      config: {
        ...store.state.config,
        shell: 'Random',
      },
    });
  }

  togglePause(false);
  renderApp(store.state, appNodes);
  configDidUpdate();
  applyResolvedBackground();
  refreshBackgroundGallery();
}

function attachRuntimeBindings() {
  store.subscribe((state) => renderApp(state, appNodes));
  store.subscribe(handleStateChange);
  store.subscribe(() => renderGalleryWithSelection());

  bindAppControls({
    nodes: appNodes,
    onConfigChange: updateConfig,
    onScaleFactorChange: handleResize,
    onToggleFullscreen: toggleFullscreen,
    onBackgroundApply: handleBackgroundApply,
    onBackgroundClear: handleBackgroundClear,
    onBackgroundUpload: handleBackgroundUpload,
    onBackgroundSelect: handleBackgroundSelect,
    onBackgroundDelete: handleBackgroundDelete,
    onHelpOpen(helpTopic) {
      store.setState({ openHelpTopic: helpTopic });
    },
    onHelpClose() {
      store.setState({ openHelpTopic: null });
    },
  });

  mainStage.addEventListener('pointerstart', handlePointerStart);
  mainStage.addEventListener('pointerend', handlePointerEnd);
  mainStage.addEventListener('pointermove', handlePointerMove);
  mainStage.addEventListener('ticker', update);

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', handleResize);

  if (!fullscreenEnabled()) {
    appNodes.fullscreenFormOption.classList.add('remove');
  }

  backgroundManager.setStatus(fwT('bgNone', '未设置自定义背景'), 'idle');
  handleResize();
}

attachRuntimeBindings();

if (IS_HEADER) {
  init();
} else {
  setLoadingStatus(fwT('igniting', '正在点燃导火线'));
  setTimeout(() => {
    Promise.all([soundManager.preload()])
      .then(() => {
        init();
      })
      .catch(() => {
        init();
      });
  }, 0);
}
