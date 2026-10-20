# Smart Invoice — Facturation & TVA (Maroc)

Application web de facturation multi-entreprises pour le Maroc : factures A4 conformes (ICE, IF, RC, TP),
TVA ventilée par taux, montant arrêté en toutes lettres, numérotation séquentielle sans trou, 12 modèles PDF
personnalisables, facturation par lots à partir de commandes réelles, exports PDF / ZIP / Excel.

**Stack :** React 19 + TypeScript + Vite, Tailwind CSS, React Router, Supabase (Auth, PostgreSQL + RLS, Storage),
@react-pdf/renderer (PDF vectoriel), pdf-lib, pdfjs-dist, SheetJS (xlsx), JSZip.

---

## Ce qui est livré (phase 1 — Smart Invoice)

| Domaine | Fonctionnalités |
|---|---|
| **Comptes** | Connexion, création de compte, mot de passe oublié, déconnexion. Rôles **administrateur / comptable / utilisateur** par entreprise. |
| **Multi-entreprises** | Un utilisateur (ex. un comptable) peut gérer plusieurs entreprises. Isolation stricte par règles **RLS** dans PostgreSQL. |
| **Entreprises** | Raison sociale, ICE, IF, RC, TP, CNSS, adresse, logo, banque/RIB, mentions légales. Téléphone, e-mail et banque **masqués par défaut** sur les factures. |
| **Clients / fournisseurs** | Création, modification, recherche, archivage, historique des factures, export Excel. ICE contrôlé (15 chiffres), unique par entreprise. |
| **Catalogue** | Référence, désignation, catégorie, unité, prix TTC, taux de TVA, actif/archivé. Import/export Excel. **Historique de chaque changement de prix.** |
| **Factures** | Brouillon → validée → partiellement payée / payée / annulée. Plusieurs taux de TVA, remises (si autorisées), conditions, échéance, nature de la marchandise, observations, duplication. |
| **Prix** | Le prix vient du catalogue et n'est **jamais modifié** par la facture. Une dérogation sur une ligne exige le rôle admin/comptable **et un motif**, enregistré. |
| **Numérotation** | Attribuée **par la base de données** à la validation, dans une transaction verrouillée : séquentielle, sans trou, sans doublon, chronologique. Format configurable (`FA{SEQ:4}/{YYYY}`…), remise à 1 annuelle, plusieurs séries. |
| **Verrouillage** | Une facture validée ne peut être ni modifiée ni supprimée. Correction = annulation motivée (numéro conservé) + nouveau brouillon lié. |
| **Paiements** | Paiements partiels ou complets, statut mis à jour automatiquement, trop-perçu refusé. |
| **PDF** | A4 vectoriel (texte sélectionnable), multi-pages avec en-tête de tableau répété, totaux jamais coupés, numéros de page. L'aperçu à l'écran **est** le PDF téléchargé. Filigranes BROUILLON / ANNULÉE / DÉMONSTRATION. |
| **Modèles** | 12 modèles : Classic, Minimal, Modern, Elegant, Clean, Stripe, Compact, Gray, Accent, Boxed, Professional Corporate, Papier à en-tête (votre fond PDF/image). Couleur, police, taille, marges, logo, titre, en-tête/pied, 12 champs affichables. Modèle par défaut par entreprise. |
| **Lots** | Import Excel/CSV de **commandes réelles** → une facture par commande, prix du catalogue, contrôle des doublons et des erreurs avant création, validation en ordre chronologique, ZIP des PDF, rapport Excel. |
| **Exports** | PDF individuel, PDF unique de plusieurs factures, ZIP, listes Excel (factures, clients, fournisseurs, catalogue). Aucun message de succès sans fichier réellement généré. |
| **Tableau de bord** | CA TTC/HT, TVA collectée, encaissé, reste à encaisser, échues, brouillons, CA mensuel — par entreprise et période. |
| **Journal** | Toutes les opérations (création, modification, suppression) avec auteur et valeurs avant/après. |
| **Démonstration** | Une entreprise de démo **clairement marquée** (numéros `DEMO-…`, bandeau, filigrane « SANS VALEUR »), jamais mélangée aux données réelles, supprimable. |

### Module Journal TVA

