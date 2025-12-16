# TP BDD Caching - Rapport

## Schéma d’Architecture

```mermaid
graph TD
    API[API Node.js]
    HA[HAProxy]
    DB_P[DB Primary (Active)]
    DB_R[DB Replica (Read-Only)]
    Redis[Redis Cache]

    API -->|Write (POST/PUT)| HA
    API -->|Read (GET)| DB_R
    API -->|Cache Check| Redis
    HA --> DB_P
    DB_P -->|Replication| DB_R
```

## Stratégies

### Lecture / Écriture
- **Écritures** : Dirigées vers le Primary via HAProxy (port 5439). Cela permet d'abstraire le serveur physique réel et facilite la bascule.
- **Lectures** : Dirigées directement vers le Replica (port 5433). Cela décharge le Primary.

### Stratégie de Cache
- **Cache-aside** : L'API vérifie d'abord Redis.
    - Si présent (HIT) : Retourne la valeur.
    - Si absent (MISS) : Lit dans le Replica, met en cache (TTL 60s), et retourne la valeur.
- **Invalidation** : Lors d'une modification (`PUT`), la clé correspondante est supprimée de Redis pour forcer un rafraîchissement lors de la prochaine lecture.

### Haute Disponibilité
- La réplication assure la redondance des données.
- En cas de panne du Primary, le Replica a été promu manuellement.
- HAProxy a été reconfiguré pour pointer vers le nouveau Primary, permettant à l'API de continuer à fonctionner sans modification de code.

## Mesures
- Lecture avec Cache HIT : Instantanée (< 5ms).
- Lecture après invalidation (MISS) : Plus lente, nécessite requête DB.

## Réponses aux Questions

1. **Différence entre réplication et haute disponibilité ?**
   - La **réplication** copie les données (redondance). Elle ne garantit pas la continuité de service automatique.
   - La **haute disponibilité (HA)** garantit que le service reste accessible avec un temps d'arrêt minimal (souvent via bascule automatique, ce qui n'était pas le cas ici totalement car manuel).

2. **Qu’est-ce qui est manuel ici ? Automatique ?**
   - **Automatique** : Réplication des données, check TCP HAProxy.
   - **Manuel** : Détection de la panne (par admin), Promotion du replica (`pg_ctl promote`), Reconfiguration HAProxy.

3. **Risques cache + réplication ?**
   - **Incohérence** : On peut lire une donnée périmée dans le cache si l'invalidation échoue.
   - **Lag de réplication** : Même après invalidation, si le Replica n'est pas à jour par rapport au Primary, on risque de mettre en cache une vieille valeur lue sur le Replica.

4. **Comment améliorer cette architecture en production ?**
   - **Failover automatique** : Utiliser des outils comme **Patroni** ou **Repmgr** pour gérer la promotion automatique.
   - **Pooler intelligent** : PgBouncer ou PgPool-II.
   - **Sentinel** pour Redis HA.
