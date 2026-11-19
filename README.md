# js-quality

Portes qualité JS/TS que [Vite+](https://viteplus.dev) ne fournit pas, réunies dans un binaire : `jsq`.

| Porte                | Ce qui est mesuré                                                                                      | Seuil par défaut |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| Complexité cognitive | Complexité de chaque fonction, règle `sonarjs/cognitive-complexity` (définition SonarSource)           | 15 au plus       |
| CRAP                 | `complexité² × (1 − couverture)³ + complexité`, par fonction, couverture lue dans `coverage/lcov.info` | moins de 10      |
| Duplication          | Blocs copiés-collés (jscpd), 40 tokens et 4 lignes au moins                                            | 0 %              |
| Mutation             | Score Stryker, tests du projet lancés par Vitest, seuls ceux qui couvrent chaque mutant                | 70 % au moins    |

Format, lint, types et tests restent à Vite+ (`vp check`, `vp test`). `jsq` n'a besoin d'aucune configuration ESLint,
Stryker ou jscpd dans le projet : tout est embarqué.

## Utilisation

Paquet npm [`@adrien-chinour/js-quality`](https://www.npmjs.com/package/@adrien-chinour/js-quality), en dépendance de
dev avec la couverture v8 de Vitest :

```sh
vp add -D @adrien-chinour/js-quality @vitest/coverage-v8@<version du Vitest de Vite+> vitest@<version du Vitest de Vite+>
```

`vitest` se déclare à la version exacte dont dépend `vite-plus` (ligne `vitest` de `vp --version`) : le runner
Vitest de Stryker, embarqué dans `jsq`, importe `vitest` depuis son propre emplacement, et la déclaration garantit
qu'il charge celui de Vite+. C'est une dépendance peer facultative de `js-quality`, inutile avec
`mutation.command`. Les tests continuent d'importer `vite-plus/test`. Le projet garde l'override de `vite` que pose
`vp create` (`vite@*` vers `@voidzero-dev/vite-plus-core`) : sans lui, `vitest` peut exister en deux copies, et le
runner échoue sur « Vitest failed to find the current suite ».

Aucun script d'installation : `dist/` est construit avant publication, pnpm n'a rien à approuver.

`vite.config.ts` doit produire un rapport lcov :

```ts
test: {
  coverage: { provider: 'v8', reporter: ['text-summary', 'lcov'], include: ['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'] },
},
```

Scripts du `package.json` :

```json
"qa": "vp check --deny-warnings && vp test run --coverage && jsq check",
"mutation": "jsq mutation"
```

Puis `vp run qa` à chaque changement, `vp run mutation` à la recette d'une version.

| Commande                            | Rôle                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `jsq check`                         | Complexité, CRAP et duplication ; code 1 si une porte échoue  |
| `jsq check --only crap,duplication` | Une partie des portes seulement                               |
| `jsq check --write-baseline`        | Gèle les violations courantes (voir « Adoption progressive ») |
| `jsq mutation`                      | Mutation sur les sources ; code non nul sous le seuil         |
| `jsq mutation --mutate src/a.ts`    | Mutation sur quelques fichiers (option répétable)             |

Codes de sortie : 0 tout passe, 1 une porte échoue, 2 mauvaise utilisation ou erreur.

## Configuration

Facultative, bloc `jsq` du `package.json`. Valeurs par défaut :

```json
"jsq": {
  "src": ["src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
  "ignore": ["**/*.d.ts", "**/*.test.*", "**/*.spec.*", "**/node_modules/**", "**/dist/**"],
  "complexity": 15,
  "crap": 10,
  "lcov": "coverage/lcov.info",
  "baseline": "jsq-baseline.json",
  "duplication": { "minTokens": 40, "minLines": 4, "threshold": 0 },
  "mutation": { "break": 70, "mutate": [] }
}
```

`mutation.command` (absent par défaut), pour un projet dont les tests ne passent pas par Vitest : Stryker lance
alors cette commande pour chaque mutant (runner « command »), sans analyse de couverture par test.

Un seuil assoupli se justifie dans le README du projet qui l'assouplit.

## Adoption progressive

Sur un projet existant, les portes échouent dès le premier lancement. Plutôt que d'assouplir les seuils, on gèle les
violations existantes, puis on les résorbe :

1. `jsq check --write-baseline` écrit `jsq-baseline.json` (option `baseline` du bloc `jsq`, chemin relatif au
   dossier où `jsq` tourne) : chaque violation courante et sa valeur, portes et clés triées. Le fichier se versionne.
2. `jsq check` passe tant que chaque violation est gelée avec une valeur supérieure ou égale. Il échoue sur une
   violation absente du fichier ou aggravée, en affichant la ligne, la clé et la valeur gelée.
3. Une entrée gelée qui ne viole plus la porte (fonction corrigée, renommée ou supprimée, clone retiré) est signalée
   par un avertissement, avec le nombre d'entrées et leurs clés ; la porte reste verte. On la retire du fichier, à
   la main ou en relançant `--write-baseline`, dans la même PR que la correction.

| Porte       | Clé                                  | Valeur gelée                             |
| ----------- | ------------------------------------ | ---------------------------------------- |
| complexity  | `src/a.ts:nom`                       | complexité cognitive                     |
| crap        | `src/a.ts:nom`                       | score CRAP arrondi à 2 décimales         |
| duplication | `src/a.ts <> src/b.ts` (paire triée) | nombre de clones entre ces deux fichiers |

Une clé ne contient aucun numéro de ligne : ajouter du code au-dessus d'une fonction ou d'un clone ne le dégèle pas.
Le nom d'une fonction est son identifiant, sinon la variable, la propriété ou la méthode qui la reçoit,
`<appelant>(callback)` pour une fonction passée en argument (`map(callback)`), `default` pour un export par défaut
anonyme, `<anonymous>` sinon. Les homonymes d'un fichier sont numérotés dans l'ordre du fichier : `name`, `name#2`…
Un nouveau clone fait échouer la porte même entre deux fichiers déjà gelés, puisqu'il augmente leur nombre de
clones. La porte duplication ne gèle des clones que si le taux dépasse `duplication.threshold`.

`--write-baseline` réécrit les sections des portes lancées et garde les autres : avec `--only crap`, seule la section
`crap` change. Il rend toujours 0 ; relire le diff du fichier avant de le versionner, car il gèle aussi une
violation aggravée.

Monorepo : chaque lancement de `jsq` a sa référence, dans le dossier où il tourne.

- À la racine, `jsq check --only complexity,duplication` lit et écrit `./jsq-baseline.json` (sections `complexity`
  et `duplication`, clés relatives à la racine : `apps/api/src/a.ts:nom`).
- Dans chaque paquet, `jsq check --only crap` lit et écrit `<paquet>/jsq-baseline.json` (section `crap`, clés
  relatives au paquet : `src/a.ts:nom`), à côté de son `coverage/lcov.info`.

## Notes techniques

- La complexité est calculée par la règle SonarJS exécutée dans l'Oxlint de `js-quality` (`jsPlugins`), et les
  bornes de chaque fonction, utilisées par le CRAP, par `oxc-parser` : aucune configuration Oxlint ni ESLint dans le
  projet, aucune dépendance à TypeScript. Oxlint mesure des copies temporaires des sources où `eslint-disable` et
  `oxlint-disable` sont rendus inertes (`eslint_disable`, même longueur) : aucun commentaire ne masque une fonction
  ni ne fait échouer la mesure, et les sources du projet ne sont pas modifiées. Un lancement d'Oxlint coûte environ
  une seconde, quel que soit le nombre de fichiers.
- La mutation utilise le runner Vitest de Stryker (`@stryker-mutator/vitest-runner`), embarqué dans `jsq` et chargé
  par chemin absolu, avec analyse de couverture par test (`coverageAnalysis: "perTest"`) : chaque mutant ne relance
  que les tests qui le couvrent. Aucune configuration ni dépendance Stryker dans le projet. Stryker lit la
  configuration Vitest du projet (`vite.config.ts`) et pose `STRYKER_MUTATOR_WORKER` dans ses processus.
- `thresholds.high` vaut 90, ou `mutation.break` s'il est plus haut.
- Stryker n'ajoute pas `// @ts-nocheck` et ne réécrit pas lui-même les `tsconfig.json`, car il le ferait avec l'API
  JavaScript de TypeScript, que TypeScript 7 n'a plus. `jsq` les réécrit par son propre script (commande de build de
  Stryker) : les chemins `extends`, `references`, `include`, `exclude` et `files` qui sortent du bac à sable
  (`.stryker-tmp/sandbox-…`, deux niveaux plus bas) gagnent deux `../`. Vitest lit ces fichiers : sans la
  réécriture, il échoue dans le bac à sable sur un `tsconfig.json` qui étend un fichier hors du paquet.
- Ajouter `coverage/` et `.stryker-tmp/` au `.gitignore` du projet.

### Monorepo

`jsq mutation` se lance dans chaque paquet (`vp run --filter <paquet> mutation`) : Stryker copie le paquet seul,
et un `tsconfig.json` qui étend un fichier de la racine (`"extends": "../../tsconfig.base.json"`) est réécrit pour
le retrouver. Les `node_modules` du paquet et de ses parents restent résolus par Node depuis le bac à sable.

Le runner « command » (`mutation.command`) relance toute la suite du paquet pour chaque mutant. Sur `apps/api` de
software-atlas, `src/ssm.ts` (26 mutants) prend 6 s avec le runner Vitest (score 73 %, aucune expiration) et 1 min
27 s avec `"command": "vp test run"`, où les 26 mutants expirent et comptent comme tués (score 100 %, faux).
Sous charge, le runner « command » surestime donc le score.

## Développement

```sh
vp install
vp run qa          # js-quality s'applique ses propres portes
vp run mutation    # ou : vp run mutation -- --mutate src/crap.ts
vp pack            # construit dist/cli.mjs
```

## Publication

Versionnage sémantique ; tant que la version est en 0.x, une version mineure peut casser la configuration ou la
sortie. Publier une version :

1. Une PR monte `version` dans `package.json`, puis est fusionnée.
2. Sur `main` à jour : `git tag v<version> && git push origin v<version>`.
3. Le workflow `release.yml` vérifie que le tag égale la version, lance `vp run qa`, construit l'archive et la publie
   sur npm par trusted publishing (OIDC, sans jeton), avec attestation de provenance.

Mise en place, une seule fois : la première version se publie à la main, puis le paquet déclare le workflow comme
éditeur de confiance, hors du projet : `npm trust github @adrien-chinour/js-quality --repo adrien-chinour/js-quality
--file release.yml`, ou sur npmjs.com, _Settings_ du paquet, _Trusted Publisher_. La publication à
la main passe par npm, pas par `vp pm publish` : le jeton de `vp pm login` est rangé dans
`~/.config/pnpm/auth.ini`, que npm ne lit pas, et npm refuse d'agir dans le projet (`devEngines` impose pnpm). Le
compte npm exige la double authentification : passkey, ou jeton granulaire avec _bypass 2FA_, à révoquer ensuite.

1. Sur `main` à jour : `vp install`.
2. Construire l'archive hors du projet : `vp pm pack --pack-destination <dossier>`.
3. Depuis ce dossier : `npm publish ./<archive>.tgz --access public`.

## Licence

[0BSD](LICENSE) : usage, copie, modification et distribution libres, sans condition.
