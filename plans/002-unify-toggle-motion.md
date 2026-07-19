# 002 — Unify toggle response timing

- **Status**: TODO
- **Commit**: 8210b71
- **Severity**: MEDIUM
- **Category**: Easing & duration / Cohesion & tokens
- **Estimated scope**: 1 file, 2 declarations

## Problem

The toggle track uses the browser's generic `ease` curve for a 240ms background transition, while the thumb uses the product's strong drawer curve. This makes the track and thumb settle with different velocity profiles on every settings, routing, compatibility, and skill toggle.

```css
/* apps/desktop/src/index.css:305-313 — current */
.motion-toggle {
  transition:
    background-color var(--motion-toggle) ease,
    opacity var(--animate-duration-fast) ease;
}

.motion-toggle-thumb {
  transition: transform var(--motion-toggle) var(--ease-drawer);
```

## Target

Use the existing strong ease-out curve and reduce the track duration to 180ms so the track and thumb complete as one crisp state change. Keep opacity at the existing 160ms fast token.

```css
/* target */
.motion-toggle {
  transition:
    background-color var(--motion-toggle) var(--ease-out),
    opacity var(--animate-duration-fast) var(--ease-out);
}

.motion-toggle-thumb {
  transition: transform var(--motion-toggle) var(--ease-drawer);
```

Change the shared token at `apps/desktop/src/index.css:88` from `--motion-toggle: 240ms` to `--motion-toggle: 180ms`. Keep `--ease-drawer` for the thumb because its spatial movement benefits from the drawer curve.

## Repo conventions to follow

- Product curves are centralized in `apps/desktop/src/index.css:89-91`; use `var(--ease-out)` rather than another inline cubic-bezier.
- Popovers already pair opacity and transform with `var(--ease-out)` in `apps/desktop/src/index.css:211-218`.
- The reduced-motion block already targets `.motion-toggle-thumb` in `apps/desktop/src/index.css:558-568`; preserve it.

## Steps

1. Change `--motion-toggle` to `180ms` in `apps/desktop/src/index.css`.
2. Replace both `ease` occurrences in `.motion-toggle` with `var(--ease-out)`.
3. Update the existing motion assertions in `apps/desktop/src/components/responsive-layout.test.ts` from 240ms/ease to 180ms/var(--ease-out).

## Boundaries

- Do NOT change toggle markup, colors, thumb distance, or disabled states.
- Do NOT alter the thumb's `--ease-drawer` curve.
- Do NOT remove reduced-motion handling or introduce a keyframe.

## Verification

- **Mechanical**: run `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts` and `npm run --workspace appsdesktop build`.
- **Feel check**: toggle environment history, auto-resume, proxy lifecycle, compatibility, and skill sync. At 10% playback, the track color and thumb should settle together without a delayed color tail. Toggle rapidly twice; the transition must retarget from the current position rather than restart.
- With reduced motion enabled, state changes should remain readable but the thumb must not visibly travel.
- **Done when**: all toggle instances share the same 180ms response and no generic `ease` remains in `.motion-toggle`.
