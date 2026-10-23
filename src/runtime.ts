// The qualified release line embeds a SQLite build with the WAL-reset corruption fix.
export const supportedNode = () => {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  return major === 24 && (minor! > 22 || (minor === 22 && patch! >= 1));
};
export function requireRuntime() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('This release supports macOS arm64 only.');
  if (!supportedNode())
    throw Error(
      'Node 24.22.1 or newer in the Node 24 LTS line is required. Upgrade Node before starting the gateway.',
    );
}
