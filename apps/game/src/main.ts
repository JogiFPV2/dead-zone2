// Dev-only `?assettest=1`: asset pipeline test page instead of the game (stripped from prod).
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('assettest')) {
  await import('./dev/asset-test.js');
} else {
  await import('./game.js');
}

export {};
