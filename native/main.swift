// Author: Ethan. Native macOS launcher and WebKit security boundary.
import AppKit
import Darwin
import Foundation
import WebKit

enum DesktopMode: String, Decodable {
  case workspace
  case tutorial
}

struct ReadyMessage: Decodable {
  let type: String
  let url: String
  let operatorToken: String
  let workspace: String
  let dataDir: String
  let mode: DesktopMode
  let tutorialRequestId: String?
  let version: String
}

enum SelfTestTermination: String {
  case commandQ = "command-q"
  case windowClose = "window-close"
}

enum LauncherFailure: LocalizedError {
  case missingBundledRuntime
  case invalidReadyMessage
  case invalidReadyOrigin
  case invalidReadyPaths
  case processDidNotStart
  case processLaunchFailed
  case gatewayClosedBeforeReady
  case gatewayReportedFailure(String)

  var errorDescription: String? {
    switch self {
    case .missingBundledRuntime:
      return "The bundled gateway runtime is missing. Reinstall Agent Approval Gate."
    case .invalidReadyMessage, .invalidReadyOrigin, .invalidReadyPaths:
      return "The local gateway returned an invalid startup response. It was stopped."
    case .processDidNotStart:
      return "The local gateway could not start. Check the app installation and try again."
    case .processLaunchFailed, .gatewayClosedBeforeReady:
      return "The local gateway stopped before it became ready. Check the app installation and try again."
    case .gatewayReportedFailure(let message):
      return message
    }
  }
}

private final class BoundedDiagnostics: @unchecked Sendable {
  private let lock = NSLock()
  private var bytes = Data()
  private let limit = 4096

  func consume(_ handle: FileHandle) {
    handle.readabilityHandler = { [weak self] readable in
      let data = readable.availableData
      guard !data.isEmpty else {
        readable.readabilityHandler = nil
        return
      }
      self?.lock.lock()
      if let self, self.bytes.count < self.limit {
        self.bytes.append(data.prefix(self.limit - self.bytes.count))
      }
      self?.lock.unlock()
    }
  }

  var safeMessage: String? {
    lock.lock()
    let data = bytes
    lock.unlock()
    guard var value = String(data: data, encoding: .utf8), !value.isEmpty else { return nil }
    value = value.replacingOccurrences(of: "\\u001B\\[[;\\d]*m", with: "", options: .regularExpression)
    value = value.replacingOccurrences(of: "(?i)bearer\\s+[^\\s]+", with: "Bearer [redacted]", options: .regularExpression)
    value = value.replacingOccurrences(of: "\\b[a-fA-F0-9]{32,}\\b", with: "[redacted]", options: .regularExpression)
    value = value.replacingOccurrences(of: "[\\r\\n\\t]+", with: " ", options: .regularExpression)
    value = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }
    return String(value.prefix(400))
  }
}

@MainActor
final class GatewayProcess {
  private let applicationSupportRoot: URL
  private var process: Process?
  private var input: Pipe?
  private var output: Pipe?
  private var diagnostics: BoundedDiagnostics?
  private var isStopping = false
  private var stopTask: Task<Void, Never>?
  private var hasStopped = false
  private var cachedShutdownFailure: String?
  var onUnexpectedTermination: (() -> Void)?
  private(set) var ready: ReadyMessage?
  var childProcessIdentifier: Int32? { process?.processIdentifier }
  var isReadyAndRunning: Bool { ready != nil && process?.isRunning == true && !isStopping }

  init(applicationSupportRoot: URL, requiresFreshRoot: Bool = false) throws {
    if requiresFreshRoot, FileManager.default.fileExists(atPath: applicationSupportRoot.path) {
      throw LauncherFailure.invalidReadyPaths
    }
    self.applicationSupportRoot = try Self.preparePrivateDirectory(applicationSupportRoot)
  }

  func start(mode: DesktopMode, workspace: URL? = nil) async throws -> ReadyMessage {
    guard process == nil else { throw LauncherFailure.processDidNotStart }
    let resources = Self.resourceDirectory()
    let runtime = resources.appending(path: "runtime/bin/node")
    let entry = resources.appending(path: "gateway/dist/desktop.js")
    guard FileManager.default.isExecutableFile(atPath: runtime.path),
          FileManager.default.isReadableFile(atPath: entry.path)
    else { throw LauncherFailure.missingBundledRuntime }

    var arguments = [entry.path, "--root", applicationSupportRoot.path]
    if mode == .tutorial {
      guard workspace == nil else { throw LauncherFailure.invalidReadyMessage }
      arguments.append("--tutorial")
    } else {
      guard let workspace = try Self.canonicalDirectory(workspace) else {
        throw LauncherFailure.invalidReadyMessage
      }
      arguments.append(contentsOf: ["--workspace", workspace.path])
    }

    let child = Process()
    let childInput = Pipe()
    let childOutput = Pipe()
    let childError = Pipe()
    let errorCapture = BoundedDiagnostics()
    errorCapture.consume(childError.fileHandleForReading)
    child.executableURL = runtime
    child.arguments = arguments
    child.environment = [
      "HOME": NSHomeDirectory(),
      "PATH": "/usr/bin:/bin",
      "TMPDIR": FileManager.default.temporaryDirectory.path,
    ]
    child.standardInput = childInput
    child.standardOutput = childOutput
    child.standardError = childError
    do {
      try child.run()
    } catch {
      childInput.fileHandleForWriting.closeFile()
      childOutput.fileHandleForReading.closeFile()
      childError.fileHandleForReading.closeFile()
      throw LauncherFailure.processLaunchFailed
    }

    process = child
    input = childInput
    output = childOutput
    diagnostics = errorCapture
    child.terminationHandler = { [weak self] terminated in
      Task { @MainActor [weak self] in
        guard let self, self.process === terminated, !self.isStopping, self.ready != nil else { return }
        self.onUnexpectedTermination?()
      }
    }
    do {
      let line = try await Self.readOneLine(from: childOutput.fileHandleForReading, limit: 64 * 1024)
      let message = try JSONDecoder().decode(ReadyMessage.self, from: line)
      try Self.validate(message, expectedMode: mode, requestedWorkspace: workspace,
                        applicationSupportRoot: applicationSupportRoot)
      ready = message
      Self.discardSubsequentOutput(childOutput.fileHandleForReading)
      return message
    } catch {
      _ = await stop()
      if let message = errorCapture.safeMessage {
        throw LauncherFailure.gatewayReportedFailure(message)
      }
      throw error is LauncherFailure ? error : LauncherFailure.invalidReadyMessage
    }
  }

  /// Close stdin first so the backend can stop its children and release its native lease.
  func stop() async -> String? {
    if hasStopped { return cachedShutdownFailure }
    if let stopTask {
      await stopTask.value
      return cachedShutdownFailure
    }
    let task = Task { @MainActor [self] in await stopOnce() }
    stopTask = task
    await task.value
    hasStopped = true
    stopTask = nil
    return cachedShutdownFailure
  }

