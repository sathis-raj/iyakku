const socket = io();

const welcomeScreen = document.getElementById("welcome-screen");
const connectedScreen = document.getElementById("connected-screen");
const photoContainer = document.getElementById("photo-container");
const photoEl = document.getElementById("photo");
const photoInfo = document.getElementById("photo-info");
const mediaContainer = document.getElementById("media-container");
const videoPlayer = document.getElementById("video-player");
const audioDisplay = document.getElementById("audio-display");
const audioTitle = document.getElementById("audio-title");
const mediaInfo = document.getElementById("media-info");

let images = [];
let currentIndex = 0;
let scale = 1;
let panX = 0;
let panY = 0;
let rotation = 0;
let rafId = null;
let slideshowTimer = null;
let currentMediaType = "image";
let timeUpdateInterval = null;
let userHasInteracted = false;
let pendingPlay = false;
const playOverlay = document.getElementById("play-overlay");

// Mini player elements
const miniPlayer = document.getElementById("mini-player");
const mpPlay = document.getElementById("mp-play");
const mpPrev = document.getElementById("mp-prev");
const mpNext = document.getElementById("mp-next");
const mpSeek = document.getElementById("mp-seek");
const mpTime = document.getElementById("mp-time");
const mpDuration = document.getElementById("mp-duration");
const mpTitle = document.getElementById("mp-title");
const mpMute = document.getElementById("mp-mute");
let mpSeeking = false;

// ─── Preload Cache ───────────────────────────────────────────────────────────

const preloadCache = {};

function preloadImage(index) {
  if (index < 0 || index >= images.length) return;
  const item = images[index];
  if (item.type && item.type !== "image") return;
  const path = item.path;
  if (preloadCache[path]) return;
  const img = new Image();
  img.src = `/api/image?path=${encodeURIComponent(path)}`;
  preloadCache[path] = img;
}

function preloadAround(index) {
  preloadImage(index - 1);
  preloadImage(index + 1);
  preloadImage(index + 2);
}

// ─── Stop All Media ──────────────────────────────────────────────────────────

function stopAllMedia() {
  videoPlayer.pause();
  videoPlayer.removeAttribute("src");
  videoPlayer.load();
  stopTimeUpdates();
}

// ─── Time Update Sync ────────────────────────────────────────────────────────

function startTimeUpdates() {
  stopTimeUpdates();
  timeUpdateInterval = setInterval(() => {
    if (videoPlayer.src && videoPlayer.src !== window.location.href) {
      socket.emit("media_time_update", {
        currentTime: videoPlayer.currentTime,
        duration: videoPlayer.duration || 0,
        paused: videoPlayer.paused,
      });
    }
  }, 1000);
}

function stopTimeUpdates() {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
    timeUpdateInterval = null;
  }
}

// ─── Display ─────────────────────────────────────────────────────────────────

function showMedia(index) {
  if (images.length === 0) return;
  stopAllMedia();
  currentIndex = Math.max(0, Math.min(index, images.length - 1));
  const item = images[currentIndex];
  currentMediaType = item.type || "image";

  // Reset zoom/pan/rotation on media change
  scale = 1;
  panX = 0;
  panY = 0;
  rotation = 0;

  // Hide all containers
  photoContainer.style.display = "none";
  mediaContainer.style.display = "none";

  // Show/hide mini player
  if (currentMediaType === "image") {
    miniPlayer.style.display = "none";
    document.body.classList.remove("has-mini-player");
  } else {
    miniPlayer.style.display = "flex";
    document.body.classList.add("has-mini-player");
    mpTitle.textContent = item.name;
    mpPlay.textContent = "\u25B6";
    mpSeek.value = 0;
    mpTime.textContent = "0:00";
    mpDuration.textContent = "0:00";
  }

  if (currentMediaType === "image") {
    photoContainer.style.display = "flex";
    showPhoto(currentIndex);
  } else if (currentMediaType === "video") {
    mediaContainer.style.display = "flex";
    audioDisplay.style.display = "none";
    videoPlayer.style.display = "block";
    videoPlayer.src = `/api/media?path=${encodeURIComponent(item.path)}`;
    videoPlayer.load();
    mediaInfo.textContent = `${currentIndex + 1} / ${images.length} — ${item.name}`;
  } else if (currentMediaType === "audio") {
    mediaContainer.style.display = "flex";
    videoPlayer.style.display = "none";
    audioDisplay.style.display = "flex";
    audioTitle.textContent = item.name;
    videoPlayer.src = `/api/media?path=${encodeURIComponent(item.path)}`;
    videoPlayer.load();
    mediaInfo.textContent = `${currentIndex + 1} / ${images.length} — ${item.name}`;
  }
}

