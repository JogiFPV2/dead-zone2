const search = window.location.search;
// Dev-only `?assettest=1`: asset pipeline test page instead of the game (stripped from prod).
if (import.meta.env.DEV && new URLSearchParams(search).has('assettest')) {
  await import('./dev/asset-test.js');
} else {
  const { shouldShowMenu, runMenu } = await import('./menu/boot-menu.js');
  const { setNewCharacter } = await import('./session.js');
  const root = document.getElementById('app');
  const q = new URLSearchParams(search);
  if (root && q.get('creator') === '1') {
    // `?creator=1&step=N`: the creator straight away (also in the public build, for review).
    const { runCreator } = await import('./creator/run-creator.js');
    const step = Number(q.get('step') ?? 0);
    setNewCharacter(await runCreator({ root, modeLabel: 'Przetrwaj', step }));
  } else if (root && shouldShowMenu(search)) {
    setNewCharacter((await runMenu(root)).character);
  }
  await import('./game.js');
}

export {};