  private func stopOnce() async {
    isStopping = true
    ready = nil
    onUnexpectedTermination = nil
    let requestedGracefulShutdown = process?.isRunning == true
    input?.fileHandleForWriting.closeFile()
    input = nil
    if let child = process, child.isRunning {
      // Give the backend time to stop mediated descendants and release its
      // lease before escalating. A bounded wait keeps app shutdown responsive.
      for _ in 0..<120 where child.isRunning {
        try? await Task.sleep(for: .milliseconds(100))
      }
      if child.isRunning {
        child.terminate()
        for _ in 0..<20 where child.isRunning {
          try? await Task.sleep(for: .milliseconds(100))
        }
        if child.isRunning {
          _ = Darwin.kill(child.processIdentifier, SIGKILL)
          cachedShutdownFailure = "The managed gateway did not stop cleanly. It was force-stopped; check for a Codex process left open in Terminal."
        } else {
          cachedShutdownFailure = "The managed gateway needed a termination signal to stop. Check for a Codex process left open in Terminal."
        }
      }
      await Task.detached { child.waitUntilExit() }.value
    }
    if requestedGracefulShutdown, let child = process, child.terminationStatus != 0 {
      let status = child.terminationStatus
      let detail = diagnostics?.safeMessage.flatMap { message -> String? in
        let marker = "Agent Approval Gate shutdown incomplete:"
        guard let range = message.range(of: marker) else { return nil }
        let value = message[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? marker : value
      }
      cachedShutdownFailure = detail.map { "Managed gateway shutdown failed (status \(status)): \($0)" }
        ?? "Managed gateway shutdown failed (status \(status)). Check for a Codex process left open in Terminal."
    }
    process?.terminationHandler = nil
    output?.fileHandleForReading.closeFile()
    output = nil
    diagnostics = nil
    process = nil
    isStopping = false
  }

  func terminateForSelfTest() {
    guard ready != nil, let child = process, child.isRunning else { return }
    _ = Darwin.kill(child.processIdentifier, SIGKILL)
  }

  private static func preparePrivateDirectory(_ url: URL) throws -> URL {
    let manager = FileManager.default
    try manager.createDirectory(at: url, withIntermediateDirectories: true)
    try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    return try canonicalPath(url)
  }

  private static func resourceDirectory() -> URL {
    if let resources = Bundle.main.resourceURL,
       FileManager.default.isExecutableFile(atPath: resources.appending(path: "runtime/bin/node").path),
       FileManager.default.isReadableFile(atPath: resources.appending(path: "gateway/dist/desktop.js").path) {
      return resources
    }
    let executable = URL(fileURLWithPath: CommandLine.arguments[0])
      .standardizedFileURL.resolvingSymlinksInPath()
    return executable.deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("Resources", isDirectory: true)
  }

  static func canonicalDirectoryForUI(_ url: URL) throws -> URL? {
    try canonicalDirectory(url)
  }

  private static func canonicalDirectory(_ url: URL?) throws -> URL? {
    guard let url else { return nil }
    let canonical = try canonicalPath(url)
    let values = try canonical.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true else {
      throw LauncherFailure.invalidReadyPaths
    }
    return canonical
  }

  private static func canonicalPath(_ url: URL) throws -> URL {
    guard let resolved = Darwin.realpath(url.path, nil) else {
      throw LauncherFailure.invalidReadyPaths
    }
    defer { free(resolved) }
    return URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
  }

  private static func readOneLine(from handle: FileHandle, limit: Int) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          var data = Data()
          while data.count < limit {
            guard let byte = try handle.read(upToCount: 1), !byte.isEmpty else {
              throw LauncherFailure.gatewayClosedBeforeReady
            }
            if byte[byte.startIndex] == 0x0a {
              continuation.resume(returning: data)
              return
            }
            data.append(byte)
          }
          throw LauncherFailure.invalidReadyMessage
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private static func discardSubsequentOutput(_ handle: FileHandle) {
    handle.readabilityHandler = { readable in
      let bytes = readable.availableData
      if bytes.isEmpty { readable.readabilityHandler = nil }
      // The backend protocol forbids further stdout messages. Discard bytes so
      // accidental diagnostics cannot become a pipe backpressure or log leak.
    }
  }

  private static func validate(
    _ message: ReadyMessage,
    expectedMode: DesktopMode,
    requestedWorkspace: URL?,
    applicationSupportRoot: URL
  ) throws {
    guard message.type == "ready", message.mode == expectedMode,
          message.operatorToken.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
          !message.version.isEmpty
    else { throw LauncherFailure.invalidReadyMessage }

    guard let url = URLComponents(string: message.url),
          url.scheme == "http", url.host == "127.0.0.1", url.port.map({ (1...65535).contains($0) }) == true,
          url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
          url.path.isEmpty || url.path == "/"
    else { throw LauncherFailure.invalidReadyOrigin }

    let rootURL = try canonicalPath(applicationSupportRoot)
    let root = rootURL.path + "/"
    let dataDirURL = try canonicalPath(URL(fileURLWithPath: message.dataDir))
    let dataDir = dataDirURL.path
    let dataValues = try dataDirURL.resourceValues(forKeys: [.isDirectoryKey])
    guard dataDir.hasPrefix(root), dataDir != rootURL.path, dataValues.isDirectory == true,
          let workspace = try canonicalDirectory(URL(fileURLWithPath: message.workspace))
    else { throw LauncherFailure.invalidReadyPaths }

    if expectedMode == .workspace {
      guard let requestedWorkspace = try canonicalDirectory(requestedWorkspace),
            workspace.path == requestedWorkspace.path,
            message.tutorialRequestId == nil
      else { throw LauncherFailure.invalidReadyPaths }
    } else {
      guard workspace.path.hasPrefix(root), let id = message.tutorialRequestId, !id.isEmpty else {
        throw LauncherFailure.invalidReadyPaths
      }
    }
  }
}

@MainActor
final class OriginNavigationPolicy: NSObject, WKNavigationDelegate, WKUIDelegate {
  private let origin: (scheme: String, host: String, port: Int)
  var didFinishMainFrame: (() -> Void)?

  init(serverURL: URL) {
    origin = (serverURL.scheme ?? "", serverURL.host ?? "", serverURL.port ?? -1)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard !action.shouldPerformDownload,
          let target = action.request.url,
          let frame = action.targetFrame,
          sameOrigin(target), frame.isMainFrame || sameOrigin(target)
    else { decisionHandler(.cancel); return }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let headers = (response.response as? HTTPURLResponse)?.allHeaderFields
    let attachment = headers?.contains { key, value in
      String(describing: key).caseInsensitiveCompare("Content-Disposition") == .orderedSame &&
        String(describing: value).lowercased().contains("attachment")
    } ?? false
    guard !attachment, response.canShowMIMEType,
          let url = response.response.url, sameOrigin(url)
    else { decisionHandler(.cancel); return }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    nil
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    didFinishMainFrame?()
  }

  private func sameOrigin(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
    return components.scheme == origin.scheme && components.host == origin.host &&
      components.port == origin.port && components.user == nil && components.password == nil
  }
}

@MainActor
struct SecuredDashboard {
  let webView: WKWebView
  private let serverURL: URL
  // Keep the delegate alive for the lifetime of the WKWebView.
  private let navigationPolicy: OriginNavigationPolicy
  var didFinishMainFrame: (() -> Void)? {
    get { navigationPolicy.didFinishMainFrame }
    nonmutating set { navigationPolicy.didFinishMainFrame = newValue }
  }