function showPhoto(index) {
  if (images.length === 0) return;
  currentIndex = Math.max(0, Math.min(index, images.length - 1));

  const img = images[currentIndex];
  photoEl.style.transition = "opacity 0.3s ease";
  photoEl.style.opacity = "0";

  setTimeout(() => {
    const src = `/api/image?path=${encodeURIComponent(img.path)}`;
    photoEl.src = src;
    photoEl.onload = () => {
      applyTransform(false);
      photoEl.style.opacity = "1";
      preloadAround(currentIndex);
    };
    // If preloaded, onload fires immediately
    if (preloadCache[img.path] && preloadCache[img.path].complete) {
      photoEl.src = preloadCache[img.path].src;
    }
  }, 150);

  photoInfo.textContent = `${currentIndex + 1} / ${images.length} — ${img.name}`;
}

function applyTransform(smooth) {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    photoEl.style.transition = smooth ? "transform 0.08s linear" : "none";
    photoEl.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale}) rotate(${rotation}deg)`;
    rafId = null;
  });
}

// ─── Video Element Event Listeners ───────────────────────────────────────────

videoPlayer.addEventListener("loadedmetadata", () => {
  socket.emit("media_loaded", { duration: videoPlayer.duration });
});

videoPlayer.addEventListener("ended", () => {
  socket.emit("media_ended");
  stopTimeUpdates();
});

// ─── Autoplay Policy Handling ─────────────────────────────────────────────────

function emitMediaState() {
  socket.emit("media_time_update", {
    currentTime: videoPlayer.currentTime,
    duration: videoPlayer.duration || 0,
    paused: videoPlayer.paused,
  });
}

function tryPlay() {
  const playPromise = videoPlayer.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      userHasInteracted = true;
      pendingPlay = false;
      startTimeUpdates();
      emitMediaState();
    }).catch(() => {
      // Autoplay blocked — show overlay so user can click to unlock
      pendingPlay = true;
      playOverlay.style.display = "flex";
      socket.emit("playback_blocked");
    });
  }
}

playOverlay.addEventListener("click", () => {
  playOverlay.style.display = "none";
  userHasInteracted = true;
  if (pendingPlay) {
    pendingPlay = false;
    videoPlayer.play().then(() => {
      startTimeUpdates();
    }).catch(() => {});
  }
});

// Also unlock on any click/keypress on the viewer page
document.addEventListener("click", () => { userHasInteracted = true; }, { once: true });
document.addEventListener("keydown", () => { userHasInteracted = true; }, { once: true });

// ─── Media Playback Socket Listeners ─────────────────────────────────────────

socket.on("apply_media_play", () => {
  tryPlay();
});

socket.on("apply_media_pause", () => {
  videoPlayer.pause();
  stopTimeUpdates();
  emitMediaState();
});

socket.on("apply_media_seek", (data) => {
  videoPlayer.currentTime = data.time;
});

socket.on("apply_media_volume", (data) => {
  videoPlayer.volume = data.level;
});

socket.on("apply_media_mute", () => {
  videoPlayer.muted = !videoPlayer.muted;
});

// ─── Slideshow ───────────────────────────────────────────────────────────────

function startSlideshow(interval) {
  stopSlideshow();
  slideshowTimer = setInterval(() => {
    if (currentIndex < images.length - 1) {
      showMedia(currentIndex + 1);
    } else {
      showMedia(0);
    }
    // Notify controller of the current photo so it stays in sync
    socket.emit("slideshow_tick", { index: currentIndex });
  }, interval * 1000);
}

function stopSlideshow() {
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
}

// ─── Socket Events ───────────────────────────────────────────────────────────

let disconnectTimer = null;

socket.on("controller_connected", () => {
  // Cancel any pending disconnect reset
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
    // Controller came back — no need to change anything
    return;
  }
  welcomeScreen.style.display = "none";
  // Only show connected screen if no media is loaded yet
  if (images.length === 0) {
    connectedScreen.style.display = "block";
  }
});

socket.on("folder_loaded", (data) => {
  images = data.media || [];
  currentIndex = 0;
  // Clear preload cache for new folder
  Object.keys(preloadCache).forEach((k) => delete preloadCache[k]);
  if (images.length > 0) {
    welcomeScreen.style.display = "none";
    connectedScreen.style.display = "none";
    photoContainer.style.display = "none";
    mediaContainer.style.display = "none";
    showMedia(0);
  }
});

socket.on("show_photo", (data) => {
  showMedia(data.index);
});

socket.on("show_next", () => {
  if (currentIndex < images.length - 1) {
    showMedia(currentIndex + 1);
  }
});

socket.on("show_prev", () => {
  if (currentIndex > 0) {
    showMedia(currentIndex - 1);
  }
});

socket.on("apply_zoom", (data) => {
  scale = data.scale;
  applyTransform(true);
});

socket.on("apply_pan", (data) => {
  panX = data.x;
  panY = data.y;
  applyTransform(false);
});

socket.on("apply_reset", () => {
  scale = 1;
  panX = 0;
  panY = 0;
  rotation = 0;
  photoEl.style.transition = "transform 0.3s ease";
  photoEl.style.transform = `translate3d(0px, 0px, 0) scale(1) rotate(0deg)`;
});

socket.on("apply_rotation", (data) => {
  rotation = data.angle;
  photoEl.style.transition = "transform 0.3s ease";
  photoEl.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale}) rotate(${rotation}deg)`;
});

