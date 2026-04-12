# Upgrade Guide

## Source install users

```bash
git pull
./scripts/install.sh
codex-sw check
```

## npm users

```bash
codex-sw upgrade
codex-sw check
```

## Breaking behavior notes

- `codex-sw` is the preferred command namespace.
- `codex-switcher` remains available for compatibility.
- `codex-sw app stop` now targets only managed App processes launched by `codex-sw`.

## Recovery

If pointers are corrupted or profile directories are missing:

```bash
codex-sw recover
codex-sw status
```