  init(ready: ReadyMessage) throws {
    guard let url = URL(string: ready.url), url.scheme == "http",
          url.host == "127.0.0.1", let port = url.port
    else { throw LauncherFailure.invalidReadyOrigin }

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let controller = WKUserContentController()
    var metadata: [String: Any] = [
      "mode": ready.mode.rawValue,
      "workspace": ready.workspace,
      "version": ready.version,
    ]
    if let id = ready.tutorialRequestId { metadata["tutorialRequestId"] = id }
    let bootstrap = """
      (() => {
        const expectedOrigin = \(try Self.jsLiteral("http://127.0.0.1:\(port)"));
        if (window.top !== window || location.origin !== expectedOrigin) return;
        sessionStorage.setItem("aag-human-token", \(try Self.jsLiteral(ready.operatorToken)));
        Object.defineProperty(window, "__AAG_DESKTOP__", {
          value: \(try Self.jsLiteral(metadata)), configurable: false, writable: false
        });
      })();
      """
    controller.addUserScript(WKUserScript(
      source: bootstrap,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))
    configuration.userContentController = controller

    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.isInspectable = false
    navigationPolicy = OriginNavigationPolicy(serverURL: url)
    serverURL = url
    webView.navigationDelegate = navigationPolicy
    webView.uiDelegate = navigationPolicy
  }

  func load() {
    webView.load(URLRequest(url: serverURL))
  }

  func clearSession() async {
    webView.stopLoading()
    webView.loadHTMLString("", baseURL: nil)
    webView.configuration.userContentController.removeAllUserScripts()
    await withCheckedContinuation { continuation in
      webView.configuration.websiteDataStore.removeData(
        ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
        modifiedSince: .distantPast
      ) { continuation.resume() }
    }
  }

  func verifySessionCleared(completion: @escaping (Bool) -> Void) {
    guard webView.url?.absoluteString != serverURL.absoluteString else {
      completion(false)
      return
    }
    webView.evaluateJavaScript("sessionStorage.getItem('aag-human-token')") { result, error in
      if error != nil {
        completion(true)
      } else {
        completion((result as? String) == nil)
      }
    }
  }

  func runTutorialSelfTest(completion: @escaping (String) -> Void) {
    let script = """
      return await (async () => {
        try {
          const fail = stage => `FAIL:${stage}`;
          for (let attempt = 0; attempt < 50 && !document.querySelector('#root')?.firstElementChild; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (!document.querySelector('#root')?.firstElementChild) return fail('dashboard-render');
          for (let attempt = 0; attempt < 50 && !document.querySelector('.connection.is-connected'); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (!document.querySelector('.connection.is-connected')) return fail('dashboard-connection');
          const context = window.__AAG_DESKTOP__;
          const token = sessionStorage.getItem('aag-human-token') || '';
          if (!context || context.mode !== 'tutorial' || !context.tutorialRequestId || !/^[a-f0-9]{64}$/.test(token)) return fail('desktop-context');
          if (location.origin !== 'http://127.0.0.1:\(webView.url?.port ?? 0)') return fail('origin');
          if (window.open('https://aag.invalid/') !== null) return fail('popup-boundary');
          const unauthenticated = await fetch('/v1/policy');
          if (unauthenticated.status !== 401) return fail('unauthenticated-denial');
          const headers = { Authorization: `Bearer ${token}` };
          const health = await fetch('/v1/health', { headers });
          if (!health.ok) return fail('authenticated-health');
          const requestURL = `/v1/requests/${encodeURIComponent(context.tutorialRequestId)}`;
          const pendingResponse = await fetch(requestURL, { headers });
          if (!pendingResponse.ok) return fail('tutorial-request');
          const pending = await pendingResponse.json();
          if (pending.state !== 'PENDING_APPROVAL') return fail('pending-state');
          const approve = [...document.querySelectorAll('.request-card.is-pending button')]
            .find(button => button.textContent?.trim() === 'Approve');
          if (!approve) return fail('approval-button');
          approve.click();
          for (let attempt = 0; attempt < 50 && ![...document.querySelectorAll('button')]
            .some(button => button.textContent?.trim() === 'Confirm approval'); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const confirm = [...document.querySelectorAll('button')]
            .find(button => button.textContent?.trim() === 'Confirm approval');
          if (!confirm) return fail('approval-confirmation');
          confirm.click();
          for (let attempt = 0; attempt < 100; attempt++) {
            const response = await fetch(requestURL, { headers });
            if (!response.ok) return fail('request-poll');
            const current = await response.json();
            if (current.state === 'COMPLETED') return 'PASS';
            if (['FAILED', 'DENIED', 'EXPIRED', 'CANCELLED'].includes(current.state)) return fail('terminal-state');
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          return fail('write-timeout');
        } catch {
          return 'FAIL:javascript-exception';
        }
      })();
      """
    webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
      completion((try? result.get() as? String) ?? "FAIL:web-evaluation")
    }
  }

  func runWorkspaceSelfTest(completion: @escaping (String) -> Void) {
    let script = """
      return await (async () => {
        try {
          const fail = stage => `FAIL:${stage}`;
          const expectedOrigin = 'http://127.0.0.1:\(webView.url?.port ?? 0)';
          for (let attempt = 0; attempt < 50 && !document.querySelector('#root')?.firstElementChild; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          for (let attempt = 0; attempt < 50 && !document.querySelector('.connection.is-connected'); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const context = window.__AAG_DESKTOP__;
          const token = sessionStorage.getItem('aag-human-token') || '';
          if (!document.querySelector('#root')?.firstElementChild) return fail('workspace-dashboard-render');
          if (!document.querySelector('.connection.is-connected')) return fail('workspace-dashboard-connection');
          if (!context || context.mode !== 'workspace' || !/^[a-f0-9]{64}$/.test(token)) return fail('workspace-context');
          if (location.origin !== expectedOrigin) return fail('workspace-origin');
          const unauthenticated = await fetch('/v1/policy');
          if (unauthenticated.status !== 401) return fail('workspace-unauthenticated-denial');
          const headers = { Authorization: `Bearer ${token}` };
          const health = await fetch('/v1/health', { headers });
          if (!health.ok) return fail('workspace-health');
          const target = `${context.workspace}/native-self-test.txt`;
          const submitted = await fetch('/v1/requests', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'X-AAG-Intent': 'human' },
            body: JSON.stringify({
              id: 'native-returning-write', agentId: 'agent', sessionId: 'native-self-test',
              category: 'filesystem', operation: 'write',
              parameters: { path: target, content: 'Native launcher approval verified.\\n' },
              resourceScope: target, timestamp: new Date().toISOString(),
              requestedPermissions: ['filesystem:write'], expectedResultFormat: 'json'
            })
          });
          if (!submitted.ok || (await submitted.json()).state !== 'PENDING_APPROVAL') return fail('workspace-submit');
          const requestURL = '/v1/requests/native-returning-write';
          for (let attempt = 0; attempt < 50 && !document.querySelector('.request-card.is-pending button'); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const approve = [...document.querySelectorAll('.request-card.is-pending button')]
            .find(button => button.textContent?.trim() === 'Approve');
          if (!approve) return fail('workspace-approval-button');
          approve.click();
          for (let attempt = 0; attempt < 50 && ![...document.querySelectorAll('button')]
            .some(button => button.textContent?.trim() === 'Confirm approval'); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const confirm = [...document.querySelectorAll('button')]
            .find(button => button.textContent?.trim() === 'Confirm approval');
          if (!confirm) return fail('workspace-approval-confirmation');
          confirm.click();
          let completed = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const response = await fetch(requestURL, { headers });
            if (!response.ok) return fail('workspace-request-poll');
            const current = await response.json();
            if (current.state === 'COMPLETED') { completed = true; break; }
            if (['FAILED', 'DENIED', 'EXPIRED', 'CANCELLED'].includes(current.state)) return fail('workspace-terminal-state');
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (!completed) return fail('workspace-write-timeout');
          for (const href of ['https://aag.invalid/', 'data:text/html,blocked']) {
            const link = document.createElement('a'); link.href = href; link.target = '_self';
            document.body.append(link); link.click(); link.remove();
            await new Promise(resolve => setTimeout(resolve, 150));
            if (location.origin !== expectedOrigin) return fail('off-origin-navigation');
          }
          if (window.open('https://aag.invalid/') !== null) return fail('popup-boundary');
          return 'PASS';
        } catch {
          return 'FAIL:workspace-javascript-exception';
        }
      })();
      """
    webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
      completion((try? result.get() as? String) ?? "FAIL:workspace-web-evaluation")
    }
  }

  func runWorkspaceReturnSelfTest(completion: @escaping (String) -> Void) {
    let script = """
      return await (async () => {
        try {
          const context = window.__AAG_DESKTOP__;
          const token = sessionStorage.getItem('aag-human-token') || '';
          if (!context || context.mode !== 'workspace' || !/^[a-f0-9]{64}$/.test(token)) return 'FAIL:return-context';
          for (let attempt = 0; attempt < 50 && !document.querySelector('.connection.is-connected'); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (!document.querySelector('.connection.is-connected')) return 'FAIL:return-dashboard-connection';
          const response = await fetch('/v1/requests/native-returning-write', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!response.ok) return 'FAIL:return-history-request';
          const request = await response.json();
          if (request.state !== 'COMPLETED') return 'FAIL:return-history-state';
          return 'PASS';
        } catch {
          return 'FAIL:return-javascript-exception';
        }
      })();
      """
    webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
      completion((try? result.get() as? String) ?? "FAIL:return-web-evaluation")
    }
  }

  func saveSelfTestSnapshot(to url: URL, completion: @escaping (Bool) -> Void) {
    webView.takeSnapshot(with: nil) { image, _ in
      guard let image, let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
            let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:])
      else { completion(false); return }
      do {
        try png.write(to: url, options: .atomic)
        completion(true)
      } catch {
        completion(false)
      }
    }
  }

  private static func jsLiteral(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    guard let string = String(data: data, encoding: .utf8) else {
      throw LauncherFailure.invalidReadyMessage
    }
    return string.replacingOccurrences(of: "<", with: "\\u003c")
  }
}

