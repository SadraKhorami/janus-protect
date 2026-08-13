import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { ProjectType, type ProtectionLevel, type SourceAnalysis } from '@janus/contracts';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import yazl from 'yazl';

const archiveExtensions = new Set(['.zip', '.tar', '.tgz', '.gz', '.bz2', '.7z', '.rar', '.phar']);
const defaultLimits: ArchiveLimits = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntries: 5_000,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
  maxCompressionRatio: 100,
};

export type ArchiveLimits = {
  maxArchiveBytes: number;
  maxEntries: number;
  maxUncompressedBytes: number;
  maxEntryBytes: number;
  maxCompressionRatio: number;
};

export type ArchiveFile = {
  path: string;
  data: Buffer;
  mode: number;
};

export type InspectedArchive = {
  files: ArchiveFile[];
  analysis: SourceAnalysis;
};

export type ProtectionInput = {
  files: ArchiveFile[];
  analysis: SourceAnalysis;
  level: ProtectionLevel;
  version: string;
  signingPrivateKey: string;
  runtimeInjection: boolean;
  integrity: boolean;
  obfuscation: boolean;
  licensing?: {
    apiUrl: string;
    projectId: string;
    projectType: ProjectType;
    productName: string;
    productVersion: string;
    publicKey: string;
  };
  transformPhp: (files: ArchiveFile[]) => Promise<{
    files: ArchiveFile[];
    report: Record<string, unknown>;
  }>;
};

export type ProtectionResult = {
  archive: Buffer;
  analysisReport: Record<string, unknown>;
  protectionReport: Record<string, unknown>;
  integrityManifest: Record<string, unknown>;
  buildReport: Record<string, unknown>;
};

export interface ProtectionEngine {
  analyze(input: Buffer): Promise<InspectedArchive>;
  protect(input: ProtectionInput): Promise<ProtectionResult>;
}

export class ArchiveValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveValidationError';
  }
}

export async function inspectWordPressArchive(
  archive: Buffer,
  limits: ArchiveLimits = defaultLimits,
): Promise<InspectedArchive> {
  if (archive.length > limits.maxArchiveBytes) {
    throw new ArchiveValidationError('ARCHIVE_TOO_LARGE', 'The ZIP archive exceeds 25 MB.');
  }
  if (archive.subarray(0, 4).toString('hex') !== '504b0304') {
    throw new ArchiveValidationError('ARCHIVE_INVALID', 'The uploaded file is not a ZIP archive.');
  }

  const zip = await openZip(archive);
  const files: ArchiveFile[] = [];
  const paths = new Set<string>();
  let uncompressedSize = 0;
  let nestedArchives = 0;
  let entryCount = 0;

  try {
    while (true) {
      const entry = await nextEntry(zip);
      if (!entry) break;
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw new ArchiveValidationError(
          'ARCHIVE_ENTRY_LIMIT',
          'The ZIP contains too many entries.',
        );
      }
      const safePath = validateEntry(entry);
      if (entry.fileName.endsWith('/')) continue;
      if (paths.has(safePath)) {
        throw new ArchiveValidationError(
          'ARCHIVE_DUPLICATE_PATH',
          `Duplicate ZIP path: ${safePath}`,
        );
      }
      paths.add(safePath);
      if (entry.uncompressedSize > limits.maxEntryBytes) {
        throw new ArchiveValidationError('ARCHIVE_ENTRY_TOO_LARGE', `${safePath} is too large.`);
      }
      uncompressedSize += entry.uncompressedSize;
      if (uncompressedSize > limits.maxUncompressedBytes) {
        throw new ArchiveValidationError(
          'ARCHIVE_EXPANDED_SIZE_LIMIT',
          'The expanded ZIP exceeds 100 MB.',
        );
      }
      const extension = extensionOf(safePath);
      if (archiveExtensions.has(extension)) nestedArchives += 1;
      const data = await readEntry(zip, entry);
      validateFileContent(safePath, data);
      files.push({ path: safePath, data, mode: unixMode(entry) || 0o100644 });
    }
  } finally {
    zip.close();
  }

  if (files.length === 0) {
    throw new ArchiveValidationError('ARCHIVE_EMPTY', 'The ZIP archive is empty.');
  }
  if (nestedArchives > 0) {
    throw new ArchiveValidationError(
      'ARCHIVE_NESTED_ARCHIVE',
      'Nested archives are not accepted in WordPress source packages.',
    );
  }
  const ratio = uncompressedSize / Math.max(archive.length, 1);
  if (ratio > limits.maxCompressionRatio) {
    throw new ArchiveValidationError(
      'ARCHIVE_BOMB_SUSPECTED',
      'The ZIP compression ratio is unsafe.',
    );
  }

  const rootDirectory = commonRoot(files.map((file) => file.path));
  const entry = detectWordPressEntry(files, rootDirectory);
  const analysis: SourceAnalysis = {
    type: entry.type,
    rootDirectory,
    entryFile: entry.entryFile,
    fileCount: files.length,
    phpFileCount: files.filter((file) => file.path.toLowerCase().endsWith('.php')).length,
    uncompressedSize,
    nestedArchives,
  };
  return { files, analysis };
}

