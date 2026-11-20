import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DocCategory } from '../domain/types.js';
import { CATEGORY_REGISTRY } from '../domain/content-graph.js';

export const SITE_BASE_URL = 'https://yghnsim.github.io/union-portal';

export type TopAxis = 'home' | 'archive' | 'accounting' | 'union';
export type AccountingSection = 'dashboard' | 'ledger' | 'coa' | 'reports';

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

export function renderPageShell(opts: RenderShellOptions): string {
  const baseUrl = (opts.baseUrl ?? SITE_BASE_URL).replace(/\/+$/, '');
  const prefix = opts.prefix ?? computePrefixForRoute(opts.route);
  const canonical = canonicalUrlForRoute(opts.route, baseUrl);
  const ogImage = `${baseUrl}/assets/social-card.png`;
  const appCss = assetHref(prefix, 'app.css', opts.assets);
  const navJs = assetHref(prefix, 'nav.js', opts.assets);
  const fav32 = assetHref(prefix, 'favicon-32.png', opts.assets);
  const fav192 = assetHref(prefix, 'favicon-192.png', opts.assets);
  const logo300 = assetHref(prefix, 'logo-header-300.webp', opts.assets);
  const logo600 = assetHref(prefix, 'logo-header-600.webp', opts.assets);

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
  <link rel="icon" type="image/png" sizes="192x192" href="${escapeAttr(fav192)}">${jsonLdScript}
  <link rel="stylesheet" href="${escapeAttr(appCss)}">
  ${opts.extraHeadHtml ?? ''}
</head>
<body>
<a class="skip-link" href="#main-content">본문으로 바로가기</a>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="${escapeAttr(`${prefix}index.html`)}" aria-label="우체국물류지원단 물류노동조합 포털 홈">
      <img class="brand-logo" src="${escapeAttr(logo300)}" srcset="${escapeAttr(logo300)} 1x, ${escapeAttr(logo600)} 2x" width="140" height="39" alt="우체국물류지원단 물류노동조합">
      <span class="brand-sub">물류노동조합 통합 포털</span>
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
  <span>우체국물류지원단 물류노동조합 · 통합 공개 포털</span>
  <span>개인 실명·금융 내역 비식별 처리 원칙 적용</span>
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
