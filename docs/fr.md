# DriveBC (événements routiers de la Colombie-Britannique)

Intégration non officielle. Elle lit les événements routiers que **DriveBC** (Province de la Colombie-Britannique)
publie sur son **API Open511** publique : fermetures, travaux, incidents, météo et état des routes. Sans compte ni
clé d'API.

> Cette intégration n'est pas une source officielle. Avant de prendre la route, consultez
> [DriveBC](https://www.drivebc.ca/) directement. Les données peuvent avoir du retard sur la route, et l'intégration
> peut manquer un événement.

Contient des renseignements sous licence Open Government Licence – British Columbia (Licence du gouvernement
ouvert – Colombie-Britannique).

## Ce que vous obtenez

Jusqu'à **trois zones**, un appareil Gladys chacune. Une zone est un cercle autour d'un point (1 à 300 km),
éventuellement limité à certaines routes (« Highway 1, Highway 99 »).

Chaque appareil de zone a :

| Fonction            | Type     | Sens                                                                    |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| Événements en cours | compteur | Événements actifs en cours dans la zone                                 |
| Routes fermées      | compteur | Ceux dont une route est indiquée fermée                                 |
| Événements majeurs  | compteur | Ceux de gravité « majeure »                                             |
| Résumé              | texte    | Les événements, fermetures d'abord, puis les majeurs, puis par distance |

Le résumé est écrit dans la langue choisie dans la configuration (anglais ou français) ; les noms de routes et les
textes de DriveBC restent en anglais, seule langue de l'API.

**En cours** veut dire : un événement actif dont l'intervalle de calendrier couvre l'heure actuelle, donnée par le
serveur de DriveBC (en-tête `Date`). Un événement prévu plus tard n'est compté qu'au début de son intervalle. Les
horaires quotidiens écrits seulement dans la description (« 7:00 AM to 7:00 PM, weekdays ») ne sont pas lus : un tel
événement compte pendant tout son intervalle. Un événement sans calendrier lisible, ou une réponse sans heure de
serveur lisible, compte comme en cours.

## Déclencheur de scène : « Nouvel événement DriveBC dans une zone »

Déclenché quand un événement en cours apparaît pour la première fois dans une zone et a été créé, mis à jour ou a
commencé dans les 2 dernières heures (heure du serveur). Filtres : zone, types d'événement, gravité. Variables :
route, titre et description (en anglais), type, gravité, fermée (oui/non), distance au centre de la zone (km), retard
annoncé (minutes, vide quand inconnu), identifiant DriveBC de l'événement.

Il n'est pas déclenché par la première lecture d'une zone, ni après le déplacement d'une zone (nouveau centre, rayon
ou routes) : cette lecture apprend seulement ce qui est déjà là. Il n'est pas déclenché quand la réponse n'a pas
d'heure de serveur lisible. Au plus 20 événements par zone et par lecture.

## Configuration

1. **Langue du résumé** : anglais ou français.
2. **Intervalle de lecture** : 3 à 60 minutes (5 par défaut).
3. **Zone 1** (obligatoire), zones 2 et 3 (facultatives, laissées vides pour les désactiver) : un nom, la latitude et
   la longitude du centre (degrés décimaux, en Colombie-Britannique), le rayon en km (25 par défaut), et au besoin
   les routes à garder, séparées par des virgules, telles que DriveBC les écrit (« Highway 1 », « Highway 99 » ;
   « Hwy 99 » marche aussi ; la casse est ignorée). DriveBC nomme les routes locales « Other Roads ».

Un champ refusé est nommé dans le statut (la valeur tapée n'y est pas répétée).

Le bouton **Voir la dernière lecture** dit ce qu'a donné la dernière lecture de chaque zone et quand vient la
suivante. Il ne lit pas DriveBC.

## Cadence et égards envers DriveBC

DriveBC limite son API et demande d'espacer les requêtes d'au moins 10 secondes. L'intégration :

- envoie une requête à la fois, au moins 12 secondes entre les débuts de deux requêtes (une par zone et par tour ;
  une zone de plus de 500 événements prend une requête de plus par 500, jusqu'à 2000) ;
- commence un tour à chaque intervalle, mesuré depuis le début du tour précédent ;
- ne lit pas plus tôt après un redémarrage, une reconnexion à Gladys, une configuration enregistrée sans changement,
  une Découverte ou le bouton de test (l'heure de la dernière tentative est gardée dans `/data`) ; déplacer une zone
  la lit aussitôt, 12 secondes après la dernière requête ;
- après un **429** (« trop de requêtes »), met toutes les lectures en pause 5 minutes, puis 10, 20… jusqu'à 6 heures ;
  après une erreur du serveur (**5xx**), 2 minutes, puis 4, 8… jusqu'à 6 heures ; un `Retry-After` plus long est
  respecté, jusqu'à 6 heures. La pause est gardée dans `/data` d'un redémarrage à l'autre ; le doublement repart de zéro
  après une lecture réussie ;
- se présente avec le User-Agent `gladys-drivebc/<version> (+https://github.com/LM1LC3N7/gladys-drivebc)` ;
- coupe une réponse après 30 secondes ou 16 Mo.

DriveBC n'offre ni `ETag` ni `Last-Modified` sur ses événements : chaque tour relit les événements.

## Statut

L'écran de configuration montre, pour chaque zone, les comptes de la dernière lecture et son heure (heure du
Pacifique), ou la raison de l'échec et l'heure des dernières données. Des données de plus de 2 heures sont dites
périmées. Quand une lecture échoue, rien n'est publié pour cette zone : les appareils gardent leurs dernières
valeurs et le statut dit depuis quand. L'intégration est montrée connectée quand la dernière lecture d'au moins une
zone a réussi, il y a moins de 2 heures.

## Vie privée

Les coordonnées de vos zones restent dans la configuration de Gladys. DriveBC reçoit, pour chaque zone, la boîte
autour du cercle (son centre est le milieu de la boîte). Le fichier de `/data` garde l'heure de la dernière
tentative, la pause, et par zone les identifiants des événements déjà vus avec une empreinte salée de la zone, pas
ses coordonnées.

## Limites

- Colombie-Britannique seulement (le centre de la zone doit être en C.-B. ; les événements près des frontières sont
  inclus).
- Essayée contre la vraie API de DriveBC le 2026-10-29 ; pas encore essayée par un utilisateur en
  Colombie-Britannique.
- Les textes de DriveBC sont en anglais seulement.
- Une réponse vide de DriveBC se lit « aucun événement » : l'intégration ne peut pas la distinguer d'une panne de
  DriveBC qui renverrait une liste vide.