| Domaine | Fonctionnalités |
|---|---|
| **Importation PDF** | Plusieurs fichiers à la fois, **plus de 500 pages** traitées par lots (barre de progression : pages, OCR, factures détectées, erreurs), bouton Interrompre, **reprise** d'un import interrompu, fichier déjà importé détecté (empreinte SHA-256). |
| **Extraction** | Toutes les factures du fichier (une facture sur plusieurs pages, plusieurs factures sur une page), numéro **alphanumérique** distingué du numéro de page, date complète (15/03/2026, 15 mars 2026…), émetteur / client, ICE, IF, nature de la marchandise, HT, TVA (par taux), TTC, formats « 1 234,56 », « 1.234,56 », « 1,234.56 ». |
| **OCR** | Pages scannées lues par Tesseract (français) **dans le navigateur**, sans service externe ; fichiers servis par l'application (`public/ocr`). |
| **Fiabilité** | Niveau de confiance par champ (fiable / probable / incertain / introuvable), contrôles HT + TVA = TTC et TVA = base × taux, **aucune valeur inventée** (un montant calculable est seulement proposé), doublons détectés (dans le fichier, dans le journal, et ventes déjà émises dans Smart Invoice). |
| **Contrôle** | Tableau modifiable, cellules incertaines colorées, page source affichée à côté, validation ligne par ligne ou des lignes sans anomalie, rejet, saisie manuelle d'achats et de ventes, timbre / autres montants. |
| **Journaux** | Journal des ventes (factures Smart Invoice + importées) et Journal des achats : filtres période (mois, trimestre, année, dates), taux, recherche, totaux, doublons possibles signalés, archivage motivé. Colonnes Mode, Date de paiement, Rubrique, déductible, charges / immobilisations. |
| **Déclaration TVA** | Préparation **indicative** par période : TVA collectée par taux, TVA déductible par nature et par taux, TVA non déductible, TVA nette ou crédit. Régime **encaissement** (au prorata des paiements) ou **débits**, configurable. Écritures à contrôler ou sans date de paiement signalées. |
| **Excel** | Classeur réel : Journal des ventes, Journal des achats, Synthèse TVA, Relevé des déductions (présentation proche de SIMPL-TVA, à vérifier), et en option une feuille séparée « À contrôler ». Montants numériques, dates complètes, totaux. |

### Autres ajouts

