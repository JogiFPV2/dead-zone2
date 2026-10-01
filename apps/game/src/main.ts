const search = window.location.search;
// Dev-only `?assettest=1`: asset pipeline test page instead of the game (stripped from prod).
if (import.meta.env.DEV && new URLSearchParams(search).has('assettest')) {
  await import('./dev/asset-test.js');
} else {
  const { shouldShowMenu, runMenu } = await import('./menu/boot-menu.js');
  const root = document.getElementById('app');
  if (root && shouldShowMenu(search)) await runMenu(root);
  await import('./game.js');
}

export {};
