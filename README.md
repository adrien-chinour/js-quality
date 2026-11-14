# js-quality

Portes qualité JS/TS que [Vite+](https://viteplus.dev) ne fournit pas, réunies dans un binaire : `jsq`.

| Porte                | Ce qui est mesuré                                                                                      | Seuil par défaut |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| Complexité cognitive | Complexité de chaque fonction, règle `sonarjs/cognitive-complexity` (définition SonarSource)           | 15 au plus       |
| CRAP                 | `complexité² × (1 − couverture)³ + complexité`, par fonction, couverture lue dans `coverage/lcov.info` | moins de 10      |
| Duplication          | Blocs copiés-collés (jscpd), 40 tokens et 4 lignes au moins                                            | 0 %              |
| Mutation             | Score Stryker, les tests du projet lancés par sa propre commande                                       | 70 % au moins    |

Format, lint, types et tests restent à Vite+ (`vp check`, `vp test`). `jsq` n'a besoin d'aucune configuration ESLint,
Stryker ou jscpd dans le projet : tout est embarqué.

## Utilisation

Le paquet n'est pas publié sur npm : il s'installe depuis le dépôt git, épinglé sur un commit. Le script `prepare`
construit `dist/` à l'installation ; pnpm 10 ne l'exécute que si la dépendance exacte figure dans
`onlyBuiltDependencies` du `pnpm-workspace.yaml` du projet :

```yaml
onlyBuiltDependencies:
  - 'js-quality@git+ssh://git@github.com/adrien-chinour/js-quality.git#<sha>'
```

```sh
vp add -D 'git+ssh://git@github.com/adrien-chinour/js-quality.git#<sha>' @vitest/coverage-v8@<version du Vitest de Vite+>
```

Le dépôt est privé : l'installation exige un accès SSH à GitHub, y compris en CI. Changer de version, c'est changer
le `<sha>` aux deux endroits.

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

| Commande                            | Rôle                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| `jsq check`                         | Complexité, CRAP et duplication ; code 1 si une porte échoue |
| `jsq check --only crap,duplication` | Une partie des portes seulement                              |
| `jsq mutation`                      | Mutation sur les sources ; code non nul sous le seuil        |
| `jsq mutation --mutate src/a.ts`    | Mutation sur quelques fichiers (option répétable)            |

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
  "duplication": { "minTokens": 40, "minLines": 4, "threshold": 0 },
  "mutation": { "command": "vp test run", "break": 70, "mutate": [] }
}
```

Un seuil assoupli se justifie dans le README du projet qui l'assouplit.

## Notes techniques

- La complexité est calculée par la règle SonarJS exécutée dans l'Oxlint de `js-quality` (`jsPlugins`), et les
  bornes de chaque fonction, utilisées par le CRAP, par `oxc-parser` : aucune configuration Oxlint ni ESLint dans le
  projet, aucune dépendance à TypeScript. Oxlint mesure des copies temporaires des sources où `eslint-disable` et
  `oxlint-disable` sont rendus inertes (`eslint_disable`, même longueur) : aucun commentaire ne masque une fonction
  ni ne fait échouer la mesure, et les sources du projet ne sont pas modifiées. Un lancement d'Oxlint coûte environ
  une seconde, quel que soit le nombre de fichiers.
- La mutation utilise le runner « command » de Stryker : il lance `mutation.command` dans un bac à sable, sans
  plugin Stryker dans le projet. Stryker n'y ajoute pas `// @ts-nocheck` et ne réécrit pas `tsconfig.json`
  (TypeScript 7 n'a plus d'API JavaScript ; les tests passent par esbuild, qui ignore les types).
- Ajouter `coverage/` et `.stryker-tmp/` au `.gitignore` du projet.

## Développement

```sh
vp install
vp run qa          # js-quality s'applique ses propres portes
vp run mutation    # ou : vp run mutation -- --mutate src/crap.ts
vp pack            # construit dist/cli.mjs
```
