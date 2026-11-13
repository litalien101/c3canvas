import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('compact workspace stays viewport-bound and uses a stacked viewport/editor layout', () => {
  assert.match(styles, /@media \(max-width: 1100px\) \{[\s\S]*?grid-template-rows: minmax\(140px, 1fr\) minmax\(180px, var\(--character-dock-height, 48%\)\) !important;[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.app-shell:not\(\.landing-shell\) \{\s*display: grid;\s*height: 100dvh;/);
  assert.match(styles, /\.character-dock-scroll \{\s*min-height: 0;\s*flex: 1 1 auto;\s*overflow: auto;/);
});

test('zoomed character editor fits the visual viewport instead of clipping the workspace', () => {
  assert.match(appSource, /visualViewport\.scale > 1\.25 && visualViewport\.width < 760/);
  assert.match(appSource, /visualViewport\?\.addEventListener\('resize', updateCompactWorkspace\)/);
  assert.match(appSource, /zoomFitViewport \? ' is-zoom-fit' : ''/);
  assert.match(appSource, /if \(project && \(zoomFitViewport \|\| compactWorkspace\)\) setChatOpen\(false\)/);
  assert.match(appSource, /\[project\?\.id, zoomFitViewport !== null \|\| compactWorkspace\]/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit \{\s*position: fixed;\s*inset: 0 auto auto 0;\s*width: var\(--landing-visual-width\);\s*height: var\(--landing-visual-height\);/);
  assert.match(styles, /grid-template-columns: 48px minmax\(120px, 24%\) minmax\(0, 1fr\) !important;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit\.chat-collapsed \{\s*grid-template-columns: 48px 48px minmax\(0, 1fr\) !important;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit \.top-actions > \.export-button:not\(\.export-secondary\) \{\s*width: auto;\s*min-width: max-content;[\s\S]*?font-size: 8px;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit > \.chat-widget\.is-collapsed \.chat-launcher \{\s*display: grid;\s*width: 40px;\s*height: 40px;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit \.chat-launcher-label \{\s*display: block;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit > \.chat-widget\.is-open \.composer \{\s*display: grid;\s*min-height: 60px;\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit > \.chat-widget\.is-open \.composer textarea \{\s*width: 100%;\s*min-height: 30px;[\s\S]*?font-size: 8px;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit \.morph-editor-heading \{\s*min-height: 30px;\s*margin-bottom: 5px;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit \.morph-anatomy-nav \{\s*min-height: 32px;[\s\S]*?padding: 3px 4px;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit \.morph-anatomy-option \{\s*min-height: 30px;\s*padding: 2px 5px;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit > \.workspace\.fixed-workspace \{\s*display: grid !important;[\s\S]*?grid-template-rows: minmax\(0, 0\.42fr\) minmax\(0, 0\.58fr\) !important;/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit \.character-dock-scroll:has\(\.morph-workspace\) \{\s*display: block;\s*overflow: auto;/);
});

test('workspace presets and separator adapt to compact layout dimensions', () => {
  assert.match(appSource, /aria-label="Workspace layout"/);
  assert.match(appSource, /chooseViewportLayout\('viewport'\)/);
  assert.match(appSource, /chooseViewportLayout\('balanced'\)/);
  assert.match(appSource, /chooseViewportLayout\('editor'\)/);
  assert.match(appSource, /aria-orientation=\{compactWorkspace \? 'horizontal' : 'vertical'\}/);
  assert.match(appSource, /event\.key === 'ArrowUp' \? 24 : -24/);
});

test('compact editor navigation and preset cards fit narrow editor widths', () => {
  assert.match(styles, /\.character-dock-tabs \{\s*position: relative;[\s\S]*?overflow-x: auto;/);
  assert.match(styles, /\.morph-anatomy-nav \{\s*display: flex;[\s\S]*?overflow-x: auto;/);
  assert.match(styles, /grid-template-columns: repeat\(auto-fit, minmax\(min\(150px, 100%\), 1fr\)\);/);
});

test('character editor uses independent viewport, editor, and morph scroll regions', () => {
  assert.match(appSource, /}, \[compactWorkspace, viewportLayout, project\?\.id\]\);/);
  assert.match(styles, /\.app-shell\.studio-shell > \.workspace\.fixed-workspace \{\s*display: grid !important;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(320px, var\(--character-dock-width, 35vw\)\) !important;/);
  assert.match(styles, /\.app-shell\.studio-shell \.workspace\.fixed-workspace > \.viewport-area \.canvas-wrap \{\s*position: absolute;\s*inset: 0;/);
  assert.match(styles, /\.app-shell\.studio-shell > \.workspace\.fixed-workspace > \.character-dock \{\s*position: relative;/);
  assert.match(styles, /\.app-shell\.studio-shell \.character-dock-tabs \{\s*position: relative;/);
  assert.match(styles, /\.app-shell\.studio-shell \.character-dock-scroll \{\s*min-width: 0;\s*min-height: 0;\s*flex: 1 1 auto;\s*overflow-x: hidden;\s*overflow-y: auto;/);
  assert.match(styles, /\.app-shell\.studio-shell \.morph-editor-heading \{\s*position: sticky;/);
  assert.match(styles, /\.app-shell\.studio-shell \.morph-anatomy-nav \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow-x: auto;\s*overflow-y: hidden;/);
  assert.match(styles, /\.app-shell\.studio-shell \.viewport-area > \.preview-status\[role="status"\] \{\s*position: absolute;[\s\S]*?top: 50%;\s*left: 50%;/);
  assert.match(styles, /\.app-shell\.studio-shell \{\s*height: 100dvh;[\s\S]*?grid-template-rows: 64px minmax\(0, 1fr\);/);
  assert.match(styles, /\.app-shell\.studio-shell\.is-zoom-fit > \.workspace\.fixed-workspace \{\s*grid-template-columns: minmax\(0, 1fr\) !important;\s*grid-template-rows: minmax\(0, 0\.42fr\) minmax\(0, 0\.58fr\) !important;/);
});

test('narrow character editor collapses Chat and fits the stacked workspace without fixed minimum overflow', () => {
  assert.match(styles, /@media \(max-width: 760px\) \{\s*\.app-shell\.studio-shell,\s*\.app-shell\.studio-shell\.is-zoom-fit \{\s*grid-template-columns: 48px minmax\(0, 1fr\) !important;\s*grid-template-rows: 52px minmax\(0, 1fr\) !important;/);
  assert.match(styles, /\.app-shell\.studio-shell\.chat-collapsed,\s*\.app-shell\.studio-shell\.is-zoom-fit\.chat-collapsed \{\s*grid-template-rows: 52px 44px minmax\(0, 1fr\) !important;/);
  assert.match(styles, /\.app-shell\.studio-shell > \.chat-widget\.is-collapsed \.chat-launcher \{\s*display: grid;/);
  assert.match(styles, /\.app-shell\.studio-shell > \.studio-sidebar,[\s\S]*?grid-row: 2 \/ 4;[\s\S]*?body \.app-shell\.studio-shell > \.studio-sidebar,[\s\S]*?width: 48px;/);
  assert.match(styles, /\.app-shell\.studio-shell > \.workspace\.fixed-workspace,\s*\.app-shell\.studio-shell\.is-zoom-fit > \.workspace\.fixed-workspace \{\s*grid-column: 2 !important;\s*grid-row: 3 !important;\s*grid-template-columns: minmax\(0, 1fr\) !important;\s*grid-template-rows: minmax\(84px, 0\.48fr\) minmax\(0, 0\.52fr\) !important;/);
});

test('viewport display controls stay at the top and leave the lower canvas unobstructed', () => {
  assert.match(styles, /\.app-shell\.studio-shell \.viewport-bottom-toolbar \{\s*top: 8px;\s*right: 8px;\s*bottom: auto;\s*left: auto;[\s\S]*?transform: none;/);
  assert.match(styles, /@media \(max-width: 760px\) \{\s*\.app-shell\.studio-shell \.viewport-mode-controls \{\s*top: 8px;\s*right: auto;\s*bottom: auto;\s*left: 8px;\s*flex-direction: row;/);
  assert.match(styles, /@media \(max-width: 430px\) \{\s*\.app-shell\.studio-shell \.viewport-mode-controls \{\s*top: 46px;/);
  assert.match(styles, /@media \(max-height: 320px\) \{\s*\.app-shell\.studio-shell \.viewport-mode-controls \{\s*top: 8px;[\s\S]*?flex-direction: row;/);
  assert.match(styles, /@media \(max-width: 920px\) and \(max-height: 320px\) \{\s*\.app-shell\.studio-shell \.viewport-mode-controls \{\s*top: 50px;/);
  assert.match(styles, /@media \(max-width: 430px\), \(max-height: 320px\) \{\s*\.app-shell\.studio-shell \.viewport-mode-controls \{\s*width: max-content;\s*flex-wrap: nowrap;/);
  assert.match(styles, /\.app-shell\.studio-shell \.viewport-mode-controls button \{\s*width: 28px;\s*min-height: 24px;\s*height: 24px;\s*flex: 0 0 28px;/);
});
