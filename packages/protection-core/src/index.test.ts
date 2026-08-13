import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { ProjectType, ProtectionLevel } from '@janus/contracts';
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  BasicProtectionEngine,
  inspectWordPressArchive,
  matchesExcludedPath,
  sha256,
  stableJson,
  type ArchiveFile,
} from './index';

async function zip(entries: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    archive.outputStream.once('error', reject);
    for (const [name, contents] of Object.entries(entries)) {
      archive.addBuffer(Buffer.from(contents), name);
    }
    archive.end();
  });
}

describe('inspectWordPressArchive', () => {
  it('detects a plugin package', async () => {
    const result = await inspectWordPressArchive(
      await zip({ 'sample/sample.php': '<?php\n/** Plugin Name: Sample */' }),
    );
    expect(result.analysis.type).toBe('PLUGIN');
    expect(result.analysis.entryFile).toBe('sample/sample.php');
  });

  it('detects a theme package', async () => {
    const result = await inspectWordPressArchive(
      await zip({
        'sample/style.css': '/*\nTheme Name: Sample\nVersion: 1.0.0\n*/',
        'sample/functions.php': '<?php\n',
      }),
    );
    expect(result.analysis.type).toBe('THEME');
    expect(result.analysis.entryFile).toBe('sample/functions.php');
  });

  it('rejects nested archives', async () => {
    const input = await zip({
      'sample/sample.php': '<?php\n/** Plugin Name: Sample */',
      'sample/payload.zip': 'not really a zip',
    });
    await expect(inspectWordPressArchive(input)).rejects.toMatchObject({
      code: 'ARCHIVE_NESTED_ARCHIVE',
    });
  });

  it('rejects native executable payloads', async () => {
    const input = await zip({
      'sample/sample.php': '<?php\n/** Plugin Name: Sample */',
      'sample/payload.exe': 'MZ malicious payload',
    });
    await expect(inspectWordPressArchive(input)).rejects.toMatchObject({
      code: 'ARCHIVE_EXECUTABLE_REJECTED',
    });
  });
});

