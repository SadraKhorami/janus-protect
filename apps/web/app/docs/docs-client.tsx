'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

type Locale = 'en' | 'fa';
type NavItem = { id: string; en: string; fa: string; group: 'start' | 'platform' | 'operate' };

const navigation: NavItem[] = [
  { id: 'introduction', en: 'Introduction', fa: 'معرفی', group: 'start' },
  { id: 'status', en: 'Version & status', fa: 'نسخه و وضعیت', group: 'start' },
  { id: 'local-setup', en: 'Local setup', fa: 'راه اندازی محلی', group: 'start' },
  { id: 'architecture', en: 'Architecture', fa: 'معماری', group: 'platform' },
  { id: 'protection', en: 'Protection pipeline', fa: 'مسیر محافظت', group: 'platform' },
  { id: 'licensing', en: 'WordPress licensing', fa: 'لایسنس وردپرس', group: 'platform' },
  { id: 'api', en: 'API reference', fa: 'مرجع API', group: 'platform' },
  { id: 'database', en: 'Database & migrations', fa: 'دیتابیس و migration', group: 'operate' },
  { id: 'deployment', en: 'Deployment', fa: 'استقرار', group: 'operate' },
  { id: 'releases', en: 'Releases & CI/CD', fa: 'انتشار و CI/CD', group: 'operate' },
  { id: 'security', en: 'Security model', fa: 'مدل امنیت', group: 'operate' },
  { id: 'roadmap', en: 'Limits & roadmap', fa: 'محدودیت و مسیر بعدی', group: 'operate' },
];

const groups = {
  start: { en: 'Getting started', fa: 'شروع کار' },
  platform: { en: 'Platform', fa: 'پلتفرم' },
  operate: { en: 'Operate', fa: 'عملیات' },
};

