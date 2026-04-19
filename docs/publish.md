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

## Publish with token (no `npm login`)

If you want to publish directly with a token:

```bash
NPM_TOKEN=npm_xxx npm run release:npm:token
```

With 2FA OTP:

```bash
NPM_TOKEN=npm_xxx NPM_CONFIG_OTP=123456 npm run release:npm:token
```

Or pass token by arg:

```bash
./scripts/publish-npm-with-token.sh --token npm_xxx --otp 123456
```

`release:npm:token` runs `scripts/publish-npm-with-token.sh`, which:

1. creates a temporary npm config with your token
2. runs `npm run check` and `npm pack --dry-run` (unless `--skip-check`)
3. validates auth with `npm whoami`
4. publishes via `npm publish --access public --registry ...`

## Auto release script (set version + changelog + publish)

`scripts/release-publish.sh` can do all of these in one command:

1. set package version (`package.json` + `package-lock.json`)
2. prepend a new changelog section in `CHANGELOG.md`
3. run `npm run check` and `npm pack --dry-run` (unless `--skip-check`)
4. run publish:
   `npm publish --access public --registry https://registry.npmjs.org/`

Example:

```bash
npm run release:npm:auto -- \
  --version 0.7.3 \
  --note "Added env/account remove commands with double confirmation."
```

Multiple notes:

```bash
npm run release:npm:auto -- \
  --version 0.7.3 \
  --note "Added feature A." \
  --note "Fixed bug B."
```

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
