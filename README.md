# Vocab Trainer FR → EN

Une petite application web pour apprendre le vocabulaire Français → Anglais avec des flashcards. Les données sont stockées localement via `localStorage`.

## Fonctionnalités
- Plusieurs vocabulaires ("decks"): créez et sélectionnez un vocabulaire (ex: "voc unit 1", "voc unit 2").
- Ajouter des mots en français avec une ou plusieurs traductions anglaises (séparées par des virgules) dans le vocabulaire sélectionné.
- Afficher la liste des mots avec un compteur d’erreurs par mot (par vocabulaire).
- Révision sous forme de flashcards (FR → EN) avec saisie de la réponse.
- Vérification, score de la session et boucle automatique sur les mots faux jusqu’à tout correct.
- Historique d’erreurs par mot (incrémenté à chaque mauvaise réponse).
- Import/Export en JSON par vocabulaire, suppression d’un mot, purge du vocabulaire courant.
- Mode aléatoire ON/OFF.

## Lancer localement
Vous pouvez ouvrir `index.html` directement dans un navigateur, mais pour un meilleur fonctionnement (et pour les imports), utilisez un petit serveur local.

Avec Python (installé par défaut sur macOS) :

```bash
python3 -m http.server 8080
```

Puis ouvrez dans votre navigateur :

- http://localhost:8080/Users/maison/CascadeProjects/vocab-trainer/

Astuce : vous pouvez aussi servir ce dossier avec d’autres outils (ex : VS Code Live Server, `npx serve`, etc.).

## Utilisation
0. Barre « Vocabulaire » en haut
   - Sélectionnez le vocabulaire à utiliser via le menu déroulant.
   - Cliquez sur « Nouveau vocabulaire » pour créer un nouveau deck.
   
1. Onglet « Liste & Ajout »
   - Saisir un mot en français et sa ou ses traductions anglaises (séparées par des virgules).
   - Le compteur « erreurs » s’incrémente lorsque le mot a été mal répondu en révision (par vocabulaire).
   - Boutons : Exporter (JSON) du vocabulaire courant, Importer (JSON) dans le vocabulaire courant, Tout effacer (du vocabulaire courant).

2. Onglet « Révision »
   - Démarrer une session : les mots du vocabulaire sélectionné sont proposés en flashcard.
   - Tapez la traduction anglaise. Si c’est correct : score +1. Sinon : affichage de la ou des réponses attendues et le mot sera reposé au round suivant.
   - La session continue automatiquement sur les mots faux jusqu’à ce que tous soient corrects.
   - Le bouton « Aléatoire » permet d’activer/désactiver l’ordre aléatoire des cartes.

## Modèle de données (localStorage)
- Clé `vocab_trainer_words_v1` : tableau d’objets `{ id, fr, en: string[], errors: number, createdAt, deckId }`.
- Clé `vocab_trainer_prefs_v1` : `{ shuffle: boolean, selectedDeckId?: string }`.
- Clé `vocab_trainer_decks_v1` : tableau d’objets `{ id, name, createdAt }`.

## Import/Export
- Export (par vocabulaire courant) : téléchargement d’un fichier JSON nommé d’après le deck, ex: `vocab-trainer-voc-unit-1.json`.
- Import (par vocabulaire courant) : fusionne les mots par clé française dans le deck sélectionné (insensible aux accents/majuscules). Les traductions sont dédoublonnées.

## Migration
Au premier démarrage de cette version, un vocabulaire par défaut est créé et tous les mots existants (sans `deckId`) y sont migrés.

## Sécurité et vie privée
- Toutes les données restent dans votre navigateur via `localStorage`.
- Aucune donnée n’est envoyée en ligne.

## Améliorations possibles
- Mode EN → FR.
- Système de difficulté/spaced repetition.
- Comptage de séries de bonnes réponses.
- Support multi-profils.
