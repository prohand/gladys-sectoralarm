# Sector Alarm

Cette intégration relie Gladys à votre système d'alarme **Sector Alarm** :
armer et désarmer la centrale, verrouiller et déverrouiller les serrures
connectées, allumer et éteindre les prises connectées, et suivre les capteurs
(portes et fenêtres, fumée, fuites d'eau, température, humidité).

## Avant de commencer

- **Gladys 5.3 ou plus récent** est nécessaire.
- Un **compte Sector Alarm** : l'e-mail et le mot de passe de l'application
  mobile Sector Alarm.
- Gladys doit avoir **accès à Internet**. Sector Alarm n'a pas d'API locale :
  tout passe par le cloud Sector Alarm (`mypagesapi.sectoralarm.net`). C'est
  pourquoi l'intégration porte le tag **cloud**.

## Configuration

| Champ                                  | Que mettre                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **E-mail**                             | L'e-mail de votre compte Sector Alarm.                                                                                                        |
| **Mot de passe**                       | Son mot de passe. Gardé comme secret, jamais écrit dans les journaux.                                                                         |
| **Code de la centrale**                | Le code tapé sur le clavier. Facultatif, voir plus bas.                                                                                       |
| **Identifiant de la centrale**         | Vide pour suivre toutes les centrales du compte. Sinon un identifiant, ou plusieurs séparés par des virgules.                                 |
| **Intervalle de rafraîchissement (s)** | Fréquence de lecture de Sector Alarm. 60 s par défaut, 30 s minimum. Sector Alarm limite les requêtes : descendre sous la minute apporte peu. |

Enregistrez, puis cliquez sur **Tester la connexion** : la réponse liste les
centrales trouvées, leur mode, si elles sont en ligne et combien d'accessoires
elles ont. Ouvrez ensuite l'onglet **Découverte** de l'intégration et créez les
appareils voulus.

### Le code de la centrale

Le code sert **uniquement** à :

- désarmer l'alarme depuis Gladys (une scène, la carte de l'appareil) ;
- verrouiller ou déverrouiller une serrure connectée ;
- armer une centrale dont l'**armement rapide** est désactivé.

Sans code, Gladys peut quand même tout lire et armer une centrale dont
l'armement rapide est activé. Laissez-le vide si vous ne voulez pas que Gladys
puisse désarmer.

## Appareils

| Appareil dans Gladys            | Fonctionnalités                                           | Valeurs                            |
| ------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| **Centrale** (une par centrale) | Mode de l'alarme (une liste : Désarmée, Partielle, Armée) | `disarmed`, `partial`, `armed`     |
| **Serrure connectée**           | Verrou (pilotable), Batterie faible                       | 1 = verrouillée, 0 = déverrouillée |
| **Prise connectée**             | Alimentation (pilotable)                                  | 1 = allumée, 0 = éteinte           |
| **Détecteur d'ouverture**       | Ouverture, Batterie faible                                | 1 = fermé, 0 = ouvert              |
| **Détecteur de fumée**          | Fumée, souvent Température                                | 1 = fumée détectée                 |
| **Détecteur de fuite**          | Fuite d'eau                                               | 1 = fuite détectée                 |
| **Température / humidité**      | Température (°C), Humidité (%)                            |                                    |

Le mode « partiel » n'apparaît que sur une centrale qui le permet. Chaque
appareil affiche un badge **cloud** ; il passe à **injoignable** quand la
centrale est hors ligne ou que Sector Alarm ne répond pas.

Gladys n'interroge pas les appareils un par un : l'intégration lit chaque
centrale en entier, à l'intervalle choisi, et n'envoie à Gladys que les valeurs
qui ont changé. Après un ordre, la centrale est relue quelques secondes plus
tard pour le confirmer.

## Widget du tableau de bord

Ajoutez le widget **Sector Alarm** à un tableau de bord. Il affiche :

- le mode de l'alarme (rouge armée, orange partielle, vert désarmée) ;
- la connexion de la centrale ;
- les portes et fenêtres ouvertes, les serrures déverrouillées ;
- une alerte fumée ou fuite d'eau.

Ses boutons : **Armer** et **Partiel** (avec confirmation), **Désarmer**,
**Actualiser**.