describe('BasicProtectionEngine', () => {
  it('accepts a build version that already matches the plugin header', async () => {
    const source = await inspectWordPressArchive(
      await zip({
        'sample/sample.php': '<?php\n/**\n * Plugin Name: Sample\n * Version: 1.0.0\n */\n',
      }),
    );
    const result = await new BasicProtectionEngine().protect({
      ...source,
      level: ProtectionLevel.BASIC,
      version: '1.0.0',
      signingPrivateKey: '',
      runtimeInjection: false,
      integrity: false,
      obfuscation: false,
      transformPhp: (files) => Promise.resolve({ files, report: {} }),
    });
    const output = await inspectWordPressArchive(result.archive);
    const entry = output.files
      .find((file) => file.path === 'sample/sample.php')
      ?.data.toString('utf8');

    expect(entry).toContain('Version: 1.0.0');
  });

  it('versions, signs and packages an independently verifiable plugin build', async () => {
    const source = await inspectWordPressArchive(
      await zip({
        'sample/sample.php': '<?php\n/**\n * Plugin Name: Sample\n * Version: 1.0.0\n */\n',
      }),
    );
    const { privateKey } = generateKeyPairSync('ed25519');
    const signingPrivateKey = privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    const licensingPublicKey = createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    const result = await new BasicProtectionEngine().protect({
      ...source,
      level: ProtectionLevel.STRONG,
      version: '1.2.3',
      signingPrivateKey,
      runtimeInjection: true,
      integrity: true,
      obfuscation: true,
      licensing: {
        apiUrl: 'https://licenses.example.com/api/v1',
        projectId: 'f231f93e-80fa-4821-96ba-cd5ffcab283e',
        projectType: ProjectType.PLUGIN,
        productName: 'Sample',
        productVersion: '1.2.3',
        publicKey: licensingPublicKey,
      },
      transformPhp: (files) =>
        Promise.resolve({ files, report: { parser: 'test-double', valid: true } }),
    });
    const output = await inspectWordPressArchive(result.archive);
    const byPath = new Map(output.files.map((file) => [file.path, file.data]));
    const entry = byPath.get('sample/sample.php')?.toString('utf8') ?? '';
    const runtime = byPath.get('sample/janus-protect/runtime.php')?.toString('utf8') ?? '';
    const licensing = byPath.get('sample/janus-protect/license.php')?.toString('utf8') ?? '';
    const manifest = byPath.get('sample/janus-protect/integrity-manifest.json');
    const signatureFile = byPath.get('sample/janus-protect/integrity-signature.json');

    expect(entry).toContain('Version: 1.2.3');
    expect(entry).toContain("require_once __DIR__ . '/janus-protect/runtime.php';");
    expect(entry).toContain("require_once __DIR__ . '/janus-protect/license.php';");
    expect(entry).toContain(
      "empty($GLOBALS['janus_protect_license_checks']['f231f93e-80fa-4821-96ba-cd5ffcab283e'])",
    );
    expect(runtime).toContain("do_action('janus_protect_integrity_failed'");
    expect(licensing).toContain("add_menu_page(__('Janus Protect'");
    expect(licensing).toContain('wordpress-sdk/0.4');
    expect(licensing).toContain("do_action('janus_protect_license_invalid'");
    expect(licensing).toContain("$GLOBALS['janus_protect_license_checks']");
    expect(licensing).toContain('class="jp-license"');
    expect(licensing).toContain('Activate your license');
    expect(licensing).toContain('Check license now');
    expect(licensing).toContain('productName');
    expect(licensing).toContain("$GLOBALS['janus_protect_products']");
    expect(licensing).toContain('Protected products');
    expect(licensing).toContain('All protected products');
    expect(licensing).toContain('.jp-license a:focus,.jp-license button:focus');
    expect(licensing).toContain('.jp-product:focus,.jp-product:active,.jp-product:visited');
    expect(manifest).toBeDefined();
    expect(signatureFile).toBeDefined();

    const signature = JSON.parse(signatureFile?.toString('utf8') ?? '{}') as {
      publicKey: string;
      signature: string;
    };
    expect(
      verify(
        null,
        manifest as Buffer,
        createPublicKey({
          key: Buffer.from(signature.publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        }),
        Buffer.from(signature.signature, 'base64'),
      ),
    ).toBe(true);
    expect(manifest?.toString('utf8')).toBe(stableJson(result.integrityManifest));
    expect(result.integrityManifest).toMatchObject({
      version: '1.2.3',
      files: {
        'sample.php': sha256(byPath.get('sample/sample.php') as Buffer),
        'janus-protect/runtime.php': sha256(
          byPath.get('sample/janus-protect/runtime.php') as Buffer,
        ),
      },
    });
  });

  it('rejects source files that collide with the protected runtime', async () => {
    const engine = new BasicProtectionEngine();
    const files: ArchiveFile[] = [
      { path: 'sample/sample.php', data: Buffer.from('<?php'), mode: 0o100644 },
      { path: 'sample/janus-protect/runtime.php', data: Buffer.from('<?php'), mode: 0o100644 },
    ];
    await expect(
      engine.protect({
        files,
        analysis: {
          type: ProjectType.PLUGIN,
          rootDirectory: 'sample',
          entryFile: 'sample/sample.php',
          fileCount: 2,
          phpFileCount: 2,
          uncompressedSize: 10,
          nestedArchives: 0,
        },
        level: ProtectionLevel.BASIC,
        version: '1.0.0',
        signingPrivateKey: '',
        runtimeInjection: true,
        integrity: true,
        obfuscation: false,
        transformPhp: (input) => Promise.resolve({ files: input, report: {} }),
      }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_RESERVED_PATH' });
  });

  it('cannot disable licensing enforcement by disabling the integrity runtime', async () => {
    const source = await inspectWordPressArchive(
      await zip({ 'sample/sample.php': '<?php\n/** Plugin Name: Sample\n * Version: 1.0.0 */' }),
    );
    const { privateKey } = generateKeyPairSync('ed25519');
    const signingPrivateKey = privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    const result = await new BasicProtectionEngine().protect({
      ...source,
      level: ProtectionLevel.BASIC,
      version: '1.0.1',
      signingPrivateKey,
      runtimeInjection: false,
      integrity: false,
      obfuscation: false,
      licensing: {
        apiUrl: 'https://licenses.example.com/api/v1',
        projectId: 'f231f93e-80fa-4821-96ba-cd5ffcab283e',
        projectType: ProjectType.PLUGIN,
        productName: 'Sample',
        productVersion: '1.0.1',
        publicKey: createPublicKey(privateKey)
          .export({ format: 'der', type: 'spki' })
          .toString('base64'),
      },
      transformPhp: (files) => Promise.resolve({ files, report: {} }),
    });
    const output = await inspectWordPressArchive(result.archive);
    const paths = new Set(output.files.map((file) => file.path));
    const entry = output.files
      .find((file) => file.path === 'sample/sample.php')
      ?.data.toString('utf8');

    expect(paths.has('sample/janus-protect/license.php')).toBe(true);
    expect(paths.has('sample/janus-protect/runtime.php')).toBe(false);
    expect(entry).toContain('janus-protect/license.php');
    expect(entry).toContain('janus_protect_license_checks');
  });
});

describe('matchesExcludedPath', () => {
  it('matches exact files and directory trees without partial-prefix collisions', () => {
    expect(matchesExcludedPath('includes/legacy.php', ['includes/**'])).toBe(true);
    expect(matchesExcludedPath('bootstrap.php', ['bootstrap.php'])).toBe(true);
    expect(matchesExcludedPath('includes-new/legacy.php', ['includes'])).toBe(false);
  });
});
