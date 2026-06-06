/*
 * SkyWatch audio alerts — shared across pages.
 *
 * Toggles are configured on the Alerts page and persisted in localStorage.
 * Sounds actually FIRE on the Radar page, where live proximity events happen.
 *
 * To add your own sound: drop a file into site/audio/ (see audio/README.md).
 * Defaults below look for per-type clips, falling back to audio/alert.mp3.
 */
(function () {
  "use strict";

  const KEYS = {
    proximity: "sw_audio_proximity", // aircraft enters CRITICAL range
    collision: "sw_audio_collision", // aircraft enters WARNING (advisory) range
    overload: "sw_audio_overload",   // feed error / rate-limit (sensor trouble)
  };

  // Drop-in clips. If a specific file is missing, falls back to alert.mp3.
  const CLIPS = {
    proximity: "audio/proximity.mp3",
    collision: "audio/collision.mp3",
    overload: "audio/overload.mp3",
    default: "audio/alert.mp3",
  };

  const cache = {};
  let primed = false;

  function isEnabled(type) {
    return localStorage.getItem(KEYS[type]) === "1";
  }

  function setEnabled(type, on) {
    localStorage.setItem(KEYS[type], on ? "1" : "0");
  }

  function getAudio(type) {
    if (!cache[type]) {
      const a = new Audio(CLIPS[type] || CLIPS.default);
      a.preload = "auto";
      // If the per-type clip 404s, retry once with the shared default.
      a.addEventListener(
        "error",
        () => {
          if (a.src.indexOf(CLIPS.default) === -1) a.src = CLIPS.default;
        },
        { once: true }
      );
      cache[type] = a;
    }
    return cache[type];
  }

  function playRaw(type) {
    try {
      const a = getAudio(type);
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {}); // ignore autoplay / missing-file errors
    } catch (_) {
      /* no-op */
    }
  }

  // Fires only if the toggle is on. Used by the live radar feed.
  function play(type) {
    if (!isEnabled(type)) return;
    playRaw(type);
  }

  // Always plays (used as immediate feedback when a toggle is switched on,
  // which happens inside a user gesture so the browser permits it).
  function preview(type) {
    playRaw(type);
  }

  // Browsers block audio until the user has interacted with the page. Warm the
  // clips on the first interaction so later event-driven plays succeed.
  function prime() {
    if (primed) return;
    primed = true;
    Object.keys(KEYS).forEach((t) => getAudio(t).load());
  }

  const onFirstGesture = () => {
    prime();
    window.removeEventListener("pointerdown", onFirstGesture);
    window.removeEventListener("keydown", onFirstGesture);
  };
  window.addEventListener("pointerdown", onFirstGesture);
  window.addEventListener("keydown", onFirstGesture);

  window.SkyWatchAudio = { KEYS, isEnabled, setEnabled, play, preview, prime };
})();