private struct LauncherArguments {
  let selfTest: Bool
  let testRoot: URL?
  var isIsolated: Bool { testRoot != nil }
  let selfTestTermination: SelfTestTermination

  init(_ arguments: [String]) throws {
    var selfTest = false
    var testRoot: URL?
    var selfTestTermination = SelfTestTermination.commandQ
    var terminationWasSpecified = false
    var selfTestWasSpecified = false
    var testRootWasSpecified = false
    var index = 0
    while index < arguments.count {
      switch arguments[index] {
      case "--self-test":
        guard !selfTestWasSpecified else { throw LauncherFailure.invalidReadyPaths }
        selfTest = true
        selfTestWasSpecified = true
        index += 1
      case "--test-root":
        guard !testRootWasSpecified, index + 1 < arguments.count,
              arguments[index + 1].hasPrefix("/"), !arguments[index + 1].isEmpty
        else { throw LauncherFailure.invalidReadyPaths }
        testRoot = URL(fileURLWithPath: arguments[index + 1], isDirectory: true)
        testRootWasSpecified = true
        index += 2
      case "--self-test-exit":
        guard !terminationWasSpecified, index + 1 < arguments.count,
              let parsed = SelfTestTermination(rawValue: arguments[index + 1])
        else { throw LauncherFailure.invalidReadyPaths }
        selfTestTermination = parsed
        terminationWasSpecified = true
        index += 2
      default:
        throw LauncherFailure.invalidReadyPaths
      }
    }
    guard (!selfTest || testRoot != nil),
          selfTest || !terminationWasSpecified,
          testRoot?.path.hasPrefix("/") ?? true
    else {
      throw LauncherFailure.invalidReadyPaths
    }
    self.selfTest = selfTest
    self.testRoot = testRoot
    self.selfTestTermination = selfTestTermination
  }
}

@MainActor
final class LauncherApplication: NSObject, NSApplicationDelegate {
  private let arguments: LauncherArguments
  private let preferences: UserDefaults
  private let testPreferencesDomain: String?
  private var window: NSWindow!
  private let dashboardSlot = NSView()
  private let statusLabel = NSTextField(labelWithString: "Choose a workspace or try the isolated tutorial.")
  private let scopeLabel = NSTextField(labelWithString: "New workspaces require file approval; saved rules may allow or deny actions. Only actions sent through this gateway are checked.")
  private let workspaceLabel = NSTextField(labelWithString: "No workspace selected")
  private let errorLabel = NSTextField(wrappingLabelWithString: "")
  private var reopenButton: NSButton!
  private var restartButton: NSButton!
  private var stopButton: NSButton!
  private var chooseButton: NSButton!
  private var tutorialButton: NSButton!
  private var gateway: GatewayProcess?
  private var pendingUnexpectedGateway: GatewayProcess?
  private var dashboard: SecuredDashboard?
  private var activeMode: DesktopMode?
  private var activeWorkspace: URL?
  private var busy = false
  private var terminationRequested = false
  private var lastShutdownFailure: String?
  private var stopSessionTask: Task<Void, Never>?
  private var stopSessionID: UUID?
  private var selfTestPageStarted = false
  private var selfTestRootInitialized = false
  private var selfTestWorkspaceReopened = false
  private var selfTestUnexpectedExitHandled = false
  private var selfTestStartupExitInjected = false
  private var selfTestStartupExitHandled = false
  private var selfTestRetiredDashboard: SecuredDashboard?
  private var selfTestWorkspace: URL?
  private var selfTestApplicationDataRoot: URL?
  private var selfTestManualStopArmed = false
  private var selfTestManualStopCompleted = false
  private var selfTestManualStopPID: Int32?
  private var selfTestManualStopDataDir: String?
  private var selfTestTerminationArmed = false
  private var quitMenuItem: NSMenuItem?
  private var editMenuItems: [NSMenuItem] = []

