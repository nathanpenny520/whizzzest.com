/**
 * background-manager.js — 自定义背景：地址/渐变/库图三类背景的解析与应用，
 * objectURL 统一持有并在切换时 revoke，requestId 竞态守卫。
 */

'use strict';

(function initFireworksBackgroundManager(global) {
  const cssImagePattern =
    /^(?:url\(|(?:repeating-)?(?:linear|radial|conic)-gradient\(|image-set\(|cross-fade\()/i;
  const urlPattern = /url\((['"]?)(.*?)\1\)/i;

  function extractUrl(cssValue) {
    const match = cssValue.match(urlPattern);
    return match ? match[2].trim() : '';
  }

  function buildCssValue(rawValue) {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
      return null;
    }

    if (cssImagePattern.test(trimmedValue)) {
      return {
        mode: trimmedValue.startsWith('url(') ? 'image' : 'style',
        rawValue: trimmedValue,
        cssValue: trimmedValue,
        preloadUrl: extractUrl(trimmedValue),
      };
    }

    return {
      mode: 'image',
      rawValue: trimmedValue,
      cssValue: `url(${JSON.stringify(new URL(trimmedValue, window.location.href).href)})`,
      preloadUrl: new URL(trimmedValue, window.location.href).href,
    };
  }

  function preloadImage(url) {
    if (!url) {
      return Promise.resolve();
    }

    const resolvedUrl = new URL(url, window.location.href);
    if (resolvedUrl.origin === window.location.origin) {
      return fetch(resolvedUrl.href, { cache: 'no-store' }).then((response) => {
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.startsWith('image/')) {
          throw new Error(fwT('bgLoadFailed', '背景图片加载失败'));
        }
      });
    }

    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error(fwT('bgLoadFailed', '背景图片加载失败')));
      image.src = resolvedUrl.href;
    });
  }

  function createBackgroundManager(options) {
    const container = options.container;
    const onStatusChange = options.onStatusChange;
    let requestId = 0;
    let activeObjectUrl = '';

    function setStatus(message, state) {
      onStatusChange(message, state);
    }

    function revokeActiveObjectUrl() {
      if (!activeObjectUrl) {
        return;
      }

      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = '';
    }

    function clearBackground() {
      requestId += 1;
      revokeActiveObjectUrl();
      container.style.backgroundImage = '';
      container.style.backgroundPosition = '';
      container.style.backgroundRepeat = '';
      container.style.backgroundSize = '';
      setStatus(fwT('bgNone', '未设置自定义背景'), 'idle');
      return {
        mode: 'none',
        value: '',
      };
    }

    async function applyBackground(candidate) {
      const rawValue =
        typeof candidate === 'string'
          ? candidate
          : candidate && candidate.value;
      const normalizedValue =
        typeof rawValue === 'string' ? rawValue.trim() : '';

      if (!normalizedValue) {
        return {
          ok: true,
          settings: clearBackground(),
        };
      }

      const backgroundDefinition = buildCssValue(normalizedValue);
      if (!backgroundDefinition) {
        return {
          ok: true,
          settings: clearBackground(),
        };
      }

      const currentRequestId = ++requestId;
      setStatus(fwT('bgApplying', '正在加载背景'), 'loading');

      try {
        await preloadImage(backgroundDefinition.preloadUrl);
        if (currentRequestId !== requestId) {
          return { ok: false, cancelled: true };
        }

        const validationNode = document.createElement('div');
        validationNode.style.backgroundImage = backgroundDefinition.cssValue;
        if (!validationNode.style.backgroundImage) {
          throw new Error(fwT('bgStyleInvalid', '背景样式无效'));
        }

        container.style.backgroundImage = backgroundDefinition.cssValue;
        container.style.backgroundPosition = 'center';
        container.style.backgroundRepeat = 'no-repeat';
        container.style.backgroundSize = 'cover';
        revokeActiveObjectUrl();
        setStatus(fwT('bgApplied', '自定义背景已应用'), 'success');

        return {
          ok: true,
          settings: {
            mode: backgroundDefinition.mode,
            value: backgroundDefinition.rawValue,
          },
        };
      } catch (error) {
        if (currentRequestId !== requestId) {
          return { ok: false, cancelled: true };
        }

        setStatus(
          fwT('bgInvalidCheckUrl', '背景加载失败，请检查地址或样式'),
          'error'
        );
        return {
          ok: false,
          error,
        };
      }
    }

    async function applyLibraryImage(record) {
      const currentRequestId = ++requestId;
      setStatus(fwT('bgApplying', '正在加载背景'), 'loading');

      try {
        const objectUrl = URL.createObjectURL(record.blob);
        const validationNode = document.createElement('div');
        validationNode.style.backgroundImage = `url("${objectUrl}")`;
        if (!validationNode.style.backgroundImage) {
          URL.revokeObjectURL(objectUrl);
          throw new Error(fwT('bgStyleInvalid', '背景样式无效'));
        }

        if (currentRequestId !== requestId) {
          URL.revokeObjectURL(objectUrl);
          return { ok: false, cancelled: true };
        }

        revokeActiveObjectUrl();
        activeObjectUrl = objectUrl;
        container.style.backgroundImage = `url("${objectUrl}")`;
        container.style.backgroundPosition = 'center';
        container.style.backgroundRepeat = 'no-repeat';
        container.style.backgroundSize = 'cover';
        setStatus(fwT('bgUploaded', '已应用上传的背景图'), 'success');

        return {
          ok: true,
          settings: {
            mode: 'library',
            value: record.id,
            configured: true,
          },
        };
      } catch (error) {
        if (currentRequestId !== requestId) {
          return { ok: false, cancelled: true };
        }

        setStatus(fwT('bgLoadRetry', '背景加载失败，请重试'), 'error');
        return {
          ok: false,
          error,
        };
      }
    }

    return {
      applyBackground,
      applyLibraryImage,
      clearBackground,
      setStatus,
    };
  }

  global.FireworksBackgroundManager = Object.freeze({
    createBackgroundManager,
  });
})(window);
