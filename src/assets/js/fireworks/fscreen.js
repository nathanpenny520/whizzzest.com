/**
 * fscreen.js — 全屏 API 兼容封装（标准/带前缀实现归一）。
 */

(function initFscreen(global) {
  'use strict';

  const keyIndex = {
    fullscreenEnabled: 0,
    fullscreenElement: 1,
    requestFullscreen: 2,
    exitFullscreen: 3,
    fullscreenchange: 4,
    fullscreenerror: 5,
  };

  const vendorMaps = [
    Object.keys(keyIndex),
    [
      'webkitFullscreenEnabled',
      'webkitFullscreenElement',
      'webkitRequestFullscreen',
      'webkitExitFullscreen',
      'webkitfullscreenchange',
      'webkitfullscreenerror',
    ],
    [
      'mozFullScreenEnabled',
      'mozFullScreenElement',
      'mozRequestFullScreen',
      'mozCancelFullScreen',
      'mozfullscreenchange',
      'mozfullscreenerror',
    ],
    [
      'msFullscreenEnabled',
      'msFullscreenElement',
      'msRequestFullscreen',
      'msExitFullscreen',
      'MSFullscreenChange',
      'MSFullscreenError',
    ],
  ];

  const doc = typeof global.document !== 'undefined' ? global.document : {};
  const vendor = vendorMaps.find((map) => map[0] in doc) || [];

  global.fscreen = {
    requestFullscreen(element) {
      return element[vendor[keyIndex.requestFullscreen]]();
    },
    requestFullscreenFunction(element) {
      return element[vendor[keyIndex.requestFullscreen]];
    },
    get exitFullscreen() {
      return doc[vendor[keyIndex.exitFullscreen]].bind(doc);
    },
    addEventListener(type, handler, options) {
      return doc.addEventListener(vendor[keyIndex[type]], handler, options);
    },
    removeEventListener(type, handler) {
      return doc.removeEventListener(vendor[keyIndex[type]], handler);
    },
    get fullscreenEnabled() {
      return Boolean(doc[vendor[keyIndex.fullscreenEnabled]]);
    },
    get fullscreenElement() {
      return doc[vendor[keyIndex.fullscreenElement]];
    },
    get onfullscreenchange() {
      return doc[`on${vendor[keyIndex.fullscreenchange]}`.toLowerCase()];
    },
    set onfullscreenchange(handler) {
      doc[`on${vendor[keyIndex.fullscreenchange]}`.toLowerCase()] = handler;
    },
    get onfullscreenerror() {
      return doc[`on${vendor[keyIndex.fullscreenerror]}`.toLowerCase()];
    },
    set onfullscreenerror(handler) {
      doc[`on${vendor[keyIndex.fullscreenerror]}`.toLowerCase()] = handler;
    },
  };
})(window);
