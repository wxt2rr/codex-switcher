# npm Publish Guide

This project publishes to npm as:

- package: `@wangxt0223/codex-switcher`
- command: `codex-sw`

## One-command publish

```bash
npm login --registry https://registry.npmjs.org/
npm run release:npm
```

`release:npm` runs:

1. `npm run check`
2. `npm pack --dry-run`
3. login check (`npm whoami --registry ...`)
4. `npm publish --access public --registry ...`

## Mirror registry note

If your default npm registry is a mirror (for example `https://registry.npmmirror.com`), publishing may fail unless you authenticate against that mirror.

This project forces publish target to npmjs using:

- `package.json` -> `publishConfig.registry = https://registry.npmjs.org/`
- `scripts/publish-npm.sh` -> `--registry https://registry.npmjs.org/`

## Optional: use a custom registry explicitly

```bash
NPM_REGISTRY=https://registry.npmjs.org/ npm run release:npm
```

## Verify publish

```bash
npm view @wangxt0223/codex-switcher version dist-tags --registry https://registry.npmjs.org/
```
