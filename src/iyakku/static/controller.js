const socket = io();

// ─── Tap Helper (fixes iOS Safari tap issues) ────────────────────────────────

function onTap(el, callback) {
  let startX, startY;
  el.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    const dx = Math.abs(e.changedTouches[0].clientX - startX);
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    if (dx < 10 && dy < 10) {
      e.preventDefault();
      callback();
    }
  });
  // Fallback for non-touch devices
  el.addEventListener("click", callback);
}

// ─── State ───────────────────────────────────────────────────────────────────

let images = [];
let currentIndex = 0;
let currentScale = 1;
let panX = 0;
let panY = 0;
let currentRotation = 0;
let currentFolderPath = null;
let currentSort = "name";
let slideshowActive = false;
let slideshowInterval = 5;
let currentMediaType = "image";
let isPlaying = false;
let isMuted = false;
let mediaDurationVal = 0;
let currentTimeVal = 0;
let isSeeking = false;

// ─── DOM Elements ────────────────────────────────────────────────────────────

const browserView = document.getElementById("browser-view");
const photoView = document.getElementById("photo-view");
const rootsList = document.getElementById("roots-list");
const folderSection = document.getElementById("folder-section");
const folderList = document.getElementById("folder-list");
const currentPathEl = document.getElementById("current-path");
const backBtn = document.getElementById("back-btn");
const browseBtn = document.getElementById("browse-btn");
const photoCounter = document.getElementById("photo-counter");
const currentPhotoName = document.getElementById("current-photo-name");
const thumbnailStrip = document.getElementById("thumbnail-strip");
const swipeArea = document.getElementById("swipe-area");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const zoomLevelEl = document.getElementById("zoom-level");
const rotateBtn = document.getElementById("rotate-btn");
const slideshowBtn = document.getElementById("slideshow-btn");
const slideshowOptions = document.getElementById("slideshow-options");
const sortSelect = document.getElementById("sort-select");
const searchSection = document.getElementById("search-section");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const searchClearBtn = document.getElementById("search-clear-btn");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const shuffleBtn = document.getElementById("shuffle-btn");
const zoomControls = document.getElementById("zoom-controls");
const slideshowControls = document.getElementById("slideshow-controls");

// Media control elements
const mediaControls = document.getElementById("media-controls");
const mediaSeekBar = document.getElementById("media-seek-bar");
const mediaCurrentTime = document.getElementById("media-current-time");
const mediaDuration = document.getElementById("media-duration");
const playPauseBtn = document.getElementById("play-pause-btn");
const skipBackBtn = document.getElementById("skip-back-btn");
const skipForwardBtn = document.getElementById("skip-forward-btn");
const muteBtn = document.getElementById("mute-btn");
const volumeSlider = document.getElementById("volume-slider");

// Controller mini player elements
const ctrlMiniPlayer = document.getElementById("ctrl-mini-player");
const cmpPlay = document.getElementById("cmp-play");
const cmpTitle = document.getElementById("cmp-title");
const cmpTime = document.getElementById("cmp-time");
const cmpDuration = document.getElementById("cmp-duration");
const cmpProgressFill = document.getElementById("cmp-progress-fill");
const cmpExpand = document.getElementById("cmp-expand");

let isShuffled = false;
let mediaIsActive = false; // true when video/audio is loaded (even if paused)
let currentFilter = "all";
let currentFolderData = null; // cached browse response for re-filtering
const filterButtons = document.querySelectorAll(".filter-btn");

// Presentation state & DOM refs
let presentationActive = false;
const presentationView = document.getElementById("presentation-view");
const presFileName = document.getElementById("pres-file-name");
const presSwipeArea = document.getElementById("pres-swipe-area");
const presPrevBtn = document.getElementById("pres-prev-btn");
const presNextBtn = document.getElementById("pres-next-btn");
const presExitBtn = document.getElementById("pres-exit-btn");

// ─── Navigation History ──────────────────────────────────────────────────────

let navHistory = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toastEl = document.getElementById("toast");
let toastTimer = null;

function showToast(message, duration) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.style.display = "block";
  toastTimer = setTimeout(() => { toastEl.style.display = "none"; }, duration || 4000);
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getMediaIcon(type) {
  if (type === "video") return "\uD83C\uDFAC";
  if (type === "audio") return "\uD83C\uDFB5";
  if (type === "presentation") return "\uD83D\uDCC4";
  return "\uD83D\uDDBC\uFE0F";
}

// ─── Initialize ──────────────────────────────────────────────────────────────

async function init() {
  const res = await fetch("/api/roots");
  const roots = await res.json();
  renderRoots(roots);
}

function renderRoots(roots) {
  rootsList.innerHTML = "";
  roots.forEach((root) => {
    const el = createFolderItem(root.name, root.path, -1, true);
    rootsList.appendChild(el);
  });
}

function renderBreadcrumbs(fullPath) {
  currentPathEl.innerHTML = "";
  const parts = fullPath.split("/").filter(Boolean);
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = " / ";
      currentPathEl.appendChild(sep);
    }
    const crumb = document.createElement("span");
    crumb.className = "breadcrumb";
    crumb.textContent = part;
    const crumbPath = "/" + parts.slice(0, i + 1).join("/");
    if (i < parts.length - 1) {
      crumb.classList.add("breadcrumb-link");
      onTap(crumb, () => {
        // Trim navHistory back to this level and browse there
        while (navHistory.length > 0 && navHistory[navHistory.length - 1] !== crumbPath) {
          navHistory.pop();
        }
        if (navHistory.length === 0) navHistory.push(crumbPath);
        else navHistory.pop(); // browseTo will re-push it
        browseTo(crumbPath);
      });
    }
    currentPathEl.appendChild(crumb);
  });
}

