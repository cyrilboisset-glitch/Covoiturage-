# Covoiturage PDE – justificatifs de carburant

Application web pour téléphone (installable sur l'écran d'accueil, fonctionne hors ligne) qui
prépare le dossier annuel de covoiturage : justificatif rempli + tickets de carburant + autres
documents, réunis dans un seul PDF.

**Aucune donnée personnelle n'est dans le code.** Chaque utilisateur saisit ses informations
(nom, prénom, équipe, signature, tickets, documents) qui restent uniquement dans le stockage
du navigateur de son téléphone (IndexedDB). Rien n'est envoyé sur Internet : la lecture des
tickets (OCR) se fait sur le téléphone.

## Utilisation

1. Ouvrir l'adresse de l'appli dans Chrome (Android) ou Safari (iPhone).
2. Menu du navigateur → « Ajouter à l'écran d'accueil » / « Installer l'application ».
3. Au premier lancement : Réglages (nom, prénom, n° d'équipage facultatif, équipe, signature).
4. À chaque plein : **Ajouter un ticket** → photo → recadrage → vérifier les valeurs lues →
   cocher « J'ai vérifié » → **Valider**.
5. En fin d'année : **PDF** → **Générer le PDF** → Partager / Enregistrer.
6. Penser à **Exporter** régulièrement une sauvegarde (fichier `.json`).

## Contenu du PDF

1. Justificatif rempli (16 lignes par feuille ; au-delà, feuilles supplémentaires avec
   sous-total par feuille et total général sur la dernière). La case « DATE » est laissée vide.
2. Tickets, 9 par page (3 × 3), ordre chronologique.
3. Autres documents, un par page.

## Hébergement

Site statique : il suffit de servir le dossier en HTTPS (obligatoire pour l'installation et le
mode hors ligne), par exemple avec GitHub Pages (Settings → Pages → branche, dossier `/`).
Après toute modification des fichiers, incrémenter `VERSION` dans `sw.js`.

Test local : `python3 -m http.server 8000` puis http://localhost:8000

## Organisation

- `index.html`, `styles.css` – interface
- `js/app.js` – écrans et logique
- `js/layout.js` – emplacements des champs sur le justificatif
- `js/pdf.js` – génération du PDF (pdf-lib)
- `js/ocr.js` – lecture des tickets (Tesseract.js, français)
- `js/imaging.js` – recadrage, compression, extraction de la signature
- `js/store.js` – stockage local
- `assets/justificatif.pdf` – formulaire vierge
- `vendor/` – bibliothèques embarquées (pdf-lib, Tesseract.js), licences incluses
