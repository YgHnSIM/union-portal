import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DocCategory } from '../domain/types.js';
import { CATEGORY_REGISTRY } from '../domain/content-graph.js';

export const SITE_BASE_URL = 'https://yghnsim.github.io/union-portal';

export type TopAxis = 'home' | 'archive' | 'accounting' | 'union';
export type AccountingSection = 'dashboard' | 'ledger' | 'coa' | 'reports';
export type UnionSection = 'org' | 'about' | 'bylaws-guide' | 'bylaws';

export interface AssetManifest {
  hashes: Map<string, string>;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

export function fmtWon(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

export function fmtSigned(n: number): string {
  const r = Math.round(n);
  return `${r >= 0 ? '+' : ''}${r.toLocaleString('ko-KR')}`;
}

export function fmtMan(n: number): string {
  if (!n) return '0원';
  const abs = Math.abs(n);
  if (abs >= 10000) {
    const man = n / 10000;
    const rounded = Math.round(man * 10) / 10;
    if (Number.isInteger(rounded)) return `${rounded.toLocaleString('ko-KR')}만원`;
    return `${rounded.toFixed(1)}만원`;
  }
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

export function computePrefixForRoute(route: string): string {
  const dir = path.posix.dirname(route.replace(/\\/g, '/'));
  if (!dir || dir === '.') return '';
  const depth = dir.split('/').filter(Boolean).length;
  return '../'.repeat(depth);
}

export function copyAndHashAssets(
  srcAssetsDir: string,
  destAssetsDir: string,
): AssetManifest {
  const hashes = new Map<string, string>();
  fs.mkdirSync(destAssetsDir, { recursive: true });

  const walk = (curSrc: string, relDir: string): void => {
    for (const entry of fs.readdirSync(curSrc, { withFileTypes: true })) {
      const srcPath = path.join(curSrc, entry.name);
      const relPosix = relDir ? `${relDir}/${entry.name}` : entry.name;
      const destPath = path.join(destAssetsDir, ...relPosix.split('/'));
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        walk(srcPath, relPosix);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const buf = fs.readFileSync(srcPath);
        fs.writeFileSync(destPath, buf);
        const digest = createHash('sha256').update(buf).digest('hex').slice(0, 12);
        hashes.set(relPosix, digest);
      }
    }
  };

  if (fs.existsSync(srcAssetsDir)) {
    walk(srcAssetsDir, '');
  }
  return { hashes };
}

export function assetHref(
  prefix: string,
  relAsset: string,
  assets: AssetManifest,
): string {
  const normalized = relAsset.replace(/^assets\//, '').replace(/^\//, '');
  const hash = assets.hashes.get(normalized);
  return hash
    ? `${prefix}assets/${normalized}?v=${hash}`
    : `${prefix}assets/${normalized}`;
}

export function canonicalUrlForRoute(route: string, baseUrl: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const norm = route.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm === 'index.html' || !norm) return `${cleanBase}/`;
  if (norm.endsWith('/index.html')) {
    return `${cleanBase}/${norm.slice(0, -'index.html'.length)}`;
  }
  return `${cleanBase}/${norm}`;
}

const FOUC_THEME_SCRIPT =
  '<script>(function(){try{var s=localStorage.getItem("color-scheme");if(s==="light"||s==="dark"){document.querySelector(\'meta[name="color-scheme"]\').content=s;document.documentElement.dataset.theme=s;}else{var d=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=d;}}catch(_){}})();</script>';

export interface RenderShellOptions {
  title: string;
  description: string;
  activeNav: TopAxis;
  route: string;
  prefix?: string;
  baseUrl?: string;
  assets: AssetManifest;
  robots?: string;
  ogType?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  keywords?: string[];
  jsonLd?: Record<string, unknown>;
  extraHeadHtml?: string;
  subnavHtml?: string;
  bodyHtml: string;
  extraScriptsHtml?: string;
}

const UNION_EMBLEM_POLYGONS_THEMED =
  '<polygon points="39.8,1.7 1.2,24 1.2,70 39.8,92.3 39.8,74.8 16.3,61.3 16.3,32.7 39.8,19.2" fill="var(--brand-emblem-blue, #516db2)"></polygon>' +
  '<polygon points="42.2,1.7 80.8,24 80.8,70 42.2,92.3 42.2,74.8 65.7,61.3 65.7,32.7 42.2,19.2" fill="var(--brand-emblem-ink, #0b051a)"></polygon>' +
  '<polygon points="39.8,22.8 21.2,33.5 39.8,44.3" fill="var(--brand-emblem-ink, #0b051a)"></polygon>' +
  '<polygon points="42.2,22.8 60.8,33.5 42.2,44.3" fill="var(--brand-emblem-blue, #516db2)"></polygon>';

const UNION_EMBLEM_POLYGONS_LIGHT =
  '<polygon points="39.8,1.7 1.2,24 1.2,70 39.8,92.3 39.8,74.8 16.3,61.3 16.3,32.7 39.8,19.2" fill="#516db2"></polygon>' +
  '<polygon points="42.2,1.7 80.8,24 80.8,70 42.2,92.3 42.2,74.8 65.7,61.3 65.7,32.7 42.2,19.2" fill="#0b051a"></polygon>' +
  '<polygon points="39.8,22.8 21.2,33.5 39.8,44.3" fill="#0b051a"></polygon>' +
  '<polygon points="42.2,22.8 60.8,33.5 42.2,44.3" fill="#516db2"></polygon>';

const UNION_WORDMARK_SUB_PATH =
  'M123.8 25.8H99V28.6H109.7V37.7H113V28.6H123.8ZM111.4 11.5C105.6 11.5 101.6 13.8 101.6 17.6C101.6 21.3 105.6 23.6 111.4 23.6C117.1 23.6 121.2 21.3 121.2 17.6C121.2 13.8 117.1 11.5 111.4 11.5ZM111.4 14.2C115.2 14.2 117.7 15.4 117.7 17.6C117.7 19.7 115.2 20.9 111.4 20.9C107.5 20.9 105 19.7 105 17.6C105 15.4 107.5 14.2 111.4 14.2Z M134.7 18.8V18H139.2V15.3H134.7V11.5H131.6V15.3H126.9V18H131.6V18.8C131.6 23.1 129.8 27.6 126 29.9L127.9 32.4C130.5 30.9 132.2 28.3 133.2 25.2C134.1 28 135.9 30.4 138.4 31.8L140.2 29.3C136.5 27.2 134.7 23 134.7 18.8ZM149.8 10.5H146.6V37.7H149.8ZM144.3 11H141.1V20.9H137.6V23.7H141.1V36.4H144.3Z M175.6 11.7H156.9V14.4H172.3C172.3 16.3 172.2 18.4 171.7 21.2H153.8V23.9H164.5V28.1H156.3V30.8H172.3V37.7H175.6V28.1H167.8V23.9H178.6V21.2H175C175.6 18.2 175.6 15.8 175.6 13.8Z M205.9 21.5H181.2V24.2H191.8V26.2H184.1V28.8H199.6V30.5H184.1V37.4H203.6V34.9H187.4V32.9H202.8V26.2H195.2V24.2H205.9ZM202.8 11.3H184.3V19.8H202.8ZM187.6 14H199.4V17.2H187.6Z M233.4 26.6H208.5V29.2H214.6V37.7H217.9V29.2H224V37.7H227.4V29.2H233.4ZM230.5 11.4H211.4V14.1H227V16.5H211.5V24.3H231.1V21.6H214.9V19H230.5Z M246.2 18.2V15.9H252.1V13.2H236.8V15.9H242.8V18.2C242.8 22.9 240.1 27.9 235.8 29.9L237.7 32.5C240.9 31 243.3 27.9 244.6 24.2C245.8 27.6 248.1 30.5 251.4 31.8L253.2 29.2C248.8 27.4 246.2 22.7 246.2 18.2ZM258.5 10.5H255.2V37.7H258.5Z M286.1 10.5H282.7V26.4H277.4V28.7H282.7V31.1H286.1ZM286.7 34.4H270.1V29.1H266.8V37.1H286.7ZM263.2 22.7 263.6 25.4C265.7 25.4 268.2 25.4 270.7 25.3V30.3H274V25.1C276.3 25 278.7 24.7 280.9 24.3L280.7 21.9C274.9 22.6 268.2 22.7 263.2 22.7ZM272.1 11.5C268 11.5 265.3 13.5 265.3 16.3C265.3 19.2 268 21.1 272.1 21.1C276 21.1 278.8 19.2 278.8 16.3C278.8 13.5 276 11.5 272.1 11.5ZM272.1 14C274.1 14 275.6 14.9 275.6 16.3C275.6 17.8 274.1 18.7 272.1 18.7C269.9 18.7 268.4 17.8 268.4 16.3C268.4 14.9 269.9 14 272.1 14Z M312.1 10.5H308.8V30.2H312.1V20.9H315.9V18.1H312.1ZM304 12.8H291.8V25.6H294C300 25.6 303.1 25.4 306.7 24.7L306.3 22C303.1 22.7 300.3 22.8 295.1 22.8V15.4H304ZM313.2 34.4H298.1V28.1H294.7V37.1H313.2Z';

const UNION_WORDMARK_MAIN_PATH =
  'M132.8 60.8H99V65.3H112.9V67.3H102.8V71.6H123V73.1H102.8V83.2H129.6V78.9H108.6V77.2H128.7V67.3H118.7V65.3H132.8ZM128.5 47.4H103.1V59.2H128.5ZM108.8 51.9H122.7V54.8H108.8Z M169.3 68H135.5V72.5H143.1V83.4H148.9V72.5H156V83.4H161.9V72.5H169.3ZM165.5 47.4H139.4V52.1H159.5V54.4H139.4V65.7H166.4V61.1H145.3V58.6H165.5Z M202.3 62.1H181.7V49.1H175.7V66.7H186.1V74.7H172.1V79.4H205.9V74.7H191.9V66.7H202.3Z M242.4 63.6H228.4V60.8H238.6V56.3H218.4V52.5H238.4V48H212.6V60.8H222.7V63.6H208.6V68.2H242.4ZM225.4 69.7C217.3 69.7 212.4 72.2 212.4 76.6C212.4 81 217.3 83.5 225.4 83.5C233.5 83.5 238.3 81 238.3 76.6C238.3 72.2 233.5 69.7 225.4 69.7ZM225.4 74.1C230.2 74.1 232.5 74.9 232.5 76.6C232.5 78.4 230.2 79.1 225.4 79.1C220.5 79.1 218.3 78.4 218.3 76.6C218.3 74.9 220.5 74.1 225.4 74.1Z M279 74.5H264.9V66.6H259.1V74.5H245.1V79.3H279ZM276 49H247.9V53.7H258.8C258.2 58.2 254.3 62.5 246.4 63.7L248.7 68.3C255.2 67.2 259.7 64 262 59.8C264.4 63.9 268.9 66.9 275.6 68L277.8 63.5C269.7 62.3 265.7 58.2 265.1 53.7H276Z M311.1 46.4H305.3V68.1H311.1V59.9H315.9V55.1H311.1ZM292.4 69.5H286.7V83H311.1V69.5H305.3V72H292.4ZM292.4 78.5V76.4H305.3V78.5ZM303.6 49.4H295.5V46.2H289.7V49.4H281.6V54H303.6ZM292.6 54.8C287.1 54.8 283.3 57.4 283.3 61.4C283.3 65.3 287.1 68 292.6 67.9C298 68 301.8 65.3 301.8 61.4C301.8 57.4 298 54.8 292.6 54.8ZM292.6 59.1C294.8 59.1 296.3 59.9 296.3 61.4C296.3 63 294.8 63.7 292.6 63.7C290.4 63.7 289 63 289 61.4C289 59.9 290.4 59.1 292.6 59.1Z';

export function renderUnionEmblemSvg(cls = 'brand-emblem', lightOnly = false): string {
  const polygons = lightOnly ? UNION_EMBLEM_POLYGONS_LIGHT : UNION_EMBLEM_POLYGONS_THEMED;
  return `<svg class="${escapeAttr(cls)}" viewBox="0 0 82 94" width="32" height="37" aria-hidden="true" focusable="false">${polygons}</svg>`;
}

export function renderUnionBrandLockup(
  cls = 'brand-lockup-svg',
  opts?: { lightOnly?: boolean; ariaLabel?: string },
): string {
  const lightOnly = opts?.lightOnly ?? false;
  const polygons = lightOnly ? UNION_EMBLEM_POLYGONS_LIGHT : UNION_EMBLEM_POLYGONS_THEMED;
  const blueFill = lightOnly ? '#516db2' : 'var(--brand-emblem-blue, #516db2)';
  const inkFill = lightOnly ? '#0b051a' : 'var(--brand-emblem-ink, #0b051a)';
  const a11yAttrs = opts?.ariaLabel
    ? `role="img" aria-label="${escapeAttr(opts.ariaLabel)}"`
    : 'aria-hidden="true"';
  return `<svg class="${escapeAttr(cls)}" viewBox="0 0 316.9 94" width="121" height="36" ${a11yAttrs} focusable="false">${polygons}<path class="brand-wordmark-sub" d="${UNION_WORDMARK_SUB_PATH}" fill="${blueFill}"></path><path class="brand-wordmark-main" d="${UNION_WORDMARK_MAIN_PATH}" fill="${inkFill}"></path></svg>`;
}

export function renderPageShell(opts: RenderShellOptions): string {
  const baseUrl = (opts.baseUrl ?? SITE_BASE_URL).replace(/\/+$/, '');
  const prefix = opts.prefix ?? computePrefixForRoute(opts.route);
  const canonical = canonicalUrlForRoute(opts.route, baseUrl);
  const ogImage = `${baseUrl}/assets/social-card.png`;
  const appCss = assetHref(prefix, 'app.css', opts.assets);
  const navJs = assetHref(prefix, 'nav.js', opts.assets);
  const fav32 = assetHref(prefix, 'favicon-32.png', opts.assets);
  const fav192 = assetHref(prefix, 'favicon-192.png', opts.assets);

  const navItems: Array<{ key: TopAxis; label: string; href: string; cls?: string }> = [
    { key: 'home', label: '홈', href: `${prefix}index.html` },
    {
      key: 'archive',
      label: '자료실',
      href: `${prefix}archive/index.html`,
      cls: 'site-archive-entry',
    },
    { key: 'accounting', label: '회계', href: `${prefix}accounting/index.html` },
    { key: 'union', label: '조합', href: `${prefix}union/index.html` },
  ];

  const menuLinks = navItems
    .map((item) => {
      const current = item.key === opts.activeNav ? ' aria-current="page"' : '';
      const clsAttr = item.cls ? ` class="${item.cls}"` : '';
      return `          <li><a href="${escapeAttr(item.href)}"${clsAttr}${current}>${escapeHtml(item.label)}</a></li>`;
    })
    .join('\n');

  const metaRobots = opts.robots
    ? `\n  <meta name="robots" content="${escapeAttr(opts.robots)}">`
    : '';
  const metaKeywords =
    opts.keywords && opts.keywords.length > 0
      ? `\n  <meta name="keywords" content="${escapeAttr(opts.keywords.join(', '))}">`
      : '';
  const metaPub = opts.publishedTime
    ? `\n  <meta property="article:published_time" content="${escapeAttr(opts.publishedTime)}">`
    : '';
  const metaMod = opts.modifiedTime
    ? `\n  <meta property="article:modified_time" content="${escapeAttr(opts.modifiedTime)}">`
    : '';
  const jsonLdScript = opts.jsonLd
    ? `\n  <script type="application/ld+json">${JSON.stringify(opts.jsonLd).replace(/<\//g, '<\\/')}</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  ${FOUC_THEME_SCRIPT}
  <title>${escapeHtml(opts.title)} — 우체국물류지원단 물류노동조합</title>
  <meta name="description" content="${escapeAttr(opts.description)}">${metaRobots}${metaKeywords}
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <meta property="og:site_name" content="우체국물류지원단 물류노동조합">
  <meta property="og:type" content="${opts.ogType ?? 'website'}">
  <meta property="og:title" content="${escapeAttr(opts.title)}">
  <meta property="og:description" content="${escapeAttr(opts.description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:image" content="${escapeAttr(ogImage)}">${metaPub}${metaMod}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(opts.title)}">
  <meta name="twitter:description" content="${escapeAttr(opts.description)}">
  <meta name="twitter:image" content="${escapeAttr(ogImage)}">
  <link rel="icon" type="image/png" sizes="32x32" href="${escapeAttr(fav32)}">
  <link rel="icon" type="image/png" sizes="192x192" href="${escapeAttr(fav192)}">
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="preconnect" href="https://hangeul.pstatic.net" crossorigin>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">${jsonLdScript}
  <link rel="stylesheet" href="${escapeAttr(appCss)}">
  ${opts.extraHeadHtml ?? ''}
</head>
<body>
<a class="skip-link" href="#main-content">본문으로 바로가기</a>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="${escapeAttr(`${prefix}index.html`)}" aria-label="우체국물류지원단 물류노동조합 포털 홈">
      ${renderUnionBrandLockup()}
    </a>
    <div class="header-controls">
      <nav class="site-nav" aria-label="주요 메뉴">
        <button type="button" class="menu-toggle" popovertarget="site-menu" aria-label="메뉴 열기">
          <svg class="menu-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="4" y1="7" x2="20" y2="7"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="17" x2="20" y2="17"/>
          </svg>
          <span>메뉴</span>
        </button>
        <ul id="site-menu" class="site-menu" popover="auto">
${menuLinks}
        </ul>
      </nav>
      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="다크 모드로 전환" aria-pressed="false">
        <span class="theme-opt-dark">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
          <span>다크</span>
        </span>
        <span class="theme-opt-light">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
          </svg>
          <span>라이트</span>
        </span>
      </button>
    </div>
  </div>
</header>
<main id="main-content" class="main-wrap">
  ${opts.subnavHtml ?? ''}
  ${opts.bodyHtml}
</main>
<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-colophon">
      <div class="footer-brand">
        ${renderUnionEmblemSvg('footer-emblem')}
        <div class="footer-org-group">
          <strong class="footer-org">우체국물류지원단 물류노동조합</strong>
          <span class="footer-units">공개 포털</span>
        </div>
      </div>
      <p class="footer-privacy">공적 직무 활동에 한해 공식 직무자의 직책·성명을 표기하며, 일반 조합원의 개인·재정 정보는 전면 비식별하여 공개합니다.</p>
    </div>
    <nav class="footer-nav no-print" aria-label="하단 바로가기">
      <a href="${escapeAttr(`${prefix}index.html`)}">포털 홈</a>
      <a href="${escapeAttr(`${prefix}archive/index.html`)}">자료실</a>
      <a href="${escapeAttr(`${prefix}accounting/index.html`)}">회계</a>
      <a href="${escapeAttr(`${prefix}union/index.html`)}">조합·규약</a>
    </nav>
  </div>
</footer>
<script src="${escapeAttr(navJs)}"></script>
${opts.extraScriptsHtml ?? ''}
</body>
</html>
`;
}

export function renderAccountingSubnav(
  prefixToAccounting: string,
  active: AccountingSection,
): string {
  const items: Array<{ key: AccountingSection; label: string; href: string }> = [
    { key: 'dashboard', label: '대시보드', href: `${prefixToAccounting}index.html` },
    { key: 'ledger', label: '거래 탐색기', href: `${prefixToAccounting}ledger.html` },
    { key: 'coa', label: '회계기준·단위', href: `${prefixToAccounting}coa.html` },
    { key: 'reports', label: '보고서 아카이브', href: `${prefixToAccounting}reports/index.html` },
  ];
  const links = items
    .map((it) => {
      const cur = it.key === active ? ' aria-current="page"' : '';
      return `<a href="${escapeAttr(it.href)}"${cur}>${escapeHtml(it.label)}</a>`;
    })
    .join('\n    ');
  return `<nav class="section-subnav no-print" aria-label="회계 섹션 메뉴">\n    ${links}\n  </nav>`;
}

export function renderUnionSubnav(
  prefixToUnion: string,
  active: UnionSection | null,
): string {
  const items: Array<{ key: UnionSection; label: string; href: string }> = [
    { key: 'org', label: '조직·임원 현황', href: `${prefixToUnion}index.html` },
    { key: 'about', label: '조합 소개', href: `${prefixToUnion}about.html` },
    { key: 'bylaws-guide', label: '규약 한눈에 보기', href: `${prefixToUnion}bylaws-guide.html` },
    { key: 'bylaws', label: '규약 전문', href: `${prefixToUnion}bylaws.html` },
  ];
  const links = items
    .map((it) => {
      const cur = active !== null && it.key === active ? ' aria-current="page"' : '';
      return `<a href="${escapeAttr(it.href)}"${cur}>${escapeHtml(it.label)}</a>`;
    })
    .join('\n    ');
  return `<nav class="section-subnav no-print" aria-label="조합 안내 섹션 메뉴">\n    ${links}\n  </nav>`;
}

export function renderArchiveCategoryNav(
  prefixToArchive: string,
  activeCategory: 'all' | DocCategory,
  counts: Record<string, number>,
): string {
  const allCount = counts.all ?? 0;
  const links: string[] = [];
  const allCur = activeCategory === 'all' ? ' aria-current="page"' : '';
  links.push(
    `<a href="${escapeAttr(`${prefixToArchive}index.html`)}"${allCur}>전체 (${allCount})</a>`,
  );
  for (const cat of CATEGORY_REGISTRY) {
    const cCount = counts[cat.key] ?? 0;
    const cur = activeCategory === cat.key ? ' aria-current="page"' : '';
    links.push(
      `<a href="${escapeAttr(`${prefixToArchive}${cat.key}/index.html`)}"${cur}>${escapeHtml(cat.label)} (${cCount})</a>`,
    );
  }
  return `<nav class="archive-category-nav no-print" aria-label="자료 분류">\n    ${links.join('\n    ')}\n  </nav>`;
}

function renderToolIcon(name: 'copy' | 'share' | 'top'): string {
  if (name === 'copy') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11"></rect><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"></path></svg>';
  }
  if (name === 'share') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="2"></circle><circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="19" r="2"></circle><path d="m8 11 8-5M8 13l8 5"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 14 6-6 6 6"></path><path d="M12 8v11"></path></svg>';
}

export function renderDocumentToolsWidget(): string {
  return `<!-- document-tools:start -->
  <div class="document-tools no-print" data-document-tools>
    <button class="document-tools-trigger" type="button" aria-expanded="false" aria-controls="document-tools-panel">문서 도구</button>
    <div class="document-tools-backdrop" hidden></div>
    <section class="document-tools-panel" id="document-tools-panel" aria-label="문서 도구" role="dialog" aria-modal="false" tabindex="-1" hidden>
      <div class="document-tools-panel-header">
        <h2>문서 도구</h2>
        <button class="document-tools-close" type="button" aria-label="문서 도구 닫기">닫기</button>
      </div>
      <div class="document-tools-size" role="group" aria-label="글자 크기">
        <button type="button" data-document-action="font-down">글자 축소</button>
        <output id="document-font-scale" for="document-font-down document-font-up">현재 100%</output>
        <button type="button" data-document-action="font-up">글자 확대</button>
        <button type="button" data-document-action="font-reset">초기화</button>
      </div>
      <div class="document-tools-actions">
        <button type="button" data-document-action="copy-document">${renderToolIcon('copy')}<span>본문 복사</span></button>
        <button type="button" data-document-action="share">${renderToolIcon('share')}<span>공유</span></button>
        <button type="button" data-document-action="copy-link">${renderToolIcon('copy')}<span>링크 복사</span></button>
        <button type="button" data-document-action="top">${renderToolIcon('top')}<span>맨 위로</span></button>
      </div>
      <p class="document-tools-status" id="document-action-status" role="status" aria-live="polite" aria-atomic="true"></p>
    </section>
  </div>
<!-- document-tools:end -->`;
}