function createFolderItem(name, path, mediaCount, isRoot, capped) {
  const countText = mediaCount > 0 ? `${mediaCount}${capped ? "+" : ""} media` : "";
  const el = document.createElement("div");
  el.className = "file-item folder-item";
  el.innerHTML = `
    <span class="file-icon">${isRoot ? "\uD83D\uDCBE" : "\uD83D\uDCC1"}</span>
    <span class="file-name">${name}</span>
    ${countText ? `<span class="image-count">${countText}</span>` : ""}
    <span class="file-arrow">\u203A</span>
  `;
  onTap(el, () => browseTo(path));
  return el;
}


async function browseTo(path) {
  try {
    const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}&sort=${currentSort}`);
    if (!res.ok) return;
    const data = await res.json();

    navHistory.push(path);
    currentFolderPath = path;
    currentFolderData = data;

    folderSection.style.display = "block";
    searchSection.style.display = "block";
    searchInput.value = "";
    searchResults.innerHTML = "";
    renderBreadcrumbs(data.path);
    backBtn.style.display = "block";

    // Keep the current filter when navigating into subfolders
    filterButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.filter === currentFilter));

    renderFolderList(data);
  } catch (err) {
    console.error("Browse error:", err);
  }
}

function renderFolderList(data) {
  folderList.innerHTML = "";

  const hasSubfolders = data.folders.length > 0;
  const allMedia = data.media || [];
  const mediaList = currentFilter === "all" ? allMedia : allMedia.filter((m) => m.type === currentFilter);

  // Recursive scan button at the very top
  if (hasSubfolders) {
    const recursiveBtn = document.createElement("div");
    recursiveBtn.className = "view-all-btn recursive-btn";
    recursiveBtn.innerHTML = `<span>View all media including subfolders</span>`;
    onTap(recursiveBtn, () => loadFolderForViewing(currentFolderPath, 0, true));
    folderList.appendChild(recursiveBtn);
  }

  // View all media in this folder (excluding presentations — they open natively)
  const viewableMedia = mediaList.filter((m) => m.type !== "presentation");
  if (viewableMedia.length > 0) {
    const label = currentFilter === "all" ? "media" : currentFilter === "image" ? "photos" : currentFilter === "video" ? "videos" : "audio files";
    const viewAllBtn = document.createElement("div");
    viewAllBtn.className = "view-all-btn";
    viewAllBtn.innerHTML = `<span>View ${viewableMedia.length} ${label} in this folder</span>`;
    onTap(viewAllBtn, () => {
      if (currentFilter === "all") {
        loadFolderForViewing(currentFolderPath, 0, false);
      } else {
        loadFilteredForViewing(viewableMedia, 0);
      }
    });
    folderList.appendChild(viewAllBtn);
  }

  // Folders — filter by type when a filter is active
  data.folders.forEach((f) => {
    if (currentFilter === "all") {
      folderList.appendChild(createFolderItem(f.name, f.path, f.media_count, false, f.capped));
    } else {
      const count = (f.type_counts && f.type_counts[currentFilter]) || 0;
      if (count > 0) {
        folderList.appendChild(createFolderItem(f.name, f.path, count, false, f.capped));
      }
    }
  });

  // Media files
  if (mediaList.length > 0) {
    mediaList.forEach((item, i) => {
      const el = document.createElement("div");
      el.className = "file-item image-item";
      el.innerHTML = `
        <span class="file-icon">${getMediaIcon(item.type)}</span>
        <span class="file-name">${item.name}</span>
      `;
      onTap(el, () => {
        if (item.type === "presentation") {
          startPresentation(item);
        } else if (currentFilter === "all") {
          // Calculate index excluding presentations
          const nonPresMedia = allMedia.filter((m) => m.type !== "presentation");
          const idx = nonPresMedia.indexOf(item);
          loadFolderForViewing(currentFolderPath, idx >= 0 ? idx : 0);
        } else {
          loadFilteredForViewing(mediaList, i);
        }
      });
      folderList.appendChild(el);
    });
  }

  if (data.folders.length === 0 && mediaList.length === 0) {
    const msg = currentFilter === "all" ? "This folder is empty" : `No ${currentFilter === "image" ? "photos" : currentFilter === "video" ? "videos" : "audio files"} in this folder`;
    folderList.innerHTML = `<div class="empty-folder">${msg}</div>`;
  }
}

function loadFilteredForViewing(mediaList, startIndex) {
  images = mediaList;
  currentIndex = startIndex || 0;
  browserView.style.display = "none";
  photoView.style.display = "flex";
  backBtn.style.display = "none";
  hideCtrlMiniPlayer();
  currentScale = 1;
  panX = 0;
  panY = 0;
  currentRotation = 0;
  stopSlideshowUI();
  updatePhotoUI();
  renderThumbnails();
  socket.emit("load_search_results", { media: mediaList, index: startIndex || 0 });
}

function loadFolderForViewing(path, startIndex, recursive) {
  if (recursive) {
    loadingText.textContent = "Scanning subfolders...";
    loadingOverlay.style.display = "flex";
  }
  socket.emit("load_folder", { path: path, sort: currentSort, recursive: !!recursive });
  currentIndex = startIndex || 0;
}

// ─── Search ──────────────────────────────────────────────────────────────────

let searchTimeout = null;

searchClearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchResults.innerHTML = "";
  searchClearBtn.style.display = "none";
  clearTimeout(searchTimeout);
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();
  searchClearBtn.style.display = query.length > 0 ? "flex" : "none";
  if (query.length < 2) {
    searchResults.innerHTML = "";
    return;
  }
  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?path=${encodeURIComponent(currentFolderPath)}&q=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const data = await res.json();
      const mediaList = data.media || [];
      searchResults.innerHTML = "";
      if (mediaList.length === 0) {
        searchResults.innerHTML = '<div class="empty-folder">No media found</div>';
        return;
      }
      const viewResultsBtn = document.createElement("div");
      viewResultsBtn.className = "view-all-btn";
      viewResultsBtn.innerHTML = `<span>View all ${mediaList.length} results</span>`;
      onTap(viewResultsBtn, () => {
        // Load search results into viewer
        images = mediaList;
        currentIndex = 0;
        browserView.style.display = "none";
        photoView.style.display = "flex";
        backBtn.style.display = "none";
        hideCtrlMiniPlayer();
        currentScale = 1;
        panX = 0;
        panY = 0;
        currentRotation = 0;
        stopSlideshowUI();
        updatePhotoUI();
        renderThumbnails();
        socket.emit("load_search_results", { media: mediaList });
      });
      searchResults.appendChild(viewResultsBtn);
      mediaList.slice(0, 20).forEach((item, i) => {
        const el = document.createElement("div");
        el.className = "file-item image-item";
        el.innerHTML = `
          <span class="file-icon">${getMediaIcon(item.type)}</span>
          <span class="file-name">${item.name}</span>
        `;
        onTap(el, () => {
          images = mediaList;
          currentIndex = i;
          browserView.style.display = "none";
          photoView.style.display = "flex";
          backBtn.style.display = "none";
          hideCtrlMiniPlayer();
          currentScale = 1;
          panX = 0;
          panY = 0;
          currentRotation = 0;
          stopSlideshowUI();
          updatePhotoUI();
          renderThumbnails();
          socket.emit("load_search_results", { media: mediaList, index: i });
        });
        searchResults.appendChild(el);
      });
      if (mediaList.length > 20) {
        searchResults.innerHTML += `<div class="empty-folder">${mediaList.length - 20} more results...</div>`;
      }
    } catch (err) {
      console.error("Search error:", err);
    }
  }, 300);
});

// ─── Filter ─────────────────────────────────────────────────────────────────

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    filterButtons.forEach((b) => b.classList.toggle("active", b === btn));
    if (currentFolderData) {
      renderFolderList(currentFolderData);
    }
  });
});

// ─── Sort ────────────────────────────────────────────────────────────────────

sortSelect.addEventListener("change", () => {
  currentSort = sortSelect.value;
  if (currentFolderPath) {
    browseTo(currentFolderPath);
    // Pop the duplicate history entry since browseTo pushes
    if (navHistory.length > 1 && navHistory[navHistory.length - 1] === navHistory[navHistory.length - 2]) {
      navHistory.pop();
    }
  }
});

// ─── Back Button ─────────────────────────────────────────────────────────────

backBtn.addEventListener("click", () => {
  if (navHistory.length > 1) {
    navHistory.pop();
    const prev = navHistory.pop();
    browseTo(prev);
  } else {
    navHistory = [];
    folderSection.style.display = "none";
    searchSection.style.display = "none";
    backBtn.style.display = "none";
    currentFolderPath = null;
  }
});

browseBtn.addEventListener("click", () => {
  stopSlideshowUI();
  photoView.style.display = "none";
  browserView.style.display = "block";
  if (navHistory.length > 0) backBtn.style.display = "block";
  showCtrlMiniPlayerIfNeeded();
});

// ─── Socket Events ───────────────────────────────────────────────────────────

socket.on("folder_loaded", (data) => {
  loadingOverlay.style.display = "none";
  images = data.media || [];
  if (images.length === 0) {
    loadingText.textContent = "No media found";
    loadingOverlay.style.display = "flex";
    setTimeout(() => { loadingOverlay.style.display = "none"; }, 1500);
    return;
  }

  // Switch to photo view
  browserView.style.display = "none";
  photoView.style.display = "flex";
  backBtn.style.display = "none";
  hideCtrlMiniPlayer();

  currentScale = 1;
  panX = 0;
  panY = 0;
  currentRotation = 0;
  stopSlideshowUI();

  updatePhotoUI();
  renderThumbnails();

  socket.emit("goto_photo", { index: currentIndex });
});

function toggleControlsForMediaType() {
  const item = images[currentIndex];
  currentMediaType = (item && item.type) || "image";

  if (currentMediaType === "image") {
    zoomControls.style.display = "flex";
    slideshowControls.style.display = "flex";
    mediaControls.style.display = "none";
    mediaIsActive = false;
  } else {
    zoomControls.style.display = "none";
    slideshowControls.style.display = "none";
    mediaControls.style.display = "flex";
    mediaIsActive = true;
    // Reset media controls state
    isPlaying = false;
    playPauseBtn.textContent = "\u25B6";
    mediaSeekBar.value = 0;
    mediaCurrentTime.textContent = "0:00";
    mediaDuration.textContent = "0:00";
    // Set mini player title
    cmpTitle.textContent = item.name;
  }
}

function updatePhotoUI() {
  photoCounter.textContent = `${currentIndex + 1} / ${images.length}`;
  currentPhotoName.textContent = images[currentIndex]?.name || "";
  zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;

  toggleControlsForMediaType();

  document.querySelectorAll(".thumb-item").forEach((el, i) => {
    el.classList.toggle("active", i === currentIndex);
  });

  const activeThumb = document.querySelector(".thumb-item.active");
  if (activeThumb) {
    activeThumb.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

function renderThumbnails() {
  thumbnailStrip.innerHTML = "";
  images.forEach((item, i) => {
    const thumb = document.createElement("div");
    thumb.className = `thumb-item ${i === currentIndex ? "active" : ""}`;
    if (item.type === "image") {
      thumb.innerHTML = `<img src="/api/thumbnail?path=${encodeURIComponent(item.path)}" alt="${item.name}" loading="lazy">`;
    } else {
      thumb.innerHTML = `<div class="thumb-media-icon">${getMediaIcon(item.type)}</div>`;
    }
    onTap(thumb, () => {
      currentIndex = i;
      currentScale = 1;
      panX = 0;
      panY = 0;
      currentRotation = 0;
      socket.emit("goto_photo", { index: i });
      updatePhotoUI();
    });
    thumbnailStrip.appendChild(thumb);
  });
}

// ─── Media Control Handlers ──────────────────────────────────────────────────

playPauseBtn.addEventListener("click", () => {
  if (isPlaying) {
    socket.emit("media_pause");
    isPlaying = false;
    playPauseBtn.textContent = "\u25B6";
  } else {
    socket.emit("media_play");
    isPlaying = true;
    playPauseBtn.textContent = "\u23F8";
  }
});

skipBackBtn.addEventListener("click", () => {
  socket.emit("media_seek", { time: Math.max(0, currentTimeVal - 10) });
});

skipForwardBtn.addEventListener("click", () => {
  socket.emit("media_seek", { time: Math.min(mediaDurationVal, currentTimeVal + 10) });
});

muteBtn.addEventListener("click", () => {
  socket.emit("media_mute");
  isMuted = !isMuted;
  muteBtn.textContent = isMuted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
});

volumeSlider.addEventListener("input", () => {
  socket.emit("media_volume", { level: volumeSlider.value / 100 });
});

mediaSeekBar.addEventListener("mousedown", () => { isSeeking = true; });
mediaSeekBar.addEventListener("touchstart", () => { isSeeking = true; }, { passive: true });
mediaSeekBar.addEventListener("mouseup", () => { isSeeking = false; });
mediaSeekBar.addEventListener("touchend", () => { isSeeking = false; });

mediaSeekBar.addEventListener("input", () => {
  socket.emit("media_seek", { time: (mediaSeekBar.value / 100) * mediaDurationVal });
});

// ─── Media Sync Socket Listeners ─────────────────────────────────────────────

socket.on("media_sync", (data) => {
  currentTimeVal = data.currentTime;
  mediaDurationVal = data.duration;
  isPlaying = !data.paused;
  playPauseBtn.textContent = isPlaying ? "\u23F8" : "\u25B6";
  mediaCurrentTime.textContent = formatTime(data.currentTime);
  mediaDuration.textContent = formatTime(data.duration);
  if (!isSeeking) {
    mediaSeekBar.value = data.duration ? (data.currentTime / data.duration) * 100 : 0;
  }
  // Update controller mini player
  updateCtrlMiniPlayer(data.currentTime, data.duration, !data.paused);
});

socket.on("media_ready", (data) => {
  mediaDurationVal = data.duration;
  mediaDuration.textContent = formatTime(data.duration);
  toggleControlsForMediaType();
});

socket.on("media_ended", () => {
  isPlaying = false;
  playPauseBtn.textContent = "\u25B6";
  mediaSeekBar.value = 0;
  mediaCurrentTime.textContent = "0:00";
  mediaIsActive = false;
  hideCtrlMiniPlayer();
});

socket.on("playback_blocked", () => {
  showToast("Tap the laptop screen once to enable playback", 6000);
});

// ─── Gesture State ───────────────────────────────────────────────────────────

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let isSwiping = false;
let isPinching = false;
let isPanning = false;
let initialPinchDist = 0;
let initialScale = 1;
let lastPanX = 0;
let lastPanY = 0;
let lastTapTime = 0;
let lastTapX = 0;
let longPressTimer = null;
let longPressTriggered = false;
let singleTapTimer = null;

// Media gesture state
let isVolumeGesture = false;
let isScrubbing = false;
let volumeStartY = 0;
let volumeStartLevel = 100;
let scrubStartTime = 0;

// Overlay elements
const volumeOverlay = document.getElementById("volume-overlay");
const volumeOverlayIcon = document.getElementById("volume-overlay-icon");
const volumeOverlayFill = document.getElementById("volume-overlay-fill");
const volumeOverlayText = document.getElementById("volume-overlay-text");
const scrubOverlay = document.getElementById("scrub-overlay");
const scrubOverlayTime = document.getElementById("scrub-overlay-time");

let volumeHideTimer = null;

function showVolumeOverlay(level) {
  clearTimeout(volumeHideTimer);
  volumeOverlayFill.style.width = `${level}%`;
  volumeOverlayText.textContent = `${Math.round(level)}%`;
  volumeOverlayIcon.innerHTML = level === 0 ? "&#128263;" : "&#128266;";
  volumeOverlay.style.display = "flex";
}

function hideVolumeOverlay() {
  volumeHideTimer = setTimeout(() => { volumeOverlay.style.display = "none"; }, 600);
}

function showScrubOverlay(time) {
  scrubOverlayTime.textContent = formatTime(time);
  scrubOverlay.style.display = "block";
}

function hideScrubOverlay() {
  scrubOverlay.style.display = "none";
}

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

let lastEmitTime = 0;
function throttledEmit(event, data) {
  const now = Date.now();
  if (now - lastEmitTime > 30) {
    socket.emit(event, data);
    lastEmitTime = now;
  }
}

function resetView() {
  currentScale = 1;
  panX = 0;
  panY = 0;
  currentRotation = 0;
}

// ─── Touch Handlers ──────────────────────────────────────────────────────────

swipeArea.addEventListener("touchstart", (e) => {
  longPressTriggered = false;
  isVolumeGesture = false;
  isScrubbing = false;

  if (e.touches.length === 3) {
    // Three-finger tap → toggle photo info
    socket.emit("toggle_info");
    return;
  }

  if (e.touches.length === 2) {
    // Pinch to zoom (images only)
    clearTimeout(longPressTimer);
    if (currentMediaType === "image") {
      isPinching = true;
      isSwiping = false;
      initialPinchDist = getTouchDist(e.touches);
      initialScale = currentScale;
    }
  } else if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();

    if (currentMediaType === "image") {
      // Long press detection (500ms) — toggle slideshow
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        if (slideshowActive) {
          stopSlideshowUI();
          socket.emit("slideshow_stop");
        } else {
          slideshowActive = true;
          slideshowBtn.textContent = "Stop";
          slideshowBtn.classList.add("active");
          socket.emit("slideshow_start", { interval: slideshowInterval });
        }
        if (navigator.vibrate) navigator.vibrate(50);
      }, 500);

      if (currentScale > 1) {
        isPanning = true;
        lastPanX = panX;
        lastPanY = panY;
      } else {
        isSwiping = true;
      }
    } else {
      // Video/audio: long press → enter scrub mode
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        isScrubbing = true;
        scrubStartTime = currentTimeVal;
        showScrubOverlay(currentTimeVal);
        if (navigator.vibrate) navigator.vibrate(50);
      }, 500);
      isSwiping = true;
    }
  }
}, { passive: true });

swipeArea.addEventListener("touchmove", (e) => {
  if (e.touches.length !== 1) {
    // Multi-touch: handle pinch for images
    if (isPinching && e.touches.length === 2) {
      clearTimeout(longPressTimer);
      const dist = getTouchDist(e.touches);
      const ratio = dist / initialPinchDist;
      currentScale = Math.max(1, Math.min(5, initialScale * ratio));
      zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
      throttledEmit("zoom_change", { scale: currentScale });
      if (currentScale <= 1) {
        panX = 0;
        panY = 0;
        throttledEmit("pan_change", { x: 0, y: 0 });
      }
    }
    return;
  }

  const curX = e.touches[0].clientX;
  const curY = e.touches[0].clientY;
  const dx = curX - touchStartX;
  const dy = curY - touchStartY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Cancel long press if finger moves significantly
  if (absDx > 10 || absDy > 10) {
    if (!isScrubbing) clearTimeout(longPressTimer);
  }

  // Scrub mode (media long press + drag horizontally)
  if (isScrubbing && currentMediaType !== "image") {
    const scrubSensitivity = mediaDurationVal / window.innerWidth;
    const newTime = Math.max(0, Math.min(mediaDurationVal, scrubStartTime + dx * scrubSensitivity));
    currentTimeVal = newTime;
    showScrubOverlay(newTime);
    throttledEmit("media_seek", { time: newTime });
    return;
  }

  // Volume gesture: vertical swipe on right half of screen (media only)
  if (currentMediaType !== "image" && !isVolumeGesture && !isPanning && absDy > 30 && absDy > absDx * 2 && touchStartX > window.innerWidth * 0.5) {
    isVolumeGesture = true;
    isSwiping = false;
    volumeStartY = curY;
    volumeStartLevel = volumeSlider.value;
    clearTimeout(longPressTimer);
  }

  if (isVolumeGesture) {
    const deltaY = volumeStartY - curY;
    const sensitivity = 0.5; // 0.5% per pixel
    let newLevel = Math.max(0, Math.min(100, parseFloat(volumeStartLevel) + deltaY * sensitivity));
    volumeSlider.value = newLevel;
    showVolumeOverlay(newLevel);
    throttledEmit("media_volume", { level: newLevel / 100 });
    return;
  }

  // Image panning (when zoomed)
  if (isPanning && currentMediaType === "image") {
    panX = lastPanX + dx;
    panY = lastPanY + dy;
    throttledEmit("pan_change", { x: panX, y: panY });
  }
}, { passive: true });

swipeArea.addEventListener("touchend", (e) => {
  clearTimeout(longPressTimer);

  // End scrub mode
  if (isScrubbing) {
    isScrubbing = false;
    hideScrubOverlay();
    longPressTriggered = false;
    isPinching = false;
    isSwiping = false;
    isPanning = false;
    return;
  }

  // End volume gesture
  if (isVolumeGesture) {
    isVolumeGesture = false;
    hideVolumeOverlay();
    return;
  }

  if (longPressTriggered) {
    longPressTriggered = false;
    isPinching = false;
    isSwiping = false;
    isPanning = false;
    return;
  }

  if (isPinching) {
    isPinching = false;
    socket.emit("zoom_change", { scale: currentScale });
    return;
  }

  if (isPanning) {
    isPanning = false;
    socket.emit("pan_change", { x: panX, y: panY });
    return;
  }

  if (!isSwiping) return;
  isSwiping = false;

  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;
  const diffX = touchEndX - touchStartX;
  const diffY = touchEndY - touchStartY;
  const elapsed = Date.now() - touchStartTime;
  const absX = Math.abs(diffX);
  const absY = Math.abs(diffY);
  const isTap = absX < 10 && absY < 10 && elapsed < 300;

  // ── Image: double-tap for quick zoom toggle ──
  if (currentMediaType === "image" && isTap) {
    const now = Date.now();
    if (now - lastTapTime < 350) {
      clearTimeout(singleTapTimer);
      if (currentScale > 1) {
        resetView();
        zoomLevelEl.textContent = "100%";
        socket.emit("reset_view");
      } else {
        currentScale = 2;
        zoomLevelEl.textContent = "200%";
        socket.emit("zoom_change", { scale: 2 });
      }
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;
  }

  // ── Media: tap / double-tap detection ──
  if (currentMediaType !== "image" && isTap) {
    const now = Date.now();
    if (now - lastTapTime < 350) {
      // Double tap! Check left vs right half
      clearTimeout(singleTapTimer);
      const screenW = window.innerWidth;
      if (lastTapX < screenW * 0.4) {
        // Double-tap left → skip back 10s
        const newTime = Math.max(0, currentTimeVal - 10);
        socket.emit("media_seek", { time: newTime });
        currentTimeVal = newTime;
        mediaCurrentTime.textContent = formatTime(newTime);
      } else if (lastTapX > screenW * 0.6) {
        // Double-tap right → skip forward 10s
        const newTime = Math.min(mediaDurationVal, currentTimeVal + 10);
        socket.emit("media_seek", { time: newTime });
        currentTimeVal = newTime;
        mediaCurrentTime.textContent = formatTime(newTime);
      }
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;
    lastTapX = touchEndX;
    // Delay single tap to wait for possible double tap
    singleTapTimer = setTimeout(() => {
      // Single tap → play/pause toggle
      if (isPlaying) {
        socket.emit("media_pause");
        isPlaying = false;
        playPauseBtn.textContent = "\u25B6";
      } else {
        socket.emit("media_play");
        isPlaying = true;
        playPauseBtn.textContent = "\u23F8";
      }
    }, 350);
    return;
  }

  // ── Common swipe gestures ──
  if (elapsed < 500) {
    // Swipe down → back to folder browser
    if (absY > 80 && absY > absX * 1.5 && diffY > 0) {
      stopSlideshowUI();
      socket.emit("slideshow_stop");
      photoView.style.display = "none";
      browserView.style.display = "block";
      if (navHistory.length > 0) backBtn.style.display = "block";
      showCtrlMiniPlayerIfNeeded();
      return;
    }

    // Swipe left/right → next/prev media
    if (absX > 50 && absX > absY) {
      if (diffX < 0 && currentIndex < images.length - 1) {
        currentIndex++;
        resetView();
        socket.emit("next_photo");
        updatePhotoUI();
      } else if (diffX > 0 && currentIndex > 0) {
        currentIndex--;
        resetView();
        socket.emit("prev_photo");
        updatePhotoUI();
      }
    }
  }
}, { passive: true });

// ─── Zoom Buttons ────────────────────────────────────────────────────────────

zoomInBtn.addEventListener("click", () => {
  currentScale = Math.min(5, currentScale + 0.25);
  zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
  socket.emit("zoom_change", { scale: currentScale });
});

zoomOutBtn.addEventListener("click", () => {
  currentScale = Math.max(1, currentScale - 0.25);
  if (currentScale <= 1) {
    panX = 0;
    panY = 0;
    socket.emit("pan_change", { x: 0, y: 0 });
  }
  zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
  socket.emit("zoom_change", { scale: currentScale });
});

zoomResetBtn.addEventListener("click", () => {
  currentScale = 1;
  panX = 0;
  panY = 0;
  currentRotation = 0;
  zoomLevelEl.textContent = "100%";
  socket.emit("reset_view");
});

// ─── Rotate Button ───────────────────────────────────────────────────────────

rotateBtn.addEventListener("click", () => {
  currentRotation = (currentRotation + 90) % 360;
  socket.emit("rotate_photo", { angle: currentRotation });
});

// ─── Slideshow ───────────────────────────────────────────────────────────────

slideshowBtn.addEventListener("click", () => {
  if (slideshowActive) {
    stopSlideshowUI();
    socket.emit("slideshow_stop");
  } else {
    slideshowOptions.style.display = slideshowOptions.style.display === "flex" ? "none" : "flex";
  }
});

function stopSlideshowUI() {
  slideshowActive = false;
  slideshowBtn.textContent = "Slideshow";
  slideshowBtn.classList.remove("active");
  slideshowOptions.style.display = "none";
}

document.querySelectorAll(".slideshow-interval-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    slideshowInterval = parseInt(btn.dataset.interval);
    slideshowActive = true;
    slideshowBtn.textContent = "Stop";
    slideshowBtn.classList.add("active");
    slideshowOptions.style.display = "none";
    socket.emit("slideshow_start", { interval: slideshowInterval });
  });
});

// Auto-advance on controller side too during slideshow
socket.on("start_slideshow", () => {
  slideshowActive = true;
  slideshowBtn.textContent = "Stop";
  slideshowBtn.classList.add("active");
});

socket.on("stop_slideshow", () => {
  stopSlideshowUI();
});

// Keep controller in sync when slideshow advances or photo changes
socket.on("show_photo", (data) => {
  currentIndex = data.index;
  currentScale = 1;
  panX = 0;
  panY = 0;
  currentRotation = 0;
  updatePhotoUI();
});

socket.on("slideshow_sync", (data) => {
  currentIndex = data.index;
  currentScale = 1;
  panX = 0;
  panY = 0;
  currentRotation = 0;
  updatePhotoUI();
});

// ─── Shuffle ─────────────────────────────────────────────────────────────────

shuffleBtn.addEventListener("click", () => {
  if (images.length === 0) return;
  isShuffled = !isShuffled;
  shuffleBtn.classList.toggle("active", isShuffled);

  if (isShuffled) {
    // Send media to server to shuffle and broadcast
    socket.emit("shuffle_photos", { media: images });
  } else {
    // Re-load the folder in original order
    if (currentFolderPath) {
      socket.emit("load_folder", { path: currentFolderPath, sort: currentSort, recursive: false });
      currentIndex = 0;
    }
  }
});

// ─── Gesture Guide ──────────────────────────────────────────────────────────

const gestureGuide = document.getElementById("gesture-guide");
const helpBtn = document.getElementById("help-btn");
const guideCloseBtn = document.getElementById("guide-close-btn");

function showGuide() {
  gestureGuide.style.display = "flex";
}

function hideGuide() {
  gestureGuide.style.display = "none";
  localStorage.setItem("iyakku_guide_seen", "1");
}

helpBtn.addEventListener("click", showGuide);
guideCloseBtn.addEventListener("click", hideGuide);

gestureGuide.addEventListener("click", (e) => {
  if (e.target === gestureGuide) hideGuide();
});

// Auto-show on first visit
if (!localStorage.getItem("iyakku_guide_seen")) {
  setTimeout(showGuide, 600);
}

// ─── Controller Mini Player ─────────────────────────────────────────────────

function showCtrlMiniPlayerIfNeeded() {
  if (mediaIsActive && currentMediaType !== "image") {
    ctrlMiniPlayer.style.display = "flex";
    document.body.classList.add("has-ctrl-mini-player");
    cmpPlay.textContent = isPlaying ? "\u23F8" : "\u25B6";
    cmpTime.textContent = formatTime(currentTimeVal);
    cmpDuration.textContent = formatTime(mediaDurationVal);
    if (mediaDurationVal > 0) {
      cmpProgressFill.style.width = `${(currentTimeVal / mediaDurationVal) * 100}%`;
    }
  }
}

function hideCtrlMiniPlayer() {
  ctrlMiniPlayer.style.display = "none";
  document.body.classList.remove("has-ctrl-mini-player");
}

function updateCtrlMiniPlayer(time, duration, playing) {
  if (ctrlMiniPlayer.style.display === "none") return;
  cmpPlay.textContent = playing ? "\u23F8" : "\u25B6";
  cmpTime.textContent = formatTime(time);
  cmpDuration.textContent = formatTime(duration);
  if (duration > 0) {
    cmpProgressFill.style.width = `${(time / duration) * 100}%`;
  }
}

// Play/pause from mini player
onTap(cmpPlay, () => {
  if (isPlaying) {
    socket.emit("media_pause");
    isPlaying = false;
    playPauseBtn.textContent = "\u25B6";
    cmpPlay.textContent = "\u25B6";
  } else {
    socket.emit("media_play");
    isPlaying = true;
    playPauseBtn.textContent = "\u23F8";
    cmpPlay.textContent = "\u23F8";
  }
});

// Expand → go back to full media controls
onTap(cmpExpand, () => {
  hideCtrlMiniPlayer();
  browserView.style.display = "none";
  photoView.style.display = "flex";
  backBtn.style.display = "none";
  updatePhotoUI();
});

// ─── Presentation Controls ──────────────────────────────────────────────────

function startPresentation(item) {
  presentationActive = true;
  presFileName.textContent = item.name;
  browserView.style.display = "none";
  photoView.style.display = "none";
  presentationView.style.display = "flex";
  backBtn.style.display = "none";
  hideCtrlMiniPlayer();
  socket.emit("presentation_start", { path: item.path });
}

function exitPresentation() {
  presentationActive = false;
  socket.emit("presentation_exit");
  presentationView.style.display = "none";
  browserView.style.display = "block";
  showCtrlMiniPlayerIfNeeded();
}

presPrevBtn.addEventListener("click", () => {
  if (presentationActive) socket.emit("presentation_prev");
});

presNextBtn.addEventListener("click", () => {
  if (presentationActive) socket.emit("presentation_next");
});

presExitBtn.addEventListener("click", exitPresentation);

// Swipe, scroll & pinch gestures on presentation view
let presTouchStartX = 0;
let presTouchStartY = 0;
let presTouchStartTime = 0;
let presGestureMode = "none"; // "none" | "pinch" | "scroll" | "swipe"
let presInitialPinchDist = 0;
let presLastPinchDist = 0;
let presLastY = 0;
let presLastEmitTime = 0;
let presAccumulatedScroll = 0;
let presCooldownUntil = 0; // timestamp — block all gestures until this time

presSwipeArea.addEventListener("touchstart", (e) => {
  if (Date.now() < presCooldownUntil) return;

  if (e.touches.length === 2) {
    presGestureMode = "pinch";
    presInitialPinchDist = getTouchDist(e.touches);
    presLastPinchDist = presInitialPinchDist;
  } else if (e.touches.length === 1 && presGestureMode === "none") {
    presTouchStartX = e.touches[0].clientX;
    presTouchStartY = e.touches[0].clientY;
    presLastY = e.touches[0].clientY;
    presAccumulatedScroll = 0;
    presTouchStartTime = Date.now();
  }
}, { passive: true });

presSwipeArea.addEventListener("touchmove", (e) => {
  if (Date.now() < presCooldownUntil) return;

  if (presGestureMode === "pinch" && e.touches.length === 2) {
    presLastPinchDist = getTouchDist(e.touches);
    return;
  }

  if (presGestureMode === "pinch" || e.touches.length !== 1) return;

  const curX = e.touches[0].clientX;
  const curY = e.touches[0].clientY;
  const absDx = Math.abs(curX - presTouchStartX);
  const absDy = Math.abs(curY - presTouchStartY);

  if (presGestureMode === "none" && (absDx > 15 || absDy > 15)) {
    presGestureMode = (absDy > absDx * 1.5) ? "scroll" : "swipe";
  }

  if (presGestureMode === "scroll") {
    const deltaY = presLastY - curY;
    presLastY = curY;
    presAccumulatedScroll += deltaY;
    // Only emit when enough finger movement has accumulated (~60px)
    if (Math.abs(presAccumulatedScroll) > 60) {
      const direction = presAccumulatedScroll > 0 ? 1 : -1;
      socket.emit("presentation_scroll", { clicks: direction });
      presAccumulatedScroll = 0;
    }
  }
}, { passive: true });

presSwipeArea.addEventListener("touchend", (e) => {
  if (Date.now() < presCooldownUntil) {
    if (e.touches.length === 0) presCooldownUntil = 0;
    return;
  }

  if (presGestureMode === "pinch") {
    if (e.touches.length === 0) {
      const ratio = presLastPinchDist / presInitialPinchDist;
      if (ratio > 1.15) {
        socket.emit("presentation_zoom", { direction: "in" });
      } else if (ratio < 0.85) {
        socket.emit("presentation_zoom", { direction: "out" });
      }
      presCooldownUntil = Date.now() + 300;
      presGestureMode = "none";
    }
    return;
  }

  if (presGestureMode === "scroll") {
    if (presAccumulatedScroll !== 0) {
      const clicks = Math.round(presAccumulatedScroll / 5);
      if (clicks !== 0) socket.emit("presentation_scroll", { clicks: clicks });
      presAccumulatedScroll = 0;
    }
    presGestureMode = "none";
    return;
  }

  if (e.touches.length === 0) {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - presTouchStartX;
    const absX = Math.abs(diffX);
    const absY = Math.abs(touchEndY - presTouchStartY);
    const elapsed = Date.now() - presTouchStartTime;

    if (elapsed < 500 && absX > 50 && absX > absY) {
      if (diffX < 0) {
        socket.emit("presentation_next");
      } else {
        socket.emit("presentation_prev");
      }
    }
    presGestureMode = "none";
  }
}, { passive: true });

presSwipeArea.addEventListener("touchcancel", () => {
  presGestureMode = "none";
  presAccumulatedScroll = 0;
  presCooldownUntil = 0;
}, { passive: true });

// Presentation socket listeners
socket.on("presentation_started", (data) => {
  presentationActive = true;
  presFileName.textContent = data.name;
  showToast("Presentation started: " + data.name, 3000);
});

socket.on("presentation_ended", () => {
  presentationActive = false;
  if (presentationView.style.display !== "none") {
    presentationView.style.display = "none";
    browserView.style.display = "block";
    showCtrlMiniPlayerIfNeeded();
  }
});

socket.on("presentation_error", (data) => {
  presentationActive = false;
  presentationView.style.display = "none";
  browserView.style.display = "block";
  showToast("Presentation error: " + data.error, 5000);
});

// ─── PIN & Auth ─────────────────────────────────────────────────────────────

const pinScreen = document.getElementById("pin-screen");
const pinSetupScreen = document.getElementById("pin-setup-screen");
const pinError = document.getElementById("pin-error");
const pinLocked = document.getElementById("pin-locked");
const setupStep1 = document.getElementById("setup-step-1");
const setupStep2 = document.getElementById("setup-step-2");
const setupMismatch = document.getElementById("setup-mismatch");

const pinDigits = [
  document.getElementById("pin-1"),
  document.getElementById("pin-2"),
  document.getElementById("pin-3"),
  document.getElementById("pin-4"),
];
const setupDigits1 = Array.from(document.querySelectorAll(".setup-pin-1"));
const setupDigits2 = Array.from(document.querySelectorAll(".setup-pin-2"));

let authenticated = false;
let setupPin1Value = "";

function getSavedPin() {
  return localStorage.getItem("iyakku_pin") || "";
}

function savePin(pin) {
  localStorage.setItem("iyakku_pin", pin);
}

function hideAllScreens() {
  pinScreen.style.display = "none";
  pinSetupScreen.style.display = "none";
  browserView.style.display = "none";
  photoView.style.display = "none";
  presentationView.style.display = "none";
}

// ── PIN Entry (returning user) ──

function showPinScreen() {
  hideAllScreens();
  pinScreen.style.display = "flex";
  pinError.style.display = "none";
  pinLocked.style.display = "none";
  pinDigits.forEach((d) => { d.value = ""; });
  pinDigits[0].focus();
}

function getPinValue() {
  return pinDigits.map((d) => d.value).join("");
}

function wireDigits(digits, onComplete) {
  digits.forEach((input, i) => {
    input.addEventListener("input", () => {
      if (input.value.length === 1) {
        if (i < 3) {
          digits[i + 1].focus();
        } else {
          input.blur();
          onComplete();
        }
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && input.value === "" && i > 0) {
        digits[i - 1].focus();
      }
    });
  });
}

// Wire PIN entry digits — auto-submit on last digit
wireDigits(pinDigits, () => {
  socket.emit("register_controller", { pin: getPinValue() });
});

// ── PIN Setup (first time) ──

function showSetupScreen() {
  hideAllScreens();
  pinSetupScreen.style.display = "flex";
  setupStep1.style.display = "block";
  setupStep2.style.display = "none";
  setupMismatch.style.display = "none";
  setupPin1Value = "";
  setupDigits1.forEach((d) => { d.value = ""; });
  setupDigits2.forEach((d) => { d.value = ""; });
  setupDigits1[0].focus();
}

// Step 1: enter PIN
wireDigits(setupDigits1, () => {
  setupPin1Value = setupDigits1.map((d) => d.value).join("");
  setupStep1.style.display = "none";
  setupStep2.style.display = "block";
  setupMismatch.style.display = "none";
  setupDigits2.forEach((d) => { d.value = ""; });
  setupDigits2[0].focus();
});

// Step 2: confirm PIN
wireDigits(setupDigits2, () => {
  const confirm = setupDigits2.map((d) => d.value).join("");
  if (confirm === setupPin1Value) {
    // Match — submit to server
    socket.emit("setup_pin", { pin: setupPin1Value });
  } else {
    // Mismatch — restart
    setupMismatch.style.display = "block";
    if (navigator.vibrate) navigator.vibrate(100);
    setTimeout(() => {
      setupStep2.style.display = "none";
      setupStep1.style.display = "block";
      setupMismatch.style.display = "none";
      setupPin1Value = "";
      setupDigits1.forEach((d) => { d.value = ""; });
      setupDigits1[0].focus();
    }, 1200);
  }
});

// ── Auth Responses ──

socket.on("auth_status", (data) => {
  if (data.pin_set) {
    // PIN exists — try saved PIN or show entry screen
    const savedPin = getSavedPin();
    if (savedPin) {
      socket.emit("register_controller", { pin: savedPin });
    } else {
      showPinScreen();
    }
  } else {
    // No PIN set yet — show setup screen
    showSetupScreen();
  }
});

socket.on("auth_success", () => {
  authenticated = true;
  // Save whichever PIN was used (entry or setup)
  const enteredPin = getPinValue() || setupPin1Value || getSavedPin();
  if (enteredPin) savePin(enteredPin);
  hideAllScreens();
  browserView.style.display = "block";
});

socket.on("auth_failed", (data) => {
  if (data.reason === "already_connected") {
    hideAllScreens();
    pinScreen.style.display = "flex";
    pinError.style.display = "none";
    pinLocked.style.display = "block";
    pinDigits.forEach((d) => { d.value = ""; });
  } else if (data.reason === "invalid_pin" || data.reason === "no_pin_set") {
    // Saved PIN was wrong or PIN was reset — show entry/setup
    if (data.reason === "no_pin_set") {
      showSetupScreen();
    } else {
      showPinScreen();
      pinError.style.display = "block";
      if (navigator.vibrate) navigator.vibrate(100);
    }
  }
});

// ─── Init ───────────────────────────────────────────────────────────────────

socket.on("connect", () => {
  // Ask server if PIN is set up
  socket.emit("check_auth");
});

init();
