/**
 * interaction.js — 交互：点击/拖拽发射、画布顶部三热区（暂停/声音/设置）、底部 44px 速度条、
 * resize 时高度扣除站点导航。
 */

'use strict';

let isUpdatingSpeed = false;
let currentFrame = 0;
let speedBarOpacity = 0;
let autoLaunchTime = 0;

function registerUserInteraction() {
  soundManager.registerInteraction();
}

function handlePointerStart(event) {
  registerUserInteraction();
  const buttonSize = 50;

  if (event.y < buttonSize) {
    if (event.x < buttonSize) {
      togglePause();
      return;
    }

    if (
      event.x > mainStage.width / 2 - buttonSize / 2 &&
      event.x < mainStage.width / 2 + buttonSize / 2
    ) {
      toggleSound();
      return;
    }

    if (event.x > mainStage.width - buttonSize) {
      toggleMenu();
      return;
    }
  }

  if (!isRunning()) {
    return;
  }

  if (updateSpeedFromEvent(event)) {
    isUpdatingSpeed = true;
    return;
  }

  if (event.onCanvas) {
    launchShellFromConfig(event);
  }
}

function handlePointerEnd() {
  isUpdatingSpeed = false;
}

function handlePointerMove(event) {
  if (!isRunning() || !isUpdatingSpeed) {
    return;
  }

  updateSpeedFromEvent(event);
}

function handleKeydown(event) {
  registerUserInteraction();

  if (event.keyCode === 80) {
    togglePause();
    return;
  }

  if (event.keyCode === 79) {
    toggleMenu();
    return;
  }

  if (event.keyCode === 27) {
    toggleMenu(false);
  }
}

function handleResize() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // 画布须让出顶部站点导航的高度，否则画布比可视区高出一截、底部速度条被裁掉
  const navHeight = (document.querySelector('.nav') || {}).offsetHeight || 0;
  const containerWidth = Math.min(viewportWidth, MAX_WIDTH);
  const containerHeight =
    viewportWidth <= 420
      ? viewportHeight - navHeight
      : Math.min(viewportHeight - navHeight, MAX_HEIGHT);

  appNodes.stageContainer.style.width = `${containerWidth}px`;
  appNodes.stageContainer.style.height = `${containerHeight}px`;
  stages.forEach((stage) => stage.resize(containerWidth, containerHeight));

  const scaleFactor = scaleFactorSelector();
  stageW = containerWidth / scaleFactor;
  stageH = containerHeight / scaleFactor;
}

function updateSpeedFromEvent(event) {
  if (isUpdatingSpeed || event.y >= mainStage.height - 44) {
    const edgePadding = 16;
    const newSpeed =
      (event.x - edgePadding) / (mainStage.width - edgePadding * 2);
    simSpeed = Math.min(Math.max(newSpeed, 0), 1);
    speedBarOpacity = 1;
    return true;
  }

  return false;
}

function updateGlobals(timeStep, lag) {
  currentFrame += 1;

  if (!isUpdatingSpeed) {
    speedBarOpacity -= lag / 30;
    if (speedBarOpacity < 0) {
      speedBarOpacity = 0;
    }
  }

  if (store.state.config.autoLaunch) {
    autoLaunchTime -= timeStep;
    if (autoLaunchTime <= 0) {
      autoLaunchTime = startSequence() * 1.25;
    }
  }
}
