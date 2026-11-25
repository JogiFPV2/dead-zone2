/** Polish labels of the farming entries of the furniture menu (`farming/menu.ts` in the sim). */
export const FARM_ACTIONS_PL = {
  dig: 'Przekop ziemię',
  plant: 'Posadź',
  water: 'Podlej',
  harvest: 'Zbierz plony',
  'clear-plot': 'Usuń uschniętą roślinę',
  'fill-vessel': 'Napełnij naczynie',
} as const satisfies Record<string, string>;

/** Type names: a dug plot and diggable soil. */
export const FARM_TYPES_PL = { plot: 'Grządka', soil: 'Ziemia' } as const satisfies Record<
  string,
  string
>;