export class BasicProtectionEngine implements ProtectionEngine {
  analyze(input: Buffer): Promise<InspectedArchive> {
    return inspectWordPressArchive(input);
  }

  async protect(input: ProtectionInput): Promise<ProtectionResult> {
    const reservedPrefix = `${input.analysis.rootDirectory}/janus-protect/`;
    if (input.files.some((file) => file.path.startsWith(reservedPrefix))) {
      throw new ArchiveValidationError(
        'ARCHIVE_RESERVED_PATH',
        'The source package already contains the reserved janus-protect directory.',
      );
    }
    const transformed = await input.transformPhp(input.files.map(cloneFile));
    const files = (input.obfuscation ? transformed.files : input.files).map(cloneFile);
    const runtimePath = `${input.analysis.rootDirectory}/janus-protect/runtime.php`;
    const manifestPath = `${input.analysis.rootDirectory}/janus-protect/integrity-manifest.json`;
    const signaturePath = `${input.analysis.rootDirectory}/janus-protect/integrity-signature.json`;
    const licensePath = `${input.analysis.rootDirectory}/janus-protect/license.php`;

    updateWordPressVersion(files, input.analysis, input.version);
    if (input.runtimeInjection || input.licensing) {
      injectRuntimeBootstrap(
        files,
        input.analysis.entryFile,
        input.runtimeInjection,
        input.licensing,
      );
      if (input.runtimeInjection) {
        files.push({
          path: runtimePath,
          data: Buffer.from(runtimeSource(input.version), 'utf8'),
          mode: 0o100644,
        });
      }
      if (input.licensing) {
        files.push({
          path: licensePath,
          data: Buffer.from(licenseSource(input.licensing), 'utf8'),
          mode: 0o100644,
        });
      }
    }

    const manifestFiles = Object.fromEntries(
      files
        .filter((file) => file.path !== manifestPath && file.path !== signaturePath)
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => [
          relativeToRoot(file.path, input.analysis.rootDirectory),
          sha256(file.data),
        ]),
    );
    const integrityManifest = {
      schemaVersion: 1,
      algorithm: 'sha256',
      projectType: input.analysis.type,
      version: input.version,
      files: manifestFiles,
    };
    if (input.integrity) {
      const manifestData = Buffer.from(stableJson(integrityManifest), 'utf8');
      const privateKey = createPrivateKey({
        key: Buffer.from(input.signingPrivateKey, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
      const signature = sign(null, manifestData, privateKey);
      files.push({ path: manifestPath, data: manifestData, mode: 0o100644 });
      files.push({
        path: signaturePath,
        data: Buffer.from(
          stableJson({
            algorithm: 'Ed25519',
            publicKey: publicKey.toString('base64'),
            signature: signature.toString('base64'),
          }),
          'utf8',
        ),
        mode: 0o100644,
      });
    }

    const protectionReport = {
      engine: 'BasicProtectionEngine',
      level: input.level,
      compatibilityFirst: true,
      obfuscationEnabled: input.obfuscation,
      integrityEnabled: input.integrity,
      runtimeInjectionEnabled: input.runtimeInjection,
      phpTransformation: transformed.report,
      runtimeInjectedAt: input.runtimeInjection ? input.analysis.entryFile : null,
      integrityFiles: Object.keys(manifestFiles).length,
      signatureAlgorithm: input.integrity ? 'Ed25519' : null,
      licensingSdkInjected: Boolean(input.licensing),
    };
    const analysisReport = { ...input.analysis };
    const buildReport = {
      schemaVersion: 1,
      version: input.version,
      sourceFiles: input.files.length,
      outputFiles: files.length,
      validations: {
        archivePaths: 'passed',
        wordpressStructure: 'passed',
        integrityManifest: input.integrity ? 'passed' : 'skipped',
        signature: input.integrity ? 'passed' : 'skipped',
      },
    };

    return {
      archive: await createZip(files),
      analysisReport,
      protectionReport,
      integrityManifest,
      buildReport,
    };
  }
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

export function matchesExcludedPath(relativePath: string, exclusions: string[]): boolean {
  return exclusions.some((value) => {
    const base = value.replace(/\/\*\*$/, '').replace(/\/$/, '');
    return relativePath === base || relativePath.startsWith(`${base}/`);
  });
}

async function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) reject(new ArchiveValidationError('ARCHIVE_INVALID', 'Invalid ZIP.'));
        else resolve(zip);
      },
    );
  });
}

function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      zip.off('entry', onEntry);
      zip.off('end', onEnd);
      zip.off('error', onError);
    };
    zip.once('entry', onEntry);
    zip.once('end', onEnd);
    zip.once('error', onError);
    zip.readEntry();
  });
}

function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error('Unable to read ZIP entry.'));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

