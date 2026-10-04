import names from '../../../../packages/content/data/base/i18n/pl.json';

const ITEMS: Readonly<Record<string, string>> = names.items;

/** Polish display name shipped with the base content pack. */
export const polishItemName = (id: string): string | undefined => ITEMS[id];
