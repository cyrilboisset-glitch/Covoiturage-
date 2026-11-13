// Emplacements des valeurs sur le justificatif vierge (PDF importé dans les Réglages).
// Mesurés sur le PDF d'origine (page 612 x 792 pt). Toutes les ordonnées
// sont exprimées depuis le HAUT de la page (comme à l'écran) ; la conversion
// vers le repère PDF (origine en bas) est faite dans pdf.js.
export const FORM = {
  pageHeight: 792,
  nom: { x: 186, baseline: 107.5, maxWidth: 312 },
  prenom: { x: 186, baseline: 134, maxWidth: 312 },
  // N° d'équipage : 6 cases
  equipage: {
    edges: [178, 197, 215.6, 234.1, 252.9, 271.4, 290.2],
    baseline: 158,
  },
  // Cases à cocher « Equipe » (centre x, centre y, demi-côté)
  equipes: {
    '1': { cx: 188.7, cy: 193.1 },
    '2': { cx: 213.0, cy: 193.1 },
    '3': { cx: 237.5, cy: 193.1 },
    '4': { cx: 261.7, cy: 193.1 },
    '5': { cx: 286.0, cy: 193.1 },
    'Journée': { cx: 310.5, cy: 193.1 },
  },
  checkHalf: 4.5,
  table: {
    // bords horizontaux des 16 lignes de données
    rows: [279.3, 298.3, 317.6, 336.6, 355.9, 375.0, 394.1, 413.3, 432.3,
           451.6, 470.8, 489.8, 508.9, 528.0, 547.1, 566.3, 585.3],
    cols: { date: [96.6, 174.9], type: [174.9, 414.6], montant: [414.6, 514.6] },
  },
  total: { x0: 414.6, x1: 514.6, top: 587, bottom: 606 },
  grandTotal: { right: 514.6, baseline: 620 },
  sheetNumber: { right: 514.6, baseline: 249 },
  // zone libre à droite de « SIGNATURE : »
  signature: { x0: 386, x1: 562, top: 700, bottom: 750 },
};

export const ROWS_PER_SHEET = FORM.table.rows.length - 1; // 16

export const EQUIPES = ['1', '2', '3', '4', '5', 'Journée'];

export const FUELS = [
  'SP95-E10',
  'SP95',
  'SP98',
  'Gazole',
  'E85',
  'GPL',
  'HVO100',
];