function validateEntry(entry: Entry): string {
  const name = entry.fileName.normalize('NFKC');
  if (
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new ArchiveValidationError('ARCHIVE_UNSAFE_PATH', `Unsafe ZIP path: ${entry.fileName}`);
  }
  const mode = unixMode(entry);
  if ((mode & 0o170000) === 0o120000) {
    throw new ArchiveValidationError('ARCHIVE_SYMLINK', `Symbolic links are not accepted: ${name}`);
  }
  return name.replace(/\/+$/, '');
}

function validateFileContent(filePath: string, data: Buffer): void {
  const extension = extensionOf(filePath);
  const forbiddenExtensions = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.sh']);
  const magic = data.subarray(0, 4).toString('hex');
  const nativeExecutable =
    magic === '7f454c46' ||
    magic.startsWith('4d5a') ||
    ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(magic);
  if (forbiddenExtensions.has(extension) || nativeExecutable) {
    throw new ArchiveValidationError(
      'ARCHIVE_EXECUTABLE_REJECTED',
      `Native executable files are not accepted: ${filePath}`,
    );
  }
}

function unixMode(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

function commonRoot(paths: string[]): string {
  const roots = new Set(paths.map((value) => value.split('/')[0]).filter(Boolean));
  if (roots.size !== 1) {
    throw new ArchiveValidationError(
      'ARCHIVE_ROOT_INVALID',
      'A WordPress package must contain exactly one top-level directory.',
    );
  }
  return [...roots][0] as string;
}

function detectWordPressEntry(
  files: ArchiveFile[],
  root: string,
): { type: ProjectType; entryFile: string } {
  const style = files.find((file) => file.path === `${root}/style.css`);
  if (style && /\bTheme Name\s*:/i.test(style.data.toString('utf8'))) {
    const functions = files.find((file) => file.path === `${root}/functions.php`);
    if (!functions) {
      throw new ArchiveValidationError(
        'THEME_ENTRY_MISSING',
        'The theme is missing functions.php.',
      );
    }
    return { type: ProjectType.THEME, entryFile: functions.path };
  }
  const plugin = files.find(
    (file) =>
      file.path.startsWith(`${root}/`) &&
      !file.path.slice(root.length + 1).includes('/') &&
      file.path.toLowerCase().endsWith('.php') &&
      /\bPlugin Name\s*:/i.test(file.data.toString('utf8')),
  );
  if (plugin) return { type: ProjectType.PLUGIN, entryFile: plugin.path };
  throw new ArchiveValidationError(
    'WORDPRESS_PACKAGE_UNRECOGNIZED',
    'No valid WordPress plugin or theme header was found.',
  );
}

function injectRuntimeBootstrap(
  files: ArchiveFile[],
  entryPath: string,
  runtimeInjection: boolean,
  licensing?: ProtectionInput['licensing'],
): void {
  const entry = files.find((file) => file.path === entryPath);
  if (!entry) throw new Error('WordPress entry file is missing.');
  const source = entry.data.toString('utf8');
  const marker = "require_once __DIR__ . '/janus-protect/runtime.php';";
  const licenseMarker = "require_once __DIR__ . '/janus-protect/license.php';";
  if (
    (!runtimeInjection || source.includes(marker)) &&
    (!licensing || source.includes(licenseMarker))
  )
    return;
  const enforcement = licensing
    ? `if (empty($GLOBALS['janus_protect_license_checks']['${licensing.projectId}']) || !is_callable($GLOBALS['janus_protect_license_checks']['${licensing.projectId}']) || !(bool) call_user_func($GLOBALS['janus_protect_license_checks']['${licensing.projectId}'])) { return; }`
    : '';
  const bootstrap = [runtimeInjection ? marker : '', licensing ? licenseMarker : '', enforcement]
    .filter(Boolean)
    .join('\n');
  const transformed = source.replace(/<\?php\s*/, (opening) => `${opening}\n${bootstrap}\n`);
  if (transformed === source) throw new Error('WordPress entry file does not begin with PHP.');
  entry.data = Buffer.from(transformed, 'utf8');
}

function updateWordPressVersion(
  files: ArchiveFile[],
  analysis: SourceAnalysis,
  version: string,
): void {
  const headerPath =
    analysis.type === ProjectType.THEME
      ? `${analysis.rootDirectory}/style.css`
      : analysis.entryFile;
  const header = files.find((file) => file.path === headerPath);
  if (!header) throw new Error('WordPress version header file is missing.');
  const source = header.data.toString('utf8');
  const transformed = source.replace(/(^|\n)(\s*\*?\s*Version\s*:\s*)[^\r\n]+/i, `$1$2${version}`);
  if (transformed === source) throw new Error('WordPress version header is missing.');
  header.data = Buffer.from(transformed, 'utf8');
}

function runtimeSource(version: string): string {
  return `<?php\n/** Janus Protect compatibility-first runtime. */\nif (!defined('ABSPATH')) { return; }\n(function (): void {\n    $verify = static function (): bool {\n        $base = dirname(__DIR__);\n        $manifestPath = __DIR__ . '/integrity-manifest.json';\n        $signaturePath = __DIR__ . '/integrity-signature.json';\n        if (!is_readable($manifestPath) || !is_readable($signaturePath)) { return false; }\n        if (!function_exists('sodium_crypto_sign_verify_detached')) { return false; }\n        $manifestRaw = file_get_contents($manifestPath);\n        $signatureData = json_decode((string) file_get_contents($signaturePath), true);\n        if (!is_string($manifestRaw) || !is_array($signatureData)) { return false; }\n        $signature = base64_decode((string) ($signatureData['signature'] ?? ''), true);\n        $spki = base64_decode((string) ($signatureData['publicKey'] ?? ''), true);\n        if (!is_string($signature) || !is_string($spki) || strlen($spki) < 32) { return false; }\n        $rawPublicKey = substr($spki, -32);\n        if (!sodium_crypto_sign_verify_detached($signature, $manifestRaw, $rawPublicKey)) { return false; }\n        $manifest = json_decode($manifestRaw, true);\n        if (!is_array($manifest) || !isset($manifest['files']) || !is_array($manifest['files'])) { return false; }\n        foreach ($manifest['files'] as $relative => $expected) {\n            $path = $base . '/' . ltrim((string) $relative, '/');\n            if (!is_file($path)) { return false; }\n            $actual = hash_file('sha256', $path);\n            if (!is_string($actual) || !hash_equals((string) $expected, $actual)) { return false; }\n        }\n        return true;\n    };\n    $check = static function () use ($verify): void {\n        $cacheKey = 'janus_protect_' . substr(hash('sha256', __DIR__), 0, 16);\n        if (function_exists('get_transient') && get_transient($cacheKey) === 'ok') { return; }\n        $valid = $verify();\n        if (function_exists('set_transient')) {\n            set_transient($cacheKey, $valid ? 'ok' : 'failed', 10 * MINUTE_IN_SECONDS);\n        }\n        if (!$valid && function_exists('do_action')) {\n            do_action('janus_protect_integrity_failed', __DIR__, '${version}');\n        }\n    };\n    if (function_exists('add_action')) { add_action('admin_init', $check, 1); }\n})();\n`;
}

function licenseSource(config: NonNullable<ProtectionInput['licensing']>): string {
  const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
  return `<?php
/** Janus Protect licensing SDK. */
if (!defined('ABSPATH')) { return; }
(function (): void {
    $config = json_decode((string) base64_decode('${encoded}', true), true);
    if (!is_array($config)) { return; }
    $suffix = substr(hash('sha256', (string) $config['projectId']), 0, 12);
    $option = 'janus_license_' . $suffix;
    $page = 'janus-license-' . $suffix;
    $postAction = 'janus_license_action_' . $suffix;
    $cronAction = 'janus_license_check_' . $suffix;
    $site = static function (): string {
        $parts = wp_parse_url(home_url('/'));
        return strtolower(rtrim((string) ($parts['host'] ?? ''), '.')) . (isset($parts['port']) ? ':' . (int) $parts['port'] : '');
    };
    $verify = static function (array $lease) use ($config, $site): bool {
        if (!function_exists('sodium_crypto_sign_verify_detached')) { return false; }
        $value = (string) ($lease['payload'] ?? '');
        $payload = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
        $signature = base64_decode((string) ($lease['signature'] ?? ''), true);
        $publicKey = base64_decode((string) $config['publicKey'], true);
        if (!is_string($payload) || !is_string($signature) || !is_string($publicKey) || strlen($publicKey) < 32 || !sodium_crypto_sign_verify_detached($signature, $payload, substr($publicKey, -32))) { return false; }
        $claims = json_decode($payload, true);
        return is_array($claims) && hash_equals((string) $config['projectId'], (string) ($claims['projectId'] ?? '')) && hash_equals($site(), (string) ($claims['site'] ?? '')) && (int) ($claims['exp'] ?? 0) >= time();
    };
    $request = static function (string $endpoint, array $body) use ($config): array {
        $response = wp_remote_post(rtrim((string) $config['apiUrl'], '/') . '/licenses/' . $endpoint, ['timeout' => 10, 'sslverify' => true, 'headers' => ['Content-Type' => 'application/json', 'Accept' => 'application/json', 'X-Janus-Client' => 'wordpress-sdk/0.4'], 'body' => wp_json_encode($body)]);
        if (is_wp_error($response)) { return ['ok' => false, 'error' => $response->get_error_message()]; }
        $data = json_decode((string) wp_remote_retrieve_body($response), true);
        return wp_remote_retrieve_response_code($response) === 200 && is_array($data) ? ['ok' => true, 'data' => $data] : ['ok' => false, 'error' => (string) ($data['error']['message'] ?? __('License request failed.', 'janus-protect'))];
    };
    $isValid = static function () use ($option, $verify): bool {
        $saved = get_option($option, []);
        return is_array($saved) && isset($saved['lease']) && is_array($saved['lease']) && $verify($saved['lease']);
    };
    if (!isset($GLOBALS['janus_protect_license_checks']) || !is_array($GLOBALS['janus_protect_license_checks'])) { $GLOBALS['janus_protect_license_checks'] = []; }
    $GLOBALS['janus_protect_license_checks'][(string) $config['projectId']] = $isValid;
    if (!isset($GLOBALS['janus_protect_products']) || !is_array($GLOBALS['janus_protect_products'])) { $GLOBALS['janus_protect_products'] = []; }
    $GLOBALS['janus_protect_products'][$suffix] = ['config' => $config, 'option' => $option, 'page' => $page, 'postAction' => $postAction, 'isValid' => $isValid, 'site' => $site];
    add_filter('janus_protect_license_valid', static function (bool $valid, string $projectId = '') use ($config, $isValid): bool { return $projectId === (string) $config['projectId'] ? $isValid() : $valid; }, 10, 2);
    add_action('admin_post_' . $postAction, static function () use ($config, $option, $page, $request, $suffix): void {
        if (!current_user_can('manage_options')) { wp_die(esc_html__('Permission denied.', 'janus-protect')); }
        check_admin_referer($page);
        $saved = get_option($option, []);
        $command = sanitize_key((string) ($_POST['janus_command'] ?? ''));
        if ($command === 'deactivate' && is_array($saved) && !empty($saved['activationToken'])) {
            $request('deactivate', ['projectId' => $config['projectId'], 'activationToken' => $saved['activationToken'], 'siteUrl' => home_url('/')]); delete_option($option);
        } elseif ($command === 'refresh' && is_array($saved) && !empty($saved['activationToken'])) {
            $result = $request('validate', ['projectId' => $config['projectId'], 'activationToken' => $saved['activationToken'], 'siteUrl' => home_url('/')]);
            if ($result['ok']) { $saved['lease'] = $result['data']['lease']; $saved['checkedAt'] = time(); $saved['error'] = ''; update_option($option, $saved, false); }
            else { $saved['error'] = $result['error']; update_option($option, $saved, false); }
        } elseif ($command === 'activate') {
            $key = sanitize_text_field(wp_unslash((string) ($_POST['license_key'] ?? '')));
            $result = $request('activate', ['projectId' => $config['projectId'], 'key' => $key, 'siteUrl' => home_url('/')]);
            if ($result['ok']) { update_option($option, ['activationToken' => $result['data']['activationToken'], 'lease' => $result['data']['lease'], 'maskedKey' => substr($key, 0, 12) . '…', 'checkedAt' => time(), 'error' => ''], false); }
            else { update_option($option, array_merge(is_array($saved) ? $saved : [], ['error' => $result['error']]), false); }
        }
        wp_safe_redirect(admin_url('admin.php?page=janus-protect&product=' . $suffix)); exit;
    });
    add_action($cronAction, static function () use ($config, $option, $request): void {
        $saved = get_option($option, []); if (!is_array($saved) || empty($saved['activationToken'])) { return; }
        $result = $request('validate', ['projectId' => $config['projectId'], 'activationToken' => $saved['activationToken'], 'siteUrl' => home_url('/')]);
        if ($result['ok']) { $saved['lease'] = $result['data']['lease']; $saved['checkedAt'] = time(); $saved['error'] = ''; update_option($option, $saved, false); }
    });
    add_action('init', static function () use ($config, $cronAction, $isValid): void {
        if (!wp_next_scheduled($cronAction)) { wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', $cronAction); }
        if (!$isValid()) { do_action('janus_protect_license_invalid', (string) $config['projectId']); }
    });
    add_action('admin_menu', static function (): void {
        if (!empty($GLOBALS['janus_protect_menu_registered'])) { return; }
        $GLOBALS['janus_protect_menu_registered'] = true;
        $render = static function (): void {
            $products = $GLOBALS['janus_protect_products'] ?? [];
            $products = is_array($products) ? $products : [];
            uasort($products, static function (array $left, array $right): int { return strcasecmp((string) ($left['config']['productName'] ?? ''), (string) ($right['config']['productName'] ?? '')); });
            $selected = isset($_GET['product']) ? sanitize_key(wp_unslash((string) $_GET['product'])) : '';
            $current = $selected !== '' && isset($products[$selected]) && is_array($products[$selected]) ? $products[$selected] : null;
            $showHub = $current === null;
            $activeCount = 0; $attentionCount = 0;
            foreach ($products as $registered) { if (is_callable($registered['isValid'] ?? null) && $registered['isValid']()) { $activeCount++; } else { $attentionCount++; } }
            $config = is_array($current['config'] ?? null) ? $current['config'] : [];
            $option = (string) ($current['option'] ?? ''); $page = (string) ($current['page'] ?? ''); $postAction = (string) ($current['postAction'] ?? '');
            $isValid = is_callable($current['isValid'] ?? null) ? $current['isValid'] : static function (): bool { return false; };
            $site = is_callable($current['site'] ?? null) ? $current['site'] : static function (): string { return ''; };
            $saved = get_option($option, []); $saved = is_array($saved) ? $saved : []; $valid = $isValid();
            $hasActivation = !empty($saved['activationToken']);
            $status = $valid ? 'Active' : ($hasActivation ? 'Lease expired' : 'License required');
            $statusClass = $valid ? 'is-active' : ($hasActivation ? 'is-warning' : 'is-inactive');
            $statusText = $valid ? 'This product is licensed and ready to use.' : ($hasActivation ? 'The saved license could not be verified. Refresh it or contact the product owner.' : 'Activate a license to unlock this product on the current site.');
            $claims = [];
            if (!empty($saved['lease']['payload']) && is_string($saved['lease']['payload'])) {
                $value = $saved['lease']['payload'];
                $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
                $claims = is_string($decoded) ? json_decode($decoded, true) : [];
                $claims = is_array($claims) ? $claims : [];
            }
            $checked = !empty($saved['checkedAt']) ? wp_date('M j, Y · H:i', (int) $saved['checkedAt']) : 'Not checked yet';
            $expires = !empty($claims['exp']) ? wp_date('M j, Y · H:i', (int) $claims['exp']) : '—';
            $product = !empty($config['productName']) ? (string) $config['productName'] : (($config['projectType'] ?? '') === 'THEME' ? 'Protected theme' : 'Protected plugin');
            $version = !empty($config['productVersion']) ? (string) $config['productVersion'] : '—';
            ?>
            <style>
                #wpcontent { padding-left: 0; }
                .jp-license { --jp-bg:#09090b;--jp-card:#111113;--jp-soft:#18181b;--jp-border:#27272a;--jp-fg:#fafafa;--jp-muted:#a1a1aa;--jp-subtle:#71717a;--jp-accent:#6ee7b7;min-height:calc(100vh - 32px);background:var(--jp-bg);color:var(--jp-fg);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:0 0 64px;box-sizing:border-box}
                .jp-license *{box-sizing:border-box}.jp-license a{color:inherit}.jp-header{height:68px;border-bottom:1px solid var(--jp-border);display:flex;align-items:center;padding:0 40px;background:rgba(9,9,11,.9)}
                .jp-brand{display:flex;align-items:center;font-size:15px;font-weight:650}
                .jp-header-meta{margin-left:auto;color:var(--jp-subtle);font-size:12px}.jp-main{max-width:1080px;margin:0 auto;padding:58px 30px}.jp-kicker{color:var(--jp-accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:12px}.jp-title{font-size:34px;line-height:1.2;letter-spacing:-.035em;margin:0 0 10px;color:var(--jp-fg)}.jp-lead{font-size:15px;line-height:1.7;color:var(--jp-muted);margin:0;max-width:650px}.jp-back{display:inline-flex;margin-bottom:25px;color:var(--jp-muted)!important;text-decoration:none;font-size:12px}.jp-back:hover{color:var(--jp-fg)!important}
                .jp-status{display:flex;align-items:flex-start;gap:15px;margin-top:32px;padding:20px 22px;border:1px solid var(--jp-border);border-radius:12px;background:var(--jp-card)}.jp-status-dot{width:9px;height:9px;margin-top:6px;border-radius:50%;background:#f87171;box-shadow:0 0 0 5px rgba(248,113,113,.1)}.jp-status.is-active .jp-status-dot{background:var(--jp-accent);box-shadow:0 0 0 5px rgba(110,231,183,.1)}.jp-status.is-warning .jp-status-dot{background:#fbbf24;box-shadow:0 0 0 5px rgba(251,191,36,.1)}.jp-status strong{display:block;font-size:14px;margin-bottom:3px}.jp-status p{margin:0;color:var(--jp-muted);font-size:13px;line-height:1.55}
                .jp-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.75fr);gap:18px;margin-top:18px}.jp-card{border:1px solid var(--jp-border);border-radius:12px;background:var(--jp-card);padding:25px}.jp-card-head{margin-bottom:22px}.jp-card h2{font-size:16px;line-height:1.3;margin:0 0 7px;color:var(--jp-fg)}.jp-card p{color:var(--jp-muted);font-size:13px;line-height:1.65;margin:0}.jp-label{display:block;color:#d4d4d8;font-size:12px;font-weight:650;margin-bottom:8px}.jp-field{display:flex;gap:9px}.jp-input{width:100%;height:44px!important;border:1px solid #3f3f46!important;border-radius:8px!important;background:#09090b!important;color:var(--jp-fg)!important;padding:0 13px!important;font-family:ui-monospace,SFMono-Regular,Menlo,monospace!important;font-size:13px!important;box-shadow:none!important}.jp-input:focus{border-color:var(--jp-accent)!important;box-shadow:0 0 0 3px rgba(110,231,183,.12)!important}.jp-button{height:44px;border:1px solid transparent;border-radius:8px;padding:0 17px;background:#f4f4f5;color:#18181b;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}.jp-button:hover{background:#fff}.jp-button.secondary{background:transparent;border-color:#3f3f46;color:#d4d4d8}.jp-button.secondary:hover{border-color:#52525b;background:var(--jp-soft)}.jp-actions{display:flex;gap:9px;flex-wrap:wrap}.jp-help{margin-top:12px!important;color:var(--jp-subtle)!important;font-size:12px!important}.jp-error{margin-bottom:17px;padding:11px 13px;border:1px solid rgba(248,113,113,.28);border-radius:8px;background:rgba(127,29,29,.15);color:#fca5a5;font-size:12px;line-height:1.55}
                .jp-details{display:grid;gap:0}.jp-detail{display:flex;justify-content:space-between;gap:20px;padding:13px 0;border-bottom:1px solid var(--jp-border);font-size:12px}.jp-detail:first-child{padding-top:0}.jp-detail:last-child{border:0;padding-bottom:0}.jp-detail span{color:var(--jp-subtle)}.jp-detail strong{color:#d4d4d8;font-weight:550;text-align:right;overflow-wrap:anywhere}.jp-security{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.jp-security-item{border:1px solid var(--jp-border);border-radius:10px;background:var(--jp-card);padding:17px}.jp-security-icon{color:var(--jp-accent);font-size:16px;margin-bottom:10px}.jp-security-item strong{display:block;font-size:12px;margin-bottom:4px}.jp-security-item span{font-size:11px;color:var(--jp-subtle)}.jp-footer{display:flex;justify-content:space-between;gap:18px;margin-top:25px;color:var(--jp-subtle);font-size:11px}.jp-footer a{text-decoration:none;color:var(--jp-muted)}.jp-footer a:hover{color:var(--jp-fg)}
                .jp-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:30px}.jp-summary-card{border:1px solid var(--jp-border);border-radius:10px;background:var(--jp-card);padding:18px}.jp-summary-card strong{display:block;font-size:24px;line-height:1;margin-bottom:8px}.jp-summary-card span{color:var(--jp-subtle);font-size:12px}.jp-products{display:grid;gap:12px;margin-top:24px}.jp-product{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;border:1px solid var(--jp-border);border-radius:12px;background:var(--jp-card);padding:20px 22px;text-decoration:none!important;transition:border-color .15s ease,background .15s ease}.jp-product:hover{border-color:#3f3f46;background:#141416}.jp-product-copy{min-width:0}.jp-product-top{display:flex;align-items:center;gap:9px;margin-bottom:7px}.jp-product h2{font-size:15px;margin:0;color:var(--jp-fg)}.jp-type{border:1px solid #323238;border-radius:5px;padding:2px 6px;color:var(--jp-subtle);font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.jp-product-meta{display:flex;gap:15px;color:var(--jp-subtle);font-size:11px}.jp-product-status{display:flex;align-items:center;gap:8px;color:#fca5a5;font-size:11px;font-weight:650;white-space:nowrap}.jp-product-status.is-active{color:var(--jp-accent)}.jp-mini-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 13%,transparent)}
                @media(max-width:782px){#wpcontent{padding-left:0}.jp-license{min-height:100vh}.jp-header{padding:0 20px}.jp-main{padding:38px 18px}.jp-title{font-size:28px}.jp-grid{grid-template-columns:1fr}.jp-security,.jp-summary{grid-template-columns:1fr}.jp-field{flex-direction:column}.jp-button{width:100%}.jp-footer{flex-direction:column}.jp-product{grid-template-columns:1fr}.jp-product-status{margin-top:4px}}
            </style>
            <div class="jp-license">
                <header class="jp-header"><div class="jp-brand">Janus Protect</div><div class="jp-header-meta"><?php echo $showHub ? esc_html(count($products) . ' protected ' . (count($products) === 1 ? 'product' : 'products')) : esc_html($product . ' · v' . $version); ?></div></header>
                <main class="jp-main">
                    <?php if ($showHub): ?>
                    <div class="jp-kicker">License hub</div>
                    <h1 class="jp-title">Protected products</h1>
                    <p class="jp-lead">Manage every Janus-protected plugin and theme installed on this WordPress site.</p>
                    <section class="jp-summary"><div class="jp-summary-card"><strong><?php echo esc_html((string) count($products)); ?></strong><span>Protected products</span></div><div class="jp-summary-card"><strong><?php echo esc_html((string) $activeCount); ?></strong><span>Active licenses</span></div><div class="jp-summary-card"><strong><?php echo esc_html((string) $attentionCount); ?></strong><span>Need attention</span></div></section>
                    <section class="jp-products">
                        <?php foreach ($products as $key => $registered): $itemConfig = is_array($registered['config'] ?? null) ? $registered['config'] : []; $itemValid = is_callable($registered['isValid'] ?? null) && $registered['isValid'](); $itemSite = is_callable($registered['site'] ?? null) ? $registered['site'] : $site; $itemSaved = get_option((string) ($registered['option'] ?? ''), []); $itemSaved = is_array($itemSaved) ? $itemSaved : []; $itemStatus = $itemValid ? 'Active' : (!empty($itemSaved['activationToken']) ? 'Needs attention' : 'License required'); ?>
                        <a class="jp-product" href="<?php echo esc_url(admin_url('admin.php?page=janus-protect&product=' . sanitize_key((string) $key))); ?>"><div class="jp-product-copy"><div class="jp-product-top"><h2><?php echo esc_html((string) ($itemConfig['productName'] ?? 'Protected product')); ?></h2><span class="jp-type"><?php echo esc_html(($itemConfig['projectType'] ?? '') === 'THEME' ? 'Theme' : 'Plugin'); ?></span></div><div class="jp-product-meta"><span>Version <?php echo esc_html((string) ($itemConfig['productVersion'] ?? '—')); ?></span><span><?php echo esc_html((string) $itemSite()); ?></span></div></div><div class="jp-product-status <?php echo $itemValid ? 'is-active' : ''; ?>"><span class="jp-mini-dot"></span><?php echo esc_html($itemStatus); ?> <span aria-hidden="true">→</span></div></a>
                        <?php endforeach; ?>
                    </section>
                    <?php else: ?>
                    <a class="jp-back" href="<?php echo esc_url(admin_url('admin.php?page=janus-protect')); ?>">← All protected products</a>
                    <div class="jp-kicker"><?php echo esc_html(($config['projectType'] ?? '') === 'THEME' ? 'Theme license' : 'Plugin license'); ?></div>
                    <h1 class="jp-title"><?php echo esc_html($product); ?></h1>
                    <p class="jp-lead">Manage access for this protected WordPress product. License validation is signed, site-bound and supports temporary offline use.</p>
                    <section class="jp-status <?php echo esc_attr($statusClass); ?>"><span class="jp-status-dot"></span><div><strong><?php echo esc_html($status); ?></strong><p><?php echo esc_html($statusText); ?></p></div></section>
                    <div class="jp-grid">
                        <section class="jp-card"><div class="jp-card-head"><h2><?php echo $hasActivation ? 'License controls' : 'Activate your license'; ?></h2><p><?php echo $hasActivation ? 'Refresh the signed lease or remove this site activation.' : 'Enter the license key supplied with this product.'; ?></p></div>
                            <?php if (!empty($saved['error'])): ?><div class="jp-error"><?php echo esc_html((string) $saved['error']); ?></div><?php endif; ?>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="<?php echo esc_attr($postAction); ?>"><?php wp_nonce_field($page); ?>
                                <?php if ($hasActivation): ?><div class="jp-actions"><button class="jp-button" name="janus_command" value="refresh">Check license now</button><button class="jp-button secondary" name="janus_command" value="deactivate">Deactivate this site</button></div>
                                <?php else: ?><label class="jp-label" for="jp-license-key">License key</label><div class="jp-field"><input id="jp-license-key" class="jp-input" required name="license_key" autocomplete="off" spellcheck="false" placeholder="JP-XXXXXX-XXXXXX-XXXXXX"><button class="jp-button" name="janus_command" value="activate">Activate license</button></div><p class="jp-help">The key is sent securely to the Janus licensing endpoint and is never stored in plain text.</p><?php endif; ?>
                            </form>
                        </section>
                        <aside class="jp-card"><div class="jp-card-head"><h2>License details</h2><p>Current installation and lease information.</p></div><div class="jp-details"><div class="jp-detail"><span>Site</span><strong><?php echo esc_html($site()); ?></strong></div><div class="jp-detail"><span>License</span><strong><?php echo esc_html((string) ($saved['maskedKey'] ?? 'Not activated')); ?></strong></div><div class="jp-detail"><span>Last checked</span><strong><?php echo esc_html($checked); ?></strong></div><div class="jp-detail"><span>Offline lease</span><strong><?php echo esc_html($expires); ?></strong></div></div></aside>
                    </div>
                    <section class="jp-security"><div class="jp-security-item"><div class="jp-security-icon">◇</div><strong>Site-bound access</strong><span><?php echo esc_html($site()); ?></span></div><div class="jp-security-item"><div class="jp-security-icon">✓</div><strong>Signed validation</strong><span>Ed25519 lease verification</span></div><div class="jp-security-item"><div class="jp-security-icon">↻</div><strong>Offline support</strong><span>Up to 7 days per lease</span></div></section>
                    <?php endif; ?>
                    <footer class="jp-footer"><span>Protected by Janus Protect</span><a href="https://janus.khorami.dev/docs" target="_blank" rel="noopener noreferrer">Documentation ↗</a></footer>
                </main>
            </div>
            <?php
        };
        add_menu_page(__('Janus Protect', 'janus-protect'), __('Janus Protect', 'janus-protect'), 'manage_options', 'janus-protect', $render, 'dashicons-shield-alt', 81);
    });
})();
`;
}

function relativeToRoot(filePath: string, root: string): string {
  return filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;
}

function extensionOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot < 0 ? '' : filePath.slice(dot).toLowerCase();
}

function cloneFile(file: ArchiveFile): ArchiveFile {
  return { ...file, data: Buffer.from(file.data) };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

function createZip(files: ArchiveFile[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    output.once('error', reject);
    output.once('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.once('error', reject);
    zip.outputStream.pipe(output);
    for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
      zip.addBuffer(file.data, file.path, { mode: file.mode & 0o777 ? file.mode : 0o100644 });
    }
    zip.end();
  });
}
