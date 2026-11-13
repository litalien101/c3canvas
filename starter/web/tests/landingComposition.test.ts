import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('homepage groups the workflow with the hero and the assistant with the dashboard cards', () => {
  const heroRowStart = appSource.indexOf('className="landing-dashboard-content"');
  const dashboardCardsStart = appSource.indexOf('className="landing-home-panels"');
  const heroRow = appSource.slice(heroRowStart, dashboardCardsStart);
  const dashboardCards = appSource.slice(dashboardCardsStart, appSource.indexOf('id="landing-dashboard"', dashboardCardsStart));

  assert.ok(heroRowStart >= 0 && dashboardCardsStart > heroRowStart);
  assert.ok(heroRow.indexOf("getLandingCardProps('hero')") < heroRow.indexOf("getLandingCardProps('workflow')"));
  assert.match(dashboardCards, /getLandingCardProps\('assistant'\)/);
  assert.match(dashboardCards, /getLandingCardProps\('recent-projects'\)/);
  assert.match(dashboardCards, /getLandingCardProps\('new-projects'\)/);
  assert.match(appSource, /defaultLandingCardOrder: LandingCardId\[\] = \['hero', 'workflow', 'assistant', 'recent-projects', 'new-projects'\]/);
});

test('homepage composition gives the hero and workflow a shared row above three equal dashboard cards', () => {
  assert.match(styles, /\.app-shell\.landing-shell \.landing-dashboard \[data-dashboard-card="hero"\] \{\s*grid-column: span 8;/);
  assert.match(styles, /\.app-shell\.landing-shell \.landing-dashboard \[data-dashboard-card="assistant"\],[\s\S]*?\[data-dashboard-card="workflow"\] \{\s*grid-column: span 4;/);
  assert.match(styles, /@media \(max-width: 860px\) \{[\s\S]*?\[data-dashboard-card="hero"\],[\s\S]*?\[data-dashboard-card="workflow"\] \{\s*grid-column: 1 \/ -1;/);
  assert.match(styles, /@media \(max-width: 680px\) \{\s*\.app-shell\.landing-shell \.landing-page \{\s*overflow-x: hidden;\s*overflow-y: auto;/);
  assert.match(styles, /\.app-shell\.landing-shell \.landing-dashboard-content > \.landing-workflow-card \{\s*min-height: 230px !important;/);
  assert.match(styles, /\.app-shell\.landing-shell \.landing-home-panels > \.landing-assistant-column > \.landing-chat-widget \{\s*position: relative;\s*inset: auto;/);
  assert.doesNotMatch(styles, /\.app-shell\.landing-shell \.landing-dashboard \[data-dashboard-card="(?:new-projects|recent-projects|workflow)"\] \{[^}]*transform: translateX/);
});

test('homepage compacts its desktop cards in short viewports so hero content stays in its row', () => {
  const shortViewportStart = styles.lastIndexOf('@media (max-height: 600px) and (min-width: 861px)');
  const shortViewportLayout = styles.slice(shortViewportStart, styles.indexOf('\n:root {', shortViewportStart));

  assert.ok(shortViewportStart >= 0 && shortViewportLayout.length > 0);
  assert.match(shortViewportLayout, /\.landing-dashboard \{\s*grid-template-rows: 42px minmax\(180px, 36vh\) minmax\(154px, 30vh\);\s*align-content: start;[\s\S]*?overflow-y: hidden;/);
  assert.match(shortViewportLayout, /\.landing-dashboard-content \.landing-hero h1 \{\s*font-size: clamp\(22px, 2\.5vw, 25px\);/);
  assert.match(shortViewportLayout, /\.landing-home-panels \.landing-concept-art \{\s*height: 58px;\s*min-height: 58px;/);
  assert.match(shortViewportLayout, /\.landing-home-panels \.landing-project-list \{\s*gap: 0;/);
});

test('homepage limits hero art height on narrow screens so the copy and following cards do not overlap', () => {
  const shortViewportStart = styles.lastIndexOf('@media (max-height: 600px) and (min-width: 861px)');
  const narrowArtStart = styles.indexOf('@media (max-width: 860px)', shortViewportStart);
  const phoneLayoutStart = styles.indexOf('@media (max-width: 600px)', narrowArtStart);
  const narrowArtLayout = styles.slice(narrowArtStart, phoneLayoutStart);
  const phoneLayout = styles.slice(phoneLayoutStart, styles.indexOf('\n:root {', phoneLayoutStart));

  assert.match(narrowArtLayout, /\.landing-hero-art \{\s*height: min\(24vh, 190px\);/);
  assert.match(phoneLayout, /\.landing-dashboard \[data-dashboard-card="hero"\] \{\s*min-height: max-content;/);
  assert.match(styles, /\.app-shell\.landing-shell \.landing-home-panels \.landing-projects \{\s*min-height: 260px;/);
});

test('tablet dashboard scrolls rather than clipping cards when rows do not fit', () => {
  const tabletStart = styles.lastIndexOf('@media (min-width: 681px) and (max-width: 860px) {');
  const tabletLayout = styles.slice(tabletStart);

  assert.ok(tabletStart >= 0);
  assert.match(tabletLayout, /\.landing-dashboard \{\s*display: grid;\s*min-width: 0;\s*min-height: 0;[\s\S]*?grid-template-rows: 38px minmax\(230px, auto\) minmax\(154px, auto\);[\s\S]*?overflow-x: hidden;\s*overflow-y: auto;/);
  assert.match(tabletLayout, /\.landing-dashboard-content > \.landing-hero \{\s*min-height: 230px;\s*grid-template-columns: minmax\(0, 0\.62fr\) minmax\(0, 1\.38fr\);/);
  assert.match(tabletLayout, /\.landing-dashboard \.landing-workflow-card \{\s*min-height: 190px !important;/);
});

test('mobile cards use content-sized rows and compact artwork to avoid excessive scrolling', () => {
  const mobileStart = styles.lastIndexOf('@media (max-width: 680px) {');
  const mobileLayout = styles.slice(mobileStart);

  assert.ok(mobileStart >= 0);
  assert.match(mobileLayout, /\.landing-dashboard \{\s*display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-auto-rows: max-content;[\s\S]*?overflow-y: auto;/);
  assert.match(mobileLayout, /\.landing-dashboard \[data-dashboard-card="hero"\] \{\s*min-height: max-content;/);
  assert.match(mobileLayout, /\.landing-hero-art \{\s*height: clamp\(78px, 12vh, 100px\);/);
  assert.match(mobileLayout, /\.landing-workflow-card \{\s*min-height: 150px !important;/);
  assert.match(mobileLayout, /\.landing-chat-widget \{\s*min-height: 190px;\s*flex: 0 0 230px;/);
});

test('homepage fits the actual zoomed visual viewport when browser zoom makes the layout viewport misleading', () => {
  const fitLayoutStart = styles.indexOf('.app-shell.landing-shell .landing-page.is-zoom-fit {');
  const fitLayout = styles.slice(fitLayoutStart, styles.indexOf('\n:root {', fitLayoutStart));

  assert.match(appSource, /window\.visualViewport/);
  assert.match(appSource, /viewport\.scale > 1\.25 && viewport\.width < 760 && viewport\.height < 420/);
  assert.match(appSource, /'--landing-visual-width': `\$\{zoomFitViewport\.width\}px`/);
  assert.match(appSource, /'--landing-visual-height': `\$\{zoomFitViewport\.height\}px`/);
  assert.match(fitLayout, /width: var\(--landing-visual-width\);[\s\S]*?height: var\(--landing-visual-height\) !important;/);
  assert.match(fitLayout, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
  assert.match(fitLayout, /grid-template-rows: 24px minmax\(0, 0\.96fr\) minmax\(0, 1fr\);/);
  assert.match(fitLayout, /padding: 4px 5px 8px;/);
  assert.match(fitLayout, /\[data-dashboard-card="hero"\] \{\s*grid-column: span 4;/);
  assert.match(fitLayout, /\[data-dashboard-card="workflow"\] \{\s*grid-column: span 2;/);
  assert.match(fitLayout, /\.landing-dashboard-content > \.landing-hero \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(120px, 0\.6fr\);/);
  assert.match(fitLayout, /\.landing-hero-art \{\s*width: 100%;\s*height: 72px;/);
  assert.match(fitLayout, /\.landing-hero-art img \{\s*max-width: 88px;/);
  assert.match(fitLayout, /\.landing-concept-castle \{\s*display: none;/);
  assert.match(fitLayout, /\.landing-concept-caption \{\s*right: 5px;\s*bottom: 5px;\s*left: 5px;[\s\S]*?background: linear-gradient\(90deg, rgb\(5 13 38 \/ 78%\), rgb\(5 13 38 \/ 38%\)\);/);
  assert.match(fitLayout, /\.landing-workflow-symbol \{\s*top: 7px;\s*right: 8px;\s*width: 18px;\s*height: 18px;\s*border-width: 4px;/);
  assert.match(fitLayout, /\.landing-workflow-card::after \{\s*right: -30px;\s*bottom: -64px;\s*width: 130px;\s*height: 130px;\s*opacity: 0\.42;/);
  assert.match(fitLayout, /\[data-dashboard-card="assistant"\],[\s\S]*?\[data-dashboard-card="recent-projects"\] \{\s*grid-column: span 2;/);
});
