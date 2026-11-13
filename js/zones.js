// Zones de covoiturage du site de Crolles (document « Zones de covoiturage »).
// Zone 4 = toutes les autres communes.

const Z1 = ['Bernin', 'Brignoud', 'Crolles', 'Froges', 'La Pierre', 'Le Champ-près-Froges', 'Lancey',
  'Lumbin', 'Saint-Ismier', 'Saint-Nazaire-les-Eymes', 'Villard-Bonnot'];

const Z2 = ['Biviers', 'Corenc', 'Domène', 'Gières', 'Goncelin', 'Hurtières', 'La Combe-de-Lancey',
  'La Tronche', 'La Terrasse', 'Laval', 'Le Touvet', 'Le Versoud', 'Les Adrets', 'Meylan', 'Montbonnot',
  'Montbonnot-Saint-Martin', 'Murianette', 'Revel', 'Saint-Bernard-du-Touvet', 'Saint-Hilaire-du-Touvet',
  'Saint-Jean-le-Vieux', 'Saint-Mury-Monteymond', 'Saint-Pancrasse', 'Sainte-Agnès', 'Tencin', 'Theys',
  'Venon',
  // commune nouvelle regroupant St-Bernard, St-Hilaire et St-Pancrasse (toutes en zone 2)
  'Plateau-des-Petites-Roches'];

const Z3 = ['Allevard', 'Barraux', 'Brié-et-Angonnes', 'Champ-sur-Drac', 'Champagnier', 'Chapareillan',
  'Claix', 'Échirolles', 'Eybens', 'Fontaine', 'Grenoble', 'Herbeys', 'Jarrie', 'La Buisse', 'La Buissière',
  'La Chapelle-du-Bard', 'La Ferrière', 'La Flachère', 'Le Cheylas', 'Le Fontanil', 'Fontanil-Cornillon',
  'Le Moutaret', 'Le Sappey-en-Chartreuse', 'Mont-Saint-Martin', 'Montchaboud', 'Morêtel-de-Mailles',
  'Notre-Dame-de-Mésage', 'Noyarey', 'Pinsot', 'Poisat', 'Le Pont-de-Claix', 'Pontcharra', 'Proveysieux',
  'Quaix-en-Chartreuse', 'Saint-Égrève', "Saint-Martin-d'Hères", "Saint-Martin-d'Uriage",
  'Saint-Martin-le-Vinoux', 'Saint-Maximin', "Saint-Pierre-d'Allevard", 'Saint-Pierre-de-Chartreuse',
  'Saint-Vincent-de-Mercuze', "Sainte-Marie-d'Alloix", 'Sainte-Marie-du-Mont', 'Sarcenas', 'Sassenage',
  'Seyssinet-Pariset', 'Seyssins', 'Uriage', 'Varces-Allières-et-Risset', 'Vaulnaveys-le-Haut',
  'Vaulnaveys-le-Bas', 'Veurey-Voroize', 'Vizille', 'Voreppe',
  // communes nouvelles dont toutes les communes d'origine sont en zone 3
  'Crêts-en-Belledonne', 'Le Haut-Bréda'];

export function normalizeCommune(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\bCEDEX\b.*$/, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\bSAINTE\b/g, 'STE')
    .replace(/\bSAINT\b/g, 'ST')
    .replace(/\s+/g, ' ')
    .trim();
}

const TABLE = new Map();
for (const [zone, list] of [[1, Z1], [2, Z2], [3, Z3]]) {
  for (const c of list) {
    const n = normalizeCommune(c);
    TABLE.set(n, zone);
    TABLE.set(n.replace(/^(LE|LA|LES) /, ''), zone); // « Pont de Claix » = « Le Pont-de-Claix »
  }
}

/** Zone (1 à 4) d'une commune ; null si la commune est vide. */
export function zoneForCommune(commune) {
  const n = normalizeCommune(commune);
  if (!n) return null;
  if (TABLE.has(n)) return TABLE.get(n);
  const short = n.replace(/^(LE|LA|LES) /, '');
  if (TABLE.has(short)) return TABLE.get(short);
  return 4;
}

export function zoneLabel(zone) {
  if (!zone) return 'Zone inconnue (commune manquante)';
  return zone === 4 ? 'Zone 4 (autres communes)' : `Zone ${zone}`;
}
