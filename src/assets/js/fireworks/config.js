/**
 * config.js — 应用配置：存储键/默认词/画质档位/DOM 选择器/帮助文案等常量；fwT 为 i18n
 * 兜底取词（window.__I18N.fw 缺失时回退代码内字面量），挂全局供后续模块共用。
 */

'use strict';

(function initFireworksAppConfig(global) {
  /* 多语言（docs/英文版方案.md Phase 1）：window.__I18N.fw 由 build.js 按 locale 注入（head 内联脚本先于本文件执行）；
     无注入（zh 或 Worker 动态页）走字面量兜底。fwT 挂全局，供拼接文件序中的后续模块共用。 */
  const fwT = (key, fallback) => {
    const v = ((global.__I18N || {}).fw || {})[key];
    return v == null ? fallback : v;
  };
  global.fwT = fwT;
  const config = {
    storageKey: 'whizzzest_fireworks_data',
    storageVersion: '1.0',
    defaultWords: Object.freeze(['焰境万载', '花炮之乡', '一朝相逢']),
    defaultBackground: Object.freeze({
      // `image` 使用图片地址。`style` 使用完整背景样式。
      mode: 'none',
      value: '',
    }),
    wordFontFamily: '华文琥珀, PingFang SC, Microsoft YaHei, sans-serif',
    wordPointDensity: 3,
    wordFontSizeMin: 60,
    wordFontSizeMax: 130,
    wordBurstInterval: 5,
    qualityLevels: Object.freeze({
      low: 1,
      normal: 2,
      high: 3,
    }),
    skyLightingModes: Object.freeze({
      none: 0,
      dim: 1,
      normal: 2,
    }),
    scaleFactorOptions: Object.freeze([0.5, 0.62, 0.75, 0.9, 1.0, 1.5, 2.0]),
    selectors: Object.freeze({
      stageContainer: '.stage-container',
      canvasContainer: '.canvas-container',
      controls: '.controls',
      menu: '.menu',
      menuInnerWrap: '.menu__inner-wrap',
      pauseBtn: '.pause-btn',
      pauseBtnSVG: '.pause-btn use',
      soundBtn: '.sound-btn',
      soundBtnSVG: '.sound-btn use',
      shellType: '.shell-type',
      shellTypeLabel: '.shell-type-label',
      shellSize: '.shell-size',
      shellSizeLabel: '.shell-size-label',
      quality: '.quality-ui',
      qualityLabel: '.quality-ui-label',
      skyLighting: '.sky-lighting',
      skyLightingLabel: '.sky-lighting-label',
      scaleFactor: '.scaleFactor',
      scaleFactorLabel: '.scaleFactor-label',
      wordShell: '.word-shell',
      wordShellLabel: '.word-shell-label',
      autoLaunch: '.auto-launch',
      autoLaunchLabel: '.auto-launch-label',
      finaleModeFormOption: '.form-option--finale-mode',
      finaleMode: '.finale-mode',
      finaleModeLabel: '.finale-mode-label',
      hideControls: '.hide-controls',
      hideControlsLabel: '.hide-controls-label',
      fullscreenFormOption: '.form-option--fullscreen',
      fullscreen: '.fullscreen',
      fullscreenLabel: '.fullscreen-label',
      longExposure: '.long-exposure',
      longExposureLabel: '.long-exposure-label',
      backgroundInput: '.background-input',
      backgroundLabel: '.background-label',
      backgroundApplyBtn: '.background-apply-btn',
      backgroundClearBtn: '.background-clear-btn',
      backgroundUploadInput: '.background-upload-input',
      backgroundGallery: '.background-gallery',
      backgroundStatus: '.background-status',
      helpModal: '.help-modal',
      helpModalOverlay: '.help-modal__overlay',
      helpModalHeader: '.help-modal__header',
      helpModalBody: '.help-modal__body',
      helpModalCloseBtn: '.help-modal__close-btn',
    }),
    helpContent: Object.freeze({
      shellType: {
        header: fwT('help.shellType.header', '烟花类型'),
        body: fwT(
          'help.shellType.body',
          '你要放的烟花类型。选择随机，可以保持当前作品原本的组合节奏。'
        ),
      },
      shellSize: {
        header: fwT('help.shellSize.header', '烟花大小'),
        body: fwT(
          'help.shellSize.body',
          '烟花越大，绽放范围越大，对设备性能的压力也越高。'
        ),
      },
      quality: {
        header: fwT('help.quality.header', '画质'),
        body: fwT(
          'help.quality.body',
          '画质越高，粒子数量越多。设备吃力时直接降低画质。'
        ),
      },
      skyLighting: {
        header: fwT('help.skyLighting.header', '照亮天空'),
        body: fwT('help.skyLighting.body', '控制烟花爆炸时对背景的照亮强度。'),
      },
      scaleFactor: {
        header: fwT('help.scaleFactor.header', '缩放'),
        body: fwT(
          'help.scaleFactor.body',
          '调整观察距离。数值越小，看到的烟花越完整。'
        ),
      },
      wordShell: {
        header: fwT('help.wordShell.header', '文字烟花'),
        body: fwT(
          'help.wordShell.body',
          '默认关闭。开启后，系统会稳定触发文字烟花，不再依赖随机概率。'
        ),
      },
      autoLaunch: {
        header: fwT('help.autoLaunch.header', '自动放烟花'),
        body: fwT(
          'help.autoLaunch.body',
          '开启后自动连续放烟花。关闭后只能通过点击屏幕发射。'
        ),
      },
      finaleMode: {
        header: fwT('help.finaleMode.header', '同时放更多的烟花'),
        body: fwT('help.finaleMode.body', '开启后会在自动发射阶段加密节奏。'),
      },
      hideControls: {
        header: fwT('help.hideControls.header', '隐藏控制按钮'),
        body: fwT(
          'help.hideControls.body',
          '隐藏顶部按钮，保留更干净的观看画面。'
        ),
      },
      fullscreen: {
        header: fwT('help.fullscreen.header', '全屏'),
        body: fwT('help.fullscreen.body', '切换浏览器全屏模式。'),
      },
      longExposure: {
        header: fwT('help.longExposure.header', '保留烟花的火花'),
        body: fwT('help.longExposure.body', '保留更长的拖尾痕迹。'),
      },
      background: {
        header: fwT('help.background.header', '自定义背景'),
        body: fwT(
          'help.background.body',
          '点「上传图片」可以把图片保存到当前浏览器（IndexedDB），刷新或下次打开后点缩略图即可选用；也支持输入图片地址或 `url(...)`、`linear-gradient(...)` 这类背景样式。清除浏览器站点数据会删除已上传的图片。'
        ),
      },
    }),
    helpNodeMap: Object.freeze({
      shellTypeLabel: 'shellType',
      shellSizeLabel: 'shellSize',
      qualityLabel: 'quality',
      skyLightingLabel: 'skyLighting',
      scaleFactorLabel: 'scaleFactor',
      wordShellLabel: 'wordShell',
      autoLaunchLabel: 'autoLaunch',
      finaleModeLabel: 'finaleMode',
      hideControlsLabel: 'hideControls',
      fullscreenLabel: 'fullscreen',
      longExposureLabel: 'longExposure',
      backgroundLabel: 'background',
    }),
  };

  global.FireworksAppConfig = Object.freeze(config);
})(window);
