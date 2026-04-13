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

## Recovery

If pointers are corrupted, or env/account data directories are missing:

```bash
codex-sw ops recover
codex-sw status
```