export function DocsClient({ version }: { version: string }) {
  const [locale, setLocale] = useState<Locale>('en');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState('introduction');
  const fa = locale === 'fa';

  useEffect(() => {
    const saved = window.localStorage.getItem('janus-docs-locale');
    if (saved === 'fa' || saved === 'en') setLocale(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('janus-docs-locale', locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = fa ? 'rtl' : 'ltr';
    return () => {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
    };
  }, [fa, locale]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-18% 0px -70% 0px' },
    );
    navigation.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [locale]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return navigation;
    return navigation.filter((item) => item[locale].toLowerCase().includes(normalized));
  }, [locale, query]);

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
    setMenuOpen(false);
    setSearchOpen(false);
    setQuery('');
  };

  const toggleLocale = () => setLocale(fa ? 'en' : 'fa');

  return (
    <div className={`docs-root ${fa ? 'docs-fa' : 'docs-en'}`} dir={fa ? 'rtl' : 'ltr'}>
      <header className="docs-header">
        <div className="docs-header-inner">
          <button
            className="docs-menu-button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Menu"
          >
            <MenuIcon />
          </button>
          <a href="/" className="docs-brand" aria-label="Janus Protect home">
            <span>Janus Protect</span>
          </a>
          <nav className="docs-top-nav" aria-label="Primary navigation">
            <a href="/docs" className="active">
              {fa ? 'مستندات' : 'Docs'}
            </a>
            <a href="/api/docs">API</a>
            <a
              href="https://github.com/SadraKhorami/janus-protect"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </nav>
          <div className="docs-header-actions">
            <button className="docs-search-trigger" onClick={() => setSearchOpen(true)}>
              <SearchIcon />
              <span>{fa ? 'جستجو در مستندات...' : 'Search documentation...'}</span>
              <kbd>⌘ K</kbd>
            </button>
            <button className="docs-language" onClick={toggleLocale} aria-label="Switch language">
              <GlobeIcon />
              <span>{fa ? 'EN' : 'فا'}</span>
            </button>
            <a href="/login" className="docs-login">
              {fa ? 'ورود' : 'Sign in'}
            </a>
          </div>
        </div>
      </header>

      <div className="docs-shell">
        <aside className={`docs-sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="docs-sidebar-scroll">
            {(Object.keys(groups) as Array<keyof typeof groups>).map((group) => (
              <div className="docs-nav-group" key={group}>
                <div className="docs-nav-heading">{groups[group][locale]}</div>
                {navigation
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.id}
                      className={active === item.id ? 'active' : ''}
                      onClick={() => goTo(item.id)}
                    >
                      {item[locale]}
                    </button>
                  ))}
              </div>
            ))}
          </div>
          <div className="docs-sidebar-meta">
            <span className="status-dot" />
            <span>{fa ? `نسخه در حال توسعه ${version}` : `Development ${version}`}</span>
          </div>
        </aside>
        {menuOpen && (
          <button
            className="docs-mobile-backdrop"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          />
        )}

        <main className="docs-main">
          <article className="docs-article">
            <Introduction fa={fa} version={version} />
            <Status fa={fa} version={version} />
            <LocalSetup fa={fa} />
            <Architecture fa={fa} />
            <Protection fa={fa} />
            <Licensing fa={fa} />
            <ApiReference fa={fa} />
            <Database fa={fa} />
            <Deployment fa={fa} />
            <Releases fa={fa} />
            <Security fa={fa} />
            <Roadmap fa={fa} />
            <footer className="docs-footer">
              <a
                href="https://github.com/SadraKhorami/janus-protect"
                target="_blank"
                rel="noreferrer"
              >
                {fa ? 'مشاهده سورس' : 'View source'} <ArrowUpRightIcon />
              </a>
            </footer>
          </article>

          <aside className="docs-toc">
            <div>{fa ? 'در این صفحه' : 'On this page'}</div>
            {navigation.map((item) => (
              <button
                key={item.id}
                className={active === item.id ? 'active' : ''}
                onClick={() => goTo(item.id)}
              >
                {item[locale]}
              </button>
            ))}
          </aside>
        </main>
      </div>

      {searchOpen && (
        <div className="docs-search-overlay" onMouseDown={() => setSearchOpen(false)}>
          <div
            className="docs-search-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="docs-search-input">
              <SearchIcon />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={fa ? 'عنوان یا موضوع را بنویسید...' : 'Type a title or topic...'}
              />
              <kbd>ESC</kbd>
            </div>
            <div className="docs-search-results">
              <div className="docs-search-label">{fa ? 'بخش ها' : 'Sections'}</div>
              {results.map((item) => (
                <button key={item.id} onClick={() => goTo(item.id)}>
                  <span className="docs-search-icon">
                    <DocumentIcon />
                  </span>
                  <span>
                    <strong>{item[locale]}</strong>
                  </span>
                  <span className="docs-enter">↵</span>
                </button>
              ))}
              {results.length === 0 && (
                <p>{fa ? 'بخشی با این عنوان پیدا نشد.' : 'No matching section found.'}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Introduction({ fa, version }: { fa: boolean; version: string }) {
  return (
    <DocSection
      id="introduction"
      eyebrow={fa ? 'مستندات پلتفرم' : 'Platform documentation'}
      title={fa ? 'Janus Protect چیست؟' : 'What is Janus Protect?'}
    >
      <p className="docs-lead">
        {fa
          ? 'Janus Protect یک پلتفرم API-first برای مدیریت سورس، ساخت نسخه محافظت شده، لایسنس و در ادامه انتشار و پایش افزونه ها و قالب های وردپرس است.'
          : 'Janus Protect is an API-first platform for source management, protected builds, licensing and, over time, release delivery and monitoring for WordPress plugins and themes.'}
      </p>
      <div className="docs-callout note">
        <InfoIcon />
        <div>
          <strong>{fa ? `وضعیت فعلی: ${version}` : `Current line: ${version}`}</strong>
          <span>
            {fa
              ? 'این نسخه هنوز release رسمی نشده و روی شاخه main در حال تکمیل است.'
              : 'This version is still under development on main and has not been published as a formal release.'}
          </span>
        </div>
      </div>
      <div className="docs-card-grid">
        <FeatureCard
          title={fa ? 'محافظت' : 'Protect'}
          text={
            fa
              ? 'اعتبارسنجی ZIP، تحلیل AST، تغییر نام متغیرهای امن، runtime و manifest امضا شده.'
              : 'ZIP validation, AST analysis, safe variable transformation, runtime injection and signed manifests.'
          }
        />
        <FeatureCard
          title={fa ? 'لایسنس' : 'License'}
          text={
            fa
              ? 'کلید لایسنس، محدودیت فعال سازی، اتصال به دامنه و lease آفلاین امضا شده.'
              : 'License keys, activation limits, domain binding and signed offline leases.'
          }
        />
        <FeatureCard
          title={fa ? 'ساخت و عملیات' : 'Build & operate'}
          text={
            fa
              ? 'صف build، artifact تغییر ناپذیر، CI، deployment نسخه محور و health check.'
              : 'Build queues, immutable artifacts, CI, tag-driven deployment and health checks.'
          }
        />
      </div>
    </DocSection>
  );
}

function Status({ fa, version }: { fa: boolean; version: string }) {
  return (
    <DocSection id="status" title={fa ? 'نسخه و وضعیت قابلیت ها' : 'Version and capability status'}>
      <p>
        {fa
          ? `نسخه پلتفرم در همه workspaceها ${version} است. این شماره با نسخه افزونه یا قالبی که در زمان build وارد می شود تفاوت دارد؛ هر محصول WordPress چرخه نسخه خودش را نگه می دارد.`
          : `The platform version is ${version} across every workspace. It is separate from the plugin or theme version supplied for a protected build; each WordPress product keeps its own release history.`}
      </p>
      <StatusTable fa={fa} />
    </DocSection>
  );
}

function LocalSetup({ fa }: { fa: boolean }) {
  return (
    <DocSection id="local-setup" title={fa ? 'راه اندازی محیط توسعه' : 'Local development setup'}>
      <p>
        {fa
          ? 'برای توسعه به Node.js 20.19 یا جدیدتر، pnpm 10.26، PHP 8.3، Composer و Docker نیاز دارید. سرویس های محلی شامل PostgreSQL، Redis، MinIO و Mailpit هستند.'
          : 'Development requires Node.js 20.19 or newer, pnpm 10.26, PHP 8.3, Composer and Docker. Local services include PostgreSQL, Redis, MinIO and Mailpit.'}
      </p>
      <Steps
        items={
          fa
            ? [
                [
                  'تنظیم محیط',
                  'فایل .env.example را به .env کپی کنید و مقادیر محلی را بررسی کنید.',
                ],
                ['اجرای سرویس ها', 'زیرساخت محلی را با Docker Compose بالا بیاورید.'],
                ['نصب dependencyها', 'پکیج های Node و transformer مربوط به PHP را نصب کنید.'],
                ['آماده سازی دیتابیس', 'Prisma Client، migrationها و حساب توسعه را بسازید.'],
                ['اجرای برنامه', 'وب، API و worker را با یک فرمان اجرا کنید.'],
              ]
            : [
                ['Configure', 'Copy .env.example to .env and review the local values.'],
                ['Start services', 'Bring up the local infrastructure with Docker Compose.'],
                [
                  'Install dependencies',
                  'Install Node packages and the PHP transformer dependencies.',
                ],
                [
                  'Prepare data',
                  'Generate Prisma Client, apply migrations and seed the development account.',
                ],
                ['Run the workspace', 'Start the web app, API and worker with one command.'],
              ]
        }
      />
      <CodeBlock
        code={`cp .env.example .env\ndocker compose up -d\npnpm install\ncomposer install --working-dir=services/php-transformer\npnpm db:generate && pnpm db:migrate && pnpm db:seed\npnpm dev`}
      />
      <InfoRows
        rows={
          fa
            ? [
                ['Web', 'http://localhost:3000'],
                ['API / Swagger', 'http://localhost:4000/api/docs'],
                ['Mailpit', 'http://localhost:8025'],
              ]
            : [
                ['Web', 'http://localhost:3000'],
                ['API / Swagger', 'http://localhost:4000/api/docs'],
                ['Mailpit', 'http://localhost:8025'],
              ]
        }
      />
    </DocSection>
  );
}

function Architecture({ fa }: { fa: boolean }) {
  return (
    <DocSection id="architecture" title={fa ? 'معماری' : 'Architecture'}>
      <p>
        {fa
          ? 'Janus یک modular monolith در monorepo مبتنی بر pnpm و Turborepo است.'
          : 'Janus is a modular monolith in a pnpm and Turborepo monorepo.'}
      </p>
      <div className="docs-architecture">
        <ArchitectureNode
          title="Next.js"
          subtitle={fa ? 'وب و جریان احراز هویت' : 'Web and identity flows'}
        />
        <span>→</span>
        <ArchitectureNode
          title="NestJS API"
          subtitle={fa ? 'contract و منطق برنامه' : 'Contracts and application logic'}
        />
        <span>→</span>
        <ArchitectureNode
          title="BullMQ Worker"
          subtitle={fa ? 'ساخت غیر همزمان' : 'Asynchronous builds'}
        />
      </div>
      <div className="docs-card-grid compact">
        <FeatureCard
          title="PostgreSQL + Prisma"
          text={
            fa
              ? 'داده اصلی، tenancy، پروژه، build، license و audit log.'
              : 'Primary data, tenancy, projects, builds, licenses and audit logs.'
          }
        />
        <FeatureCard
          title="Redis + BullMQ"
          text={
            fa
              ? 'صف build، rate limit و عملیات کوتاه مدت.'
              : 'Build queues, rate limits and short-lived coordination.'
          }
        />
        <FeatureCard
          title="S3 / MinIO"
          text={
            fa
              ? 'سورس ZIP و artifactها؛ فایل بزرگ داخل دیتابیس ذخیره نمی شود.'
              : 'ZIP sources and artifacts; large files do not live in PostgreSQL.'
          }
        />
      </div>
      <CodeBlock
        title={fa ? 'ساختار monorepo' : 'Monorepo map'}
        code={`apps/web             Next.js application\napps/api             NestJS HTTP API\napps/worker-build    BullMQ build worker\npackages/*           contracts, config, auth, database, queue, storage\nservices/php-transformer  PHP AST analysis and transformation\ndeploy/              production Compose and PM2 definitions\nscripts/             setup, deploy, backup and release automation`}
      />
    </DocSection>
  );
}

function Protection({ fa }: { fa: boolean }) {
  return (
    <DocSection
      id="protection"
      title={fa ? 'مسیر محافظت و build' : 'Protection and build pipeline'}
    >
      <p>
        {fa
          ? 'ورودی build فقط ZIP افزونه یا قالب WordPress است. قبل از هر تغییر، آرشیو در برابر path traversal، symlink، فایل تکراری، nested archive، حجم باز شده غیر عادی و compression ratio خطرناک بررسی می شود.'
          : 'Build input is a WordPress plugin or theme ZIP. Before transformation, the archive is checked for path traversal, symlinks, duplicate paths, nested archives, unsafe expanded size and suspicious compression ratios.'}
      </p>
      <Pipeline fa={fa} />
      <h3>{fa ? 'خروجی های هر build' : 'Build artifacts'}</h3>
      <BulletList
        items={
          fa
            ? [
                'فایل ZIP اصلی و نسخه محافظت شده با SHA-256 ثبت شده',
                'گزارش تحلیل سورس و گزارش تغییرات protection',
                'manifest یکپارچگی و امضای Ed25519',
                'گزارش نهایی build شامل نسخه و وضعیت قابلیت ها',
              ]
            : [
                'Original and protected ZIPs recorded with SHA-256 metadata',
                'Source analysis and protection transformation reports',
                'Integrity manifest and Ed25519 signature',
                'Final build report with version and enabled capabilities',
              ]
        }
      />
      <div className="docs-callout warning">
        <WarningIcon />
        <div>
          <strong>{fa ? 'مرز حفاظت' : 'Protection boundary'}</strong>
          <span>
            {fa
              ? 'obfuscation فعلی compatibility-first است. هدف آن افزایش هزینه بررسی و تغییر کد است، نه وعده پنهان سازی غیر قابل شکست برای کسی که دسترسی کامل به فایل ها دارد.'
              : 'Current obfuscation is compatibility-first. It raises the cost of casual inspection and modification; it is not an unbreakable secrecy claim against someone with full file access.'}
          </span>
        </div>
      </div>
    </DocSection>
  );
}

function Licensing({ fa }: { fa: boolean }) {
  return (
    <DocSection id="licensing" title={fa ? 'لایسنس WordPress' : 'WordPress licensing'}>
      <p>
        {fa
          ? 'هنگام build، یک SDK کوچک داخل محصول تزریق می شود. افزونه منوی License را زیر Settings و قالب آن را زیر Appearance نمایش می دهد تا مصرف کننده کلید را بدون ویرایش فایل وارد کند.'
          : 'Protected builds receive a small embedded SDK. Plugins expose a License page under Settings and themes expose it under Appearance, so customers can enter a key without editing files.'}
      </p>
      <div className="docs-card-grid compact">
        <FeatureCard
          title={fa ? 'فعال سازی متصل به سایت' : 'Site-bound activation'}
          text={
            fa
              ? 'دامنه و پورت normalize می شوند و هر فعال سازی با hash سایت ثبت می شود.'
              : 'Host and port are normalized and each activation is recorded against a site hash.'
          }
        />
        <FeatureCard
          title={fa ? 'lease امضا شده' : 'Signed lease'}
          text={
            fa
              ? 'API یک lease هفت روزه امضا می کند؛ SDK آن را به صورت محلی با کلید عمومی build بررسی می کند.'
              : 'The API signs a seven-day lease; the SDK verifies it locally using the build public key.'
          }
        />
        <FeatureCard
          title={fa ? 'تحمل قطعی موقت' : 'Outage tolerance'}
          text={
            fa
              ? 'SDK روزانه renew می کند و قطع کوتاه API باعث از کار افتادن ناگهانی سایت عمومی نمی شود.'
              : 'The SDK renews daily and a short API outage does not immediately break the public site.'
          }
        />
      </div>
      <CodeBlock
        title={fa ? 'کنترل قابلیت در محصول' : 'Gate a product feature'}
        code={`$is_valid = apply_filters(\n    'janus_protect_license_valid',\n    false,\n    '<project-id>'\n);`}
      />
      <p>
        {fa
          ? 'کلید خام لایسنس فقط هنگام ساخت نمایش داده می شود و در دیتابیس hash آن نگهداری می شود. OWNER و ADMIN می توانند لایسنس ایجاد یا revoke کنند. تعداد فعال سازی و تاریخ انقضا برای هر کلید قابل تنظیم است.'
          : 'A raw license key is returned only when issued; the database stores its hash. OWNER and ADMIN roles can issue or revoke licenses, with activation limits and optional expiration per key.'}
      </p>
    </DocSection>
  );
}

function ApiReference({ fa }: { fa: boolean }) {
  const rows = [
    [
      'POST',
      '/api/v1/auth/register',
      fa ? 'ساخت حساب و organization' : 'Create account and organization',
    ],
    ['POST', '/api/v1/auth/login', fa ? 'ورود و شروع session' : 'Authenticate and start a session'],
    ['GET', '/api/v1/auth/me', fa ? 'حساب و نقش فعال' : 'Current account and role'],
    ['POST', '/api/v1/projects', fa ? 'ساخت پروژه WordPress' : 'Create a WordPress project'],
    [
      'POST',
      '/api/v1/projects/:id/source/upload',
      fa ? 'ثبت revision جدید ZIP' : 'Upload a new ZIP revision',
    ],
    [
      'POST',
      '/api/v1/projects/:id/builds',
      fa ? 'صف کردن build نسخه دار' : 'Queue a versioned build',
    ],
    ['POST', '/api/v1/projects/:id/licenses', fa ? 'صدور لایسنس' : 'Issue a license'],
    ['POST', '/api/v1/licenses/activate', fa ? 'فعال سازی عمومی' : 'Public license activation'],
    [
      'POST',
      '/api/v1/licenses/validate',
      fa ? 'تمدید و اعتبارسنجی lease' : 'Validate and renew a lease',
    ],
  ];
  return (
    <DocSection id="api" title={fa ? 'مرجع API' : 'API reference'}>
      <p>
        {fa
          ? 'API پایدار زیر /api/v1 قرار دارد و Swagger در /api/docs سرو می شود. endpointهای پروژه bearer token می خواهند و تمام queryها با organization داخل token محدود می شوند.'
          : 'Stable endpoints live under /api/v1 and Swagger is served at /api/docs. Project endpoints require a bearer token and all queries are constrained by the organization encoded in that token.'}
      </p>
      <div className="docs-table-wrap">
        <table className="docs-api-table">
          <thead>
            <tr>
              <th>{fa ? 'متد' : 'Method'}</th>
              <th>{fa ? 'مسیر' : 'Path'}</th>
              <th>{fa ? 'کاربرد' : 'Purpose'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([method = '', path = '', purpose = '']) => (
              <tr key={path}>
                <td>
                  <span className={`method ${method.toLowerCase()}`}>{method}</span>
                </td>
                <td>
                  <code>{path}</code>
                </td>
                <td>{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>{fa ? 'قرارداد خطا' : 'Error contract'}</h3>
      <CodeBlock
        language="json"
        code={`{\n  "error": {\n    "code": "AUTHENTICATION_FAILED",\n    "message": "The supplied credentials are invalid.",\n    "requestId": "..."\n  }\n}`}
      />
      <p>
        {fa
          ? 'requestId را برای ارتباط دادن پاسخ API با structured log و audit نگه دارید. endpointهای /health/live و /health/ready خارج از prefix نسخه هستند.'
          : 'Keep requestId when reporting an error; it connects the API response to structured logs and audit context. /health/live and /health/ready sit outside the versioned prefix.'}
      </p>
    </DocSection>
  );
}

function Database({ fa }: { fa: boolean }) {
  return (
    <DocSection id="database" title={fa ? 'دیتابیس و migration' : 'Database and migrations'}>
      <p>
        {fa
          ? 'PostgreSQL منبع اصلی داده است و Prisma schema و migrationهای SQL تاریخچه آن را تعریف می کنند. Redis منبع داده دائمی نیست و فایل ها در S3 یا MinIO قرار می گیرند.'
          : 'PostgreSQL is the source of truth, with Prisma schema and committed SQL migrations defining its history. Redis is not durable business storage, and files live in S3 or MinIO.'}
      </p>
      <CodeBlock
        title={fa ? 'ساخت migration در محیط توسعه' : 'Create a migration in development'}
        code={`pnpm exec dotenv -e .env -- pnpm --filter @janus/database exec \\\n  prisma migrate dev --name add_example_field\npnpm db:generate\npnpm check`}
      />
      <CodeBlock
        title={fa ? 'اعمال در production' : 'Apply in production'}
        code={`pnpm db:generate\npnpm db:migrate`}
      />
      <BulletList
        items={
          fa
            ? [
                'در production از prisma migrate dev یا db push استفاده نکنید.',
                'فایل migration اعمال شده را ویرایش یا حذف نکنید؛ migration جدید بسازید.',
                'تغییر schema را backward-compatible طراحی کنید تا rollback برنامه ممکن بماند.',
                'قبل از migration نسخه production، deploy script به صورت خودکار pg_dump می گیرد.',
              ]
            : [
                'Never use prisma migrate dev or db push in production.',
                'Do not edit or remove an applied migration; create a new migration.',
                'Design schema changes to remain backward compatible during application rollback.',
                'The deployment script creates a pg_dump before production migrations.',
              ]
        }
      />
    </DocSection>
  );
}

function Deployment({ fa }: { fa: boolean }) {
  return (
    <DocSection id="deployment" title={fa ? 'استقرار روی Ubuntu' : 'Ubuntu deployment'}>
      <p>
        {fa
          ? 'فایل های استقرار داخل repository نگهداری می شوند، اما secretهای واقعی نباید commit شوند. وب روی پورت 3100 و API روی پورت 4100 فقط در loopback در دسترس هستند. برای انتشار عمومی باید یکی از روش های زیر را انتخاب کنید؛ اجرای هم زمان هر دو لازم نیست.'
          : 'Deployment definitions live in the repository, but real secrets must never be committed. The web app on port 3100 and API on port 4100 listen on loopback only. Choose one of the public routing options below; running both is unnecessary.'}
      </p>
      <CodeBlock
        title={fa ? 'راه اندازی سرور تازه' : 'Bootstrap a fresh server'}
        code={`git clone https://github.com/SadraKhorami/janus-protect.git /opt/janus-protect\ncd /opt/janus-protect\nscripts/setup-server.sh`}
      />
      <p>
        {fa
          ? 'setup ابزارهای لازم، Docker، PM2، فایل های نمونه محیط و swap را آماده می کند. اگر CHANGE_ME باقی مانده باشد قبل از deploy متوقف می شود.'
          : 'Setup installs the required runtime, Docker and PM2, creates environment files from safe examples and provisions swap. It stops before deployment while any CHANGE_ME value remains.'}
      </p>
      <CodeBlock
        title={fa ? 'استقرار دستی یک tag' : 'Deploy a tag manually'}
        code={`scripts/deploy.sh --ref vX.Y.Z`}
      />
      <h3>{fa ? 'Cloudflare Tunnel' : 'Cloudflare Tunnel'}</h3>
      <p>
        {fa
          ? 'اگر از Tunnel استفاده می کنید، رکورد DNS و TLS در Cloudflare مدیریت می شوند. مسیرهای API باید قبل از مسیر عمومی وب قرار بگیرند. نام میزبان زیر فقط نمونه است و باید با دامنه خودتان جایگزین شود.'
          : 'With a Tunnel, Cloudflare manages the DNS record and TLS edge. API routes must appear before the web catch-all. The hostname below is only an example and must be replaced with your own domain.'}
      </p>
      <CodeBlock
        language="yaml"
        code={`ingress:\n  - hostname: protect.example.com\n    path: ^/api(?:/.*)?$\n    service: http://127.0.0.1:4100\n  - hostname: protect.example.com\n    service: http://127.0.0.1:3100\n  - service: http_status:404`}
      />
      <h3>{fa ? 'Nginx' : 'Nginx'}</h3>
      <p>
        {fa
          ? 'اگر سرور مستقیما از اینترنت در دسترس است، Nginx می تواند TLS و reverse proxy را مدیریت کند. ابتدا گواهی معتبر برای دامنه خودتان تنظیم کنید، سپس مسیر API را جدا از وب به پورت درست بفرستید.'
          : 'When the server is directly reachable from the internet, Nginx can terminate TLS and act as the reverse proxy. Configure a valid certificate for your domain, then route the API separately from the web app.'}
      </p>
      <CodeBlock
        language="nginx"
        code={`server {\n  listen 443 ssl;\n  server_name protect.example.com;\n\n  # Configure ssl_certificate and ssl_certificate_key here.\n\n  location /api/ {\n    proxy_pass http://127.0.0.1:4100;\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n  }\n\n  location / {\n    proxy_pass http://127.0.0.1:3100;\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n  }\n}`}
      />
    </DocSection>
  );
}

function Releases({ fa }: { fa: boolean }) {
  return (
    <DocSection
      id="releases"
      title={fa ? 'CI، انتشار و deploy خودکار' : 'CI, releases and automated deployment'}
    >
      <p>
        {fa
          ? 'push و pull request روی main فقط CI را اجرا می کنند و production را تغییر نمی دهند. انتشار production با annotated tag انجام می شود تا سرور همیشه به یک commit مشخص و قابل ردیابی متصل باشد.'
          : 'Pushes and pull requests against main run CI without changing production. Production is released from an annotated version tag so the server always maps to a specific, traceable commit.'}
      </p>
      <div className="docs-release-flow">
        <span>PR</span>
        <i>→</i>
        <span>CI</span>
        <i>→</i>
        <span>main</span>
        <i>→</i>
        <span>pnpm release</span>
        <i>→</i>
        <span>vX.Y.Z</span>
        <i>→</i>
        <span>production</span>
      </div>
      <CodeBlock
        title={fa ? 'انتشار نسخه آماده' : 'Publish the prepared version'}
        code={`git switch main\ngit pull\npnpm release`}
      />
      <p>
        {fa
          ? 'release script تمیز بودن working tree، تطابق local main با origin، شماره نسخه و تمام checkها را کنترل می کند. بعد از push شدن tag، GitHub دوباره build را تایید می کند، backup می گیرد، همان tag را deploy می کند، سلامت عمومی را می سنجد و GitHub Release می سازد.'
          : 'The release script checks a clean working tree, exact local/origin main parity, the version and the complete test suite. Once the tag is pushed, GitHub independently verifies the build, takes a backup, deploys that tag, checks the public service and creates a GitHub Release.'}
      </p>
    </DocSection>
  );
}

function Security({ fa }: { fa: boolean }) {
  return (
    <DocSection id="security" title={fa ? 'مدل امنیت' : 'Security model'}>
      <div className="docs-card-grid compact">
        <FeatureCard
          title={fa ? 'احراز هویت' : 'Identity'}
          text={
            fa
              ? 'Argon2id، access token کوتاه مدت، refresh token چرخشی و cookie از نوع HttpOnly و SameSite=Strict.'
              : 'Argon2id, short-lived access tokens, rotating refresh tokens and HttpOnly SameSite=Strict cookies.'
          }
        />
        <FeatureCard
          title={fa ? 'جداسازی سازمان' : 'Tenant isolation'}
          text={
            fa
              ? 'دسترسی پروژه و لایسنس با organization و نقش OWNER، ADMIN، DEVELOPER یا VIEWER محدود می شود.'
              : 'Project and licensing access is scoped by organization and OWNER, ADMIN, DEVELOPER or VIEWER role.'
          }
        />
        <FeatureCard
          title={fa ? 'کلید و token' : 'Keys and tokens'}
          text={
            fa
              ? 'رمز، کد تایید، reset token، refresh token و license key به صورت خام در دیتابیس نگهداری نمی شوند.'
              : 'Passwords, verification codes, reset tokens, refresh tokens and license keys are never stored raw.'
          }
        />
      </div>
      <BulletList
        items={
          fa
            ? [
                'ورودی HTTP با schema مشترک Zod اعتبارسنجی می شود.',
                'rate limit احراز هویت و licensing با Redis اعمال می شود.',
                'secretها در structured log redacted می شوند.',
                'PostgreSQL، Redis، MinIO و API در تنظیم production روی localhost محدود هستند.',
                'runtime امضای artifact را بررسی می کند، اما خود فایل PHP برای مدیر سرور قابل تغییر است.',
              ]
            : [
                'HTTP input is validated with shared Zod schemas.',
                'Authentication and licensing rate limits are backed by Redis.',
                'Known secret fields are redacted from structured logs.',
                'Production PostgreSQL, Redis, MinIO and API bind to localhost.',
                'The runtime checks artifact signatures, but PHP files remain editable by the server owner.',
              ]
        }
      />
    </DocSection>
  );
}

function Roadmap({ fa }: { fa: boolean }) {
  return (
    <DocSection
      id="roadmap"
      title={fa ? 'محدودیت های فعلی و مسیر بعدی' : 'Current limits and next work'}
    >
      <p>{fa ? 'موارد زیر هنوز کامل نشده‌اند:' : 'The following items are not complete yet:'}</p>
      <div className="docs-roadmap-list">
        {(fa
          ? [
              [
                'Sandbox یک بار مصرف build',
                'محدودیت CPU، حافظه، filesystem و network برای ورودی ناشناس.',
              ],
              [
                'Release و update delivery',
                'manifest نسخه، دانلود کوتاه مدت و بروزرسانی استاندارد WordPress.',
              ],
              [
                'Monitoring نصب ها',
                'heartbeat، نسخه نصب شده، وضعیت لایسنس و signalهای حداقلی بدون داده محتوایی.',
              ],
              ['پنل مدیریتی کامل', 'UI پروژه، build، artifact، license، release و monitoring.'],
              [
                'پوشش end-to-end',
                'WordPress matrix، ZIP مخرب، recovery صف و سناریوهای deployment.',
              ],
            ]
          : [
              [
                'Ephemeral build sandbox',
                'CPU, memory, filesystem and network isolation for untrusted input.',
              ],
              [
                'Release and update delivery',
                'Version manifests, short-lived downloads and native WordPress updates.',
              ],
              [
                'Installation monitoring',
                'Heartbeats, installed version and license health without collecting site content.',
              ],
              [
                'Complete management UI',
                'Project, build, artifact, license, release and monitoring interfaces.',
              ],
              [
                'End-to-end coverage',
                'WordPress matrix, hostile ZIPs, queue recovery and deployment scenarios.',
              ],
            ]
        ).map(([title, text], index) => (
          <div key={title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>
    </DocSection>
  );
}

function DocSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="docs-section">
      {eyebrow && <div className="docs-eyebrow">{eyebrow}</div>}
      <h2>
        {title}
        <a href={`#${id}`} aria-label={`Link to ${title}`}>
          #
        </a>
      </h2>
      {children}
    </section>
  );
}

function FeatureCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="docs-feature-card">
      <div className="docs-feature-mark" />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="docs-bullets">
      {items.map((item) => (
        <li key={item}>
          <CheckIcon />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
function CodeBlock({ code, title, language }: { code: string; title?: string; language?: string }) {
  return (
    <div className="docs-code">
      {title && (
        <div className="docs-code-title">
          <span>{title}</span>
          <span>{language ?? 'shell'}</span>
        </div>
      )}
      <pre dir="ltr">
        <code>{code}</code>
      </pre>
    </div>
  );
}
function InfoRows({ rows }: { rows: string[][] }) {
  return (
    <div className="docs-info-rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <code>{value}</code>
        </div>
      ))}
    </div>
  );
}
function Steps({ items }: { items: string[][] }) {
  return (
    <div className="docs-steps">
      {items.map(([title, text], index) => (
        <div key={title}>
          <span>{index + 1}</span>
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
function ArchitectureNode({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <strong>{title}</strong>
      <small>{subtitle}</small>
    </div>
  );
}

function StatusTable({ fa }: { fa: boolean }) {
  const rows = fa
    ? [
        ['حساب، session و organization', 'موجود'],
        ['پروژه و source revision', 'موجود'],
        ['build و artifact محافظت شده', 'موجود'],
        ['لایسنس و UI داخل WordPress', 'موجود'],
        ['CI و deployment نسخه محور', 'موجود'],
        ['پنل مدیریتی کامل', 'در حال توسعه'],
        ['update delivery و monitoring', 'برنامه بعدی'],
      ]
    : [
        ['Accounts, sessions and organizations', 'Available'],
        ['Projects and source revisions', 'Available'],
        ['Protected builds and artifacts', 'Available'],
        ['Licensing and embedded WordPress UI', 'Available'],
        ['CI and tag-driven deployment', 'Available'],
        ['Complete management console', 'In progress'],
        ['Update delivery and monitoring', 'Next'],
      ];
  return (
    <div className="docs-status-table">
      {rows.map(([name, status]) => (
        <div key={name}>
          <span>{name}</span>
          <span
            className={
              status === 'موجود' || status === 'Available'
                ? 'ready'
                : status === 'در حال توسعه' || status === 'In progress'
                  ? 'progress'
                  : 'next'
            }
          >
            {status}
          </span>
        </div>
      ))}
    </div>
  );
}

function Pipeline({ fa }: { fa: boolean }) {
  const stages = fa
    ? [
        'دریافت revision',
        'اعتبارسنجی ZIP',
        'تحلیل PHP AST',
        'تغییر امن',
        'تزریق runtime',
        'امضا و بسته بندی',
        'آپلود artifact',
      ]
    : [
        'Source revision',
        'ZIP validation',
        'PHP AST analysis',
        'Safe transform',
        'Runtime injection',
        'Sign and package',
        'Artifact upload',
      ];
  return (
    <div className="docs-pipeline">
      {stages.map((stage, index) => (
        <div key={stage}>
          <span>{index + 1}</span>
          <strong>{stage}</strong>
        </div>
      ))}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </svg>
  );
}
function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h5" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </svg>
  );
}
function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 2.5 20h19zM12 9v5M12 17h.01" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}
