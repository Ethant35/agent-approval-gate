// Author: Ethan. Reproducible local app assembly; signing/notarization is a separate explicit step.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fs.realpathSync.native(process.cwd());
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--node-root' || args[2] !== '--output')
  throw Error('Use --node-root DIR --output NEW_DIR');
const nodeRoot = fs.realpathSync.native(path.resolve(args[1]));
const output = path.resolve(args[3]);
if (fs.existsSync(output))
  throw Error('Output must be a new directory; preserve earlier tested artifacts.');
const manifest = JSON.parse(fs.readFileSync('package.json'));
const node = path.join(nodeRoot, 'bin/node');
if (execFileSync(node, ['--version'], { encoding: 'utf8' }).trim() !== 'v24.22.1')
  throw Error('Expected qualified Node24.22.1 runtime.');
fs.mkdirSync(output, { recursive: true });
const app = path.join(output, 'Agent Approval Gate.app');
const contents = path.join(app, 'Contents'),
  resources = path.join(contents, 'Resources');
const macos = path.join(contents, 'MacOS'),
  gateway = path.join(resources, 'gateway');
for (const p of [macos, gateway, path.join(resources, 'runtime/bin')])
  fs.mkdirSync(p, { recursive: true });
fs.cpSync('dist', path.join(gateway, 'dist'), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'README.md', 'SECURITY.md'])
  fs.copyFileSync(name, path.join(gateway, name));
fs.copyFileSync(node, path.join(resources, 'runtime/bin/node'));
fs.chmodSync(path.join(resources, 'runtime/bin/node'), 0o755);
fs.copyFileSync(path.join(nodeRoot, 'LICENSE'), path.join(resources, 'runtime/LICENSE'));
execFileSync(
  path.join(nodeRoot, 'bin/npm'),
  ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  {
    cwd: gateway,
    env: { ...process.env, PATH: path.join(nodeRoot, 'bin') + ':' + process.env.PATH },
    stdio: 'inherit',
  },
);
execFileSync(
  '/usr/bin/xcrun',
  [
    'swiftc',
    '-parse-as-library',
    '-O',
    '-warnings-as-errors',
    '-target',
    'arm64-apple-macosx14.0',
    '-framework',
    'AppKit',
    '-framework',
    'WebKit',
    'native/main.swift',
    '-o',
    path.join(macos, 'AgentApprovalGate'),
  ],
  { stdio: 'inherit' },
);
const plist = {
  CFBundleDevelopmentRegion: 'en',
  CFBundleExecutable: 'AgentApprovalGate',
  CFBundleIdentifier: 'com.ethan.agent-approval-gate',
  CFBundleInfoDictionaryVersion: '6.0',
  CFBundleName: 'Agent Approval Gate',
  CFBundleDisplayName: 'Agent Approval Gate',
  CFBundlePackageType: 'APPL',
  CFBundleShortVersionString: manifest.version,
  CFBundleVersion: manifest.version,
  LSMinimumSystemVersion: '14.0',
  NSHighResolutionCapable: true,
  NSHumanReadableCopyright:
    'Copyright © 2026 Ethan. MIT license; bundled upstream licenses retained.',
  NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
};
fs.writeFileSync(path.join(contents, 'Info.plist'), JSON.stringify(plist));
execFileSync('/usr/bin/plutil', ['-convert', 'xml1', path.join(contents, 'Info.plist')]);
const provenance = {
  author: 'Ethan',
  version: manifest.version,
  nodeVersion: '24.22.1',
  upstreamNodeSha256: createHash('sha256').update(fs.readFileSync(node)).digest('hex'),
  buildPlatform: process.platform + '-' + process.arch,
  entry: 'native/main.swift',
  nodeLicense: 'runtime/LICENSE',
  gatewayLicense: 'gateway/LICENSE',
  signing: 'Assembly is unsigned; final signing/notarization evidence is external.',
};
fs.writeFileSync(
  path.join(resources, 'provenance.json'),
  JSON.stringify(provenance, null, 2) + '\n',
);
console.log(JSON.stringify({ app, version: manifest.version }));