> **Sécurité.** Un tableau de bord peut être accroché au mur, et n'importe qui
> peut appuyer dessus. Le bouton **Désarmer** n'utilise donc **jamais** le code
> de la configuration : il ouvre un petit formulaire où le code doit être tapé à
> chaque fois.

Avec plusieurs centrales, choisissez celle à afficher dans les réglages du
widget.

## Scènes

### Déclencheurs

| Déclencheur                               | Clé                        | Filtres                     | Variables                                                                    |
| ----------------------------------------- | -------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| **Le mode de l'alarme change**            | `alarm_mode_changed`       | Centrale, Nouveau mode      | `mode`, `previous_mode`, `panel_name`, `user`, `channel`                     |
| **Une centrale se déconnecte ou revient** | `panel_connection_changed` | Centrale, Connexion         | `state` (`offline` / `online`), `panel_name`                                 |
| **Une serrure connectée est actionnée**   | `lock_operated`            | Serrure, Ce qui s'est passé | `action` (`lock` / `unlock` / `lock_failed`), `lock_name`, `user`, `channel` |

`user` et `channel` viennent du journal d'événements Sector Alarm (qui, et avec
quoi : clavier, appli, badge…) ; ils sont vides quand le journal ne le dit pas.

Les déclencheurs partent sur les **changements** vus entre deux lectures, d'où
qu'ils viennent (clavier, appli, badge ou Gladys). Rien ne part à la première
lecture après un démarrage : l'historique n'est pas une nouveauté. Un changement
qui va et vient entre deux lectures peut être manqué : baissez l'intervalle si
c'est important.

Exemples :

- _Quand l'alarme est désarmée, si personne n'est à la maison, m'envoyer une
  notification avec `{{triggerEvent.data.user}}`._
- _Quand la centrale se déconnecte, envoyer un message._
- _Quand la porte d'entrée est déverrouillée, allumer la lumière de l'entrée._

### Actions

| Action                             | Clé              | Champs                | Sorties                              |
| ---------------------------------- | ---------------- | --------------------- | ------------------------------------ |
| **Changer le mode de l'alarme**    | `set_alarm_mode` | Centrale, Mode        | `applied` (oui/non), `mode`, `error` |
| **Relire Sector Alarm maintenant** | `refresh_now`    | Centrale (facultatif) | `mode`, `online`                     |

`set_alarm_mode` utilise le code de la centrale de la configuration. Un ordre
refusé n'arrête pas la scène : testez `applied` dans une condition, et utilisez
`error` dans une notification. Exemple : _à 23 h, armer l'alarme en partiel ; si
`applied` vaut non, m'envoyer `error`._

Les actions standard de Gladys pilotent aussi les appareils : le mode de
l'alarme, les serrures et les prises se règlent avec **Contrôler un appareil**.

## Boutons de l'écran de configuration

- **Tester la connexion** : se reconnecte et lit chaque centrale.
- **Actualiser maintenant** : relit Sector Alarm sans attendre.

## En cas de problème

| Ce que vous voyez                                   | Que faire                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| « Sector Alarm refuse l'e-mail ou le mot de passe » | Vérifiez-les dans l'application Sector Alarm, puis enregistrez de nouveau.                                              |
| « Sector Alarm demande de ralentir »                | Sector Alarm limite les requêtes. L'intégration espace ses lectures, puis revient à la normale. Augmentez l'intervalle. |
| « Sector Alarm est injoignable »                    | Vérifiez l'accès à Internet de Gladys.                                                                                  |
| « Le code de la centrale est nécessaire… »          | Renseignez le code, ou n'armez qu'avec l'armement rapide.                                                               |
| Un capteur manque                                   | Cliquez sur **Actualiser maintenant**, puis regardez l'onglet **Découverte** : un nouvel accessoire y apparaît.         |
| Le mode ne bouge plus pendant une coupure           | C'est voulu : une centrale hors ligne se dit « armée » quoi qu'il arrive, Gladys garde donc le dernier mode connu.      |

## Vie privée

Votre e-mail, votre mot de passe et votre code restent dans Gladys, comme
secrets, et ne sont envoyés qu'à Sector Alarm (`mypagesapi.sectoralarm.net`).
L'intégration n'utilise aucun autre service.

Cette intégration n'est ni faite ni soutenue par Sector Alarm. Elle utilise la
même API que l'application Sector Alarm, qui peut changer sans préavis.