  fileprivate init(arguments: LauncherArguments) {
    self.arguments = arguments
    if arguments.isIsolated {
      let domain = "AgentApprovalGate.NativeSelfTest.\(UUID().uuidString)"
      preferences = UserDefaults(suiteName: domain)!
      testPreferencesDomain = domain
    } else {
      preferences = .standard
      testPreferencesDomain = nil
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // A regular app policy enables the same last-window-close behavior in
    // production and in the lifecycle self-test.
    NSApp.setActivationPolicy(.regular)
    installApplicationMenu()
    buildWindow()
    if arguments.isIsolated {
      guard let root = arguments.testRoot else { finishSelfTest("FAIL:test-root"); return }
      do {
        guard !FileManager.default.fileExists(atPath: root.path) else {
          if arguments.selfTest {
            finishSelfTest("FAIL:test-root-not-fresh")
          } else {
            showError("Choose a new empty folder for the isolated test root, then relaunch.")
          }
          return
        }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        let appData = root.appendingPathComponent("appdata", isDirectory: true)
        let workspacePath = root.appendingPathComponent("workspace", isDirectory: true)
        try FileManager.default.createDirectory(at: workspacePath, withIntermediateDirectories: false)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: workspacePath.path)
        guard let workspace = try GatewayProcess.canonicalDirectoryForUI(workspacePath) else {
          if arguments.selfTest {
            finishSelfTest("FAIL:test-workspace")
          } else {
            showError("Could not create the isolated workspace. Choose a new empty test root.")
          }
          return
        }
        selfTestWorkspace = workspace
        if !arguments.selfTest {
          preferences.set(workspace.path, forKey: "lastWorkspacePath")
          selfTestApplicationDataRoot = appData
          workspaceLabel.stringValue = "Last workspace: \(workspace.path)"
          statusLabel.stringValue = "Reopen the last workspace, or choose another."
          reopenButton.isEnabled = true
          window.makeKeyAndOrderFront(nil)
          NSApp.activate(ignoringOtherApps: true)
          return
        }
        guard window.title == "Agent Approval Gate",
              scopeLabel.stringValue.contains("Only actions sent through this gateway are checked."),
              chooseButton.title == "Choose Workspace",
              tutorialButton.title == "Try Tutorial",
              hasAccessibleApplicationMenus()
        else {
          finishSelfTest("FAIL:native-start-screen")
          return
        }
        selfTestApplicationDataRoot = appData
        // The last-window-close test must close a visible window. Closing an
        // ordered-out window does not exercise AppKit's last-window behavior.
        window.makeKeyAndOrderFront(nil)
        tutorialButton.performClick(nil)
      } catch {
        if arguments.selfTest {
          finishSelfTest("FAIL:test-root-setup")
        } else {
          showError("Could not prepare the isolated test workspace. Choose a new empty folder and relaunch.")
        }
      }
    } else {
      window.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      updateReturningWorkspace()
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationWillTerminate(_ notification: Notification) {
    if let domain = testPreferencesDomain { preferences.removePersistentDomain(forName: domain) }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    terminationRequested = true
    guard gateway != nil || lastShutdownFailure != nil else { return .terminateNow }
    let selfTestTermination = arguments.selfTest && selfTestTerminationArmed
    let stoppingGateway = gateway
    let childPID = stoppingGateway?.childProcessIdentifier
    let gatewayPort = stoppingGateway?.ready.flatMap { URL(string: $0.url)?.port }
    Task { @MainActor in
      if stoppingGateway != nil { await stopSession() }
      if selfTestTermination {
        let stoppedExactly = childPID.map { !Self.processIsRunning($0) } ?? false
        let listenerClosed = gatewayPort.map(Self.loopbackPortIsClosed) ?? false
        let selectionRetained = activeMode == .workspace && activeWorkspace == selfTestWorkspace
        guard stoppedExactly, listenerClosed, selectionRetained, gateway == nil, dashboard == nil,
              restartButton.isEnabled, !stopButton.isEnabled, lastShutdownFailure == nil
        else {
          reportSelfTestTermination(passed: false)
          return
        }
        reportSelfTestTermination(passed: true)
      }
      if let failure = await self.takeShutdownFailure() {
        let shouldQuit = self.presentShutdownFailure(failure)
        if !shouldQuit {
          terminationRequested = false
          window.makeKeyAndOrderFront(nil)
          updateControls()
        }
        sender.reply(toApplicationShouldTerminate: shouldQuit)
        return
      }
      sender.reply(toApplicationShouldTerminate: true)
    }
    return .terminateLater
  }

  @objc private func chooseWorkspace(_ sender: Any?) {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    panel.resolvesAliases = true
    panel.prompt = "Use Workspace"
    panel.message = "Choose the folder where mediated file actions may run."
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      guard let workspace = try GatewayProcess.canonicalDirectoryForUI(url) else {
        showError("Choose an existing workspace directory.")
        return
      }
      preferences.set(workspace.path, forKey: "lastWorkspacePath")
      start(mode: .workspace, workspace: workspace)
    } catch {
      showError("The selected workspace is not available.")
    }
  }

  @objc private func tryTutorial(_ sender: Any?) {
    start(
      mode: .tutorial,
      workspace: nil,
      supportRoot: arguments.isIsolated ? selfTestApplicationDataRoot : nil,
      isTest: arguments.selfTest
    )
  }

  @objc private func reopenLastWorkspace(_ sender: Any?) {
    guard let path = preferences.string(forKey: "lastWorkspacePath") else { return }
    do {
      guard let workspace = try GatewayProcess.canonicalDirectoryForUI(URL(fileURLWithPath: path)) else {
        showError("The saved workspace is unavailable. Choose it again to continue.")
        return
      }
      start(
        mode: .workspace,
        workspace: workspace,
        supportRoot: arguments.isIsolated ? selfTestApplicationDataRoot : nil,
        isTest: arguments.selfTest
      )
    } catch {
      showError("The saved workspace is unavailable. Choose it again to continue.")
    }
  }

  @objc private func restartGateway(_ sender: Any?) {
    guard let mode = activeMode else { return }
    start(
      mode: mode,
      workspace: activeWorkspace,
      supportRoot: arguments.isIsolated ? selfTestApplicationDataRoot : nil,
      isTest: arguments.selfTest
    )
  }

  @objc private func stopGateway(_ sender: Any?) {
    guard !busy else { return }
    busy = true
    updateControls()
    Task { @MainActor in
      let childPID = gateway?.childProcessIdentifier
      let gatewayPort = gateway?.ready.flatMap { URL(string: $0.url)?.port }
      await stopSession()
      if let failure = await takeShutdownFailure() {
        statusLabel.stringValue = "The managed gateway needs attention."
        showError("\(failure) Reopen the workspace or select Restart Gateway after checking Terminal.")
      } else {
        statusLabel.stringValue = "Gateway stopped."
      }
      busy = false
      updateControls()
      if arguments.selfTest && selfTestManualStopArmed {
        let selectionRetained = activeMode == .workspace && activeWorkspace == selfTestWorkspace
        let childExited = childPID == selfTestManualStopPID &&
          childPID.map { !Self.processIsRunning($0) } == true
        let listenerClosed = gatewayPort.map(Self.loopbackPortIsClosed) ?? false
        guard selectionRetained, childExited, listenerClosed, gateway == nil, dashboard == nil,
              !stopButton.isEnabled, restartButton.isEnabled,
              workspaceLabel.stringValue == "Workspace: \(selfTestWorkspace?.path ?? "")",
              lastShutdownFailure == nil
        else {
          finishSelfTest("FAIL:manual-stop-state")
          return
        }
        selfTestManualStopArmed = false
        selfTestManualStopCompleted = true
        selfTestPageStarted = false
        if !terminationRequested { restartButton.performClick(nil) }
      }
    }
  }

  private func buildWindow() {
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Agent Approval Gate"
    window.identifier = NSUserInterfaceItemIdentifier("aag.launcher-window")
    window.minSize = NSSize(width: 720, height: 480)
    window.center()

    scopeLabel.lineBreakMode = .byWordWrapping
    scopeLabel.maximumNumberOfLines = 2
    workspaceLabel.lineBreakMode = .byTruncatingMiddle
    errorLabel.textColor = .systemRed
    errorLabel.isHidden = true

    chooseButton = button("Choose Workspace", #selector(chooseWorkspace(_:)))
    tutorialButton = button("Try Tutorial", #selector(tryTutorial(_:)))
    reopenButton = button("Reopen Last Workspace", #selector(reopenLastWorkspace(_:)))
    restartButton = button("Restart Gateway", #selector(restartGateway(_:)))
    stopButton = button("Stop Gateway", #selector(stopGateway(_:)))
    reopenButton.isEnabled = preferences.string(forKey: "lastWorkspacePath") != nil
    restartButton.isEnabled = false
    stopButton.isEnabled = false

    let controls = NSStackView(views: [chooseButton, tutorialButton, reopenButton, restartButton, stopButton])
    controls.orientation = .horizontal
    controls.alignment = .centerY
    controls.distribution = .fill
    controls.spacing = 8

    dashboardSlot.translatesAutoresizingMaskIntoConstraints = false
    dashboardSlot.setContentHuggingPriority(.defaultLow, for: .vertical)
    dashboardSlot.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
    dashboardSlot.heightAnchor.constraint(greaterThanOrEqualToConstant: 300).isActive = true

    let content = NSStackView(views: [scopeLabel, controls, workspaceLabel, statusLabel, errorLabel, dashboardSlot])
    content.orientation = .vertical
    content.alignment = .leading
    content.distribution = .fill
    content.spacing = 10
    content.edgeInsets = NSEdgeInsets(top: 16, left: 18, bottom: 16, right: 18)
    content.translatesAutoresizingMaskIntoConstraints = false
    let root = NSView()
    root.addSubview(content)
    NSLayoutConstraint.activate([
      content.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: root.trailingAnchor),
      content.topAnchor.constraint(equalTo: root.topAnchor),
      content.bottomAnchor.constraint(equalTo: root.bottomAnchor),
      dashboardSlot.widthAnchor.constraint(equalTo: content.widthAnchor),
    ])
    window.contentView = root
  }

  private func installApplicationMenu() {
    let mainMenu = NSMenu()

    let appMenuItem = NSMenuItem()
    let appMenu = NSMenu(title: "Agent Approval Gate")
    let about = NSMenuItem(
      title: "About Agent Approval Gate",
      action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
      keyEquivalent: ""
    )
    about.target = NSApp
    identify(about, as: "application.about", label: "About Agent Approval Gate")
    appMenu.addItem(about)
    appMenu.addItem(.separator())

    let hide = NSMenuItem(title: "Hide Agent Approval Gate", action: NSSelectorFromString("hide:"), keyEquivalent: "h")
    hide.target = NSApp
    hide.keyEquivalentModifierMask = [.command]
    identify(hide, as: "application.hide", label: "Hide Agent Approval Gate")
    appMenu.addItem(hide)
    let hideOthers = NSMenuItem(
      title: "Hide Others",
      action: #selector(NSApplication.hideOtherApplications(_:)),
      keyEquivalent: "h"
    )
    hideOthers.target = NSApp
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    identify(hideOthers, as: "application.hide-others", label: "Hide Others")
    appMenu.addItem(hideOthers)
    let showAll = NSMenuItem(
      title: "Show All",
      action: #selector(NSApplication.unhideAllApplications(_:)),
      keyEquivalent: ""
    )
    showAll.target = NSApp
    identify(showAll, as: "application.show-all", label: "Show All")
    appMenu.addItem(showAll)
    appMenu.addItem(.separator())

    let quit = NSMenuItem(
      title: "Quit Agent Approval Gate",
      action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q"
    )
    quit.target = NSApp
    quit.keyEquivalentModifierMask = [.command]
    identify(quit, as: "application.quit", label: "Quit Agent Approval Gate")
    appMenu.addItem(quit)
    quitMenuItem = quit
    appMenuItem.identifier = NSUserInterfaceItemIdentifier("application.menu")
    appMenuItem.submenu = appMenu
    mainMenu.addItem(appMenuItem)

    let editMenuItem = NSMenuItem()
    let editMenu = NSMenu(title: "Edit")
    let editItems: [(String, String, String, NSEvent.ModifierFlags)] = [
      ("Undo", "undo:", "z", [.command]),
      ("Redo", "redo:", "z", [.command, .shift]),
      ("Cut", "cut:", "x", [.command]),
      ("Copy", "copy:", "c", [.command]),
      ("Paste", "paste:", "v", [.command]),
      ("Select All", "selectAll:", "a", [.command]),
    ]
    for (title, selector, key, modifiers) in editItems {
      let item = NSMenuItem(title: title, action: NSSelectorFromString(selector), keyEquivalent: key)
      item.target = nil
      item.keyEquivalentModifierMask = modifiers
      identify(item, as: "edit.\(selector.dropLast())", label: title)
      editMenu.addItem(item)
      editMenuItems.append(item)
    }
    editMenuItem.identifier = NSUserInterfaceItemIdentifier("edit.menu")
    editMenuItem.submenu = editMenu
    mainMenu.addItem(editMenuItem)
    NSApp.mainMenu = mainMenu
  }

  private func identify(_ item: NSMenuItem, as identifier: String, label: String) {
    item.identifier = NSUserInterfaceItemIdentifier(identifier)
    item.title = label
  }

  private func hasAccessibleApplicationMenus() -> Bool {
    guard let quitMenuItem,
          quitMenuItem.identifier?.rawValue == "application.quit",
          quitMenuItem.title == "Quit Agent Approval Gate",
          quitMenuItem.action == #selector(NSApplication.terminate(_:)),
          quitMenuItem.target === NSApp,
          quitMenuItem.keyEquivalent.lowercased() == "q",
          quitMenuItem.keyEquivalentModifierMask.contains(.command),
          NSApp.mainMenu?.items.count == 2,
          NSApp.mainMenu?.item(at: 0)?.submenu?.title == "Agent Approval Gate",
          NSApp.mainMenu?.item(at: 1)?.submenu?.title == "Edit",
          NSApp.mainMenu?.item(at: 0)?.identifier?.rawValue == "application.menu",
          NSApp.mainMenu?.item(at: 1)?.identifier?.rawValue == "edit.menu",
          editMenuItems.count == 6
    else { return false }
    let expected: [(String, String, NSEvent.ModifierFlags)] = [
      ("undo:", "z", [.command]),
      ("redo:", "z", [.command, .shift]),
      ("cut:", "x", [.command]),
      ("copy:", "c", [.command]),
      ("paste:", "v", [.command]),
      ("selectAll:", "a", [.command]),
    ]
    guard editMenuItems.count == expected.count else { return false }
    for index in expected.indices {
      let item = editMenuItems[index]
      let values = expected[index]
      guard item.action == NSSelectorFromString(values.0),
            item.keyEquivalent == values.1,
            item.keyEquivalentModifierMask == values.2,
            item.identifier?.rawValue.hasPrefix("edit.") == true
      else { return false }
    }
    return true
  }

  private static func processIsRunning(_ pid: Int32) -> Bool {
    if Darwin.kill(pid, 0) == 0 { return true }
    return errno != ESRCH
  }

  private static func loopbackPortIsClosed(_ port: Int) -> Bool {
    guard (1...65535).contains(port) else { return false }
    let descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return false }
    defer { _ = Darwin.close(descriptor) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(port).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let connected = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    return connected != 0 && errno == ECONNREFUSED
  }

  private func button(_ title: String, _ action: Selector) -> NSButton {
    let control = NSButton(title: title, target: self, action: action)
    control.bezelStyle = .rounded
    control.setAccessibilityIdentifier(title.lowercased().replacingOccurrences(of: " ", with: "-"))
    return control
  }

  private func start(
    mode: DesktopMode,
    workspace: URL?,
    supportRoot: URL? = nil,
    isTest: Bool = false
  ) {
    guard !busy, !terminationRequested else { return }
    activeMode = mode
    activeWorkspace = workspace
    busy = true
    errorLabel.isHidden = true
    statusLabel.stringValue = "Starting the local gateway…"
    updateControls()
    Task { @MainActor in
      await stopSession()
      guard !terminationRequested else {
        busy = false
        updateControls()
        return
      }
      do {
        let root: URL
        if arguments.isIsolated {
          guard let isolatedRoot = selfTestApplicationDataRoot else {
            throw LauncherFailure.invalidReadyPaths
          }
          root = isolatedRoot
        } else if let supportRoot {
          root = supportRoot
        } else {
          let appSupport = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
          )
          root = appSupport.appendingPathComponent("Agent Approval Gate", isDirectory: true)
        }
        let host = try GatewayProcess(
          applicationSupportRoot: root,
          requiresFreshRoot: isTest && !selfTestRootInitialized
        )
        host.onUnexpectedTermination = { [self, weak host] in
          guard let host else { return }
          self.handleUnexpectedTermination(of: host)
        }
        if isTest { selfTestRootInitialized = true }
        // Keep the process reachable during the handshake so app termination can close stdin.
        gateway = host
        let ready = try await host.start(mode: mode, workspace: workspace)
        guard !terminationRequested else {
          await stopSession()
          busy = false
          return
        }
        guard host.isReadyAndRunning else { throw LauncherFailure.gatewayClosedBeforeReady }
        lastShutdownFailure = nil
        activeMode = mode
        activeWorkspace = workspace

        if isTest && mode == .tutorial && !selfTestStartupExitInjected {
          selfTestStartupExitInjected = true
          host.terminateForSelfTest()
          for _ in 0..<20 where host.isReadyAndRunning {
            try? await Task.sleep(for: .milliseconds(10))
          }
          if !host.isReadyAndRunning {
            busy = false
            updateControls()
            if let pending = pendingUnexpectedGateway {
              pendingUnexpectedGateway = nil
              handleUnexpectedTermination(of: pending)
            } else {
              handleUnexpectedTermination(of: host)
            }
            return
          }
        }
        guard host.isReadyAndRunning else { throw LauncherFailure.gatewayClosedBeforeReady }
        let page = try SecuredDashboard(ready: ready)
        gateway = host
        dashboard = page
        activeMode = mode
        activeWorkspace = workspace
        workspaceLabel.stringValue = mode == .tutorial
          ? "Tutorial workspace: \(ready.workspace)"
          : "Workspace: \(ready.workspace)"
        if isTest {
          page.didFinishMainFrame = { [weak owner = self] in
            guard let owner, !owner.selfTestPageStarted, let page = owner.dashboard else { return }
            owner.selfTestPageStarted = true
            if owner.activeMode == .tutorial {
              page.runTutorialSelfTest { result in owner.completeTutorialSelfTest(result) }
            } else if owner.selfTestWorkspaceReopened {
              page.runWorkspaceReturnSelfTest { result in owner.completeWorkspaceReturnSelfTest(result) }
            } else {
              page.runWorkspaceSelfTest { result in owner.completeWorkspaceSelfTest(result) }
            }
          }
        }
        install(page.webView)
        page.load()
        statusLabel.stringValue = "Gateway is running on this Mac."
        busy = false
        updateControls()
        drainPendingUnexpectedTermination()
      } catch {
        await stopSession()
        if terminationRequested {
          busy = false
          return
        }
        pendingUnexpectedGateway = nil
        busy = false
        statusLabel.stringValue = "Gateway stopped."
        let safeError = error is LauncherFailure ? error.localizedDescription :
          "The local gateway could not start. Check the app installation and try again."
        showError(safeError)
        updateControls()
        if isTest {
          let failure = error as NSError
          let diagnostic = "Self-test startup failed: \(safeError) (\(failure.domain), \(failure.code)).\n"
          try? FileHandle.standardError.write(contentsOf: Data(diagnostic.utf8))
          finishSelfTest("FAIL:startup")
        }
      }
    }
  }

  private func stopSession() async {
    if let stopSessionTask {
      await stopSessionTask.value
      return
    }
    let operationID = UUID()
    let task = Task { @MainActor [self] in
      if let dashboard { await dashboard.clearSession() }
      dashboard = nil
      for view in dashboardSlot.subviews { view.removeFromSuperview() }
      if let gateway, let failure = await gateway.stop() {
        lastShutdownFailure = failure
      }
      gateway = nil
      updateControls()
    }
    stopSessionID = operationID
    stopSessionTask = task
    await task.value
    if stopSessionID == operationID {
      stopSessionTask = nil
      stopSessionID = nil
    }
  }

  private func takeShutdownFailure() async -> String? {
    if let stopSessionTask { await stopSessionTask.value }
    return lastShutdownFailure
  }

  private func presentShutdownFailure(_ message: String) -> Bool {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "The managed gateway did not shut down cleanly"
    alert.informativeText = "\(message)\n\nChoose Keep Open to return to the app and restart the gateway. Choose Quit Anyway only if you accept that a managed Codex process may remain; close its Terminal session manually."
    alert.addButton(withTitle: "Keep Open")
    alert.addButton(withTitle: "Quit Anyway")
    alert.buttons.first?.keyEquivalent = "\r"
    return alert.runModal() == .alertSecondButtonReturn
  }

  private func handleUnexpectedTermination(of host: GatewayProcess) {
    guard gateway === host else { return }
    if busy {
      pendingUnexpectedGateway = host
      return
    }
    busy = true
    statusLabel.stringValue = "The local gateway stopped unexpectedly. Clearing the page session…"
    errorLabel.isHidden = true
    updateControls()
    let retired = dashboard
    dashboard = nil
    for view in dashboardSlot.subviews { view.removeFromSuperview() }
    Task { @MainActor in
      if let retired { await retired.clearSession() }
      _ = await host.stop()
      gateway = nil
      if arguments.selfTest { selfTestRetiredDashboard = retired }
      statusLabel.stringValue = "Gateway stopped unexpectedly."
      showError("The local gateway stopped unexpectedly. Its page session was cleared. Select Restart Gateway to reconnect.")
      busy = false
      updateControls()

      if arguments.selfTest {
        guard host.ready == nil, dashboard == nil, gateway == nil,
              (activeMode == .workspace && activeWorkspace == selfTestWorkspace) ||
                (activeMode == .tutorial && selfTestStartupExitInjected && !selfTestStartupExitHandled),
              restartButton.isEnabled, !stopButton.isEnabled,
              statusLabel.stringValue == "Gateway stopped unexpectedly.",
              !errorLabel.isHidden, errorLabel.stringValue.contains("reconnect"),
              (retired != nil || activeMode == .tutorial)
        else {
          finishSelfTest("FAIL:unexpected-exit-ui-state")
          return
        }
        let recover = { [self] in
          if activeMode == .tutorial {
            selfTestStartupExitHandled = true
          } else {
            selfTestUnexpectedExitHandled = true
          }
          self.selfTestPageStarted = false
          self.restartButton.performClick(nil)
        }
        if let retired {
          retired.verifySessionCleared { [self] cleared in
            guard cleared else { self.finishSelfTest("FAIL:unexpected-exit-token-clear"); return }
            recover()
          }
        } else {
          recover()
        }
      }
    }
  }

  private func drainPendingUnexpectedTermination() {
    guard let pending = pendingUnexpectedGateway else { return }
    pendingUnexpectedGateway = nil
    handleUnexpectedTermination(of: pending)
  }

  private func install(_ view: NSView) {
    for child in dashboardSlot.subviews { child.removeFromSuperview() }
    view.translatesAutoresizingMaskIntoConstraints = false
    dashboardSlot.addSubview(view)
    NSLayoutConstraint.activate([
      view.leadingAnchor.constraint(equalTo: dashboardSlot.leadingAnchor),
      view.trailingAnchor.constraint(equalTo: dashboardSlot.trailingAnchor),
      view.topAnchor.constraint(equalTo: dashboardSlot.topAnchor),
      view.bottomAnchor.constraint(equalTo: dashboardSlot.bottomAnchor),
    ])
  }

  private func updateControls() {
    reopenButton?.isEnabled = !busy && preferences.string(forKey: "lastWorkspacePath") != nil
    restartButton?.isEnabled = !busy && activeMode != nil && gateway == nil
    stopButton?.isEnabled = !busy && gateway != nil
  }

  private func updateReturningWorkspace() {
    if let last = preferences.string(forKey: "lastWorkspacePath") {
      workspaceLabel.stringValue = "Last workspace: \(last)"
      statusLabel.stringValue = "Reopen it, or choose another workspace."
      reopenButton.isEnabled = FileManager.default.fileExists(atPath: last)
    }
  }

  private func showError(_ text: String) {
    errorLabel.stringValue = text
    errorLabel.isHidden = false
  }

  private func finishSelfTest(_ result: String) {
    guard arguments.selfTest else { return }
    Task { @MainActor in
      await stopSession()
      let finalResult = lastShutdownFailure == nil ? result : "FAIL:shutdown"
      let passed = finalResult == "PASS"
      emitSelfTestResult(passed: passed, failure: finalResult)
      if passed {
        NSApp.terminate(nil)
      } else {
        Darwin.exit(1)
      }
    }
  }

  private func emitSelfTestResult(passed: Bool, failure: String? = nil) {
    if !passed, let failure {
      try? FileHandle.standardError.write(
        contentsOf: Data(("Native lifecycle self-test failed: \(failure)\n").utf8)
      )
    }
    let message = passed ? "AAG_SELF_TEST_OK\n" : "AAG_SELF_TEST_FAILED\n"
    if let domain = testPreferencesDomain { preferences.removePersistentDomain(forName: domain) }
    let handle = passed ? FileHandle.standardOutput : FileHandle.standardError
    if let data = message.data(using: .utf8) { try? handle.write(contentsOf: data) }
  }

  private func reportSelfTestTermination(passed: Bool) {
    emitSelfTestResult(passed: passed, failure: passed ? nil : "termination-shutdown")
    if !passed { Darwin.exit(1) }
  }

  private func completeTutorialSelfTest(_ result: String) {
    guard arguments.selfTest else { return }
    guard result == "PASS", let workspace = selfTestWorkspace else {
      finishSelfTest(result == "PASS" ? "FAIL:test-workspace-path" : result)
      return
    }
    selfTestPageStarted = false
    preferences.set(workspace.path, forKey: "lastWorkspacePath")
    reopenButton.isEnabled = true
    reopenButton.performClick(nil)
  }

  private func completeWorkspaceSelfTest(_ result: String) {
    guard arguments.selfTest else { return }
    guard result == "PASS", let workspace = selfTestWorkspace else {
      finishSelfTest(result)
      return
    }
    let output = workspace.appendingPathComponent("native-self-test.txt")
    guard let contents = try? String(contentsOf: output, encoding: .utf8),
          contents == "Native launcher approval verified.\n" else {
      finishSelfTest("FAIL:workspace-file-content")
      return
    }
    selfTestWorkspaceReopened = true
    selfTestPageStarted = false
    preferences.set(workspace.path, forKey: "lastWorkspacePath")
    reopenButton.isEnabled = true
    reopenButton.performClick(nil)
  }

  private func completeWorkspaceReturnSelfTest(_ result: String) {
    guard arguments.selfTest, result == "PASS", let root = arguments.testRoot else {
      finishSelfTest(result)
      return
    }
    guard selfTestUnexpectedExitHandled else {
      guard let gateway else { finishSelfTest("FAIL:unexpected-exit-child"); return }
      gateway.terminateForSelfTest()
      return
    }
    if !selfTestManualStopCompleted {
      guard let host = gateway, host.isReadyAndRunning,
            host.ready?.mode == .workspace,
            host.ready?.workspace == selfTestWorkspace?.path,
            activeMode == .workspace,
            activeWorkspace == selfTestWorkspace,
            let childPID = host.childProcessIdentifier,
            let dataDir = host.ready?.dataDir
      else {
        finishSelfTest("FAIL:manual-stop-precondition")
        return
      }
      selfTestManualStopPID = childPID
      selfTestManualStopDataDir = dataDir
      selfTestManualStopArmed = true
      stopButton.performClick(nil)
      return
    }
    guard let host = gateway, host.isReadyAndRunning,
          host.ready?.mode == .workspace,
          host.ready?.workspace == selfTestWorkspace?.path,
          host.ready?.dataDir == selfTestManualStopDataDir,
          activeMode == .workspace,
          activeWorkspace == selfTestWorkspace
    else {
      finishSelfTest("FAIL:restart-selection")
      return
    }
    let snapshot = root.appendingPathComponent("self-test-dashboard.png")
    dashboard?.saveSelfTestSnapshot(to: snapshot) { [weak owner = self] saved in
      guard let owner else { return }
      guard saved else { owner.finishSelfTest("FAIL:screenshot"); return }
      owner.requestSelfTestTermination()
    }
  }

  private func requestSelfTestTermination() {
    guard arguments.selfTest, !selfTestTerminationArmed,
          gateway?.isReadyAndRunning == true,
          activeMode == .workspace,
          activeWorkspace == selfTestWorkspace
    else {
      finishSelfTest("FAIL:termination-precondition")
      return
    }
    selfTestTerminationArmed = true
    switch arguments.selfTestTermination {
    case .commandQ:
      guard let event = NSEvent.keyEvent(
        with: .keyDown,
        location: .zero,
        modifierFlags: [.command],
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber,
        context: nil,
        characters: "q",
        charactersIgnoringModifiers: "q",
        isARepeat: false,
        keyCode: 12
      ), NSApp.mainMenu?.performKeyEquivalent(with: event) == true
      else {
        selfTestTerminationArmed = false
        finishSelfTest("FAIL:command-q-menu-action")
        return
      }
    case .windowClose:
      // Route through the real close-button action on a visible window. AppKit
      // must call applicationShouldTerminateAfterLastWindowClosed and then
      // applicationShouldTerminate; explicitly calling terminate here would
      // hide a regression in last-window handling.
      guard window.isVisible else {
        selfTestTerminationArmed = false
        finishSelfTest("FAIL:window-not-visible")
        return
      }
      window.performClose(nil)
    }
  }
}

@main
struct NativeLauncherMain {
  @MainActor
  static func main() {
    let args: LauncherArguments
    do {
      args = try LauncherArguments(Array(CommandLine.arguments.dropFirst()))
    } catch {
      FileHandle.standardError.write(Data("Invalid launcher arguments.\n".utf8))
      Darwin.exit(2)
    }
    let application = NSApplication.shared
    let delegate = LauncherApplication(arguments: args)
    application.delegate = delegate
    application.run()
  }
}