socket.on("controller_disconnected", () => {
  // Grace period — phone may have just locked, give it time to reconnect
  if (disconnectTimer) clearTimeout(disconnectTimer);
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    stopSlideshow();
    stopAllMedia();
    images = [];
    currentIndex = 0;
    scale = 1;
    panX = 0;
    panY = 0;
    rotation = 0;
    photoEl.src = "";
    photoEl.style.transform = "";
    photoContainer.style.display = "none";
    mediaContainer.style.display = "none";
    miniPlayer.style.display = "none";
    presentingOverlay.style.display = "none";
    connectedScreen.style.display = "none";
    document.body.classList.remove("has-mini-player");
    welcomeScreen.style.display = "block";
  }, 15000); // 15 seconds grace period
});

socket.on("start_slideshow", (data) => {
  startSlideshow(data.interval);
});

socket.on("stop_slideshow", () => {
  stopSlideshow();
});

// ─── Fullscreen & Info Toggle ────────────────────────────────────────────────

let infoVisible = true;

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

document.body.addEventListener("dblclick", toggleFullscreen);

socket.on("apply_toggle_info", () => {
  infoVisible = !infoVisible;
  photoInfo.style.display = infoVisible ? "block" : "none";
  mediaInfo.style.display = infoVisible ? "block" : "none";
});

// ─── Mini Player Controls ────────────────────────────────────────────────────

