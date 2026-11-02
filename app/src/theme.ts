// Taken from the supplied RevoV screens.
export const c = {
  bg: '#F3F6FC', card: '#FFFFFF', border: '#E2E9F5', primary: '#0B5FFF', primarySoft: '#E8F0FF',
  navy: '#0B1B4D', muted: '#6B7A99', green: '#1B9E4B', greenSoft: '#E6F6EC',
  red: '#D92D20', redSoft: '#FDECEA', amber: '#B54708', amberSoft: '#FFF4D6', disabled: '#D9DFEA',
};
export const radius = { sm: 10, md: 14, lg: 18 };

/** minor units -> "ETB 72" or "ETB 72.50" */
export const etb = (minor: number) => `ETB ${minor % 100 === 0 ? minor / 100 : (minor / 100).toFixed(2)}`;
export const parseEtb = (text: string): number | null => {
  const v = Number(text.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
};