- **Importer votre propre modèle** (PDF, JPG ou PNG) et **placer les blocs à la souris** (titre/numéro/date, client, échéance, entreprise, tableau) ; le tableau et les totaux continuent proprement sur les pages suivantes.
- **Export JPG** d'une facture (une image par page).
- **N° de bon de livraison** sur la facture (saisie, PDF, recherche, export Excel, colonne `bon_livraison` dans l'import par lots).
- **Style de la facture** (dans chaque modèle, y compris « Importer mon modèle ») : styles rapides en un clic, tableau (quadrillé, lignes, alterné, en-tête plein, minimal), couleur de l'en-tête du tableau, colonnes de prix (TTC, HT, ou détaillé HT + TVA + TTC), totaux (encadré, simple, bandeau), en-tête, hauteur des lignes, numérotation des lignes, unité.
- **Clients, fournisseurs et produits communs à plusieurs entreprises** : case « Ajouter aussi dans mes autres entreprises » à la création, bouton « Reprendre d'une autre entreprise », reprise à la création d'une entreprise, et synchronisation de toutes les entreprises (page Entreprises). Sans doublon (même ICE / nom / référence). Mise à jour d'une base existante : `supabase/MISE_A_JOUR_partage_entreprises.sql`.
- **Modèles FERCIM MAT, NOVASTRO BUSINESS et NORD BUSINESS JLE** (reproduits depuis les modèles Excel) et **mode de paiement** sur la facture (virement, chèque, espèces, effet, carte…). Mise à jour : `supabase/MISE_A_JOUR_17-10-2026.sql`.
- **Numérotation propre à chaque client** : dans la fiche client, choisir une série ou saisir le dernier numéro du client (ex. MATA0012/2026) ou ses lettres (ex. MATA) ; ses factures prennent automatiquement cette série.
- **Importation Excel** (Journal TVA) : reprise des factures déjà émises sur Excel (un fichier par facture ou une liste), avec leurs numéros d'origine, puis « Continuer votre numérotation » à partir du dernier numéro trouvé.
- **Devis** : numérotation DV0001/2026, mêmes modèles que les factures (titre DEVIS, date de validité), suivi (envoyé, accepté, refusé) et « Transformer en facture » (facture brouillon avec les mêmes lignes).
- **Application installable** (PWA) : bouton « Installer l'application » (ordinateur, Android) ; sur iPhone : Partager → Sur l'écran d'accueil.
- Mise à jour d'une base existante (tout en un) : `supabase/MISE_A_JOUR_20-10-2026.sql`.
- **Section « Bons BL / BC »** : sur la fiche d'une facture, les boutons « Créer le BL » et « Créer le BC » créent en un clic
  le bon de livraison ou le bon de commande (même client, mêmes lignes, même modèle graphique) avec sa propre numérotation
  `BL0001/2026`, `BC0001/2026`. Le BL est imprimé sans prix par défaut, avec cases de signature (livreur / client) ;
  le BC avec prix et totaux. Réglages : date, observations, prix affichés ou non. PDF et JPG. Un seul bon de chaque type
  par facture (recliquer ouvre le bon existant). Mise à jour d'une base existante : `supabase/MISE_A_JOUR_bons.sql`.
- **Reprise d'une numérotation existante** : saisissez votre dernier numéro (ex. `NOV0100/2025A`), le format et le numéro suivant sont déduits et vérifiés.
- Tableau de bord : achats, TVA déductible, TVA nette ou crédit estimé, dernières importations, factures à contrôler.

### Volontairement non inclus

- Un générateur qui fabrique des factures pour atteindre un montant total (dates et quantités inventées, sauts de numéros) : de telles factures ne correspondent à aucune vente réelle. La facturation par lots fonctionne à partir de **commandes réelles** (fichier Excel).
- L'export DOCX des factures.

---

## Installation sous Windows

Prérequis : [Node.js 20.19 ou plus récent](https://nodejs.org) (version LTS) et un compte [Supabase](https://supabase.com) (gratuit).

```powershell
cd smart-invoice
npm install
copy .env.example .env.local
```

Ouvrez `.env.local` et renseignez l'URL et la clé **anon** de votre projet Supabase (voir ci-dessous), puis :

```powershell
npm run dev        # http://localhost:5173
```

Autres commandes :

| Commande | Rôle |
|---|---|
| `npm run verify` | Contrôle TypeScript + tests unitaires + build de production |
| `npm run test` | Tests unitaires (calculs, montant en lettres, numérotation, lots) |
| `npm run build` | Build de production dans `dist/` |
| `npm run pdf:samples` | Régénère les PDF d'exemple des 12 modèles dans `samples/` |

---

## Configuration de Supabase

1. Créez un projet sur supabase.com (région la plus proche, ex. Europe).
2. **SQL Editor** → ouvrez `supabase/INSTALLATION_COMPLETE.sql`, copiez **tout** son contenu, collez-le et cliquez sur **Run**.
   Le message « installation terminée avec succès » doit s'afficher. Ce fichier regroupe les 7 migrations de
   `supabase/migrations/` et peut être relancé sans erreur (il nettoie d'abord une installation partielle ;
   ⚠️ relancé plus tard, il effacerait les données Smart Invoice).
   (Alternative pour les développeurs : CLI Supabase, `supabase link` puis `supabase db push`.)
3. **Project Settings → API** : copiez *Project URL* → `VITE_SUPABASE_URL` et *anon public key* → `VITE_SUPABASE_ANON_KEY`.
   ⚠️ N'utilisez **jamais** la clé `service_role` dans l'application.
4. **Authentication → URL Configuration** : *Site URL* = l'adresse de votre application
   (`http://localhost:5173` en local, puis l'URL Vercel). Ajoutez aussi les deux dans *Redirect URLs*
   (nécessaire pour le lien « mot de passe oublié »).
5. Premier lancement : créez votre compte, puis votre entreprise. Vous en devenez administrateur.
   Pour ajouter un collègue : il crée son compte, puis vous l'ajoutez dans **Utilisateurs** avec son e-mail.

Le stockage privé `company-assets` (logos, papiers à en-tête) est créé par la migration 003.

---

## Déploiement sur Vercel

1. Poussez le projet sur GitHub, puis **Vercel → Add New → Project** et importez le dépôt.
2. Framework : **Vite** (détecté). Build : `npm run build`, dossier : `dist` (déjà dans `vercel.json`).
3. **Environment Variables** : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
4. Déployez, puis ajoutez l'URL Vercel dans Supabase (étape 4 ci-dessus).

`vercel.json` redirige toutes les routes vers `index.html` (navigation côté client).

---

## Vérification

```powershell
npm run verify
```

Base de données (sous Linux/WSL avec PostgreSQL 16 local) :
`supabase/tests/run-local.sh` applique les migrations sur une base de test et exécute **plus de 100 scénarios**
(isolation entre entreprises, rôles, verrouillage, numérotation et reprise, prix, paiements, journal TVA,
déclaration en régime d'encaissement et de débits, doublons, démo).

Tests d'extraction : un vrai PDF de 15 pages / 12 factures / 7 mises en page (`src/domain/extraction/__fixtures__`),
un fichier de **525 pages** (420 factures, environ 7 s), et une page scannée lue par OCR.
Après modification d'une migration : `node supabase/build-install.mjs` régénère `INSTALLATION_COMPLETE.sql`.

Procédure de recette manuelle conseillée :
1. Créer l'entreprise de démonstration (page Entreprises) et parcourir les factures `DEMO-…`.
2. Créer une vraie entreprise, 2 produits à des taux différents, 1 client avec ICE.
3. Créer une facture, vérifier l'aperçu, valider : numéro `FA0001/AAAA`.
4. Tenter de modifier la facture validée (refusé), enregistrer un paiement partiel, puis le solde.
5. Importer un fichier de commandes (page Lots, bouton « Modèle Excel ») et télécharger le ZIP.
6. Journal TVA : importer un PDF de factures d'achat, contrôler les lignes colorées, valider, puis consulter
   le Journal des achats, la Déclaration TVA et exporter le classeur Excel.

---

## Règles de calcul

Pour une ligne au prix TTC : `TTC ligne = quantité × prix unitaire TTC × (1 − remise)`, arrondi au centime.
Par taux : `HT = TTC ÷ (1 + taux)`, `TVA = TTC − HT`. Deux règles d'arrondi au choix (par taux, recommandé, ou par ligne) ;
dans les deux cas `HT + TVA = TTC` au centime et le TTC est la somme exacte des lignes. Le même algorithme est
implémenté en TypeScript (aperçu) et en SQL (valeurs enregistrées) ; leur concordance a été vérifiée sur 5 000 lignes et 300 factures aléatoires (deux règles d'arrondi), sans aucun écart.

Les taux de TVA (20 %, 14 %, 10 %, 7 %, exonéré par défaut) sont paramétrables par entreprise :
faites-les valider par votre comptable selon votre activité.

---

## Structure

```
src/
  domain/        logique métier pure + tests (montants, TVA, lettres, numérotation, lots, dates)
  domain/extraction/  découpage des PDF en factures et extraction des champs (+ PDF de test)
  lib/           client Supabase, session, types, Excel, pdf.js
  pdf/           document PDF, 12 modèles, export ZIP / PDF unique, aperçu
  components/    interface (boutons, champs, tableaux, fenêtres), mise en page
  features/      pages : tableau de bord, factures, lots, clients, catalogue, modèles,
                 entreprises, paramètres, utilisateurs, journal, connexion, vat/ (Journal TVA)
supabase/
  migrations/    schéma, règles métier (déclencheurs), RLS, démo
  tests/         scénarios SQL
samples/         PDF d'exemple des modèles
```

---

## دليل سريع بالعربية

1. ثبّت **Node.js** (نسخة LTS) من nodejs.org.
2. افتح المجلد في PowerShell واكتب: `npm install`
3. أنشئ مشروعاً مجانياً على **supabase.com**، ثم انسخ محتوى الملف `supabase/INSTALLATION_COMPLETE.sql` كاملاً، والصقه في **SQL Editor**، واضغط **Run** (مرة واحدة).
4. انسخ الملف `.env.example` إلى `.env.local`، وضع فيه `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` (من Project Settings ← API).
5. شغّل الموقع: `npm run dev` ثم افتح `http://localhost:5173`.
6. للنشر على **Vercel**: ارفع المشروع إلى GitHub، واستورده في Vercel، وأضف المتغيرين نفسيهما.
7. **بونات BL / BC**: افتح أي فاتورة ← اضغط «Créer le BL» أو «Créer le BC» ← يُنشأ البون وتنتقل إليه. تجد كل البونات في القائمة اليسرى «Bons BL / BC». إذا كانت قاعدة البيانات منشأة من قبل، فشغّل مرة واحدة الملف `supabase/MISE_A_JOUR_bons.sql` في SQL Editor.
