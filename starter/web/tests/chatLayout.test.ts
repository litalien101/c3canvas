import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('editor chat reserves its own column instead of floating over the character viewport', () => {
  assert.match(appSource, /studio-shell\$\{chatOpen \? ' chat-open' : ' chat-collapsed'\}/);
  assert.match(styles, /\.app-shell\.studio-shell \{\s*display: grid;[\s\S]*?grid-template-columns: 108px clamp\(210px, 18vw, 260px\) minmax\(0, 1fr\) !important;/);
  assert.match(styles, /\.app-shell\.studio-shell > \.chat-widget \{\s*position: relative !important;[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 2;/);
  assert.match(styles, /\.app-shell\.studio-shell > \.workspace\.fixed-workspace \{\s*display: grid !important;[\s\S]*?grid-column: 3 !important;/);
  assert.match(styles, /\.app-shell\.studio-shell \.workspace\.fixed-workspace > \.viewport-area \{\s*position: relative !important;/);
  assert.doesNotMatch(appSource, /composerPosition|composerDragging|position: 'fixed'/);
});

test('responsive editor keeps chat separate from the viewport', () => {
  assert.match(styles, /@media \(max-width: 760px\) \{\s*\.app-shell\.studio-shell \{[\s\S]*?grid-template-rows: 56px minmax\(0, min\(24dvh, 190px\)\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.app-shell\.studio-shell > \.chat-widget \{\s*grid-column: 2;\s*grid-row: 2;/);
  assert.match(styles, /\.app-shell\.studio-shell > \.workspace\.fixed-workspace \{\s*grid-column: 2 !important;\s*grid-row: 3 !important;/);
});