function formatTimeMini(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function updateMiniPlayer() {
  if (currentMediaType === "image") return;
  mpTime.textContent = formatTimeMini(videoPlayer.currentTime);
  mpDuration.textContent = formatTimeMini(videoPlayer.duration);
  mpPlay.textContent = videoPlayer.paused ? "\u25B6" : "\u23F8";
  if (!mpSeeking && videoPlayer.duration) {
    mpSeek.value = (videoPlayer.currentTime / videoPlayer.duration) * 100;
  }
}

// Direct play/pause on viewer (user gesture — bypasses autoplay policy)
mpPlay.addEventListener("click", () => {
  userHasInteracted = true;
  if (videoPlayer.paused) {
    videoPlayer.play().then(() => {
      startTimeUpdates();
      emitMediaState();
      updateMiniPlayer();
    }).catch(() => {});
    socket.emit("media_play");
  } else {
    videoPlayer.pause();
    stopTimeUpdates();
    emitMediaState();
    updateMiniPlayer();
    socket.emit("media_pause");
  }
});

mpPrev.addEventListener("click", () => {
  if (currentIndex > 0) {
    showMedia(currentIndex - 1);
    socket.emit("prev_photo");
  }
});

mpNext.addEventListener("click", () => {
  if (currentIndex < images.length - 1) {
    showMedia(currentIndex + 1);
    socket.emit("next_photo");
  }
});

mpMute.addEventListener("click", () => {
  videoPlayer.muted = !videoPlayer.muted;
  mpMute.textContent = videoPlayer.muted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
  socket.emit("media_mute");
});

mpSeek.addEventListener("mousedown", () => { mpSeeking = true; });
mpSeek.addEventListener("mouseup", () => { mpSeeking = false; });
mpSeek.addEventListener("input", () => {
  if (videoPlayer.duration) {
    const time = (mpSeek.value / 100) * videoPlayer.duration;
    videoPlayer.currentTime = time;
    mpTime.textContent = formatTimeMini(time);
    socket.emit("media_seek", { time });
  }
});

// Keep mini player in sync via timeupdate event (local, no socket needed)
videoPlayer.addEventListener("timeupdate", updateMiniPlayer);

// ─── Presentation Overlay ─────────────────────────────────────────────────────

const presentingOverlay = document.getElementById("presenting-overlay");
const presentingFileName = document.getElementById("presenting-file-name");

socket.on("presentation_started", (data) => {
  presentingFileName.textContent = data.name;
  welcomeScreen.style.display = "none";
  connectedScreen.style.display = "none";
  photoContainer.style.display = "none";
  mediaContainer.style.display = "none";
  miniPlayer.style.display = "none";
  document.body.classList.remove("has-mini-player");
  presentingOverlay.style.display = "flex";
});

socket.on("presentation_ended", () => {
  presentingOverlay.style.display = "none";
  if (images.length > 0) {
    showMedia(currentIndex);
  } else {
    connectedScreen.style.display = "block";
  }
});

// ─── Welcome Screen Interactions ──────────────────────────────────────────────

(function () {
  const cantScanToggle = document.getElementById("cant-scan-toggle");
  const urlRow = document.getElementById("url-row");
  const copyBtn = document.getElementById("copy-btn");
  const ctrlUrl = document.getElementById("ctrl-url");
  const statusDot = document.getElementById("status-dot");
  const pinLabel = document.getElementById("pin-label");

  if (!cantScanToggle) return;

  let urlVisible = false;
  cantScanToggle.addEventListener("click", () => {
    urlVisible = !urlVisible;
    urlRow.style.display = urlVisible ? "flex" : "none";
    cantScanToggle.textContent = urlVisible ? "Hide URL" : "Can't scan? Show URL";
  });

  if (copyBtn && ctrlUrl) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(ctrlUrl.textContent).then(() => {
        copyBtn.textContent = "Copied!";
        copyBtn.style.color = "#a0e650";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
          copyBtn.style.color = "";
        }, 2000);
      });
    });
  }

  // Update status dot on connection events
  if (statusDot) {
    socket.on("controller_connected", () => {
      statusDot.classList.add("connected");
      // Update PIN label when controller connects (it may have just set a PIN)
      if (pinLabel) {
        pinLabel.innerHTML = "&#128274; PIN Protected";
        pinLabel.classList.add("pin-set");
      }
    });
    socket.on("controller_disconnected", () => {
      // Matches the 15s grace period in the main disconnect handler
      setTimeout(() => {
        statusDot.classList.remove("connected");
      }, 15000);
    });
  }
})();

