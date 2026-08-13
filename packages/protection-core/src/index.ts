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
    add_filter('janus_protect_license_valid', static function (bool $valid, string $projectId = '') use ($config, $isValid): bool { return $projectId === (string) $config['projectId'] ? $isValid() : $valid; }, 10, 2);
    add_action('admin_post_' . $postAction, static function () use ($config, $option, $page, $request): void {
        if (!current_user_can('manage_options')) { wp_die(esc_html__('Permission denied.', 'janus-protect')); }
        check_admin_referer($page);
        $saved = get_option($option, []);
        $command = sanitize_key((string) ($_POST['janus_command'] ?? ''));
        if ($command === 'deactivate' && is_array($saved) && !empty($saved['activationToken'])) {
            $request('deactivate', ['projectId' => $config['projectId'], 'activationToken' => $saved['activationToken'], 'siteUrl' => home_url('/')]); delete_option($option);
        } elseif ($command === 'activate') {
            $key = sanitize_text_field(wp_unslash((string) ($_POST['license_key'] ?? '')));
            $result = $request('activate', ['projectId' => $config['projectId'], 'key' => $key, 'siteUrl' => home_url('/')]);
            if ($result['ok']) { update_option($option, ['activationToken' => $result['data']['activationToken'], 'lease' => $result['data']['lease'], 'maskedKey' => substr($key, 0, 12) . '…', 'checkedAt' => time(), 'error' => ''], false); }
            else { update_option($option, array_merge(is_array($saved) ? $saved : [], ['error' => $result['error']]), false); }
        }
        wp_safe_redirect(admin_url(($config['projectType'] === 'THEME' ? 'themes.php' : 'options-general.php') . '?page=' . $page)); exit;
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
    add_action('admin_menu', static function () use ($config, $option, $page, $postAction, $isValid): void {
        $render = static function () use ($option, $page, $postAction, $isValid): void {
            $saved = get_option($option, []); $valid = $isValid();
            echo '<div class="wrap"><h1>' . esc_html__('Janus License', 'janus-protect') . '</h1><p><strong>' . esc_html__('Status:', 'janus-protect') . '</strong> ' . ($valid ? '<span style="color:#16803a">' . esc_html__('Active', 'janus-protect') . '</span>' : '<span style="color:#b42318">' . esc_html__('Inactive or offline lease expired', 'janus-protect') . '</span>') . '</p>';
            if (is_array($saved) && !empty($saved['error'])) { echo '<div class="notice notice-error"><p>' . esc_html((string) $saved['error']) . '</p></div>'; }
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="' . esc_attr($postAction) . '">'; wp_nonce_field($page);
            if (!empty($saved['activationToken'])) { echo '<p>' . esc_html((string) ($saved['maskedKey'] ?? '')) . '</p><input type="hidden" name="janus_command" value="deactivate"><button class="button">' . esc_html__('Deactivate license', 'janus-protect') . '</button>'; }
            else { echo '<input class="regular-text" required name="license_key" autocomplete="off" placeholder="JP-XXXXXX-XXXXXX-XXXXXX"><input type="hidden" name="janus_command" value="activate"> <button class="button button-primary">' . esc_html__('Activate license', 'janus-protect') . '</button>'; }
            echo '</form></div>';
        };
        if ($config['projectType'] === 'THEME') { add_theme_page(__('License', 'janus-protect'), __('License', 'janus-protect'), 'manage_options', $page, $render); } else { add_options_page(__('License', 'janus-protect'), __('License', 'janus-protect'), 'manage_options', $page, $render); }
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
