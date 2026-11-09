# js-quality

Binaire `jsq` : portes qualité JS/TS que Vite+ ne fournit pas (complexité cognitive, CRAP, duplication,
mutation). Usage et configuration : [README.md](README.md).

- Prose, commits, PR : français. Code, identifiants, commentaires : anglais.
- Chaque porte a son module dans `src/` (`complexity.ts`, `crap.ts`, `duplication.ts`, `mutation.ts`) ;
  `check.ts` les assemble, `cli.ts` lit la ligne de commande.
- Le projet s'applique ses propres portes : une fonction ajoutée doit rester sous les seuils par défaut.
- `test/fixtures/project` est un faux projet (code dupliqué, fonction complexe, `lcov.info`) : il est exclu des
  tests, du lint et du format.

## Workflow agent

- **Vérification** : `vp run qa`.
- **Portes qualité** : `jsq check` (dans `qa`) ; `vp run mutation -- --mutate <fichier>` sur les fichiers modifiés,
  seuil 70 %.
- **Branches** : `issue/<n>-<slug>` sur `main`.
- **Fusion** : le mainteneur.
- **CI** : workflow `ci.yml`.
